package api

import (
	"errors"
	"strings"
	"unicode/utf8"
)

const (
	autoTitleMax = 20
	renameMax    = 100
)

// AutoTitle collapses whitespace and keeps at most 20 runes of the prompt.
func AutoTitle(content string) string {
	s := strings.Join(strings.Fields(content), " ")
	r := []rune(s)
	if len(r) > autoTitleMax {
		r = r[:autoTitleMax]
	}
	return strings.TrimSpace(string(r))
}

// ValidateRename trims the title and enforces the 1..100 rune bounds.
func ValidateRename(title string) (string, error) {
	t := strings.TrimSpace(title)
	if t == "" {
		return "", errors.New("title must not be empty")
	}
	if utf8.RuneCountInString(t) > renameMax {
		return "", errors.New("title must be at most 100 characters")
	}
	return t, nil
}
