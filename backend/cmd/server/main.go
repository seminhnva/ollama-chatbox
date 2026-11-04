package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"aichatbot/internal/api"
	"aichatbot/internal/ollama"
	"aichatbot/internal/store"
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	port := env("PORT", "8081")
	dbPath := env("DB_PATH", "./chat.db")
	ollamaURL := env("OLLAMA_URL", "http://localhost:11434")
	model := env("OLLAMA_MODEL", "gemma4:31b-cloud")

	st, err := store.Open(dbPath)
	if err != nil {
		log.Fatalf("open database %s: %v", dbPath, err)
	}
	defer st.Close()

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           api.NewRouter(st, ollama.New(ollamaURL, model)),
		ReadHeaderTimeout: 10 * time.Second, // no WriteTimeout: replies stream for a long time
	}
	log.Printf("listening on :%s, ollama=%s model=%s db=%s", port, ollamaURL, model, dbPath)
	log.Fatal(srv.ListenAndServe())
}
