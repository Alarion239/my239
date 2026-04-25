package httpx

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-playground/validator/v10"
)

func TestWriteJSON(t *testing.T) {
	rr := httptest.NewRecorder()
	WriteJSON(rr, http.StatusCreated, map[string]string{"hello": "world"})

	if rr.Code != http.StatusCreated {
		t.Errorf("status: got %d, want %d", rr.Code, http.StatusCreated)
	}
	if ct := rr.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("content-type: got %q", ct)
	}

	var got map[string]string
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("response is not valid JSON: %v", err)
	}
	if got["hello"] != "world" {
		t.Errorf("body: got %v", got)
	}
}

func TestWriteAPIError_Shape(t *testing.T) {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	WriteAPIError(rr, req, http.StatusBadRequest, CodeBadRequest, "something wrong")

	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d", rr.Code)
	}
	var env ErrorResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &env); err != nil {
		t.Fatalf("body is not ErrorResponse JSON: %v", err)
	}
	if env.Code != CodeBadRequest {
		t.Errorf("code: got %q, want %q", env.Code, CodeBadRequest)
	}
	if env.Error != "something wrong" {
		t.Errorf("error: got %q", env.Error)
	}
}

type sampleInput struct {
	Name  string `validate:"required,min=3"`
	Email string `validate:"required,email"`
}

func TestWriteValidationError_WithFieldDetails(t *testing.T) {
	v := validator.New()
	err := v.Struct(sampleInput{Name: "x", Email: "not-email"})
	if err == nil {
		t.Fatal("expected validator to return errors")
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	WriteValidationError(rr, req, err)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d", rr.Code)
	}
	var env ErrorResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &env); err != nil {
		t.Fatalf("body: %v", err)
	}
	if env.Code != CodeValidationFailed {
		t.Errorf("code: got %q, want %q", env.Code, CodeValidationFailed)
	}
	if env.Error != "validation failed" {
		t.Errorf("error: got %q", env.Error)
	}
	if len(env.Fields) != 2 {
		t.Errorf("fields: got %d, want 2 (%v)", len(env.Fields), env.Fields)
	}
}

func TestWriteValidationError_NonValidatorError(t *testing.T) {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	WriteValidationError(rr, req, http.ErrBodyNotAllowed)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("status: got %d", rr.Code)
	}
	var env ErrorResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &env); err != nil {
		t.Fatalf("body: %v", err)
	}
	if env.Code != CodeBadRequest {
		t.Errorf("non-validator error should map to bad_request, got %q", env.Code)
	}
}

func TestDecodeJSON_Success(t *testing.T) {
	body := bytes.NewBufferString(`{"name":"sasha","age":28}`)
	req := httptest.NewRequest(http.MethodPost, "/", body)
	req.Header.Set("Content-Type", "application/json")

	var dst struct {
		Name string `json:"name"`
		Age  int    `json:"age"`
	}
	if err := DecodeJSON(req, &dst); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dst.Name != "sasha" || dst.Age != 28 {
		t.Errorf("got %+v", dst)
	}
}

func TestDecodeJSON_UnknownField(t *testing.T) {
	body := bytes.NewBufferString(`{"name":"x","extra":"uh oh"}`)
	req := httptest.NewRequest(http.MethodPost, "/", body)
	req.Header.Set("Content-Type", "application/json")

	var dst struct {
		Name string `json:"name"`
	}
	if err := DecodeJSON(req, &dst); err == nil {
		t.Fatal("expected error for unknown field")
	}
}

func TestDecodeJSON_RejectsNonJSONContentType(t *testing.T) {
	body := bytes.NewBufferString(`{"name":"x"}`)
	req := httptest.NewRequest(http.MethodPost, "/", body)
	req.Header.Set("Content-Type", "text/plain")

	var dst struct{}
	if err := DecodeJSON(req, &dst); err == nil {
		t.Fatal("expected error for non-JSON content type")
	}
}

func TestDecodeJSON_OverSizeLimit(t *testing.T) {
	huge := strings.Repeat("a", MaxBodyBytes+100)
	body := bytes.NewBufferString(`{"name":"` + huge + `"}`)
	req := httptest.NewRequest(http.MethodPost, "/", body)
	req.Header.Set("Content-Type", "application/json")

	var dst struct {
		Name string `json:"name"`
	}
	if err := DecodeJSON(req, &dst); err == nil {
		t.Fatal("expected error when body exceeds MaxBodyBytes")
	}
}

func TestDecodeJSON_MultipleObjects(t *testing.T) {
	body := bytes.NewBufferString(`{"name":"a"}{"name":"b"}`)
	req := httptest.NewRequest(http.MethodPost, "/", body)
	req.Header.Set("Content-Type", "application/json")

	var dst struct {
		Name string `json:"name"`
	}
	if err := DecodeJSON(req, &dst); err == nil {
		t.Fatal("expected error for multiple JSON objects in body")
	}
}
