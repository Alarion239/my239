package telegramalerts

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/Alarion239/my239/backend/internal/config"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/metrics"
	"github.com/Alarion239/my239/backend/pkg/ratelimit"
)

const (
	alertQueueSize             = 512
	alertBatchWindow           = 300 * time.Millisecond
	alertMaxMessageBytes       = 3900 // leave margin below Telegram's 4096-byte limit
	alertMaxRetries            = 5
	passwordPrompt             = "Reply to this message with the Telegram alerts password."
	groupRequestID       int64 = 274239
)

type botAPI interface {
	GetMe(context.Context) (BotUser, error)
	SetWebhook(context.Context, string, string) error
	GetChat(context.Context, int64) (Chat, error)
	GetChatMember(context.Context, int64, int64) (ChatMember, error)
	SendMessage(context.Context, int64, string, any) error
	DeleteMessage(context.Context, int64, int64) error
}

// Service is both the asynchronous logger sink and the Telegram bot's
// subscription/delivery service.
type Service struct {
	cfg      config.TelegramAlertsConfig
	repo     *Repository
	bot      botAPI
	limiter  ratelimit.Limiter
	password [sha256.Size]byte
	queue    chan logger.AlertEvent

	ctx       context.Context
	cancel    context.CancelFunc
	done      chan struct{}
	closeOnce sync.Once
	started   atomic.Bool
	inFlight  atomic.Int64
	botUserID atomic.Int64
	dropped   atomic.Uint64

	rateMu   sync.Mutex
	nextSend map[int64]time.Time
}

func NewService(cfg config.TelegramAlertsConfig, repo *Repository, limiter ratelimit.Limiter) *Service {
	return &Service{
		cfg:      cfg,
		repo:     repo,
		bot:      NewBotClient(cfg.BotToken),
		limiter:  limiter,
		password: sha256.Sum256([]byte(cfg.SubscribePassword)),
		queue:    make(chan logger.AlertEvent, alertQueueSize),
		done:     make(chan struct{}),
		nextSend: make(map[int64]time.Time),
	}
}

// Start launches webhook registration and the bounded delivery worker. It
// never performs network I/O synchronously on the server startup path.
func (s *Service) Start(parent context.Context) {
	if s.started.Swap(true) {
		return
	}
	s.ctx, s.cancel = context.WithCancel(parent)
	go func() {
		if err := logger.Guard("telegram alerts worker", func() error {
			s.run(s.ctx)
			return nil
		}); err != nil {
			logger.LogWarn("telegram alerts worker stopped after panic", "error", err)
		}
	}()
	go func() {
		if err := logger.Guard("telegram webhook registration", func() error {
			s.registerWebhook(s.ctx)
			return nil
		}); err != nil {
			logger.LogWarn("telegram webhook registration stopped after panic", "error", err)
		}
	}()
}

func (s *Service) Enqueue(event logger.AlertEvent) {
	kind := "error"
	if event.Attrs["fatal"] == "true" {
		kind = "fatal"
	} else if event.Attrs["stack"] != "" || event.Attrs["panic"] != "" {
		kind = "panic"
	}
	metrics.TelegramAlertEvents.WithLabelValues(kind).Inc()
	select {
	case s.queue <- event:
		metrics.TelegramAlertQueueDepth.Set(float64(len(s.queue)))
	default:
		s.dropped.Add(1)
		metrics.TelegramAlertDropped.Inc()
		metrics.TelegramAlertDeliveries.WithLabelValues("dropped").Inc()
		logger.LogWarn("telegram alert queue full; event dropped")
	}
}

func (s *Service) run(ctx context.Context) {
	defer close(s.done)
	for {
		select {
		case <-ctx.Done():
			return
		case first := <-s.queue:
			metrics.TelegramAlertQueueDepth.Set(float64(len(s.queue)))
			s.inFlight.Add(1)
			batch := s.collectBatch(ctx, first)
			if dropped := s.dropped.Swap(0); dropped > 0 {
				batch = append([]logger.AlertEvent{droppedSummary(dropped)}, batch...)
			}
			s.deliverBatch(ctx, batch)
			s.inFlight.Add(-1)
		}
	}
}

func (s *Service) collectBatch(ctx context.Context, first logger.AlertEvent) []logger.AlertEvent {
	batch := []logger.AlertEvent{first}
	timer := time.NewTimer(alertBatchWindow)
	defer timer.Stop()
	for len(batch) < 32 {
		select {
		case <-ctx.Done():
			return batch
		case next := <-s.queue:
			batch = append(batch, next)
			metrics.TelegramAlertQueueDepth.Set(float64(len(s.queue)))
		case <-timer.C:
			return batch
		}
	}
	return batch
}

func (s *Service) deliverBatch(ctx context.Context, events []logger.AlertEvent) {
	subs, err := s.repo.ListActiveSubscriptions(ctx)
	if err != nil {
		logger.LogWarn("telegram alerts: list subscriptions failed", "error", err)
		return
	}
	for _, sub := range subs {
		if err := s.deliverToSubscription(ctx, sub, events); err != nil {
			logger.LogWarn("telegram alerts: delivery failed", "error", err, "chat_type", sub.ChatType)
		}
	}
}

func (s *Service) deliverToSubscription(ctx context.Context, sub Subscription, events []logger.AlertEvent) error {
	chunks := formatBatch(events, s.cfg.Environment)
	for _, chunk := range chunks {
		if err := s.waitForChatRate(ctx, sub); err != nil {
			return err
		}
		if err := s.sendWithRetry(ctx, sub.ChatID, chunk); err != nil {
			var apiErr *APIError
			if errors.As(err, &apiErr) && (apiErr.Code == 403 || apiErr.Code == 400) {
				if disableErr := s.repo.DisableSubscription(context.Background(), sub.ChatID); disableErr != nil {
					logger.LogWarn("telegram alerts: disable subscription failed", "error", disableErr)
				} else {
					metrics.TelegramAlertDisabledSubscriptions.Inc()
				}
			}
			return err
		}
		metrics.TelegramAlertDeliveries.WithLabelValues("sent").Inc()
	}
	return nil
}

func (s *Service) waitForChatRate(ctx context.Context, sub Subscription) error {
	delay := time.Second
	if sub.ChatType == "group" || sub.ChatType == "supergroup" {
		delay = 3 * time.Second
	}
	s.rateMu.Lock()
	wait := time.Until(s.nextSend[sub.ChatID])
	if wait < 0 {
		wait = 0
	}
	s.nextSend[sub.ChatID] = time.Now().Add(delay)
	s.rateMu.Unlock()
	if wait == 0 {
		return nil
	}
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (s *Service) sendWithRetry(ctx context.Context, chatID int64, text string) error {
	backoff := time.Second
	for attempt := 0; attempt < alertMaxRetries; attempt++ {
		err := s.bot.SendMessage(ctx, chatID, text, nil)
		if err == nil {
			return nil
		}
		var apiErr *APIError
		if !errors.As(err, &apiErr) || !apiErr.Transient() {
			return err
		}
		if attempt == alertMaxRetries-1 {
			s.dropped.Add(1)
			metrics.TelegramAlertDropped.Inc()
			metrics.TelegramAlertDeliveries.WithLabelValues("expired").Inc()
			return err
		}
		metrics.TelegramAlertRetries.Inc()
		metrics.TelegramAlertDeliveries.WithLabelValues("retry").Inc()
		wait := backoff
		if apiErr.RetryAfter > 0 {
			wait = time.Duration(apiErr.RetryAfter) * time.Second
		}
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
	return nil
}

func droppedSummary(count uint64) logger.AlertEvent {
	return logger.AlertEvent{
		Time:    time.Now().UTC(),
		Level:   slog.LevelError,
		Message: "telegram alerts were dropped",
		Attrs: map[string]string{
			"dropped_count": fmt.Sprint(count),
		},
	}
}

func (s *Service) registerWebhook(ctx context.Context) {
	backoff := time.Second
	for {
		if ctx.Err() != nil {
			return
		}
		callCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		me, err := s.bot.GetMe(callCtx)
		if err == nil {
			s.botUserID.Store(me.ID)
			err = s.bot.SetWebhook(callCtx, s.cfg.WebhookURL, s.cfg.WebhookSecret)
		}
		cancel()
		if err == nil {
			logger.LogInfo("telegram alerts: webhook registered", "environment", s.cfg.Environment)
			return
		}
		logger.LogWarn("telegram alerts: webhook registration unavailable; retrying", "error", err)
		timer := time.NewTimer(backoff)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		if backoff < time.Minute {
			backoff *= 2
		}
	}
}

// Flush waits until the queue and in-flight delivery batches are empty or the
// caller's deadline expires.
func (s *Service) Flush(ctx context.Context) {
	if !s.started.Load() {
		return
	}
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		if len(s.queue) == 0 && s.inFlight.Load() == 0 {
			if dropped := s.dropped.Swap(0); dropped > 0 {
				select {
				case s.queue <- droppedSummary(dropped):
					metrics.TelegramAlertQueueDepth.Set(float64(len(s.queue)))
					continue
				default:
					s.dropped.Add(dropped)
				}
			}
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Service) Close() {
	if !s.started.Load() {
		return
	}
	s.closeOnce.Do(func() {
		if s.cancel != nil {
			s.cancel()
		}
		<-s.done
	})
}

// VerifyPassword compares fixed-length SHA-256 digests, avoiding an early
// exit based on the first differing password byte.
func (s *Service) VerifyPassword(password string) bool {
	got := sha256.Sum256([]byte(password))
	return subtle.ConstantTimeCompare(got[:], s.password[:]) == 1
}

func (s *Service) AllowPasswordAttempt(ctx context.Context, userID int64) (bool, error) {
	if s.limiter == nil {
		return true, nil
	}
	returnValue, _, err := s.limiter.AllowKey(ctx, "telegram.alerts.password", fmt.Sprint(userID), 5, 15*60)
	return returnValue, err
}

func (s *Service) SendTest(ctx context.Context, sub Subscription) error {
	event := logger.AlertEvent{
		Time:    time.Now().UTC(),
		Level:   slog.LevelError,
		Message: "telegram alert delivery test",
		Attrs: map[string]string{
			"environment": s.cfg.Environment,
			"test":        "true",
		},
	}
	return s.deliverToSubscription(ctx, sub, []logger.AlertEvent{event})
}

func formatBatch(events []logger.AlertEvent, environment string) []string {
	var chunks []string
	var current strings.Builder
	for _, event := range events {
		formatted := formatEvent(event, environment)
		if current.Len() > 0 && current.Len()+len(formatted)+2 > alertMaxMessageBytes {
			chunks = append(chunks, current.String())
			current.Reset()
		}
		if current.Len() > 0 {
			current.WriteString("\n\n")
		}
		current.WriteString(formatted)
	}
	if current.Len() > 0 {
		chunks = append(chunks, current.String())
	}
	return chunks
}

func formatEvent(event logger.AlertEvent, environment string) string {
	var b strings.Builder
	b.WriteString("[my239 ")
	b.WriteString(cleanText(environment, 80))
	b.WriteString("] ")
	b.WriteString(event.Level.String())
	b.WriteString("\n")
	b.WriteString(event.Time.UTC().Format(time.RFC3339))
	b.WriteString("\n")
	b.WriteString(cleanText(event.Message, 300))

	known := []string{"error", "request_id", "method", "route", "status", "path", "panic", "dropped_count"}
	seen := make(map[string]struct{}, len(known)+1)
	for _, key := range known {
		seen[key] = struct{}{}
		appendAlertAttr(&b, key, event.Attrs[key])
	}
	otherKeys := make([]string, 0, len(event.Attrs))
	for key := range event.Attrs {
		if _, ok := seen[key]; ok || key == "stack" || sensitiveKey(key) {
			continue
		}
		otherKeys = append(otherKeys, key)
	}
	sort.Strings(otherKeys)
	for _, key := range otherKeys {
		appendAlertAttr(&b, key, event.Attrs[key])
	}
	if stack := event.Attrs["stack"]; stack != "" {
		b.WriteString("\nstack:\n")
		b.WriteString(cleanText(stack, 1800))
	}
	return truncateBytes(b.String(), alertMaxMessageBytes)
}

func appendAlertAttr(b *strings.Builder, key, value string) {
	if value == "" {
		return
	}
	b.WriteString("\n")
	b.WriteString(cleanText(key, 120))
	b.WriteString(": ")
	b.WriteString(cleanText(value, 900))
}

func sensitiveKey(key string) bool {
	key = strings.ToLower(key)
	for _, part := range []string{"password", "token", "authorization", "cookie", "secret", "body"} {
		if strings.Contains(key, part) {
			return true
		}
	}
	return false
}

func cleanText(value string, maxBytes int) string {
	value = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\r' || r == '\t' {
			return r
		}
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, value)
	return truncateBytes(value, maxBytes)
}

func truncateBytes(value string, maxBytes int) string {
	if len(value) <= maxBytes {
		return value
	}
	if maxBytes < 4 {
		return value[:maxBytes]
	}
	limit := maxBytes - 3
	for limit > 0 && !utf8.ValidString(value[:limit]) {
		limit--
	}
	return value[:limit] + "..."
}
