package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"aichatbot/internal/store"
	"github.com/gin-gonic/gin"
)

func newTestRouter(t *testing.T, chat ChatClient) (*gin.Engine, *store.Store) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return NewRouter(st, chat), st
}

func do(r http.Handler, method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func createSession(t *testing.T, r http.Handler) store.Session {
	t.Helper()
	w := do(r, "POST", "/api/sessions", "")
	var s store.Session
	json.Unmarshal(w.Body.Bytes(), &s)
	return s
}

func TestCreateSession(t *testing.T) {
	r, _ := newTestRouter(t, nil)
	w := do(r, "POST", "/api/sessions", "")
	var s store.Session
	json.Unmarshal(w.Body.Bytes(), &s)
	if w.Code != 201 || s.ID == "" || s.Title != "" {
		t.Fatalf("got %d %s", w.Code, w.Body)
	}
}

func TestListSessionsEmpty(t *testing.T) {
	r, _ := newTestRouter(t, nil)
	w := do(r, "GET", "/api/sessions", "")
	if w.Code != 200 || strings.TrimSpace(w.Body.String()) != "[]" {
		t.Fatalf("got %d %q", w.Code, w.Body)
	}
}

func TestRenameSession(t *testing.T) {
	r, _ := newTestRouter(t, nil)
	s := createSession(t, r)
	w := do(r, "PATCH", "/api/sessions/"+s.ID, `{"title":"  New name "}`)
	var got store.Session
	json.Unmarshal(w.Body.Bytes(), &got)
	if w.Code != 200 || got.Title != "New name" {
		t.Fatalf("got %d %s", w.Code, w.Body)
	}
	for name, body := range map[string]string{
		"blank":    `{"title":"  "}`,
		"too long": `{"title":"` + strings.Repeat("a", 101) + `"}`,
		"not json": `nope`,
	} {
		if w := do(r, "PATCH", "/api/sessions/"+s.ID, body); w.Code != 400 {
			t.Errorf("%s: want 400 got %d", name, w.Code)
		}
	}
	w = do(r, "PATCH", "/api/sessions/unknown", `{"title":"x"}`)
	if w.Code != 404 || strings.TrimSpace(w.Body.String()) != `{"error":"session not found"}` {
		t.Fatalf("got %d %s", w.Code, w.Body)
	}
}

func TestDeleteSession(t *testing.T) {
	r, _ := newTestRouter(t, nil)
	s := createSession(t, r)
	if w := do(r, "DELETE", "/api/sessions/"+s.ID, ""); w.Code != 204 {
		t.Fatalf("delete: %d", w.Code)
	}
	if w := do(r, "GET", "/api/sessions/"+s.ID+"/messages", ""); w.Code != 404 {
		t.Fatalf("messages after delete: %d", w.Code)
	}
	if w := do(r, "DELETE", "/api/sessions/"+s.ID, ""); w.Code != 404 {
		t.Fatalf("second delete: %d", w.Code)
	}
}

func TestListMessagesEmpty(t *testing.T) {
	r, _ := newTestRouter(t, nil)
	s := createSession(t, r)
	w := do(r, "GET", "/api/sessions/"+s.ID+"/messages", "")
	if w.Code != 200 || strings.TrimSpace(w.Body.String()) != "[]" {
		t.Fatalf("got %d %q", w.Code, w.Body)
	}
}
