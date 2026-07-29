// Package googlesheets contains the narrow Google API boundary used by conduit
// synchronization. It intentionally accepts only spreadsheet IDs and tab IDs;
// user-provided URLs are parsed before reaching this package, preventing the
// integration from becoming an arbitrary HTTP proxy.
package googlesheets

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/Alarion239/my239/backend/internal/logger"
)

const (
	googleTokenScope = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.metadata.readonly"
	googleAPITimeout = 15 * time.Second
)

var (
	ErrNotConfigured   = errors.New("google sheets integration is not configured")
	updateRangePattern = regexp.MustCompile(`^[A-Z]+[1-9][0-9]*:[A-Z]+[1-9][0-9]*$`)
)

// Tab is the immutable Google tab id plus its human-readable current title.
type Tab struct {
	ID    int64  `json:"id"`
	Title string `json:"title"`
}

// Metadata is workbook-level only. Google does not expose a trustworthy
// per-cell modification timestamp through this API.
type Metadata struct {
	Version          string
	ModifiedAt       time.Time
	CanModifyContent bool
}

// Client is intentionally small so reconciliation can be tested without live
// Google credentials.
type Client interface {
	ListTabs(context.Context, string) ([]Tab, error)
	Metadata(context.Context, string) (Metadata, error)
	Values(context.Context, string, string) ([][]string, error)
	UpdateValues(context.Context, string, string, string, [][]string) error
}

type serviceAccount struct {
	ClientEmail string `json:"client_email"`
	PrivateKey  string `json:"private_key"`
	TokenURI    string `json:"token_uri"`
}

type token struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int64  `json:"expires_in"`
}

// HTTPClient authenticates a service account using the OAuth JWT bearer flow
// and talks only to fixed Google endpoints.
type HTTPClient struct {
	httpClient *http.Client
	email      string
	privateKey *rsa.PrivateKey
	tokenURI   string

	mu        sync.Mutex
	accessTok string
	expiresAt time.Time
}

var _ Client = (*HTTPClient)(nil)

func NewHTTPClient(serviceAccountJSON string) (*HTTPClient, error) {
	if strings.TrimSpace(serviceAccountJSON) == "" {
		return nil, ErrNotConfigured
	}
	var account serviceAccount
	if err := json.Unmarshal([]byte(serviceAccountJSON), &account); err != nil {
		return nil, fmt.Errorf("parsing google service account json: %w", err)
	}
	if account.ClientEmail == "" || account.PrivateKey == "" {
		return nil, errors.New("google service account json must include client_email and private_key")
	}
	block, _ := pem.Decode([]byte(account.PrivateKey))
	if block == nil {
		return nil, errors.New("decoding google service-account private key")
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parsing google service-account private key: %w", err)
	}
	rsaKey, ok := key.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("google service-account private key is not RSA")
	}
	if account.TokenURI == "" {
		account.TokenURI = "https://oauth2.googleapis.com/token"
	}
	parsed, err := url.Parse(account.TokenURI)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return nil, errors.New("google service-account token_uri must be an https URL")
	}
	return &HTTPClient{
		httpClient: &http.Client{Timeout: googleAPITimeout},
		email:      account.ClientEmail,
		privateKey: rsaKey,
		tokenURI:   account.TokenURI,
	}, nil
}

func (c *HTTPClient) ListTabs(ctx context.Context, spreadsheetID string) ([]Tab, error) {
	if err := validSpreadsheetID(spreadsheetID); err != nil {
		return nil, err
	}
	var response struct {
		Sheets []struct {
			Properties struct {
				SheetID int64  `json:"sheetId"`
				Title   string `json:"title"`
			} `json:"properties"`
		} `json:"sheets"`
	}
	path := "https://sheets.googleapis.com/v4/spreadsheets/" + url.PathEscape(spreadsheetID) + "?fields=sheets(properties(sheetId,title))"
	if err := c.getJSON(ctx, path, &response); err != nil {
		return nil, err
	}
	tabs := make([]Tab, 0, len(response.Sheets))
	for _, sheet := range response.Sheets {
		tabs = append(tabs, Tab{ID: sheet.Properties.SheetID, Title: sheet.Properties.Title})
	}
	return tabs, nil
}

func (c *HTTPClient) Metadata(ctx context.Context, spreadsheetID string) (Metadata, error) {
	if err := validSpreadsheetID(spreadsheetID); err != nil {
		return Metadata{}, err
	}
	var response struct {
		Version      string `json:"version"`
		ModifiedTime string `json:"modifiedTime"`
		Capabilities struct {
			CanModifyContent bool `json:"canModifyContent"`
		} `json:"capabilities"`
	}
	path := "https://www.googleapis.com/drive/v3/files/" + url.PathEscape(spreadsheetID) +
		"?fields=version,modifiedTime,capabilities(canModifyContent)"
	if err := c.getJSON(ctx, path, &response); err != nil {
		return Metadata{}, err
	}
	modifiedAt, err := time.Parse(time.RFC3339Nano, response.ModifiedTime)
	if err != nil {
		return Metadata{}, fmt.Errorf("parsing google file modified time: %w", err)
	}
	return Metadata{
		Version:          response.Version,
		ModifiedAt:       modifiedAt,
		CanModifyContent: response.Capabilities.CanModifyContent,
	}, nil
}

// Values reads the visible values of one linked tab. The title came from
// Google's own tab metadata when the link was created, and is escaped as an
// A1 sheet name rather than being treated as a URL or SQL fragment.
func (c *HTTPClient) Values(ctx context.Context, spreadsheetID, sheetTitle string) ([][]string, error) {
	if err := validSpreadsheetID(spreadsheetID); err != nil {
		return nil, err
	}
	title := strings.TrimSpace(sheetTitle)
	if title == "" {
		return nil, errors.New("google sheet title is required")
	}
	rangeName := "'" + strings.ReplaceAll(title, "'", "''") + "'!A1:ZZ1000"
	var response struct {
		Values [][]string `json:"values"`
	}
	path := "https://sheets.googleapis.com/v4/spreadsheets/" + url.PathEscape(spreadsheetID) + "/values/" + url.PathEscape(rangeName)
	if err := c.getJSON(ctx, path, &response); err != nil {
		return nil, err
	}
	return response.Values, nil
}

// UpdateValues replaces one server-generated A1 range with raw values. The
// sheet title is a title returned by Google, while rangeName is constructed by
// the reconciliation code from numeric row/column positions.
func (c *HTTPClient) UpdateValues(ctx context.Context, spreadsheetID, sheetTitle, rangeName string, values [][]string) error {
	if err := validSpreadsheetID(spreadsheetID); err != nil {
		return err
	}
	title := strings.TrimSpace(sheetTitle)
	if title == "" {
		return errors.New("google sheet title is required")
	}
	if !updateRangePattern.MatchString(rangeName) {
		return errors.New("invalid google sheet update range")
	}
	fullRange := "'" + strings.ReplaceAll(title, "'", "''") + "'!" + rangeName
	body := struct {
		Range          string     `json:"range"`
		MajorDimension string     `json:"majorDimension"`
		Values         [][]string `json:"values"`
	}{
		Range:          fullRange,
		MajorDimension: "ROWS",
		Values:         values,
	}
	endpoint := "https://sheets.googleapis.com/v4/spreadsheets/" + url.PathEscape(spreadsheetID) +
		"/values/" + url.PathEscape(fullRange) + "?valueInputOption=RAW"
	return c.doJSON(ctx, http.MethodPut, endpoint, body, nil)
}

func (c *HTTPClient) getJSON(ctx context.Context, endpoint string, dst any) error {
	return c.doJSON(ctx, http.MethodGet, endpoint, nil, dst)
}

func (c *HTTPClient) doJSON(ctx context.Context, method, endpoint string, body, dst any) error {
	accessToken, err := c.accessToken(ctx)
	if err != nil {
		return err
	}
	var reader io.Reader
	if body != nil {
		var encoded []byte
		encoded, err = json.Marshal(body)
		if err != nil {
			return fmt.Errorf("encoding google api request: %w", err)
		}
		reader = strings.NewReader(string(encoded))
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return fmt.Errorf("creating google api request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("calling google api: %w", err)
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			logger.LogErrorContext(ctx, "google api: close response body", closeErr)
		}
	}()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
		return fmt.Errorf("google api returned %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
	if dst == nil {
		_, err = io.Copy(io.Discard, resp.Body)
		if err != nil {
			return fmt.Errorf("reading google api response: %w", err)
		}
		return nil
	}
	if err := json.NewDecoder(resp.Body).Decode(dst); err != nil {
		return fmt.Errorf("decoding google api response: %w", err)
	}
	return nil
}

func (c *HTTPClient) accessToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.accessTok != "" && time.Until(c.expiresAt) > time.Minute {
		return c.accessTok, nil
	}
	assertion, err := c.signedAssertion(time.Now())
	if err != nil {
		return "", err
	}
	form := url.Values{"grant_type": {"urn:ietf:params:oauth:grant-type:jwt-bearer"}, "assertion": {assertion}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.tokenURI, strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("creating google token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("requesting google access token: %w", err)
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil {
			logger.LogErrorContext(ctx, "google token: close response body", closeErr)
		}
	}()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<10))
		return "", fmt.Errorf("google token endpoint returned %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
	var result token
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("decoding google token response: %w", err)
	}
	if result.AccessToken == "" || result.ExpiresIn <= 0 {
		return "", errors.New("google token response did not include an access token")
	}
	c.accessTok = result.AccessToken
	c.expiresAt = time.Now().Add(time.Duration(result.ExpiresIn) * time.Second)
	return c.accessTok, nil
}

func (c *HTTPClient) signedAssertion(now time.Time) (string, error) {
	header, err := json.Marshal(map[string]string{"alg": "RS256", "typ": "JWT"})
	if err != nil {
		return "", fmt.Errorf("encoding google jwt header: %w", err)
	}
	claims, err := json.Marshal(map[string]any{
		"iss": c.email, "scope": googleTokenScope, "aud": c.tokenURI,
		"iat": now.Unix(), "exp": now.Add(time.Hour).Unix(),
	})
	if err != nil {
		return "", fmt.Errorf("encoding google jwt claims: %w", err)
	}
	encodedHeader := base64.RawURLEncoding.EncodeToString(header)
	encodedClaims := base64.RawURLEncoding.EncodeToString(claims)
	signingInput := encodedHeader + "." + encodedClaims
	digest := sha256.Sum256([]byte(signingInput))
	signature, err := rsa.SignPKCS1v15(rand.Reader, c.privateKey, crypto.SHA256, digest[:])
	if err != nil {
		return "", fmt.Errorf("signing google jwt assertion: %w", err)
	}
	return signingInput + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

func validSpreadsheetID(id string) error {
	if len(id) < 20 || len(id) > 256 {
		return errors.New("invalid google spreadsheet id")
	}
	for _, r := range id {
		isLower := r >= 'a' && r <= 'z'
		isUpper := r >= 'A' && r <= 'Z'
		isDigit := r >= '0' && r <= '9'
		isSafe := isLower || isUpper || isDigit || r == '-' || r == '_'
		if !isSafe {
			return errors.New("invalid google spreadsheet id")
		}
	}
	return nil
}
