package telegramalerts

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/Alarion239/my239/backend/internal/logger"
)

type Update struct {
	UpdateID int64    `json:"update_id"`
	Message  *Message `json:"message,omitempty"`
}

type User struct {
	ID    int64 `json:"id"`
	IsBot bool  `json:"is_bot"`
}

type Message struct {
	MessageID      int64       `json:"message_id"`
	From           *User       `json:"from,omitempty"`
	Chat           Chat        `json:"chat"`
	Text           string      `json:"text,omitempty"`
	ReplyToMessage *Message    `json:"reply_to_message,omitempty"`
	ChatShared     *ChatShared `json:"chat_shared,omitempty"`
}

type ChatShared struct {
	RequestID int64 `json:"request_id"`
	ChatID    int64 `json:"chat_id"`
}

// Webhook returns the public, secret-header-authenticated Telegram endpoint.
// Invalid payloads are acknowledged after a local warning so Telegram does
// not retry an update that cannot be made meaningful by the application.
func (s *Service) Webhook() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		provided := sha256.Sum256([]byte(r.Header.Get("X-Telegram-Bot-Api-Secret-Token")))
		expected := sha256.Sum256([]byte(s.cfg.WebhookSecret))
		if subtle.ConstantTimeCompare(provided[:], expected[:]) != 1 {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var update Update
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&update); err != nil {
			logger.LogWarn("telegram alerts: invalid webhook update", "error", err)
			w.WriteHeader(http.StatusOK)
			return
		}
		if err := s.handleUpdate(r, update); err != nil {
			logger.LogWarn("telegram alerts: handle webhook update failed", "error", err)
		}
		w.WriteHeader(http.StatusOK)
	})
}

func (s *Service) handleUpdate(r *http.Request, update Update) error {
	msg := update.Message
	if msg == nil || msg.From == nil {
		return nil
	}
	if msg.ChatShared != nil {
		return s.handleChatShared(r, msg)
	}

	if cmd, ok := parseCommand(msg.Text); ok {
		switch cmd {
		case "start", "help":
			return s.sendHelp(r, msg.Chat.ID)
		case "subscribe":
			return s.startSubscription(r, msg)
		case "status":
			return s.sendStatus(r, msg)
		case "unsubscribe":
			return s.unsubscribe(r, msg)
		case "test":
			return s.testSubscription(r, msg)
		default:
			return s.sendText(r, msg.Chat.ID, "Unknown command. Use /help for available commands.")
		}
	}

	if msg.Chat.Type == "private" && isPasswordReply(msg, s.botUserID.Load()) {
		return s.finishPassword(r, msg)
	}
	if msg.Chat.Type == "private" && msg.Text == "Subscribe this private chat" {
		return s.subscribePrivate(r, msg)
	}
	return nil
}

func parseCommand(text string) (string, bool) {
	field := strings.Fields(text)
	if len(field) == 0 || !strings.HasPrefix(field[0], "/") {
		return "", false
	}
	command := strings.TrimPrefix(field[0], "/")
	if at := strings.IndexByte(command, '@'); at >= 0 {
		command = command[:at]
	}
	return strings.ToLower(command), command != ""
}

func isPasswordReply(msg *Message, botID int64) bool {
	return msg.Text != "" && msg.ReplyToMessage != nil &&
		msg.ReplyToMessage.From != nil && msg.ReplyToMessage.From.ID == botID &&
		msg.ReplyToMessage.Text == passwordPrompt
}

func (s *Service) startSubscription(r *http.Request, msg *Message) error {
	if msg.Chat.Type != "private" {
		return s.sendText(r, msg.Chat.ID, "Open a private chat with this bot and use /subscribe there.")
	}
	return s.sendMessage(r, msg.Chat.ID, passwordPrompt, ForceReply{
		ForceReply:            true,
		Selective:             true,
		InputFieldPlaceholder: "Alert password",
	})
}

func (s *Service) finishPassword(r *http.Request, msg *Message) error {
	allowed, err := s.AllowPasswordAttempt(r.Context(), msg.From.ID)
	if err != nil {
		logger.LogWarn("telegram alerts: password limiter failed", "error", err)
		return s.sendText(r, msg.Chat.ID, "Enrollment is temporarily unavailable. Try again later.")
	}
	if !allowed {
		return s.sendText(r, msg.Chat.ID, "Too many attempts. Try again later.")
	}
	// Password content is never logged. Deletion is best effort because Telegram
	// imposes chat-type and time-window restrictions on deleteMessage.
	if err := s.bot.DeleteMessage(r.Context(), msg.Chat.ID, msg.MessageID); err != nil {
		logger.LogDebug("telegram alerts: could not delete password message", "error", err)
	}
	if !s.VerifyPassword(msg.Text) {
		return s.sendText(r, msg.Chat.ID, "The password was incorrect or the prompt expired.")
	}
	if err := s.repo.CreateEnrollmentSession(r.Context(), msg.From.ID, groupRequestID, time.Now().Add(5*time.Minute)); err != nil {
		return fmt.Errorf("create enrollment session: %w", err)
	}
	return s.sendMessage(r, msg.Chat.ID, "Authenticated. Choose where to receive alerts.", ReplyKeyboardMarkup{
		Keyboard: [][]KeyboardButton{
			{{Text: "Subscribe this private chat"}},
			{{Text: "Choose a group", RequestChat: &KeyboardButtonRequestChat{
				RequestID:     groupRequestID,
				ChatIsChannel: false,
				BotIsMember:   true,
				RequestTitle:  true,
			}}},
		},
		ResizeKeyboard:  true,
		OneTimeKeyboard: true,
	})
}

func (s *Service) subscribePrivate(r *http.Request, msg *Message) error {
	if err := s.repo.ConsumeEnrollmentSession(r.Context(), msg.From.ID, groupRequestID); err != nil {
		return s.sendText(r, msg.Chat.ID, "The enrollment prompt expired. Use /subscribe to start again.")
	}
	if err := s.repo.UpsertSubscription(r.Context(), msg.Chat.ID, "private", msg.From.ID); err != nil {
		return fmt.Errorf("subscribe private Telegram chat: %w", err)
	}
	return s.sendMessage(r, msg.Chat.ID, "Subscribed. Use /unsubscribe here to stop alerts.", ReplyKeyboardRemove{RemoveKeyboard: true})
}

func (s *Service) handleChatShared(r *http.Request, msg *Message) error {
	if msg.Chat.Type != "private" || msg.ChatShared.RequestID != groupRequestID {
		return nil
	}
	if err := s.repo.ConsumeEnrollmentSession(r.Context(), msg.From.ID, msg.ChatShared.RequestID); err != nil {
		return s.sendText(r, msg.Chat.ID, "The enrollment prompt expired. Use /subscribe to start again.")
	}
	chat, err := s.bot.GetChat(r.Context(), msg.ChatShared.ChatID)
	if err != nil {
		return s.sendText(r, msg.Chat.ID, "The bot cannot access that group. Add it to the group and try again.")
	}
	if chat.Type != "group" && chat.Type != "supergroup" {
		return s.sendText(r, msg.Chat.ID, "Only groups and supergroups can receive alerts.")
	}
	requester, err := s.bot.GetChatMember(r.Context(), chat.ID, msg.From.ID)
	if err != nil || !isChatAdmin(requester.Status) {
		return s.sendText(r, msg.Chat.ID, "You must be a group administrator to subscribe this group.")
	}
	botID := s.botUserID.Load()
	if botID == 0 {
		me, meErr := s.bot.GetMe(r.Context())
		if meErr != nil {
			return s.sendText(r, msg.Chat.ID, "The bot is still starting. Try again in a moment.")
		}
		botID = me.ID
		s.botUserID.Store(botID)
	}
	botMember, err := s.bot.GetChatMember(r.Context(), chat.ID, botID)
	if err != nil || botMember.Status == "left" || botMember.Status == "kicked" {
		return s.sendText(r, msg.Chat.ID, "Add the bot to that group before subscribing it.")
	}
	if err := s.repo.UpsertSubscription(r.Context(), chat.ID, chat.Type, msg.From.ID); err != nil {
		return fmt.Errorf("subscribe Telegram group: %w", err)
	}
	return s.sendMessage(r, msg.Chat.ID, "Subscribed. The selected group will receive server error alerts.", ReplyKeyboardRemove{RemoveKeyboard: true})
}

func (s *Service) sendHelp(r *http.Request, chatID int64) error {
	return s.sendText(r, chatID, "Commands:\n/subscribe — authenticate and choose a destination\n/status — show this chat's subscription\n/test — send a delivery test\n/unsubscribe — stop alerts for this chat")
}

func (s *Service) sendStatus(r *http.Request, msg *Message) error {
	sub, err := s.repo.GetSubscription(r.Context(), msg.Chat.ID)
	if errors.Is(err, ErrSubscriptionNotFound) || sub.DisabledAt != nil {
		return s.sendText(r, msg.Chat.ID, "This chat is not subscribed.")
	}
	if err != nil {
		return err
	}
	return s.sendText(r, msg.Chat.ID, "This chat is subscribed to my239 server alerts.")
}

func (s *Service) unsubscribe(r *http.Request, msg *Message) error {
	sub, err := s.repo.GetSubscription(r.Context(), msg.Chat.ID)
	if errors.Is(err, ErrSubscriptionNotFound) {
		return s.sendText(r, msg.Chat.ID, "This chat is not subscribed.")
	}
	if err != nil {
		return err
	}
	if msg.Chat.Type == "private" {
		if msg.From.ID != msg.Chat.ID {
			return s.sendText(r, msg.Chat.ID, "Only the subscribed private-chat user can unsubscribe it.")
		}
	} else {
		member, memberErr := s.bot.GetChatMember(r.Context(), msg.Chat.ID, msg.From.ID)
		if memberErr != nil || !isChatAdmin(member.Status) {
			return s.sendText(r, msg.Chat.ID, "Only a group administrator can unsubscribe this group.")
		}
	}
	if err := s.repo.DeleteSubscription(r.Context(), sub.ChatID); err != nil {
		return err
	}
	return s.sendText(r, msg.Chat.ID, "Unsubscribed.")
}

func (s *Service) testSubscription(r *http.Request, msg *Message) error {
	sub, err := s.repo.GetSubscription(r.Context(), msg.Chat.ID)
	if errors.Is(err, ErrSubscriptionNotFound) || sub.DisabledAt != nil {
		return s.sendText(r, msg.Chat.ID, "This chat is not subscribed.")
	}
	if err != nil {
		return err
	}
	if msg.Chat.Type != "private" {
		member, memberErr := s.bot.GetChatMember(r.Context(), msg.Chat.ID, msg.From.ID)
		if memberErr != nil || !isChatAdmin(member.Status) {
			return s.sendText(r, msg.Chat.ID, "Only a group administrator can run a delivery test.")
		}
	}
	if err := s.SendTest(r.Context(), sub); err != nil {
		logger.LogWarn("telegram alerts: test delivery failed", "error", err)
		return s.sendText(r, msg.Chat.ID, "The test delivery failed. Check the server logs.")
	}
	return nil
}

func (s *Service) sendText(r *http.Request, chatID int64, text string) error {
	return s.sendMessage(r, chatID, text, nil)
}

func (s *Service) sendMessage(r *http.Request, chatID int64, text string, markup any) error {
	if err := s.bot.SendMessage(r.Context(), chatID, text, markup); err != nil {
		return fmt.Errorf("send Telegram bot message: %w", err)
	}
	return nil
}
