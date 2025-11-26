package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"

	"github.com/Alarion239/my239/backend/internal/constants"
	"github.com/Alarion239/my239/backend/internal/handlers"

	"github.com/go-telegram/bot"
)

// Send any text message to the bot after the bot has been started

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	secretToken := bot.RandomString(128)
	webhookURL := os.Getenv(constants.BACKEND_DOMAIN) + "/webhooks/telegram"
	log.Println("Webhook URL:", webhookURL)

	opts := []bot.Option{
		bot.WithDefaultHandler(handlers.TelegramWebhooksHandler),
		bot.WithWebhookSecretToken(secretToken),
	}

	b, err := bot.New(os.Getenv(constants.TELEGRAM_BOT_TOKEN), opts...)
	if nil != err {
		log.Fatal(err)
	}

	ok, err := b.SetWebhook(ctx, &bot.SetWebhookParams{
		URL:         webhookURL,
		SecretToken: secretToken,
	})
	if nil != err {
		log.Fatal(err)
	}
	if !ok {
		log.Fatal("Failed to set webhook")
	}

	go func() {
		http.ListenAndServe(":8080", b.WebhookHandler())
	}()

	// Use StartWebhook instead of Start
	b.StartWebhook(ctx)

	// call methods.DeleteWebhook if needed
}
