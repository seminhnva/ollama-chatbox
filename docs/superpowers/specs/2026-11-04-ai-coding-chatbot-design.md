# AI Coding's Chatbot — Design Spec

- Ngày: 2026-11-04
- Trạng thái: Chờ review
- Nguồn yêu cầu: `PROMPT.md`

## 1. Mục tiêu và phạm vi

Web chatbot cá nhân, chạy local, một người dùng, LLM là Ollama model `gemma4:31b-cloud`.
Người dùng chat với bot, các phiên chat (session) được lưu trong SQLite (version sqlite3) để mở lại và chat tiếp.

**Trong phạm vi**
- Khung chat hiển thị hội thoại user ↔ bot, câu trả lời stream dần, render Markdown + code highlight.
- Ô nhập nhiều dòng + nút "Send".
- Sidebar trái: nút "New Chat" ở trên, danh sách session bên dưới.
- Tên session tự sinh = 20 ký tự đầu của prompt đầu tiên.
- Hover vào session hiện "⋯" → Rename / Delete.
- Tiêu đề chung "AI Coding's Chatbot".
- Dark mode / light mode có nút chuyển; giao diện responsive (desktop + mobile).
- Docker cho frontend, backend và dữ liệu SQLite (volume).

**Ngoài phạm vi**
- User / đăng nhập / phân quyền.
- Cắt bớt ngữ cảnh khi session quá dài.
- Test e2e tự động.
- Deploy public.

**Tiêu chí hoàn thành**
1. `docker compose up --build` → mở `http://localhost:8080` chat được, chữ stream dần.
2. Session mới xuất hiện ở sidebar với tên = 20 ký tự đầu của prompt.
3. Rename và Delete hoạt động qua menu "⋯" (hiện khi hover hoặc focus).
4. `docker compose down` rồi `up` lại: lịch sử còn nguyên; click session → load lại và chat tiếp được.
5. Nút theme chuyển light ↔ dark, reload trang vẫn giữ theme đã chọn.
6. Ở chiều rộng < 768px: sidebar ẩn, mở/đóng được bằng hamburger; chat và ô nhập dùng được không bị vỡ layout.

## 2. Kiến trúc

```
Browser ──► nginx (container frontend, :8080)
             ├─ /        → Angular build tĩnh (SPA fallback về index.html)
             └─ /api/*   → proxy ──► Go/Gin (container backend) ──► Ollama trên host (:11434)
                                            │
                                            └─ SQLite file /data/chat.db (Docker volume)
```

- Giao tiếp: REST JSON + streaming SSE trên HTTP (`POST` → `fetch` + `ReadableStream`). Không dùng WebSocket.
- Kết nối Ollama: daemon Ollama trên máy người dùng (đã `ollama signin`), backend gọi `http://host.docker.internal:11434`. URL cấu hình qua env `OLLAMA_URL`; sau này có thể trỏ sang `https://ollama.com` mà không đổi code ngoài việc thêm header API key.

## 3. Backend (Go + Gin)

### 3.1 Cấu trúc

```
backend/
  cmd/server/main.go     -- đọc env, khởi tạo store / ollama client, đăng ký route, chạy Gin
  internal/store/        -- truy vấn SQLite (sessions, messages), tạo schema khi khởi động
  internal/ollama/       -- client gọi POST /api/chat với stream: true, đọc NDJSON
  internal/api/          -- Gin handlers, ghi SSE
  Dockerfile
```

- Driver: `database/sql` + `modernc.org/sqlite` (thuần Go, `CGO_ENABLED=0`). Đây là engine SQLite 3, file `.db` tương thích hoàn toàn với `sqlite3` CLI. SQL viết tay, không ORM.
- Bật `PRAGMA foreign_keys = ON` cho mỗi kết nối.

### 3.2 Cấu hình (env)

| Biến | Mặc định |
|---|---|
| `PORT` | `8081` |
| `DB_PATH` | `./chat.db` (trong Docker: `/data/chat.db`) |
| `OLLAMA_URL` | `http://localhost:11434` (trong Docker: `http://host.docker.internal:11434`) |
| `OLLAMA_MODEL` | `gemma4:31b-cloud` |

### 3.3 Schema

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,              -- UUID
  title      TEXT NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content    TEXT NOT NULL,
  created_at DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
```

`sessions.updated_at` được cập nhật mỗi khi có tin nhắn mới hoặc đổi tên.

### 3.4 API

Lỗi trả về dạng `{"error": "<message>"}`.

| Method | Path | Request | Response |
|---|---|---|---|
| `GET` | `/api/sessions` | — | `200 [{id, title, createdAt, updatedAt}]`, sắp xếp `updated_at DESC` |
| `POST` | `/api/sessions` | — | `201 {id, title, createdAt, updatedAt}` (title rỗng) |
| `GET` | `/api/sessions/:id/messages` | — | `200 [{id, role, content, createdAt}]` theo thứ tự `id ASC`; `404` nếu không có session |
| `PATCH` | `/api/sessions/:id` | `{title}` | `200 {session}`; `400` nếu title rỗng sau trim hoặc > 100 ký tự; `404` |
| `DELETE` | `/api/sessions/:id` | — | `204`; `404` |
| `POST` | `/api/sessions/:id/messages` | `{content}` | `200 text/event-stream`; `400` nếu content rỗng sau trim; `404` |

### 3.5 Luồng gửi tin nhắn (`POST /api/sessions/:id/messages`)

1. Validate `content` (trim, không rỗng). Kiểm tra session tồn tại.
2. Lưu tin nhắn `user`. Nếu `title` đang rỗng → đặt `title = autoTitle(content)`.
3. Đọc toàn bộ tin nhắn của session, gửi sang Ollama `POST /api/chat` với `{model, messages, stream: true}`.
4. Với mỗi dòng NDJSON từ Ollama có `message.content` không rỗng → ghi event:
   ```
   event: delta
   data: {"text": "..."}
   ```
5. Khi Ollama trả `done: true` → lưu câu trả lời đầy đủ (role `assistant`), ghi:
   ```
   event: done
   data: {"messageId": 123, "title": "<title hiện tại của session>"}
   ```
6. Lỗi bất kỳ sau khi đã bắt đầu stream → ghi `event: error` / `data: {"message": "..."}` rồi đóng stream; không lưu câu trả lời dở. Tin nhắn user đã lưu ở bước 2 vẫn giữ.
7. Request context bị huỷ (client đóng tab / abort) → huỷ request tới Ollama, không lưu câu trả lời dở.

Header SSE: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`; flush sau mỗi event.

### 3.6 `autoTitle(content)`

- Gộp mọi chuỗi khoảng trắng (kể cả xuống dòng) thành một dấu cách, trim.
- Cắt tối đa **20 ký tự tính theo rune** (không cắt hỏng ký tự tiếng Việt). Không thêm "…".

### 3.7 Xử lý lỗi

| Tình huống | Hành vi |
|---|---|
| Body không hợp lệ / content hoặc title rỗng | `400` |
| Session không tồn tại | `404 {"error": "session not found"}` |
| Không kết nối được Ollama | SSE `error`: `Cannot reach Ollama at <OLLAMA_URL>` |
| Ollama trả HTTP lỗi (sai model, chưa signin, quota, vượt context) | SSE `error` kèm thông báo lỗi của Ollama |
| Lỗi DB không mong đợi | `500` (REST) hoặc SSE `error` (đang stream); log ra stdout |

Server không đặt `WriteTimeout` để không cắt ngang stream dài.

## 4. Frontend (Angular)

### 4.1 Nền tảng

- Angular bản mới nhất lúc scaffold (Angular CLI, builder mặc định dựa trên esbuild/Vite), standalone components, signals, zoneless, control flow `@if` / `@for`.
- Tailwind CSS v4; token màu khai báo trong `@theme` lấy từ `design-system-DESIGN.md`:
  - brand: `500 #6c4cf2`, `600 #5638d6`, `700 #4229ad`
  - neutral: `0 #ffffff`, `50 #f7f7f8`, `100 #ededf0`, `200 #dfe0e4`, `300 #c5c6cc`, `400 #a0a3ac`, `500 #71737c`, `600 #5b5f68`, `900 #17181b`
  - danger: `100 #fde2e1`, `500 #e5484d`, `600 #cc3b37`, `700 #b3261e`
- Markdown: `marked` + `highlight.js`, HTML làm sạch bằng `DOMPurify` trước khi gán vào `innerHTML`.
- Nhãn giao diện tiếng Anh: "New Chat", "Send", "Rename", "Delete".

### 4.1a Dark mode / Light mode

- Nút chuyển theme (icon mặt trời / mặt trăng) ở góc phải header, có `aria-label`.
- Lần đầu truy cập: theo `prefers-color-scheme` của hệ điều hành. Sau khi người dùng bấm chuyển: lưu lựa chọn vào `localStorage` (`theme = 'light' | 'dark'`) và dùng lựa chọn đó cho các lần sau.
- Cài đặt: `ThemeService` (signal `theme`) bật/tắt class `dark` trên `<html>`; Tailwind v4 khai báo `@custom-variant dark (&:where(.dark, .dark *));`. Một script nhỏ inline trong `index.html` đặt class trước khi Angular khởi động để tránh nháy màu.
- Màu dark mode chỉ dùng token có trong design system (không tự chế mã màu mới):
  - Nền chính `neutral-900`; sidebar / bubble user / ô nhập dùng `neutral-0` với độ trong suốt 5–10%; viền `neutral-0` 10%.
  - Chữ chính `neutral-100`, chữ phụ `neutral-400`.
  - Brand `500` cho nút Send, item đang chọn; danger `500` cho lỗi và Delete.
- Theme highlight code: `github` cho light, `github-dark` cho dark (đổi theo class `dark`).

### 4.1b Responsive

- Breakpoint `md` (768px):
  - **≥ md**: layout 2 cột, sidebar cố định rộng 260px.
  - **< md**: sidebar ẩn; header có nút hamburger mở sidebar dạng drawer trượt từ trái, có backdrop. Drawer đóng khi chọn session, bấm "New Chat", bấm backdrop hoặc nhấn Esc.
- Thiết bị cảm ứng (`@media (hover: none)`): nút "⋯" luôn hiển thị vì không có hover.
- Nội dung chat giới hạn `max-w-3xl`, căn giữa; ô nhập dính đáy màn hình; tiêu đề header tự cắt bằng `truncate` khi màn hình hẹp.
- Code block trong câu trả lời cuộn ngang, không làm vỡ layout.

### 4.2 Bố cục

```
┌──────────────────────────────────────────────────────────┐
│  AI Coding's Chatbot                                     │
├───────────────┬──────────────────────────────────────────┤
│ [+ New Chat]  │                                          │
│               │                     (user bubble)        │
│ Session 1   ⋯ │   (assistant markdown)                   │
│ Session 2     │                                          │
│               ├──────────────────────────────────────────┤
│               │ [ textarea nhiều dòng            ][Send] │
└───────────────┴──────────────────────────────────────────┘
```

### 4.3 Components

| Component | Trách nhiệm |
|---|---|
| `AppComponent` | Header (tiêu đề, nút hamburger khi < md, nút chuyển theme) + layout 2 cột / drawer, `<router-outlet>` |
| `SidebarComponent` | Nút "New Chat", danh sách `SessionItemComponent`, highlight session đang mở |
| `SessionItemComponent` | Hiển thị title; nút "⋯" chỉ hiện khi hover hoặc focus-within; menu Rename / Delete. Rename: input inline, Enter lưu, Esc huỷ. Delete: dialog xác nhận nhỏ |
| `ChatViewComponent` | Đọc route, danh sách `MessageComponent`, auto-scroll xuống cuối khi có nội dung mới, màn hình chào khi trống |
| `MessageComponent` | User: text thuần (giữ xuống dòng). Assistant: Markdown đã sanitize; trạng thái lỗi hiển thị màu danger |
| `ChatInputComponent` | Textarea tự giãn chiều cao; Enter = gửi, Shift+Enter = xuống dòng; Send disabled khi rỗng hoặc đang stream |

### 4.4 State và services

- `ApiService`: REST qua `HttpClient`; `streamMessage(sessionId, content, signal)` dùng `fetch` + `ReadableStream`, trả về async iterable các event `{type: 'delta'|'done'|'error', data}`.
- `parseSse(chunk)`: hàm thuần, tách event SSE, chịu được chunk bị cắt giữa chừng và nhiều event trong một chunk.
- `ChatStore` (injectable, signals): `sessions`, `activeSessionId`, `messages`, `isStreaming`, `error`. Methods: `loadSessions()`, `openSession(id)`, `newChat()`, `send(content)`, `rename(id, title)`, `remove(id)`.

### 4.5 Routing

- `/` → chat mới (chưa có session).
- `/c/:id` → mở session `id`. Reload trang giữ đúng session. Id không tồn tại → điều hướng về `/`.

### 4.6 Hành vi

- **New Chat**: điều hướng `/`, xoá khung chat; chưa tạo session (tránh session rỗng).
- **Send khi chưa có session**: `POST /api/sessions` → điều hướng `/c/:id` → stream tin nhắn.
- **Send**: thêm ngay bubble user + bubble assistant rỗng; nối `delta` vào bubble assistant; khi `done` cập nhật title và đưa session lên đầu sidebar.
- **Chuyển session / New Chat khi đang stream**: abort stream đang chạy.
- **Delete session đang mở**: điều hướng `/`.
- **Lỗi stream**: bubble assistant hiển thị thông báo lỗi; tin nhắn user giữ nguyên; người dùng có thể gửi lại.
- **Lỗi REST**: banner lỗi nhỏ, tự ẩn sau vài giây.

## 5. Docker

```
docker-compose.yml
backend/Dockerfile
frontend/Dockerfile
frontend/nginx.conf
```

- `backend/Dockerfile`: stage build `golang` với `CGO_ENABLED=0`; stage chạy `gcr.io/distroless/static` user nonroot; `DB_PATH=/data/chat.db`.
- `frontend/Dockerfile`: stage build `node` (`npm ci && ng build`); stage chạy `nginx:alpine` copy `dist` và `nginx.conf`.
- `frontend/nginx.conf`: `try_files $uri /index.html`; `location /api/ { proxy_pass http://backend:8081; proxy_buffering off; proxy_read_timeout 1h; }`.
- `docker-compose.yml`:
  - `backend`: build `./backend`, env như mục 3.2, volume `chat-data:/data`, `extra_hosts: ["host.docker.internal:host-gateway"]`, không publish port.
  - `frontend`: build `./frontend`, `ports: ["8080:80"]`, `depends_on: [backend]`.
  - `volumes: { chat-data: {} }`.
- Phát triển không Docker: `go run ./cmd/server` (port 8081) + `ng serve` với `proxy.conf.json` chuyển `/api` → `http://localhost:8081`.
- README ghi chú: nếu container không gọi được Ollama, đặt `OLLAMA_HOST=0.0.0.0` cho Ollama trên host và khởi động lại Ollama.

## 6. Testing

**Backend (`go test ./...`)**
- `store`: dùng file SQLite tạm; tạo / liệt kê (thứ tự `updated_at DESC`) / đổi tên / xoá session; xoá cascade messages.
- `autoTitle`: chuỗi tiếng Việt dài, chuỗi có xuống dòng và khoảng trắng thừa, chuỗi ngắn hơn 20 ký tự.
- `api`: `httptest` + Ollama giả (`httptest.Server` trả NDJSON):
  - stream thành công → nhận các `delta` rồi `done`, câu trả lời được lưu.
  - Ollama trả lỗi / không kết nối được → nhận `error`, không lưu câu trả lời.
  - validate `400` / `404` cho các endpoint.

**Frontend (Vitest)**
- `parseSse`: chunk bị cắt giữa, nhiều event trong một chunk.
- `ChatStore` với `ApiService` giả: gửi tin đầu tiên tạo session; delete session đang mở reset về chat mới; lỗi stream hiển thị trên bubble.
- `SessionItemComponent`: rename Enter lưu, Esc huỷ.
- `ThemeService`: mặc định theo `prefers-color-scheme`; toggle cập nhật class `dark` và `localStorage`; đọc lại lựa chọn đã lưu.

**Kiểm tra thủ công**: 6 tiêu chí hoàn thành ở mục 1.
