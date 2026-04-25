package httpx

// ErrorCode is a stable, machine-readable identifier for a class of API
// failure. Frontends should branch on Code, not on the human-readable Error
// string. Codes are append-only: do not rename or repurpose existing values.
type ErrorCode string

const (
	// CodeBadRequest — request was malformed in a way that doesn't fit any
	// other code (invalid JSON, missing content-type, body too large).
	CodeBadRequest ErrorCode = "bad_request"

	// CodeValidationFailed — a structurally valid request failed field-level
	// validation. The Fields map contains per-field reasons.
	CodeValidationFailed ErrorCode = "validation_failed"

	// CodeUnauthenticated — request did not present a valid identity
	// (missing/malformed/expired token, no session).
	CodeUnauthenticated ErrorCode = "unauthenticated"

	// CodeInvalidCredentials — credentials presented (e.g. password) did not
	// match. Distinct from CodeUnauthenticated so the frontend can show
	// "wrong password" vs "please sign in again".
	CodeInvalidCredentials ErrorCode = "invalid_credentials"

	// CodeTokenInvalid — invitation, refresh, or other opaque token is
	// rejected (not found, revoked, malformed).
	CodeTokenInvalid ErrorCode = "token_invalid"

	// CodeTokenExpired — token was valid but is past its expiration.
	CodeTokenExpired ErrorCode = "token_expired"

	// CodeTokenExhausted — invitation token has reached its max_uses.
	CodeTokenExhausted ErrorCode = "token_exhausted"

	// CodeForbidden — request is authenticated but not authorized for the
	// target resource.
	CodeForbidden ErrorCode = "forbidden"

	// CodeNotFound — target resource doesn't exist.
	CodeNotFound ErrorCode = "not_found"

	// CodeConflict — request conflicts with current state (e.g. unique
	// constraint, optimistic lock).
	CodeConflict ErrorCode = "conflict"

	// CodeRateLimited — too many requests; client should back off.
	CodeRateLimited ErrorCode = "rate_limited"

	// CodeInternal — unexpected server-side error. Body never includes
	// internal details.
	CodeInternal ErrorCode = "internal_error"

	// CodeUnavailable — a downstream dependency (DB, Redis) is unreachable;
	// retrying the request later may succeed.
	CodeUnavailable ErrorCode = "service_unavailable"
)
