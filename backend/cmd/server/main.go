package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"

	"github.com/Alarion239/my239/backend/internal/config"
	"github.com/Alarion239/my239/backend/internal/handlers/auth"
	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/Alarion239/my239/backend/internal/middleware"
	tghandlers "github.com/Alarion239/my239/backend/internal/tg-bot-handlers"
	"github.com/Alarion239/my239/backend/pkg/db"
	"github.com/go-telegram/bot"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	// Initialize logger
	logger.Init()

	// Initialize database
	database, err := db.NewDB(ctx, config.DatabaseURL)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer database.Close()

	port := config.Port

	// Initialize Telegram bot
	telegramBot := initTelegramBot(ctx)

	// Create router
	mux := http.NewServeMux()

	// REST API routes (public)
	mux.Handle("/api/v1/auth/register", middleware.RateLimitMiddleware(middleware.RegisterLimiter)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth.Register(database, r.Context(), w, r)
	})))
	mux.Handle("/api/v1/auth/login", middleware.RateLimitMiddleware(middleware.LoginLimiter)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth.Login(database, w, r)
	})))

	// REST API routes (protected)
	mux.Handle("/api/v1/auth/me", middleware.AuthMiddleware(database, middleware.RateLimitMiddleware(middleware.AuthLimiter)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth.Me(database, w, r)
	}))))

	// Telegram webhook route
	if telegramBot != nil {
		mux.Handle("/webhooks/telegram", telegramBot.WebhookHandler())
		logger.LogInfo("Telegram webhook handler registered")
	}

	// Apply middleware chain
	handler := middleware.LoggerMiddleware(
		middleware.SecurityHeadersMiddleware(
			middleware.CORSMiddleware()(
				mux,
			),
		),
	)

	fmt.Printf("Unified server starting on port %s\n", port)
	fmt.Println("Available endpoints:")
	fmt.Println("  POST /api/v1/auth/register  - Register new user")
	fmt.Println("  POST /api/v1/auth/login     - Login user")
	fmt.Println("  GET  /api/v1/auth/me        - Get current user (requires Bearer token)")
	fmt.Println("  POST /webhooks/telegram     - Telegram webhook")

	// Start server
	go func() {
		if err := http.ListenAndServe(":"+port, handler); err != nil {
			log.Fatal(err)
		}
	}()

	<-ctx.Done()
	logger.LogInfo("Server shutting down gracefully...")
}

func initTelegramBot(ctx context.Context) *bot.Bot {
	botToken := config.TelegramBotToken
	if botToken == "" {
		logger.LogInfo("TELEGRAM_BOT_TOKEN not set, skipping Telegram bot initialization")
		return nil
	}

	secretToken := bot.RandomString(128)
	webhookURL := config.BackendDomain + "/webhooks/telegram"

	logger.LogInfo("Telegram bot configured", "webhook_url", webhookURL)

	opts := []bot.Option{
		bot.WithDefaultHandler(tghandlers.TelegramWebhooksHandler),
		bot.WithWebhookSecretToken(secretToken),
	}

	b, err := bot.New(botToken, opts...)
	if err != nil {
		logger.LogError("Failed to create Telegram bot", err)
		return nil
	}

	// Set webhook
	ok, err := b.SetWebhook(ctx, &bot.SetWebhookParams{
		URL:         webhookURL,
		SecretToken: secretToken,
	})
	if err != nil || !ok {
		logger.LogError("Failed to set webhook", err)
		return nil
	}

	logger.LogInfo("Telegram bot initialized successfully")
	return b
}
