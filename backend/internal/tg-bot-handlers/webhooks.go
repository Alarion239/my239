package handlers

import (
	"context"

	"github.com/Alarion239/my239/backend/internal/logger"
	"github.com/go-telegram/bot"
	"github.com/go-telegram/bot/models"
)

func TelegramWebhooksHandler(ctx context.Context, b *bot.Bot, update *models.Update) {
	logger.LogInfo("Received Telegram update", "chat_id", update.Message.Chat.ID, "text", update.Message.Text)

	_, err := b.SendMessage(ctx, &bot.SendMessageParams{
		ChatID: update.Message.Chat.ID,
		Text:   update.Message.Text,
	})
	if err != nil {
		logger.LogError("Failed to send Telegram message", err, "chat_id", update.Message.Chat.ID)
		return
	}

	logger.LogInfo("Echoed message back to Telegram", "chat_id", update.Message.Chat.ID)
}
