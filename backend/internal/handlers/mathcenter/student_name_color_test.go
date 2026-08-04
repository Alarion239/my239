package mathcenter_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/pashagolub/pgxmock/v4"
)

func TestUpdateStudentNameColor_NormalizesAndStores(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	expectTeacherInCenter(mock, 3, 42, true)
	expectStudentInCenter(mock, 99, 42, true)
	mock.ExpectQuery(`INSERT INTO math_center_student_name_color`).
		WithArgs(int64(42), int64(99), "#FFD09A").
		WillReturnRows(mock.NewRows([]string{"background_hex"}).AddRow("#FFD09A"))

	body, _ := json.Marshal(map[string]any{"background_hex": "  #ffd09a "})
	req := authedRequest(t, access, 3, http.MethodPut, "/centers/42/students/99/name-color", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var got map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got["background_hex"] != "#FFD09A" {
		t.Fatalf("background_hex: got %v", got["background_hex"])
	}
}

func TestUpdateStudentNameColor_RejectsMalformedHex(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	expectTeacherInCenter(mock, 3, 42, true)
	expectStudentInCenter(mock, 99, 42, true)
	body, _ := json.Marshal(map[string]any{"background_hex": "red"})
	req := authedRequest(t, access, 3, http.MethodPut, "/centers/42/students/99/name-color", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("got %d, want 400; body=%s", rr.Code, rr.Body.String())
	}
}

func TestUpdateStudentNameColor_ClearsWithNull(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	expectTeacherInCenter(mock, 3, 42, true)
	expectStudentInCenter(mock, 99, 42, true)
	mock.ExpectExec(`DELETE FROM math_center_student_name_color`).
		WithArgs(int64(42), int64(99)).
		WillReturnResult(pgxmock.NewResult("DELETE", 1))

	body, _ := json.Marshal(map[string]any{"background_hex": nil})
	req := authedRequest(t, access, 3, http.MethodPut, "/centers/42/students/99/name-color", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("got %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var got map[string]any
	_ = json.Unmarshal(rr.Body.Bytes(), &got)
	if got["background_hex"] != nil {
		t.Fatalf("background_hex: got %v, want null", got["background_hex"])
	}
}

func TestUpdateStudentNameColor_RejectsNonTeacher(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	expectTeacherInCenter(mock, 9, 42, false)
	req := authedRequest(t, access, 9, http.MethodPut, "/centers/42/students/99/name-color", bytes.NewReader([]byte(`{"background_hex":"#FFD09A"}`)))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("got %d, want 403; body=%s", rr.Code, rr.Body.String())
	}
}

func TestUpdateStudentNameColor_RejectsNonEnrolledTarget(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	expectTeacherInCenter(mock, 3, 42, true)
	expectStudentInCenter(mock, 99, 42, false)
	req := authedRequest(t, access, 3, http.MethodPut, "/centers/42/students/99/name-color", bytes.NewReader([]byte(`{"background_hex":"#FFD09A"}`)))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("got %d, want 404; body=%s", rr.Code, rr.Body.String())
	}
}

func TestGetStudentProfile_RejectsStudentCaller(t *testing.T) {
	t.Parallel()
	mock, _ := pgxmock.NewPool()
	defer mock.Close()
	r, access, _ := newRouter(t, mock)

	expectTeacherInCenter(mock, 99, 42, false)
	req := authedRequest(t, access, 99, http.MethodGet, "/centers/42/students/99/", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("got %d, want 403; body=%s", rr.Code, rr.Body.String())
	}
}
