package live

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/pkg/db"
)

// Publish emits a center-change signal to all instances via pg_notify. Call it
// AFTER the mutation's transaction has committed, on the pool (not the tx), so a
// rollback never broadcasts a phantom change. Best-effort: a notify failure is
// logged, never surfaced to the user (the next refetch self-heals).
func Publish(ctx context.Context, q db.Querier, ev Event) {
	b, err := json.Marshal(ev)
	if err != nil {
		logger.LogErrorContext(ctx, "live: marshal event", err)
		return
	}
	if _, err := q.Exec(ctx, "SELECT pg_notify($1, $2)", Channel, string(b)); err != nil {
		logger.LogErrorContext(ctx, "live: pg_notify", err)
	}
}

// Run is the single per-instance listener: it holds one dedicated connection,
// LISTENs on Channel, and fans every NOTIFY into the in-process hub. It
// reconnects with backoff on connection loss and returns when ctx is done.
func Run(ctx context.Context, pool *pgxpool.Pool, hub *Hub) {
	const minBackoff, maxBackoff = time.Second, 30 * time.Second
	backoff := minBackoff
	for ctx.Err() == nil {
		if err := listenOnce(ctx, pool, hub); err != nil && ctx.Err() == nil {
			logger.LogErrorContext(ctx, "live: listener loop", err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(backoff):
			}
			if backoff *= 2; backoff > maxBackoff {
				backoff = maxBackoff
			}
			continue
		}
		backoff = minBackoff
	}
}

func listenOnce(ctx context.Context, pool *pgxpool.Pool, hub *Hub) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, "LISTEN "+Channel); err != nil {
		return err
	}
	logger.LogInfo("live: listening", "channel", Channel)
	for {
		n, err := conn.Conn().WaitForNotification(ctx)
		if err != nil {
			return err // includes ctx cancellation
		}
		var ev Event
		if err := json.Unmarshal([]byte(n.Payload), &ev); err != nil {
			logger.LogErrorContext(ctx, "live: bad notify payload", err)
			continue
		}
		hub.Publish(ev)
	}
}
