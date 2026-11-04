package api

import (
	"strings"
	"testing"
)

func TestAutoTitle(t *testing.T) {
	cases := map[string]string{
		"Viết hàm debounce bằng TypeScript cho tôi": "Viết hàm debounce bằ",
		"  fix\n\nlỗi   CORS  ":                     "fix lỗi CORS",
		"ngắn":                                      "ngắn",
		strings.Repeat("😀", 22):                     strings.Repeat("😀", 20),
		"aaaaaaaaaaaaaaaaaaa bbbb":                  "aaaaaaaaaaaaaaaaaaa",
	}
	for in, want := range cases {
		if got := AutoTitle(in); got != want {
			t.Errorf("AutoTitle(%q)=%q want %q", in, got, want)
		}
	}
}

func TestValidateRename(t *testing.T) {
	if got, err := ValidateRename("  hello  "); err != nil || got != "hello" {
		t.Errorf("trim: got %q, %v", got, err)
	}
	if _, err := ValidateRename("   "); err == nil || err.Error() != "title must not be empty" {
		t.Errorf("empty: got %v", err)
	}
	if _, err := ValidateRename(strings.Repeat("ệ", 100)); err != nil {
		t.Errorf("100 runes should pass: %v", err)
	}
	if _, err := ValidateRename(strings.Repeat("ệ", 101)); err == nil || err.Error() != "title must be at most 100 characters" {
		t.Errorf("101 runes: got %v", err)
	}
}
