# AI Coding's Chatbot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web chatbot cá nhân (Angular + Go/Gin + SQLite) gọi Ollama `gemma4:31b-cloud`, stream câu trả lời, lưu và mở lại session, chạy bằng `docker compose`.

**Architecture:** nginx (container frontend) phục vụ Angular build và proxy `/api` sang Go/Gin (container backend). Backend lưu session/message vào SQLite trên Docker volume, gọi Ollama `/api/chat` dạng NDJSON stream và chuyển tiếp về trình duyệt dưới dạng SSE. Frontend đọc SSE bằng `fetch` + `ReadableStream`, state giữ trong một `ChatStore` dùng signals.

**Tech Stack:** Go 1.25, Gin, `modernc.org/sqlite`, `github.com/google/uuid`; Angular (bản mới nhất, standalone, signals, zoneless, Vitest), Tailwind CSS v4, `marked`, `highlight.js`, `dompurify`; Docker, nginx.

**Spec:** `docs/superpowers/specs/2026-11-04-ai-coding-chatbot-design.md`

## Global Constraints

- Go module: `aichatbot` trong `backend/`; Angular project trong `frontend/`.
- Env backend: `PORT=8081`, `DB_PATH=./chat.db`, `OLLAMA_URL=http://localhost:11434`, `OLLAMA_MODEL=gemma4:31b-cloud` (mặc định).
- Lỗi REST: JSON `{"error": "<message>"}`; `404` dùng đúng chuỗi `session not found`.
- SSE event: `delta` `{"text"}`, `done` `{"messageId","title"}`, `error` `{"message"}`.
- Lỗi không kết nối Ollama: đúng chuỗi `Cannot reach Ollama at <OLLAMA_URL>`.
- JSON field camelCase: `id`, `title`, `createdAt`, `updatedAt`, `role`, `content`.
- Auto title: gộp khoảng trắng, trim, tối đa 20 rune, không thêm "…". Rename: trim, không rỗng, tối đa 100 rune.
- Không `WriteTimeout` trên server; header SSE `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`, flush sau mỗi event.
- Nhãn UI tiếng Anh: "AI Coding's Chatbot", "New Chat", "Send", "Rename", "Delete".
- Màu chỉ dùng token trong spec mục 4.1 (brand 500/600/700, neutral 0–900, danger 100–700); không tự chế mã màu.
- Breakpoint responsive `md` = 768px; sidebar 260px.
- `localStorage` key `theme` với giá trị `'light' | 'dark'`.
- Không thêm dependency ngoài danh sách Tech Stack mà không có lý do ghi trong commit.

## Review Focus

1. **Ollama ngắt kết nối giữa chừng** (stream kết thúc khi chưa có `done: true`) → phải là lỗi, không lưu câu trả lời dở. Test: Task 3 `TestChat_EOFWithoutDone`, Task 5 `TestStream_PartialNotSaved`.
2. **Ollama trả dòng `{"error": "..."}` khi HTTP 200** (vượt quota/context giữa stream) → SSE `error` kèm thông báo đó. Test: Task 3 `TestChat_ErrorLineMidStream`.
3. **Một dòng NDJSON rất dài (> 64 KB)** → không được hỏng vì giới hạn buffer mặc định của `bufio.Scanner`. Test: Task 3 `TestChat_LongLine`.
4. **Ký tự tiếng Việt / emoji bị cắt đôi giữa hai chunk byte** → hiển thị đúng, không ra ký tự `�`. Test: Task 7 `readSseStream decodes multibyte split across chunks`.
5. **Model trả về HTML nguy hiểm** (`<script>`, `<img onerror>`) trong Markdown → bị loại bỏ khi render. Test: Task 10 `renderMarkdown strips script and event handlers`.

---

### Task 1: Backend scaffold và `AutoTitle`

**Files:**
- Create: `backend/go.mod`, `backend/internal/api/title.go`
- Create: `.gitignore` (gốc repo: `backend/chat.db`, `frontend/node_modules/`, `frontend/dist/`, `frontend/.angular/`)
- Test: `backend/internal/api/title_test.go`

**Interfaces:**
- Produces: `func AutoTitle(content string) string`, `func ValidateRename(title string) (string, error)` (package `api`; trả về title đã trim hoặc lỗi `title must not be empty` / `title must be at most 100 characters`).

- [ ] **Step 1: `cd backend && go mod init aichatbot`**

- [ ] **Step 2: Viết test (table-driven)**

```go
func TestAutoTitle(t *testing.T) {
	cases := map[string]string{
		"Viết hàm debounce bằng TypeScript cho tôi": "Viết hàm debounce bằ",
		"  fix\n\nlỗi   CORS  ":                     "fix lỗi CORS",
		"ngắn":                                       "ngắn",
		"😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀": strings.Repeat("😀", 20),
	}
	for in, want := range cases {
		if got := AutoTitle(in); got != want { t.Errorf("AutoTitle(%q)=%q want %q", in, got, want) }
	}
}

func TestValidateRename(t *testing.T) {
	// "  hello  " -> "hello", nil
	// "   " -> error
	// strings.Repeat("ệ", 100) -> ok ; strings.Repeat("ệ", 101) -> error
}
```

- [ ] **Step 3: `go test ./internal/api/` → FAIL (undefined)**

- [ ] **Step 4: Implement** — `strings.Fields` + `strings.Join(…, " ")`, cắt bằng `[]rune`, trim lại sau khi cắt (tránh dấu cách cuối); `ValidateRename` đếm `utf8.RuneCountInString`.

- [ ] **Step 5: `go test ./internal/api/` → PASS**

- [ ] **Step 6: Commit** `feat(backend): scaffold module and session title helpers`

---

### Task 2: Store (SQLite)

**Files:**
- Create: `backend/internal/store/store.go`
- Test: `backend/internal/store/store_test.go`

**Interfaces:**
- Produces (package `store`):
```go
var ErrNotFound = errors.New("not found")
type Session struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}
type Message struct {
	ID        int64     `json:"id"`
	Role      string    `json:"role"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"createdAt"`
}
func Open(path string) (*Store, error)        // mở DB, PRAGMA foreign_keys=ON, tạo schema
func (s *Store) Close() error
func (s *Store) CreateSession(ctx context.Context) (Session, error)
func (s *Store) ListSessions(ctx context.Context) ([]Session, error)              // updated_at DESC; rỗng → []Session{} không phải nil
func (s *Store) GetSession(ctx context.Context, id string) (Session, error)       // ErrNotFound
func (s *Store) RenameSession(ctx context.Context, id, title string) (Session, error) // cập nhật updated_at; ErrNotFound
func (s *Store) SetTitleIfEmpty(ctx context.Context, id, title string) (Session, error)
func (s *Store) DeleteSession(ctx context.Context, id string) error              // ErrNotFound
func (s *Store) AddMessage(ctx context.Context, sessionID, role, content string) (Message, error) // cập nhật sessions.updated_at
func (s *Store) ListMessages(ctx context.Context, sessionID string) ([]Message, error) // id ASC; ErrNotFound nếu session không có
```

- [ ] **Step 1: Viết test** dùng `Open(filepath.Join(t.TempDir(), "t.db"))`:
  - `TestCreateAndList`: tạo A rồi B, `AddMessage(A, …)` → `ListSessions` trả `[A, B]` (A mới cập nhật nhất).
  - `TestRename`: title đổi, `UpdatedAt` tăng; id lạ → `ErrNotFound`.
  - `TestSetTitleIfEmpty`: lần đầu đặt "x", lần hai với "y" vẫn là "x".
  - `TestDeleteCascades`: thêm 2 message, xoá session → `ListMessages` trả `ErrNotFound`; truy vấn trực tiếp `SELECT COUNT(*) FROM messages` = 0.
  - `TestListMessagesOrder`: user, assistant, user → đúng thứ tự, đúng role.
  - `TestReopenPersists`: Close, Open lại cùng path → dữ liệu còn.

- [ ] **Step 2: `go test ./internal/store/` → FAIL**

- [ ] **Step 3: Implement.** `go get modernc.org/sqlite github.com/google/uuid`. Driver name `"sqlite"`; DSN `path + "?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)"`; `db.SetMaxOpenConns(1)`. Schema đúng spec mục 3.3. Thời gian lưu UTC.

- [ ] **Step 4: `go test ./internal/store/` → PASS**

- [ ] **Step 5: Commit** `feat(backend): sqlite store for sessions and messages`

---

### Task 3: Ollama client

**Files:**
- Create: `backend/internal/ollama/client.go`
- Test: `backend/internal/ollama/client_test.go`

**Interfaces:**
- Produces (package `ollama`):
```go
type Message struct { Role string `json:"role"`; Content string `json:"content"` }
type Client struct { /* baseURL, model, http *http.Client (không timeout) */ }
func New(baseURL, model string) *Client
// Gọi POST {baseURL}/api/chat {model, messages, stream:true}; gọi onDelta cho mỗi message.content không rỗng;
// trả về toàn bộ nội dung ghép lại khi gặp done:true.
func (c *Client) Chat(ctx context.Context, msgs []Message, onDelta func(string) error) (string, error)
```
- Lỗi trả về (`err.Error()` được hiển thị nguyên văn cho người dùng):
  - lỗi kết nối → `Cannot reach Ollama at <baseURL>`
  - HTTP ≠ 200 → giá trị field `error` trong body JSON, nếu không parse được thì `Ollama returned HTTP <code>`
  - dòng có field `error` → giá trị đó
  - EOF khi chưa `done:true` → `Ollama stream ended unexpectedly`
  - `ctx` bị huỷ → `ctx.Err()`

- [ ] **Step 1: Viết test** với `httptest.NewServer` trả NDJSON:
  - `TestChat_Streams`: 3 dòng `{"message":{"content":"Hel"}}`, `{"message":{"content":"lo"}}`, `{"done":true}` → deltas `["Hel","lo"]`, kết quả `"Hello"`; server kiểm tra body có `"model":"gemma4:31b-cloud"`, `"stream":true`.
  - `TestChat_Unreachable`: baseURL `http://127.0.0.1:1` → lỗi chứa `Cannot reach Ollama at http://127.0.0.1:1`.
  - `TestChat_HTTPError`: 404 `{"error":"model not found"}` → lỗi `model not found`.
  - `TestChat_ErrorLineMidStream`: một delta rồi `{"error":"context length exceeded"}` → lỗi đó.
  - `TestChat_EOFWithoutDone`: một delta rồi đóng → lỗi `Ollama stream ended unexpectedly`.
  - `TestChat_LongLine`: một delta dài 200 000 ký tự → kết quả đúng độ dài.
  - `TestChat_OnDeltaErrorStops`: `onDelta` trả lỗi → `Chat` trả về lỗi đó.

- [ ] **Step 2: `go test ./internal/ollama/` → FAIL**

- [ ] **Step 3: Implement.** Đọc từng dòng bằng `bufio.Reader.ReadBytes('\n')` (không dùng `bufio.Scanner` mặc định); request tạo bằng `http.NewRequestWithContext`.

- [ ] **Step 4: `go test ./internal/ollama/` → PASS**

- [ ] **Step 5: Commit** `feat(backend): streaming ollama chat client`

---

### Task 4: REST handlers cho session

**Files:**
- Create: `backend/internal/api/router.go`, `backend/internal/api/sessions.go`
- Test: `backend/internal/api/sessions_test.go`

**Interfaces:**
- Consumes: `store.*` (Task 2), `ValidateRename` (Task 1), `ollama.Message` (Task 3).
- Produces:
```go
type ChatClient interface {
	Chat(ctx context.Context, msgs []ollama.Message, onDelta func(string) error) (string, error)
}
func NewRouter(st *store.Store, chat ChatClient) *gin.Engine // gin.New() + gin.Recovery() + gin.Logger()
```
- Route theo spec mục 3.4: `GET/POST /api/sessions`, `GET /api/sessions/:id/messages`, `PATCH/DELETE /api/sessions/:id`. (Route stream thêm ở Task 5.)

- [ ] **Step 1: Viết test** (`httptest.NewRecorder`, store thật trên `t.TempDir()`, `chat` = nil):
  - `POST /api/sessions` → 201, `title == ""`, có `id`.
  - `GET /api/sessions` khi rỗng → 200 body `[]`.
  - `PATCH` `{"title":"  New name "}` → 200 `title=="New name"`; `{"title":"  "}` → 400; title 101 rune → 400; id lạ → 404 `{"error":"session not found"}`; body không phải JSON → 400.
  - `DELETE` → 204, sau đó `GET …/messages` → 404.
  - `GET /api/sessions/:id/messages` session mới → 200 `[]`.

- [ ] **Step 2: `go test ./internal/api/` → FAIL**

- [ ] **Step 3: Implement** — `go get github.com/gin-gonic/gin`; `errors.Is(err, store.ErrNotFound)` → 404; lỗi khác → 500 `{"error":"internal error"}` và `log.Printf`.

- [ ] **Step 4: `go test ./internal/api/` → PASS**

- [ ] **Step 5: Commit** `feat(backend): session REST endpoints`

---

### Task 5: Endpoint gửi tin nhắn (SSE)

**Files:**
- Create: `backend/internal/api/stream.go`
- Modify: `backend/internal/api/router.go` (đăng ký `POST /api/sessions/:id/messages`)
- Test: `backend/internal/api/stream_test.go`

**Interfaces:**
- Consumes: `AutoTitle`, `store.AddMessage`, `store.SetTitleIfEmpty`, `store.ListMessages`, `ChatClient`.
- Produces: SSE theo Global Constraints. Thứ tự xử lý đúng spec mục 3.5. Validate (400/404) trả JSON **trước khi** gửi header SSE.

- [ ] **Step 1: Viết test.** Dùng `httptest.NewServer(NewRouter(st, ollama.New(fake.URL, "gemma4:31b-cloud")))` với `fake` là Ollama giả; helper `readEvents(body) []sseEvent{Name, Data string}`.
  - `TestStream_Success`: fake trả "Xin " + "chào" + done → events `delta,delta,done`; `done.title == AutoTitle(prompt)`; DB có 2 message (user, assistant "Xin chào"); fake nhận đủ lịch sử (gửi lần 2 trong cùng session → fake nhận 3 message).
  - `TestStream_TitleOnlyFirstPrompt`: gửi 2 lần → title vẫn theo prompt đầu.
  - `TestStream_OllamaError`: fake 500 `{"error":"boom"}` → events `[error]` với `message=="boom"`; DB chỉ có message user.
  - `TestStream_PartialNotSaved`: fake gửi 1 delta rồi đóng → events `delta,error`; DB chỉ có message user.
  - `TestStream_Validation`: content `"   "` → 400 JSON; session lạ → 404 JSON.
  - `TestStream_Headers`: `Content-Type` bắt đầu bằng `text/event-stream`, có `X-Accel-Buffering: no`.

- [ ] **Step 2: `go test ./internal/api/` → FAIL**

- [ ] **Step 3: Implement.** Ghi event bằng `fmt.Fprintf(w, "event: %s\ndata: %s\n\n", name, json)` rồi `c.Writer.Flush()`; dùng `c.Request.Context()` cho `Chat` để client ngắt thì huỷ Ollama. Chỉ `AddMessage(assistant)` khi `Chat` trả `err == nil`.

- [ ] **Step 4: `go test ./...` → PASS**

- [ ] **Step 5: Commit** `feat(backend): stream chat replies over SSE`

---

### Task 6: `main.go` và Dockerfile backend

**Files:**
- Create: `backend/cmd/server/main.go`, `backend/Dockerfile`, `backend/.dockerignore` (`chat.db`, `*.db`)

**Interfaces:**
- Consumes: `store.Open`, `ollama.New`, `api.NewRouter`.

- [ ] **Step 1: Implement `main`** — đọc 4 env với mặc định ở Global Constraints; `http.Server{Addr: ":"+port, Handler: r, ReadHeaderTimeout: 10*time.Second}` (không `WriteTimeout`); log URL Ollama và model khi khởi động.

- [ ] **Step 2: Dockerfile** — stage `golang:1.25-alpine`: `go mod download`, `CGO_ENABLED=0 go build -o /server ./cmd/server`; stage `gcr.io/distroless/static:nonroot`: copy `/server`, `ENV DB_PATH=/data/chat.db PORT=8081`, `EXPOSE 8081`, `USER nonroot`, `ENTRYPOINT ["/server"]`.

- [ ] **Step 3: Verify local** — `go vet ./... && go test ./...` → PASS; `go run ./cmd/server` rồi `curl -X POST localhost:8081/api/sessions` → 201 JSON.

- [ ] **Step 4: Verify image** — `docker build -t aichatbot-backend ./backend` → thành công.

- [ ] **Step 5: Commit** `feat(backend): server entrypoint and Dockerfile`

---

### Task 7: Frontend scaffold, Tailwind theme, SSE reader

**Files:**
- Create: `frontend/` (qua Angular CLI), `frontend/.postcssrc.json`, `frontend/proxy.conf.json`
- Modify: `frontend/src/styles.css`, `frontend/angular.json` (`serve.options.proxyConfig`)
- Create: `frontend/src/app/core/sse.ts`
- Test: `frontend/src/app/core/sse.spec.ts`

**Interfaces:**
- Produces:
```ts
export type SseEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; messageId: number; title: string }
  | { type: 'error'; message: string };
export class SseParser { push(chunk: string): SseEvent[] }  // giữ phần dư giữa các lần push
export function readSseStream(stream: ReadableStream<Uint8Array>): AsyncIterable<SseEvent>
```

- [ ] **Step 1: Scaffold** — tại gốc repo: `npx @angular/cli@latest new frontend --style=css --ssr=false --skip-git --skip-tests=false`. Xác nhận `ng test` chạy Vitest và app zoneless (`provideZonelessChangeDetection` hoặc mặc định của bản CLI); nếu bản CLI hỏi test runner thì chọn Vitest.

- [ ] **Step 2: Tailwind v4** — `npm i -D tailwindcss @tailwindcss/postcss postcss`; `.postcssrc.json` `{"plugins":{"@tailwindcss/postcss":{}}}`; `styles.css`:
```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));
@theme {
  --color-brand-500: #6c4cf2; --color-brand-600: #5638d6; --color-brand-700: #4229ad;
  --color-neutral-0: #ffffff; --color-neutral-50: #f7f7f8; --color-neutral-100: #ededf0;
  --color-neutral-200: #dfe0e4; --color-neutral-300: #c5c6cc; --color-neutral-400: #a0a3ac;
  --color-neutral-500: #71737c; --color-neutral-600: #5b5f68; --color-neutral-900: #17181b;
  --color-danger-100: #fde2e1; --color-danger-500: #e5484d; --color-danger-600: #cc3b37; --color-danger-700: #b3261e;
}
```
  `proxy.conf.json`: `{"/api": {"target": "http://localhost:8081", "secure": false}}`.

- [ ] **Step 3: Viết test `sse.spec.ts`:**
  - `parses a single event`: `"event: delta\ndata: {\"text\":\"hi\"}\n\n"` → `[{type:'delta',text:'hi'}]`.
  - `handles an event split across chunks`: push `"event: del"`, rồi `"ta\ndata: {\"text\":\"a\"}\n\n"` → lần 1 `[]`, lần 2 một event.
  - `handles several events in one chunk`: delta + done → 2 event, `done.messageId===7`, `done.title==='x'`.
  - `readSseStream decodes multibyte split across chunks`: encode `event: delta\ndata: {"text":"Việt 😀"}\n\n` bằng `TextEncoder`, cắt bytes ở giữa ký tự `ệ` và giữa emoji thành 3 chunk → `text === 'Việt 😀'`.

- [ ] **Step 4: `npx ng test --watch=false` → FAIL**

- [ ] **Step 5: Implement** — `readSseStream` dùng `TextDecoder` với `{stream: true}` rồi đưa vào `SseParser`; event phân tách bằng `\n\n`, hỗ trợ `\r\n`.

- [ ] **Step 6: `npx ng test --watch=false` → PASS; `npx ng build` → thành công**

- [ ] **Step 7: Commit** `feat(frontend): scaffold Angular app with Tailwind theme and SSE reader`

---

### Task 8: `ApiService` và `ThemeService`

**Files:**
- Create: `frontend/src/app/core/models.ts`, `frontend/src/app/core/api.service.ts`, `frontend/src/app/core/theme.service.ts`
- Modify: `frontend/src/app/app.config.ts` (`provideHttpClient(withFetch())`), `frontend/src/index.html` (script theme inline)
- Test: `frontend/src/app/core/api.service.spec.ts`, `frontend/src/app/core/theme.service.spec.ts`

**Interfaces:**
- Consumes: `SseEvent`, `readSseStream` (Task 7).
- Produces:
```ts
// models.ts
export interface Session { id: string; title: string; createdAt: string; updatedAt: string }
export interface ChatMessage { id?: number; role: 'user' | 'assistant'; content: string; error?: string }
// api.service.ts (providedIn root)
listSessions(): Promise<Session[]>
createSession(): Promise<Session>
listMessages(id: string): Promise<ChatMessage[]>
renameSession(id: string, title: string): Promise<Session>
deleteSession(id: string): Promise<void>
streamMessage(id: string, content: string, signal: AbortSignal): AsyncIterable<SseEvent>
// theme.service.ts (providedIn root)
readonly theme: Signal<'light' | 'dark'>
toggle(): void
```
- REST dùng `HttpClient` + `firstValueFrom`. `streamMessage` dùng `fetch` (`POST`, JSON body `{content}`); response không ok → ném `Error` với message lấy từ `{"error"}` trong body.

- [ ] **Step 1: Viết test**
  - `api.service.spec.ts` (`provideHttpClientTesting`): `renameSession` gửi `PATCH /api/sessions/abc` body `{title:'x'}`; `streamMessage` với `fetch` bị stub (`vi.stubGlobal`) trả `Response` có body SSE → nhận đúng event; status 404 body `{"error":"session not found"}` → ném lỗi `session not found`.
  - `theme.service.spec.ts`: không có `localStorage.theme` và `matchMedia('(prefers-color-scheme: dark)').matches === true` → `theme()==='dark'`, `<html>` có class `dark`; `toggle()` → `'light'`, class bị gỡ, `localStorage.theme==='light'`; có sẵn `localStorage.theme='light'` dù hệ thống dark → `'light'`.

- [ ] **Step 2: `npx ng test --watch=false` → FAIL**

- [ ] **Step 3: Implement** cả hai service; thêm vào `<head>` của `index.html` script inline đặt class `dark` theo cùng quy tắc trước khi Angular chạy.

- [ ] **Step 4: `npx ng test --watch=false` → PASS**

- [ ] **Step 5: Commit** `feat(frontend): api and theme services`

---

### Task 9: `ChatStore`

**Files:**
- Create: `frontend/src/app/core/chat.store.ts`
- Test: `frontend/src/app/core/chat.store.spec.ts`

**Interfaces:**
- Consumes: `ApiService`, `Session`, `ChatMessage` (Task 8); `Router`.
- Produces (providedIn root):
```ts
readonly sessions: Signal<Session[]>
readonly activeSessionId: Signal<string | null>
readonly messages: Signal<ChatMessage[]>
readonly isStreaming: Signal<boolean>
readonly error: Signal<string | null>        // banner REST, tự xoá sau 4000 ms
loadSessions(): Promise<void>
openSession(id: string): Promise<void>      // abort stream đang chạy; 404 → navigate ['/']
newChat(): void                             // abort stream; activeSessionId=null; messages=[]
send(content: string): Promise<void>
rename(id: string, title: string): Promise<void>
remove(id: string): Promise<void>
```
- `send`: bỏ qua nếu `content.trim()===''` hoặc `isStreaming()`. Nếu chưa có session → `createSession()`, `navigate(['/c', id])`, thêm session vào đầu `sessions`. Thêm bubble user + bubble assistant rỗng; `delta` nối vào bubble cuối; `done` gán `id`, cập nhật `title` và đưa session lên đầu `sessions`; `error` (event hoặc exception) → gán `error` cho bubble assistant. Abort (`AbortError`) không hiển thị lỗi.
- `openSession(id)` khi `id === activeSessionId()` và đang stream thì không làm gì (tránh tự huỷ stream khi navigate sau tạo session).

- [ ] **Step 1: Viết test** với `ApiService` giả (object implement 6 method, `streamMessage` là async generator) và `Router` giả có `navigate` là `vi.fn()`:
  - `send creates a session on first message`: `createSession` gọi 1 lần, `navigate(['/c','s1'])`, `messages()` = user + assistant `"Hello"`, `sessions()[0].title === 'Hi there'` (từ `done`).
  - `send ignores input while streaming`: gọi `send` lần 2 khi generator chưa xong → `streamMessage` chỉ gọi 1 lần.
  - `stream error marks assistant bubble`: generator yield `{type:'error',message:'boom'}` → bubble cuối `error==='boom'`, bubble user còn.
  - `remove active session resets to new chat`: `navigate(['/'])`, `messages()` rỗng, session biến khỏi list.
  - `rename updates title in list`.
  - `openSession with unknown id navigates home`: `listMessages` ném lỗi 404 → `navigate(['/'])`.

- [ ] **Step 2: `npx ng test --watch=false` → FAIL**

- [ ] **Step 3: Implement** bằng `signal()` nội bộ + `asReadonly()`.

- [ ] **Step 4: `npx ng test --watch=false` → PASS**

- [ ] **Step 5: Commit** `feat(frontend): chat store with signals`

---

### Task 10: Khung chat — message, input, chat view, routing

**Files:**
- Create: `frontend/src/app/chat/markdown.ts`, `frontend/src/app/chat/message.component.ts`, `frontend/src/app/chat/chat-input.component.ts`, `frontend/src/app/chat/chat-view.component.ts`
- Modify: `frontend/src/app/app.routes.ts`, `frontend/src/styles.css` (import theme `highlight.js/styles/github.css` và `github-dark.css` bọc dưới `.dark`)
- Test: `frontend/src/app/chat/markdown.spec.ts`, `frontend/src/app/chat/chat-input.component.spec.ts`

**Interfaces:**
- Consumes: `ChatStore` (Task 9), `ChatMessage`.
- Produces:
```ts
export function renderMarkdown(src: string): string   // marked + highlight.js + DOMPurify.sanitize
// MessageComponent: input.required<ChatMessage>('message')
// ChatInputComponent: input<boolean>('disabled'), output<string>('send')
// ChatViewComponent: route component cho '' và 'c/:id'
```
- Routes: `{path: '', component: ChatViewComponent}`, `{path: 'c/:id', component: ChatViewComponent}`, `{path: '**', redirectTo: ''}`. `ChatViewComponent` theo dõi param `id`: có id → `store.openSession(id)`, không có → `store.newChat()`.
- Npm: `npm i marked highlight.js dompurify` (+ `marked-highlight` nếu cần nối `marked` với `highlight.js`).

- [ ] **Step 1: Viết test**
  - `markdown.spec.ts`: `renderMarkdown strips script and event handlers` — input `"<script>alert(1)</script><img src=x onerror=alert(1)>"` → output không chứa `<script` và `onerror`; ` ```ts\nconst a = 1\n``` ` → output chứa `<pre` và class `hljs`.
  - `chat-input.component.spec.ts`: gõ `"hi"` + Enter → `send` phát `"hi"` và ô được xoá; Shift+Enter → không phát; `"   "` + Enter → không phát; `disabled=true` → nút Send `disabled`.

- [ ] **Step 2: `npx ng test --watch=false` → FAIL**

- [ ] **Step 3: Implement**
  - `MessageComponent`: user → bubble phải, `whitespace-pre-wrap`, nền `neutral-100` / `dark:bg-neutral-0/10`; assistant → `[innerHTML]` = `renderMarkdown(content)` (khi đã sanitize bằng DOMPurify thì bọc `DomSanitizer.bypassSecurityTrustHtml`), `pre` có `overflow-x-auto`; có `error` → dòng chữ `text-danger-600` (`dark:text-danger-500`); assistant rỗng khi đang stream → chấm "đang trả lời".
  - `ChatInputComponent`: textarea tự giãn tới tối đa ~200px, nút "Send" nền `brand-500` hover `brand-600`.
  - `ChatViewComponent`: cột `max-w-3xl mx-auto`, danh sách cuộn, input dính đáy; tự cuộn xuống cuối bằng `effect` khi `messages()` đổi; màn hình trống hiện lời chào "How can I help you code today?".

- [ ] **Step 4: `npx ng test --watch=false` → PASS**

- [ ] **Step 5: Commit** `feat(frontend): chat view with markdown messages and input`

---

### Task 11: Layout, sidebar, session item, theme toggle, responsive

**Files:**
- Create: `frontend/src/app/sidebar/sidebar.component.ts`, `frontend/src/app/sidebar/session-item.component.ts`
- Modify: `frontend/src/app/app.ts` (+ template của nó; tên file theo CLI)
- Test: `frontend/src/app/sidebar/session-item.component.spec.ts`

**Interfaces:**
- Consumes: `ChatStore`, `ThemeService`, `Session`.
- Produces:
```ts
// SessionItemComponent
session = input.required<Session>(); active = input<boolean>(false);
select = output<void>(); renamed = output<string>(); deleted = output<void>();
// SidebarComponent
closed = output<void>();   // phát khi chọn session / New Chat (để đóng drawer mobile)
```

- [ ] **Step 1: Viết test `session-item.component.spec.ts`:**
  - `Rename then Enter emits trimmed title`: mở menu "⋯" → "Rename" → input có giá trị hiện tại; nhập `"  New "` + Enter → `renamed` phát `"New"`.
  - `Escape cancels rename`: Esc → không phát, hiển thị lại title cũ.
  - `Delete asks for confirmation`: "Delete" → hiện dialog; bấm xác nhận → `deleted` phát 1 lần; bấm Cancel → không phát.

- [ ] **Step 2: `npx ng test --watch=false` → FAIL**

- [ ] **Step 3: Implement**
  - `SessionItemComponent`: nút "⋯" có `aria-label="Session options"`, class `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100`; item active nền `brand-500/10` chữ `brand-700` (`dark:text-brand-500`); "Delete" màu danger.
  - `SidebarComponent`: nút "+ New Chat" → `router.navigate(['/'])` rồi phát `closed`; list từ `store.sessions()`; click item → `navigate(['/c', id])`; gọi `store.loadSessions()` khi khởi tạo.
  - `App`: header `h-14` với tiêu đề "AI Coding's Chatbot" (`truncate`), nút hamburger (`md:hidden`, `aria-label="Open sidebar"`), nút theme (`aria-label="Toggle theme"`) gọi `theme.toggle()`. ≥ md: sidebar `w-[260px]` cố định; < md: drawer `fixed inset-y-0 left-0` + backdrop, đóng khi backdrop click / Esc / `closed`. Banner `store.error()` ở trên khung chat. Nền light `neutral-50`/`neutral-0`, dark `neutral-900` với bề mặt `neutral-0/5`, viền `neutral-0/10`, chữ `neutral-100`/`neutral-400`.

- [ ] **Step 4: `npx ng test --watch=false` → PASS; `npx ng build` → thành công**

- [ ] **Step 5: Verify thủ công (dev)** — chạy `go run ./cmd/server` (backend) và `npx ng serve` (frontend), mở `http://localhost:4200`: gửi prompt, thấy stream; sidebar có session mới; rename/delete; toggle theme và reload; thu hẹp cửa sổ < 768px dùng hamburger.

- [ ] **Step 6: Commit** `feat(frontend): sidebar, session actions, theme toggle and responsive layout`

---

### Task 12: Docker frontend, docker-compose, README

**Files:**
- Create: `frontend/Dockerfile`, `frontend/nginx.conf`, `frontend/.dockerignore` (`node_modules`, `dist`, `.angular`), `docker-compose.yml`, `README.md`

**Interfaces:**
- Consumes: image backend (Task 6), build Angular (Task 7–11).

- [ ] **Step 1: `frontend/Dockerfile`** — stage `node:24-alpine`: `npm ci`, `npx ng build`; stage `nginx:alpine`: copy `dist/frontend/browser` → `/usr/share/nginx/html`, copy `nginx.conf` → `/etc/nginx/conf.d/default.conf`.

- [ ] **Step 2: `frontend/nginx.conf`** — `listen 80`; `location / { try_files $uri $uri/ /index.html; }`; `location /api/ { proxy_pass http://backend:8081; proxy_http_version 1.1; proxy_buffering off; proxy_cache off; proxy_read_timeout 1h; }`.

- [ ] **Step 3: `docker-compose.yml`** — đúng spec mục 5: service `backend` (build `./backend`, env `DB_PATH=/data/chat.db`, `OLLAMA_URL=http://host.docker.internal:11434`, `OLLAMA_MODEL=gemma4:31b-cloud`, volume `chat-data:/data`, `extra_hosts: ["host.docker.internal:host-gateway"]`, `restart: unless-stopped`); service `frontend` (build `./frontend`, `ports: ["8080:80"]`, `depends_on: [backend]`); `volumes: {chat-data: {}}`.

- [ ] **Step 4: `README.md`** — yêu cầu (Docker, Ollama đã `ollama signin` và `ollama pull gemma4:31b-cloud`), `docker compose up --build`, mở `http://localhost:8080`; chạy dev không Docker; ghi chú `OLLAMA_HOST=0.0.0.0` nếu container không gọi được Ollama; bảng env.

- [ ] **Step 5: Verify** — `docker compose up --build -d`; `curl -s localhost:8080/api/sessions` → `[]` hoặc danh sách JSON; kiểm tra thủ công 6 tiêu chí hoàn thành ở spec mục 1 (tiêu chí 4: `docker compose down` rồi `up -d`, lịch sử còn).

- [ ] **Step 6: Commit** `feat: dockerize frontend and add compose setup`
