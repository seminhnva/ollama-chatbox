package api

import (
	"errors"
	"log"
	"net/http"

	"aichatbot/internal/store"
	"github.com/gin-gonic/gin"
)

func fail(c *gin.Context, err error) {
	if errors.Is(err, store.ErrNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
		return
	}
	log.Printf("internal error: %v", err)
	c.JSON(http.StatusInternalServerError, gin.H{"error": "internal error"})
}

func (h *handlers) listSessions(c *gin.Context) {
	list, err := h.st.ListSessions(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, list)
}

func (h *handlers) createSession(c *gin.Context) {
	s, err := h.st.CreateSession(c.Request.Context())
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusCreated, s)
}

func (h *handlers) listMessages(c *gin.Context) {
	msgs, err := h.st.ListMessages(c.Request.Context(), c.Param("id"))
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, msgs)
}

func (h *handlers) renameSession(c *gin.Context) {
	var body struct {
		Title string `json:"title"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON body"})
		return
	}
	title, err := ValidateRename(body.Title)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	s, err := h.st.RenameSession(c.Request.Context(), c.Param("id"), title)
	if err != nil {
		fail(c, err)
		return
	}
	c.JSON(http.StatusOK, s)
}

func (h *handlers) deleteSession(c *gin.Context) {
	if err := h.st.DeleteSession(c.Request.Context(), c.Param("id")); err != nil {
		fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
