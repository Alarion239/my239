// Package telegramalerts delivers structured server alerts through a
// Telegram bot and manages authenticated chat subscriptions.
package telegramalerts

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const defaultBotAPIBase = "https://api.telegram.org"

// BotClient is a deliberately small Bot API client. It never returns the
// request URL in an error because that URL contains the bot token.
type BotClient struct {
	token      string
	baseURL    string
	httpClient *http.Client
}

func NewBotClient(token string) *BotClient {
	return &BotClient{
		token:   token,
		baseURL: defaultBotAPIBase,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// newBotClientForTest permits package-local tests to use an httptest server
// without ever changing the production endpoint.
func newBotClientForTest(token, baseURL string, client *http.Client) *BotClient {
	if client == nil {
		client = &http.Client{Timeout: 2 * time.Second}
	}
	return &BotClient{token: token, baseURL: strings.TrimRight(baseURL, "/"), httpClient: client}
}

type APIError struct {
	Method      string
	Code        int
	Description string
	RetryAfter  int
}

func (e *APIError) Error() string {
	if e.Description == "" {
		return fmt.Sprintf("telegram %s failed with status %d", e.Method, e.Code)
	}
	return fmt.Sprintf("telegram %s failed with status %d: %s", e.Method, e.Code, e.Description)
}

func (e *APIError) Transient() bool {
	return e.Code == http.StatusTooManyRequests || e.Code >= http.StatusInternalServerError || e.Code == 0
}

type apiResponse[T any] struct {
	OK          bool           `json:"ok"`
	Result      T              `json:"result"`
	ErrorCode   int            `json:"error_code"`
	Description string         `json:"description"`
	Parameters  *apiParameters `json:"parameters,omitempty"`
}

type apiParameters struct {
	RetryAfter int `json:"retry_after,omitempty"`
}

func (b *BotClient) call(ctx context.Context, method string, payload any, result any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal telegram %s request: %w", method, err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		b.baseURL+"/bot"+b.token+"/"+method, bytes.NewReader(body))
	if err != nil {
		// The URL contains the bot token. Do not wrap an error from URL/request
		// construction because some net/http errors echo the complete URL.
		return &APIError{Method: method, Description: "request construction failure"}
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := b.httpClient.Do(req)
	if err != nil {
		// Do not return *url.Error: its Error method includes the token-bearing
		// request URL. Keep only the stable transport error text.
		return &APIError{Method: method, Description: "transport failure"}
	}
	defer func() {
		// The response has already been bounded and consumed; a close error is
		// not actionable at this point and must not mask the Bot API result.
		_ = resp.Body.Close()
	}()

	limited := io.LimitReader(resp.Body, 1<<20)
	var envelope apiResponse[json.RawMessage]
	if err := json.NewDecoder(limited).Decode(&envelope); err != nil {
		return &APIError{Method: method, Code: resp.StatusCode, Description: "invalid response"}
	}
	if !envelope.OK {
		apiErr := &APIError{
			Method:      method,
			Code:        envelope.ErrorCode,
			Description: sanitizeAPIDescription(envelope.Description),
		}
		if apiErr.Code == 0 {
			apiErr.Code = resp.StatusCode
		}
		if envelope.Parameters != nil {
			apiErr.RetryAfter = envelope.Parameters.RetryAfter
		}
		return apiErr
	}
	if result == nil || len(envelope.Result) == 0 || string(envelope.Result) == "null" {
		return nil
	}
	if err := json.Unmarshal(envelope.Result, result); err != nil {
		return fmt.Errorf("decode telegram %s response: %w", method, err)
	}
	return nil
}

func sanitizeAPIDescription(s string) string {
	// Bot API descriptions are operator-facing but can contain arbitrary text
	// such as chat titles. Keep them single-line and bounded for local logs.
	s = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\r' || r == '\t' {
			return ' '
		}
		if r < 0x20 {
			return -1
		}
		return r
	}, s)
	if len(s) > 256 {
		return s[:256]
	}
	return s
}

type BotUser struct {
	ID        int64  `json:"id"`
	IsBot     bool   `json:"is_bot"`
	FirstName string `json:"first_name"`
}

func (b *BotClient) GetMe(ctx context.Context) (BotUser, error) {
	var result BotUser
	err := b.call(ctx, "getMe", struct{}{}, &result)
	return result, err
}

func (b *BotClient) SetWebhook(ctx context.Context, webhookURL, secret string) error {
	return b.call(ctx, "setWebhook", map[string]any{
		"url":             webhookURL,
		"secret_token":    secret,
		"allowed_updates": []string{"message"},
		"max_connections": 10,
	}, nil)
}

type Chat struct {
	ID    int64  `json:"id"`
	Type  string `json:"type"`
	Title string `json:"title,omitempty"`
}

func (b *BotClient) GetChat(ctx context.Context, chatID int64) (Chat, error) {
	var result Chat
	err := b.call(ctx, "getChat", map[string]any{"chat_id": chatID}, &result)
	return result, err
}

type ChatMember struct {
	Status string `json:"status"`
}

func (b *BotClient) GetChatMember(ctx context.Context, chatID, userID int64) (ChatMember, error) {
	var result ChatMember
	err := b.call(ctx, "getChatMember", map[string]any{
		"chat_id": chatID,
		"user_id": userID,
	}, &result)
	return result, err
}

func isChatAdmin(status string) bool {
	return status == "creator" || status == "administrator"
}

type ReplyKeyboardMarkup struct {
	Keyboard        [][]KeyboardButton `json:"keyboard"`
	ResizeKeyboard  bool               `json:"resize_keyboard,omitempty"`
	OneTimeKeyboard bool               `json:"one_time_keyboard,omitempty"`
}

type ReplyKeyboardRemove struct {
	RemoveKeyboard bool `json:"remove_keyboard"`
}

type ForceReply struct {
	ForceReply            bool   `json:"force_reply"`
	Selective             bool   `json:"selective,omitempty"`
	InputFieldPlaceholder string `json:"input_field_placeholder,omitempty"`
}

type KeyboardButton struct {
	Text        string                     `json:"text"`
	RequestChat *KeyboardButtonRequestChat `json:"request_chat,omitempty"`
}

type KeyboardButtonRequestChat struct {
	RequestID     int64 `json:"request_id"`
	ChatIsChannel bool  `json:"chat_is_channel"`
	BotIsMember   bool  `json:"bot_is_member,omitempty"`
	RequestTitle  bool  `json:"request_title,omitempty"`
}

func (b *BotClient) SendMessage(ctx context.Context, chatID int64, text string, replyMarkup any) error {
	payload := map[string]any{
		"chat_id": chatID,
		"text":    text,
	}
	if replyMarkup != nil {
		payload["reply_markup"] = replyMarkup
	}
	return b.call(ctx, "sendMessage", payload, nil)
}

func (b *BotClient) DeleteMessage(ctx context.Context, chatID, messageID int64) error {
	return b.call(ctx, "deleteMessage", map[string]any{
		"chat_id":    chatID,
		"message_id": messageID,
	}, nil)
}
