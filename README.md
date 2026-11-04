# Ollama Chatbox

![Angular](https://img.shields.io/badge/Angular-DD0031?logo=angular&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?logo=go&logoColor=white)
![Gin](https://img.shields.io/badge/Gin-008ECF?logo=gin&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)
![Ollama](https://img.shields.io/badge/Ollama-000000?logo=ollama&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)

A self-hosted chat UI for local LLMs. The app is branded **"AI Coding's Chatbot"** in the browser: a ChatGPT-style interface with streamed replies, Markdown and syntax-highlighted code, saved conversations, dark/light mode and a responsive layout.

**Stack:** Angular 22 (signals, zoneless) + Tailwind CSS v4 · Go + Gin · SQLite · Ollama · Docker Compose

## Features

- Streaming replies (tokens appear as they are generated)
- Markdown rendering with code highlighting, sanitized with DOMPurify
- Multi-line input: `Enter` sends, `Shift+Enter` adds a new line
- Conversation history in a sidebar; click a session to reload it and keep chatting
- Session title = first 20 characters of the first prompt; rename or delete from the `⋯` menu (shown on hover/focus)
- Persistent storage in SQLite (Docker volume), survives restarts
- Light/dark theme (follows the OS by default, remembered afterwards) and a mobile drawer layout
- Single user, no authentication

## How it works

```
Browser ──► nginx (frontend container, :8080)
             ├─ /        → static Angular build (SPA fallback to index.html)
             └─ /api/*   → Go/Gin (backend container, :8081) ──► Ollama on the host (:11434)
                                    │
                                    └─ SQLite file /data/chat.db (Docker volume "chat-data")
```

### Life of a message

1. **New Chat** only clears the screen; nothing is stored yet, so there are no empty sessions.
2. On the first send the frontend creates a session (`POST /api/sessions`) and navigates to `/c/<id>`.
3. The frontend posts the text to `POST /api/sessions/:id/messages` and reads the response as a stream (`fetch` + `ReadableStream`, Server-Sent Events).
4. The backend saves the user message and, if the session has no title yet, sets it to the first 20 characters of the prompt.
5. The backend sends the **whole conversation history** to Ollama (`/api/chat`, `stream: true`) and forwards each chunk to the browser as a `delta` event.
6. When Ollama finishes, the backend stores the full reply and sends a `done` event (with the session title). If anything fails, an `error` event is sent instead and the partial reply is **not** stored.
7. Closing the tab or switching session mid-reply cancels the request to Ollama.

SSE events: `delta {text}` · `done {messageId, title}` · `error {message}`.

## Prerequisites

- Docker and Docker Compose
- [Ollama](https://ollama.com) running on the host machine, with at least one model pulled:

```bash
ollama pull gemma3:4b
```

The default model is `gemma3:4b` (runs locally and is free). Models whose names end in `-cloud` (for example `gemma4:31b-cloud`) run on Ollama's servers: they need `ollama signin` and an account plan with usage credits.

## Quick start

```bash
docker compose up --build
```

Open http://localhost:8080.

Chats are stored in the `chat-data` volume, so they survive `docker compose down` and `up`. Only `docker compose down -v` deletes them.

To use another model, change `OLLAMA_MODEL` in `docker-compose.yml` and run `docker compose up -d`.

### Container cannot reach Ollama

If a reply fails with `Cannot reach Ollama at ...`, make Ollama listen on all interfaces and restart it:

```bash
# Linux / macOS
OLLAMA_HOST=0.0.0.0 ollama serve
# Windows: set the user environment variable OLLAMA_HOST=0.0.0.0, then restart Ollama
```

## Development without Docker

```bash
# terminal 1 – backend on :8081
cd backend
go run ./cmd/server

# terminal 2 – frontend on :4200 (proxies /api to localhost:8081)
cd frontend
npm install
npx ng serve
```

Run the tests:

```bash
cd backend  && go test ./...
cd frontend && npx ng test --watch=false
```

## Configuration (backend environment variables)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8081` | HTTP port |
| `DB_PATH` | `./chat.db` (Docker: `/data/chat.db`) | SQLite file |
| `OLLAMA_URL` | `http://localhost:11434` (Docker: `http://host.docker.internal:11434`) | Ollama base URL |
| `OLLAMA_MODEL` | `gemma4:31b-cloud` in code, `gemma3:4b` in `docker-compose.yml` | Model used for chat |

## API

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/sessions` | List sessions, most recently updated first |
| `POST` | `/api/sessions` | Create an empty session |
| `GET` | `/api/sessions/:id/messages` | Message history of a session |
| `PATCH` | `/api/sessions/:id` | Rename: `{"title": "..."}` (1–100 characters) |
| `DELETE` | `/api/sessions/:id` | Delete a session and its messages |
| `POST` | `/api/sessions/:id/messages` | Send `{"content": "..."}`; responds with an SSE stream |

Errors are returned as `{"error": "..."}`.

## Project structure

```
backend/
  cmd/server/        entry point: reads env, wires everything, starts Gin
  internal/store/    SQLite access (sessions, messages), schema creation
  internal/ollama/   streaming client for Ollama /api/chat
  internal/api/      Gin handlers, SSE writer, title helpers
frontend/
  src/app/core/      ApiService, ChatStore (signals), ThemeService, SSE parser
  src/app/chat/      chat view, message, input, Markdown renderer
  src/app/sidebar/   sidebar and session item (rename/delete menu)
  nginx.conf         SPA fallback + unbuffered /api proxy
docker-compose.yml   backend + frontend + chat-data volume
docs/superpowers/    design spec and implementation plan
```

## Notes and limits

- The entire history is sent to the model on every message; very long chats can exceed the model's context window, in which case the reply shows an error.
- There is no stop button: leave the chat (New Chat or another session) to cancel a running reply.
- Intended for local, single-user use. There is no authentication, so do not expose it to the internet as is.
