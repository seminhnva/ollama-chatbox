# AI Coding's Chatbot

Chatbot web cá nhân: Angular + Go (Gin) + SQLite, LLM là Ollama model `gemma4:31b-cloud`.
Câu trả lời stream dần, hỗ trợ Markdown/code highlight, session được lưu và mở lại được, có dark/light mode và responsive.

## Yêu cầu

- Docker + Docker Compose
- [Ollama](https://ollama.com) chạy trên máy, đã đăng nhập và có model:
  ```bash
  ollama signin
  ollama pull gemma4:31b-cloud
  ```
  Model `-cloud` chạy trên server của Ollama, lượt dùng tính vào tài khoản Ollama của bạn.

## Chạy bằng Docker

```bash
docker compose up --build
```

Mở http://localhost:8080. Dữ liệu SQLite nằm trong volume `chat-data` nên còn nguyên sau `docker compose down` / `up`
(chỉ `docker compose down -v` mới xoá).

Nếu container không gọi được Ollama (`Cannot reach Ollama at ...`), cho Ollama lắng nghe mọi interface rồi khởi động lại nó:

```bash
# Linux/macOS
OLLAMA_HOST=0.0.0.0 ollama serve
# Windows (PowerShell): đặt biến môi trường người dùng OLLAMA_HOST=0.0.0.0 rồi restart Ollama
```

## Chạy khi phát triển (không Docker)

```bash
# terminal 1 — backend (cổng 8081)
cd backend
go run ./cmd/server

# terminal 2 — frontend (cổng 4200, proxy /api -> localhost:8081)
cd frontend
npm install
npx ng serve
```

Test:

```bash
cd backend && go test ./...
cd frontend && npx ng test --watch=false
```

## Cấu hình backend (biến môi trường)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `8081` | Cổng HTTP |
| `DB_PATH` | `./chat.db` (Docker: `/data/chat.db`) | File SQLite |
| `OLLAMA_URL` | `http://localhost:11434` (Docker: `http://host.docker.internal:11434`) | Địa chỉ Ollama |
| `OLLAMA_MODEL` | `gemma4:31b-cloud` | Model dùng để chat |

## API

| Method | Path | Mô tả |
|---|---|---|
| `GET` | `/api/sessions` | Danh sách session (mới cập nhật lên đầu) |
| `POST` | `/api/sessions` | Tạo session rỗng |
| `GET` | `/api/sessions/:id/messages` | Lịch sử tin nhắn |
| `PATCH` | `/api/sessions/:id` | Đổi tên `{title}` (tối đa 100 ký tự) |
| `DELETE` | `/api/sessions/:id` | Xoá session và tin nhắn |
| `POST` | `/api/sessions/:id/messages` | Gửi `{content}`, trả về stream SSE (`delta` / `done` / `error`) |
