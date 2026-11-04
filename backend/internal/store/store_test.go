package store

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func newStore(t *testing.T) (*Store, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "t.db")
	s, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s, path
}

func TestCreateAndList(t *testing.T) {
	ctx := context.Background()
	s, _ := newStore(t)
	empty, err := s.ListSessions(ctx)
	if err != nil || empty == nil || len(empty) != 0 {
		t.Fatalf("empty list should be non-nil empty slice, got %v %v", empty, err)
	}
	a, _ := s.CreateSession(ctx)
	b, _ := s.CreateSession(ctx)
	time.Sleep(5 * time.Millisecond)
	if _, err := s.AddMessage(ctx, a.ID, "user", "hi"); err != nil {
		t.Fatal(err)
	}
	list, _ := s.ListSessions(ctx)
	if len(list) != 2 || list[0].ID != a.ID || list[1].ID != b.ID {
		t.Fatalf("want [A,B] got %+v", list)
	}
}

func TestRename(t *testing.T) {
	ctx := context.Background()
	s, _ := newStore(t)
	a, _ := s.CreateSession(ctx)
	time.Sleep(5 * time.Millisecond)
	got, err := s.RenameSession(ctx, a.ID, "New")
	if err != nil || got.Title != "New" || !got.UpdatedAt.After(a.UpdatedAt) {
		t.Fatalf("rename: %+v %v", got, err)
	}
	if _, err := s.RenameSession(ctx, "nope", "x"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound got %v", err)
	}
}

func TestSetTitleIfEmpty(t *testing.T) {
	ctx := context.Background()
	s, _ := newStore(t)
	a, _ := s.CreateSession(ctx)
	s.SetTitleIfEmpty(ctx, a.ID, "x")
	got, _ := s.SetTitleIfEmpty(ctx, a.ID, "y")
	if got.Title != "x" {
		t.Fatalf("want x got %q", got.Title)
	}
}

func TestDeleteCascades(t *testing.T) {
	ctx := context.Background()
	s, _ := newStore(t)
	a, _ := s.CreateSession(ctx)
	s.AddMessage(ctx, a.ID, "user", "1")
	s.AddMessage(ctx, a.ID, "assistant", "2")
	if err := s.DeleteSession(ctx, a.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ListMessages(ctx, a.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("want ErrNotFound got %v", err)
	}
	var n int
	s.db.QueryRow("SELECT COUNT(*) FROM messages").Scan(&n)
	if n != 0 {
		t.Fatalf("messages not cascaded: %d", n)
	}
	if err := s.DeleteSession(ctx, a.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete want ErrNotFound got %v", err)
	}
}

func TestListMessagesOrder(t *testing.T) {
	ctx := context.Background()
	s, _ := newStore(t)
	a, _ := s.CreateSession(ctx)
	for _, r := range []string{"user", "assistant", "user"} {
		s.AddMessage(ctx, a.ID, r, "c-"+r)
	}
	msgs, _ := s.ListMessages(ctx, a.ID)
	if len(msgs) != 3 || msgs[0].Role != "user" || msgs[1].Role != "assistant" || msgs[2].Role != "user" {
		t.Fatalf("order wrong: %+v", msgs)
	}
}

func TestReopenPersists(t *testing.T) {
	ctx := context.Background()
	s, path := newStore(t)
	a, _ := s.CreateSession(ctx)
	s.AddMessage(ctx, a.ID, "user", "keep me")
	s.Close()
	s2, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s2.Close()
	msgs, err := s2.ListMessages(ctx, a.ID)
	if err != nil || len(msgs) != 1 || msgs[0].Content != "keep me" {
		t.Fatalf("persist: %+v %v", msgs, err)
	}
}
