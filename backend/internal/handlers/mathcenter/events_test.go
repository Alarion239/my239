package mathcenter_test

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/pashagolub/pgxmock/v4"

	internalAuth "github.com/Alarion239/my239/backend/internal/auth"
	mcHandlers "github.com/Alarion239/my239/backend/internal/handlers/mathcenter"
	"github.com/Alarion239/my239/backend/internal/live"
	"github.com/Alarion239/my239/backend/internal/middleware"
	"github.com/Alarion239/my239/backend/pkg/db"
)

// newEventsServer wires a minimal router (auth + impersonation middleware +
// the SSE Events handler) around a mock pool and an explicit hub the test
// controls, then serves it from a real httptest.Server so streaming/flushing
// works (httptest.NewRecorder cannot stream). Returns the server, the access
// service for minting tokens, and the hub for publishing.
func newEventsServer(t *testing.T, mock pgxmock.PgxPoolIface) (*httptest.Server, *internalAuth.AccessTokenService, *live.Hub) {
	t.Helper()
	database := db.NewWithPool(mock)
	access := newAccess(t)
	hub := live.NewHub()

	r := chi.NewRouter()
	r.Use(middleware.AuthMiddleware(access))
	r.Use(middleware.ImpersonationMiddleware(database))
	r.Get("/centers/{centerID}/events", mcHandlers.Events(hub, database))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv, access, hub
}

func TestEvents_NonMemberForbidden(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	srv, access, _ := newEventsServer(t, mock)

	// Non-admin caller who is neither teacher nor student of center 42.
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_teachers`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_teacher"}).AddRow(false))
	mock.ExpectQuery(`SELECT EXISTS .* FROM math_center_students`).
		WithArgs(int64(7), int64(42)).
		WillReturnRows(mock.NewRows([]string{"is_student"}).AddRow(false))

	tok, err := access.Generate(7, "user7", false)
	if err != nil {
		t.Fatalf("token: %v", err)
	}
	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/centers/42/events", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("got %d, want 403", resp.StatusCode)
	}
}

func TestEvents_MemberStreamsConnectedThenEvent(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	srv, access, hub := newEventsServer(t, mock)

	// Admin bypasses the membership DB lookups (teacher superset).
	tok, err := access.Generate(1, "admin", true)
	if err != nil {
		t.Fatalf("token: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/centers/42/events", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("got %d, want 200", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content-type %q, want text/event-stream", ct)
	}

	reader := bufio.NewReader(resp.Body)

	// First frame is the `: connected` comment.
	line, err := reader.ReadString('\n')
	if err != nil {
		t.Fatalf("read connected: %v", err)
	}
	if !strings.HasPrefix(line, ": connected") {
		t.Fatalf("first line %q, want `: connected`", line)
	}

	// Publish a grading event for center 42; expect an `event: grading` frame.
	// Retry a few times to avoid racing the handler's Subscribe.
	got := make(chan string, 1)
	go func() {
		for {
			l, err := reader.ReadString('\n')
			if err != nil {
				return
			}
			if strings.HasPrefix(l, "event: ") {
				got <- strings.TrimSpace(strings.TrimPrefix(l, "event: "))
				return
			}
		}
	}()

	deadline := time.After(2 * time.Second)
	tick := time.NewTicker(20 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case kind := <-got:
			if kind != "grading" {
				t.Fatalf("got event %q, want grading", kind)
			}
			return
		case <-deadline:
			t.Fatal("did not receive grading event")
		case <-tick.C:
			hub.Publish(live.Event{CenterID: 42, Kind: live.KindGrading, SeriesID: 7})
		}
	}
}
