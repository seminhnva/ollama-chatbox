package api

import (
	"context"

	"aichatbot/internal/ollama"
	"aichatbot/internal/store"
	"github.com/gin-gonic/gin"
)

type ChatClient interface {
	Chat(ctx context.Context, msgs []ollama.Message, onDelta func(string) error) (string, error)
}

type handlers struct {
	st   *store.Store
	chat ChatClient
}

func NewRouter(st *store.Store, chat ChatClient) *gin.Engine {
	h := &handlers{st: st, chat: chat}
	r := gin.New()
	r.Use(gin.Recovery(), gin.Logger())
	g := r.Group("/api/sessions")
	g.GET("", h.listSessions)
	g.POST("", h.createSession)
	g.GET("/:id/messages", h.listMessages)
	g.PATCH("/:id", h.renameSession)
	g.DELETE("/:id", h.deleteSession)
	return r
}
