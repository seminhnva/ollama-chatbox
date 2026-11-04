package ollama

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func fake(t *testing.T, status int, lines ...string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
		for _, l := range lines {
			fmt.Fprintln(w, l)
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
		}
	}))
}

func collect(c *Client) (string, []string, error) {
	var deltas []string
	full, err := c.Chat(context.Background(), []Message{{Role: "user", Content: "hi"}},
		func(s string) error { deltas = append(deltas, s); return nil })
	return full, deltas, err
}

func TestChat_Streams(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &body)
		fmt.Fprintln(w, `{"message":{"content":"Hel"}}`)
		fmt.Fprintln(w, `{"message":{"content":"lo"}}`)
		fmt.Fprintln(w, `{"done":true}`)
	}))
	defer srv.Close()
	full, deltas, err := collect(New(srv.URL, "gemma4:31b-cloud"))
	if err != nil || full != "Hello" || strings.Join(deltas, "|") != "Hel|lo" {
		t.Fatalf("got %q %v %v", full, deltas, err)
	}
	if body["model"] != "gemma4:31b-cloud" || body["stream"] != true {
		t.Fatalf("bad request body: %v", body)
	}
}

func TestChat_Unreachable(t *testing.T) {
	_, _, err := collect(New("http://127.0.0.1:1", "m"))
	if err == nil || !strings.Contains(err.Error(), "Cannot reach Ollama at http://127.0.0.1:1") {
		t.Fatalf("got %v", err)
	}
}

func TestChat_HTTPError(t *testing.T) {
	srv := fake(t, 404, `{"error":"model not found"}`)
	defer srv.Close()
	_, _, err := collect(New(srv.URL, "m"))
	if err == nil || err.Error() != "model not found" {
		t.Fatalf("got %v", err)
	}
}

func TestChat_HTTPErrorUnparseable(t *testing.T) {
	srv := fake(t, 502, `<html>bad gateway</html>`)
	defer srv.Close()
	_, _, err := collect(New(srv.URL, "m"))
	if err == nil || err.Error() != "Ollama returned HTTP 502" {
		t.Fatalf("got %v", err)
	}
}

func TestChat_ErrorLineMidStream(t *testing.T) {
	srv := fake(t, 200, `{"message":{"content":"a"}}`, `{"error":"context length exceeded"}`)
	defer srv.Close()
	_, _, err := collect(New(srv.URL, "m"))
	if err == nil || err.Error() != "context length exceeded" {
		t.Fatalf("got %v", err)
	}
}

func TestChat_EOFWithoutDone(t *testing.T) {
	srv := fake(t, 200, `{"message":{"content":"a"}}`)
	defer srv.Close()
	_, _, err := collect(New(srv.URL, "m"))
	if err == nil || err.Error() != "Ollama stream ended unexpectedly" {
		t.Fatalf("got %v", err)
	}
}

func TestChat_LongLine(t *testing.T) {
	long := strings.Repeat("x", 200000)
	srv := fake(t, 200, fmt.Sprintf(`{"message":{"content":"%s"}}`, long), `{"done":true}`)
	defer srv.Close()
	full, _, err := collect(New(srv.URL, "m"))
	if err != nil || len(full) != 200000 {
		t.Fatalf("len=%d err=%v", len(full), err)
	}
}

func TestChat_OnDeltaErrorStops(t *testing.T) {
	srv := fake(t, 200, `{"message":{"content":"a"}}`, `{"done":true}`)
	defer srv.Close()
	boom := errors.New("client gone")
	_, err := New(srv.URL, "m").Chat(context.Background(), nil, func(string) error { return boom })
	if !errors.Is(err, boom) {
		t.Fatalf("got %v", err)
	}
}
