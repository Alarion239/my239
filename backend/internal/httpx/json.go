// Package httpx contains small HTTP helpers shared by handlers: JSON
// encode/decode with size limits, and a consistent JSON error envelope.
package httpx

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	chiMiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-playground/validator/v10"

	"github.com/Alarion239/my239/backend/internal/logger"
)

// MaxBodyBytes is the default cap for JSON request bodies. 1 MiB is generous
// for everything we currently accept (auth payloads) without being an
// attractive DoS target.
const MaxBodyBytes = 1 << 20

// ErrorResponse is the canonical error envelope returned by the API.
//
// Code is a stable machine-readable identifier — see ErrorCode constants.
// Error is human-readable and may change between releases.
// Fields, when present, breaks down per-field validation errors.
// TraceID is the chi request ID, if available, so users can include it in
// bug reports and operators can grep logs.
type ErrorResponse struct {
	Code    ErrorCode         `json:"code"`
	Error   string            `json:"error"`
	Fields  map[string]string `json:"fields,omitempty"`
	TraceID string            `json:"trace_id,omitempty"`
}

// WriteJSON serializes v as JSON with the given status code. Errors during
// encoding are logged but not surfaced to the client because the headers have
// already been written.
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(v); err != nil {
		logger.LogError("WriteJSON encode failed", err)
	}
}

// WriteAPIError writes a structured error envelope. status is the HTTP
// status, code is a machine-readable category, and msg is the human-readable
// message shown to the user.
//
// The chi request ID is attached as TraceID when one is in the request
// context — pass r to populate it.
func WriteAPIError(w http.ResponseWriter, r *http.Request, status int, code ErrorCode, msg string) {
	resp := ErrorResponse{Code: code, Error: msg}
	if r != nil {
		resp.TraceID = chiMiddleware.GetReqID(r.Context())
	}
	WriteJSON(w, status, resp)
}

// WriteValidationError writes a 400 with per-field messages extracted from a
// validator.ValidationErrors value. If err is not a ValidationErrors, a
// generic 400 with CodeBadRequest is returned.
func WriteValidationError(w http.ResponseWriter, r *http.Request, err error) {
	var ve validator.ValidationErrors
	if !errors.As(err, &ve) {
		WriteAPIError(w, r, http.StatusBadRequest, CodeBadRequest, "invalid request")
		return
	}
	fields := make(map[string]string, len(ve))
	for _, fe := range ve {
		fields[fe.Field()] = fmt.Sprintf("failed on the '%s' tag", fe.Tag())
	}
	resp := ErrorResponse{
		Code:   CodeValidationFailed,
		Error:  "validation failed",
		Fields: fields,
	}
	if r != nil {
		resp.TraceID = chiMiddleware.GetReqID(r.Context())
	}
	WriteJSON(w, http.StatusBadRequest, resp)
}

// DecodeJSON reads a bounded JSON body into dst and rejects unknown fields to
// catch typos in client payloads. The body is always limited by MaxBodyBytes
// regardless of what the client claims in Content-Length. w is passed to
// MaxBytesReader so the server can manage the connection when the limit is
// hit; it may be nil in tests.
//
// Most handlers should call DecodeJSONBody, which also writes the error
// response; DecodeJSON is exposed for callers that need the raw error.
func DecodeJSON(w http.ResponseWriter, r *http.Request, dst any) error {
	if ct := r.Header.Get("Content-Type"); ct != "" && !strings.HasPrefix(ct, "application/json") {
		return fmt.Errorf("unsupported content type %q", ct)
	}
	r.Body = http.MaxBytesReader(w, r.Body, MaxBodyBytes)

	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("body must contain a single JSON object")
	}
	return nil
}

// DecodeJSONBody decodes the request body into dst with the same rules as
// DecodeJSON. On failure it writes a 400 error envelope with a generic
// message — JSON parser internals must not leak to the client — and returns
// false; the caller should simply return.
func DecodeJSONBody(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := DecodeJSON(w, r, dst); err != nil {
		WriteAPIError(w, r, http.StatusBadRequest, CodeBadRequest, "invalid request body")
		return false
	}
	return true
}
