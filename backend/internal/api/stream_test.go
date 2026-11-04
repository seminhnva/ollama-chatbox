package api

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"aichatbot/internal/ollama"
	"aichatbot/internal/store"
)

type sseEvent struct{ Name, Data string }

func readEvents(t *testing.T, body io.Reader) []sseEvent {
	t.Helper()
	var evs []sseEvent
	var cur sseEvent
	sc := bufio.NewScanner(body)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "event: "):
			cur.Name = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			cur.Data = strings.TrimPrefix(line, "data: ")
		case line == "":
			if cur.Name != "" {
				evs = append(evs, cur)
			}
			cur = sseEvent{}
		}
	}
	return evs
}

type fakeOllama struct {
	srv  *httptest.Server
	mu   sync.Mutex
	reqs []int // number of messages received per request
}

func newFakeOllama(t *testing.T, status int, lines ...string) *fakeOllama {
	t.Helper()
	f := &fakeOllama{}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct{ Messages []ollama.Message }
		json.NewDecoder(r.Body).Decode(&req)
		f.mu.Lock()
		f.reqs = append(f.reqs, len(req.Messages))
		f.mu.Unlock()
		w.WriteHeader(status)
		for _, l := range lines {
			fmt.Fprintln(w, l)
		}
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func setup(t *testing.T, f *fakeOllama) (*httptest.Server, *store.Store, store.Session) {
	t.Helper()
	r, st := newTestRouter(t, ollama.New(f.srv.URL, "gemma4:31b-cloud"))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	s := createSession(t, r)
	return srv, st, s
}

func send(t *testing.T, srv *httptest.Server, id, content string) *http.Response {
	t.Helper()
	b, _ := json.Marshal(map[string]string{"content": content})
	resp, err := http.Post(srv.URL+"/api/sessions/"+id+"/messages", "application/json", strings.NewReader(string(b)))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func names(evs []sseEvent) string {
	var n []string
	for _, e := range evs {
		n = append(n, e.Name)
	}
	return strings.Join(n, ",")
}

func TestStream_Success(t *testing.T) {
	f := newFakeOllama(t, 200, `{"message":{"content":"Xin "}}`, `{"message":{"content":"chào"}}`, `{"done":true}`)
	srv, st, s := setup(t, f)
	prompt := "Viết hàm debounce bằng TypeScript cho tôi"
	evs := readEvents(t, send(t, srv, s.ID, prompt).Body)
	if names(evs) != "delta,delta,done" {
		t.Fatalf("events: %v", evs)
	}
	var done struct {
		MessageID int64  `json:"messageId"`
		Title     string `json:"title"`
	}
	json.Unmarshal([]byte(evs[2].Data), &done)
	if done.Title != AutoTitle(prompt) || done.MessageID == 0 {
		t.Fatalf("done payload: %+v", done)
	}
	msgs, _ := st.ListMessages(t.Context(), s.ID)
	if len(msgs) != 2 || msgs[0].Role != "user" || msgs[1].Role != "assistant" || msgs[1].Content != "Xin chào" {
		t.Fatalf("stored: %+v", msgs)
	}
	// second turn: Ollama must receive full history (user, assistant, user)
	readEvents(t, send(t, srv, s.ID, "tiếp").Body)
	if f.reqs[len(f.reqs)-1] != 3 {
		t.Fatalf("history sent: %v", f.reqs)
	}
}

func TestStream_TitleOnlyFirstPrompt(t *testing.T) {
	f := newFakeOllama(t, 200, `{"message":{"content":"ok"}}`, `{"done":true}`)
	srv, st, s := setup(t, f)
	readEvents(t, send(t, srv, s.ID, "first prompt").Body)
	readEvents(t, send(t, srv, s.ID, "second prompt").Body)
	got, _ := st.GetSession(t.Context(), s.ID)
	if got.Title != "first prompt" {
		t.Fatalf("title=%q", got.Title)
	}
}

func TestStream_OllamaError(t *testing.T) {
	f := newFakeOllama(t, 500, `{"error":"boom"}`)
	srv, st, s := setup(t, f)
	evs := readEvents(t, send(t, srv, s.ID, "hi").Body)
	if names(evs) != "error" || !strings.Contains(evs[0].Data, `"message":"boom"`) {
		t.Fatalf("events: %v", evs)
	}
	msgs, _ := st.ListMessages(t.Context(), s.ID)
	if len(msgs) != 1 || msgs[0].Role != "user" {
		t.Fatalf("stored: %+v", msgs)
	}
}

func TestStream_PartialNotSaved(t *testing.T) {
	f := newFakeOllama(t, 200, `{"message":{"content":"half"}}`)
	srv, st, s := setup(t, f)
	evs := readEvents(t, send(t, srv, s.ID, "hi").Body)
	if names(evs) != "delta,error" {
		t.Fatalf("events: %v", evs)
	}
	msgs, _ := st.ListMessages(t.Context(), s.ID)
	if len(msgs) != 1 {
		t.Fatalf("partial reply must not be stored: %+v", msgs)
	}
}

func TestStream_Validation(t *testing.T) {
	f := newFakeOllama(t, 200, `{"done":true}`)
	srv, _, s := setup(t, f)
	if r := send(t, srv, s.ID, "   "); r.StatusCode != 400 {
		t.Errorf("blank: %d", r.StatusCode)
	}
	r := send(t, srv, "unknown", "hi")
	b, _ := io.ReadAll(r.Body)
	if r.StatusCode != 404 || strings.TrimSpace(string(b)) != `{"error":"session not found"}` {
		t.Errorf("unknown: %d %s", r.StatusCode, b)
	}
}

func TestStream_Headers(t *testing.T) {
	f := newFakeOllama(t, 200, `{"message":{"content":"a"}}`, `{"done":true}`)
	srv, _, s := setup(t, f)
	r := send(t, srv, s.ID, "hi")
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "text/event-stream") || r.Header.Get("X-Accel-Buffering") != "no" {
		t.Fatalf("headers: %v", r.Header)
	}
}
