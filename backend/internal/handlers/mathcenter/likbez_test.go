package mathcenter_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
)

var likbezColumns = []string{
	"id", "math_center_id", "term_id", "number", "title", "held_on",
	"description", "pdf_object_key", "tex_source", "video_url", "published_at",
	"created_at", "updated_at", "term_kind", "term_grade",
}

func expectLikbez(mock pgxmock.PgxPoolIface, id, centerID int64, publishedAt *time.Time) {
	now := time.Date(2026, time.July, 23, 0, 0, 0, 0, time.UTC)
	grade := int32(9)
	mock.ExpectQuery(`FROM math_center_likbez l\s+JOIN math_center_terms`).
		WithArgs(id).
		WillReturnRows(mock.NewRows(likbezColumns).AddRow(
			id, centerID, int64(7), int32(4), "Инварианты", now, "Краткий конспект.",
			(*string)(nil), (*string)(nil), (*string)(nil), publishedAt, now, now, "academic", &grade,
		))
}

func TestPublishLikbez_RequiresMaterial(t *testing.T) {
	t.Parallel()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("new pool: %v", err)
	}
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	expectLikbez(mock, 9, 42, nil)
	mock.ExpectQuery(`UPDATE math_center_likbez\s+SET published_at`).
		WithArgs(int64(9)).
		WillReturnError(pgx.ErrNoRows)

	req := authedAdminRequest(t, access, 1, http.MethodPost, "/likbez/9/publish", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)
	if rr.Code != http.StatusConflict {
		t.Fatalf("got %d, want 409; body=%s", rr.Code, rr.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectation: %v", err)
	}
}
