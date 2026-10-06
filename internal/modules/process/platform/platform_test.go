package platform

import (
	"runtime"
	"testing"
)

func TestJoinArgv(t *testing.T) {
	got, err := JoinArgv([]string{"npm", "run", "build:prod"})
	if err != nil || got != "npm run build:prod" {
		t.Fatalf("got %q, %v", got, err)
	}
	if _, err := JoinArgv(nil); err == nil {
		t.Fatal("empty argv must fail")
	}

	hostile := "dev & calc"
	got, err = JoinArgv([]string{"npm", "run", hostile})
	if runtime.GOOS == "windows" {
		if err == nil {
			t.Fatalf("cmd.exe metacharacters must be rejected, got %q", got)
		}
		return
	}
	if err != nil || got != `npm run 'dev & calc'` {
		t.Fatalf("got %q, %v", got, err)
	}
	got, _ = JoinArgv([]string{"x", "it's"})
	if got != `x 'it'\''s'` {
		t.Fatalf("single quote escaping: %q", got)
	}
}

func TestValidateCommandText(t *testing.T) {
	if err := ValidateCommandText("npm run dev && echo ok"); err != nil {
		t.Fatal(err)
	}
	for _, bad := range []string{"a\nb", "a\rb", "a\x00b"} {
		if err := ValidateCommandText(bad); err == nil {
			t.Fatalf("%q should be rejected", bad)
		}
	}
}
