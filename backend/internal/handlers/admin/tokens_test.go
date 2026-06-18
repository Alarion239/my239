package admin_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"
)

// invitationTokenColumns matches `SELECT * FROM invitation_tokens` / the
// CreateInvitationToken RETURNING list after sqlc; keep aligned with the
// migrations and store/models.go.
var invitationTokenColumns = []string{"id", "token", "description", "max_uses", "expires_at", "created_at", "preset"}

// TestCreateToken_WithValidPreset verifies the handler validates a teacher
// preset against the DB, then stores the marshaled (version-stamped) preset in
// the CreateInvitationToken arguments.
func TestCreateToken_WithValidPreset(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	now := time.Now()
	// Validate: the referenced center must exist.
	mock.ExpectQuery(`SELECT .* FROM math_centers WHERE id = \$1`).
		WithArgs(int64(7)).
		WillReturnRows(mock.NewRows([]string{"id", "graduation_year", "created_at"}).
			AddRow(int64(7), int32(2030), now))
	// Insert: the stored preset must be the version-stamped JSON. pgxmock
	// compares the json.RawMessage argument byte-for-byte.
	wantPreset := json.RawMessage(`{"version":1,"mathcenter_teacher":{"center_id":7,"is_head_teacher":true}}`)
	mock.ExpectQuery(`INSERT INTO invitation_tokens`).
		WithArgs(pgxmock.AnyArg(), "Head teacher invite", int32(1), pgxmock.AnyArg(), wantPreset).
		WillReturnRows(mock.NewRows(invitationTokenColumns).
			AddRow(int64(10), "tok-value", "Head teacher invite", int32(1), now.Add(72*time.Hour), now, wantPreset))

	router, access := newAdminRouter(t, mock)

	body := accountBody(t, map[string]any{
		"description":      "Head teacher invite",
		"max_uses":         1,
		"expires_in_hours": 72,
		"preset": map[string]any{
			"mathcenter_teacher": map[string]any{"center_id": 7, "is_head_teacher": true},
		},
	})
	req := adminRequest(t, access, true, http.MethodPost, "/tokens", bytes.NewReader(body))
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status: got %d, body=%s", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}

// TestCreateToken_InvalidPreset verifies a preset referencing a non-existent
// center is rejected with 400 and no token is inserted.
func TestCreateToken_InvalidPreset(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	// Validate: center lookup returns no rows.
	mock.ExpectQuery(`SELECT .* FROM math_centers WHERE id = \$1`).
		WithArgs(int64(99)).
		WillReturnRows(mock.NewRows([]string{"id", "graduation_year", "created_at"}))

	router, access := newAdminRouter(t, mock)

	body := accountBody(t, map[string]any{
		"description":      "bad",
		"max_uses":         1,
		"expires_in_hours": 72,
		"preset": map[string]any{
			"mathcenter_teacher": map[string]any{"center_id": 99},
		},
	})
	req := adminRequest(t, access, true, http.MethodPost, "/tokens", bytes.NewReader(body))
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, body=%s", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}

// TestCreateToken_NoPreset verifies an omitted preset defaults to the empty
// "{}" object and the token is created without any DB validation lookups.
func TestCreateToken_NoPreset(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	now := time.Now()
	mock.ExpectQuery(`INSERT INTO invitation_tokens`).
		WithArgs(pgxmock.AnyArg(), "plain", int32(5), pgxmock.AnyArg(), json.RawMessage(`{"version":1}`)).
		WillReturnRows(mock.NewRows(invitationTokenColumns).
			AddRow(int64(11), "tok", "plain", int32(5), now.Add(72*time.Hour), now, []byte(`{"version":1}`)))

	router, access := newAdminRouter(t, mock)

	body := accountBody(t, map[string]any{
		"description":      "plain",
		"max_uses":         5,
		"expires_in_hours": 72,
	})
	req := adminRequest(t, access, true, http.MethodPost, "/tokens", bytes.NewReader(body))
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status: got %d, body=%s", rr.Code, rr.Body.String())
	}

	var resp map[string]json.RawMessage
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if string(resp["preset"]) != `{"version":1}` {
		t.Errorf("preset echo: got %s", resp["preset"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}
