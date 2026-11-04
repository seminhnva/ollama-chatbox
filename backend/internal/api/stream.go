package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"aichatbot/internal/ollama"
	"github.com/gin-gonic/gin"
)

func writeEvent(c *gin.Context, name string, payload any) {
	b, _ := json.Marshal(payload)
	fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", name, b)
	c.Writer.Flush()
}

func (h *handlers) sendMessage(c *gin.Context) {
	ctx := c.Request.Context()
	id := c.Param("id")

	var body struct {
		Content string `json:"content"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.Content) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "content must not be empty"})
		return
	}
	if _, err := h.st.GetSession(ctx, id); err != nil {
		fail(c, err)
		return
	}
	if _, err := h.st.AddMessage(ctx, id, "user", body.Content); err != nil {
		fail(c, err)
		return
	}
	sess, err := h.st.SetTitleIfEmpty(ctx, id, AutoTitle(body.Content))
	if err != nil {
		fail(c, err)
		return
	}
	history, err := h.st.ListMessages(ctx, id)
	if err != nil {
		fail(c, err)
		return
	}
	msgs := make([]ollama.Message, len(history))
	for i, m := range history {
		msgs[i] = ollama.Message{Role: m.Role, Content: m.Content}
	}

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	c.Writer.Flush()

	reply, err := h.chat.Chat(ctx, msgs, func(text string) error {
		writeEvent(c, "delta", gin.H{"text": text})
		return nil
	})
	if err != nil {
		if ctx.Err() == nil {
			writeEvent(c, "error", gin.H{"message": err.Error()})
		}
		return
	}
	saved, err := h.st.AddMessage(ctx, id, "assistant", reply)
	if err != nil {
		writeEvent(c, "error", gin.H{"message": "could not save reply"})
		return
	}
	writeEvent(c, "done", gin.H{"messageId": saved.ID, "title": sess.Title})
}
