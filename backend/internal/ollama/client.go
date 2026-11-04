package ollama

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type Client struct {
	baseURL string
	model   string
	http    *http.Client // no timeout: replies may stream for minutes
}

func New(baseURL, model string) *Client {
	return &Client{baseURL: strings.TrimRight(baseURL, "/"), model: model, http: &http.Client{}}
}

type chunk struct {
	Message struct {
		Content string `json:"content"`
	} `json:"message"`
	Done  bool   `json:"done"`
	Error string `json:"error"`
}

// Chat streams a reply, calling onDelta for each piece, and returns the full text once Ollama reports done.
func (c *Client) Chat(ctx context.Context, msgs []Message, onDelta func(string) error) (string, error) {
	payload, err := json.Marshal(map[string]any{"model": c.model, "messages": msgs, "stream": true})
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/api/chat", bytes.NewReader(payload))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", fmt.Errorf("Cannot reach Ollama at %s", c.baseURL)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		var e chunk
		if json.Unmarshal(body, &e) == nil && e.Error != "" {
			return "", errors.New(e.Error)
		}
		return "", fmt.Errorf("Ollama returned HTTP %d", resp.StatusCode)
	}

	var full strings.Builder
	r := bufio.NewReader(resp.Body)
	for {
		line, err := r.ReadBytes('\n')
		if len(bytes.TrimSpace(line)) > 0 {
			var ck chunk
			if jerr := json.Unmarshal(line, &ck); jerr != nil {
				return "", fmt.Errorf("invalid response from Ollama: %w", jerr)
			}
			if ck.Error != "" {
				return "", errors.New(ck.Error)
			}
			if t := ck.Message.Content; t != "" {
				full.WriteString(t)
				if derr := onDelta(t); derr != nil {
					return "", derr
				}
			}
			if ck.Done {
				return full.String(), nil
			}
		}
		if err != nil {
			if ctx.Err() != nil {
				return "", ctx.Err()
			}
			return "", errors.New("Ollama stream ended unexpectedly")
		}
	}
}
