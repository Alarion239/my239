package auth_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/pashagolub/pgxmock/v4"

	authHandlers "github.com/Alarion239/my239/backend/internal/handlers/auth"
	"github.com/Alarion239/my239/backend/pkg/db"
)

func inviteRouter(database *db.DB) chi.Router {
	r := chi.NewRouter()
	r.Get("/invite/{token}", authHandlers.InviteLookup(database))
	return r
}

func TestInviteLookup_Unknown(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	mock.ExpectQuery(`FROM invitation_tokens\s+WHERE token = \$1`).
		WithArgs("nope").
		WillReturnRows(mock.NewRows(invitationTokenColumns))

	req := httptest.NewRequest(http.MethodGet, "/invite/nope", nil)
	rr := httptest.NewRecorder()
	inviteRouter(db.NewWithPool(mock)).ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status: got %d, want 404; body=%s", rr.Code, rr.Body.String())
	}
	var resp map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp["valid"] != false {
		t.Errorf("valid: got %v, want false", resp["valid"])
	}
}

func TestInviteLookup_StudentToken(t *testing.T) {
	mock, _ := pgxmock.NewPool()
	defer mock.Close()

	now := time.Now()
	preset := []byte(`{"version":1,"mathcenter_student":{"group_id":3}}`)
	mock.ExpectQuery(`FROM invitation_tokens\s+WHERE token = \$1`).
		WithArgs("good").
		WillReturnRows(mock.NewRows(invitationTokenColumns).
			AddRow(int64(1), "good", "Join group А", int32(30), now.Add(48*time.Hour), now, preset, ptrInt64(7)))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM users WHERE invitation_token_id`).
		WithArgs(int64(1)).
		WillReturnRows(mock.NewRows([]string{"count"}).AddRow(int64(2)))
	mock.ExpectQuery(`FROM math_center_groups\s+WHERE id = \$1`).
		WithArgs(int64(3)).
		WillReturnRows(mock.NewRows([]string{"id", "math_center_id", "name", "created_at"}).
			AddRow(int64(3), int64(7), "А", now))
	mock.ExpectQuery(`FROM math_centers\s+WHERE id = \$1`).
		WithArgs(int64(7)).
		WillReturnRows(mock.NewRows([]string{"id", "graduation_year", "created_at"}).
			AddRow(int64(7), int32(2030), now))

	req := httptest.NewRequest(http.MethodGet, "/invite/good", nil)
	rr := httptest.NewRecorder()
	inviteRouter(db.NewWithPool(mock)).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Valid      bool   `json:"valid"`
		Role       string `json:"role"`
		CenterName string `json:"center_name"`
		GroupName  string `json:"group_name"`
	}
	_ = json.Unmarshal(rr.Body.Bytes(), &resp)
	if !resp.Valid || resp.Role != "student" || resp.GroupName != "А" || resp.CenterName != "Матцентр 2030" {
		t.Errorf("view: %+v", resp)
	}
}
