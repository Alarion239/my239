package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"

	constants "github.com/Alarion239/my239/backend/internal/constants"
	handlers "github.com/Alarion239/my239/backend/internal/tg-bot-handlers"

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

	b.StartWebhook(ctx)
}
