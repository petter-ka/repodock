package environment

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestNamesUsesCanonicalOrder(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{".env.production", ".env", ".env.local", ".envrc", "env"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("A=1\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(dir, ".env.test"), 0o700); err != nil {
		t.Fatal(err)
	}
	got := New().Names(dir)
	want := []string{".env", ".env.local", ".env.production"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("names = %v, want %v", got, want)
	}
}

func TestSavePreservesTextExactly(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env.local")
	if err := os.WriteFile(path, []byte("OLD=1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	content := "# comment\r\nA=1\n\nB=\"quoted value\" # trailing\nexport C='x'\nNO_NEWLINE=1"
	svc := New()
	if err := svc.Save(dir, ".env.local", content); err != nil {
		t.Fatal(err)
	}
	file, err := svc.Read(dir, ".env.local")
	if err != nil {
		t.Fatal(err)
	}
	if file.Content != content {
		t.Fatalf("content changed:\n%q\n%q", file.Content, content)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatalf("temp files left behind: %v", entries)
	}
}

func TestRejectsUnsupportedNamesAndTraversal(t *testing.T) {
	dir := t.TempDir()
	svc := New()
	for _, name := range []string{"../.env", ".env/../x", "package.json", ".ENV", ""} {
		if _, err := svc.Read(dir, name); err == nil {
			t.Fatalf("read %q should fail", name)
		}
		if err := svc.Save(dir, name, "x"); err == nil {
			t.Fatalf("save %q should fail", name)
		}
	}
}

func TestSaveRequiresExistingFileAndText(t *testing.T) {
	dir := t.TempDir()
	svc := New()
	if err := svc.Save(dir, ".env", "A=1"); err == nil {
		t.Fatal("saving an undiscovered file must fail")
	}
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte("A=1"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := svc.Save(dir, ".env", "A=\x00"); err == nil {
		t.Fatal("NUL bytes must be rejected")
	}
	if data, _ := os.ReadFile(filepath.Join(dir, ".env")); string(data) != "A=1" {
		t.Fatalf("failed save modified the file: %q", data)
	}
}

func TestReadRejectsOversizedFiles(t *testing.T) {
	dir := t.TempDir()
	big := make([]byte, MaxFileSize+1)
	if err := os.WriteFile(filepath.Join(dir, ".env"), big, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := New().Read(dir, ".env"); err == nil {
		t.Fatal("oversized file must be rejected")
	}
}
