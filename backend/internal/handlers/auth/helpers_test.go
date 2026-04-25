package auth_test

import (
	"encoding/json"
	"testing"
)

// assertErrorCode checks that body decodes to {code: ..., error: ...} and
// the code matches want. Used by every handler test that expects a 4xx/5xx.
func assertErrorCode(t *testing.T, body []byte, want string) {
	t.Helper()
	var env struct {
		Code  string `json:"code"`
		Error string `json:"error"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("error body is not JSON: %v\nbody=%s", err, body)
	}
	if env.Code != want {
		t.Errorf("code: got %q, want %q (error=%q)", env.Code, want, env.Error)
	}
}
