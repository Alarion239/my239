package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"

	"github.com/Alarion239/my239/backend/internal/logger"

	constants "github.com/Alarion239/my239/backend/internal/constants"
	handlers "github.com/Alarion239/my239/backend/internal/tg-bot-handlers"
	"github.com/Alarion239/my239/backend/pkg/db"

	"github.com/go-telegram/bot"
)

// Send any text message to the bot after the bot has been started

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	logger.Init()

	// Initialize database connection pool
	database, err := db.NewDB(ctx, os.Getenv(constants.DATABASE_URL))
	if err != nil {
		logger.LogError("Failed to initialize database pool", err)
		os.Exit(1)
	}
	defer database.Close()

	secretToken := bot.RandomString(128)
	webhookURL := os.Getenv(constants.BACKEND_DOMAIN) + "/webhooks/telegram"
	logger.LogInfo("Webhook URL:", webhookURL)

	opts := []bot.Option{
		bot.WithDefaultHandler(handlers.TelegramWebhooksHandler),
		bot.WithWebhookSecretToken(secretToken),
	}

	b, err := bot.New(os.Getenv(constants.TELEGRAM_BOT_TOKEN), opts...)
	if nil != err {
		logger.LogError("Failed to create bot", err)
	}

	ok, err := b.SetWebhook(ctx, &bot.SetWebhookParams{
		URL:         webhookURL,
		SecretToken: secretToken,
	})
	if nil != err {
		logger.LogError("Failed to set webhook", err)
	}
	if !ok {
		logger.LogError("Failed to set webhook", errors.New("failed to set webhook"))
	}

	go func() {
		http.ListenAndServe(":8080", b.WebhookHandler())
	}()

	b.StartWebhook(ctx)
}
