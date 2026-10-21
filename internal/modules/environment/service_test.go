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

func write(t *testing.T, root, rel, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestNamesFindsEveryKindInSubfolders(t *testing.T) {
	dir := t.TempDir()
	for _, rel := range []string{
		".env.staging", ".env", ".env.example", "docker.env", ".env.local",
		"apps/web/.env.local", "apps/web/.env", "apps/api/.env.test", "packages/db/prisma/.env",
		".devcontainer/devcontainer.env",
		// Not env files, or in folders that are skipped.
		".envrc", "env", ".env.local.swp", ".env~", "README.env.md",
		"node_modules/pkg/.env", ".git/.env", ".turbo/.env", "dist/.env", "apps/web/.next/.env",
		"a/b/c/d/e/f/.env",
	} {
		write(t, dir, rel, "A=1\n")
	}
	got := New().Names(dir)
	want := []string{
		".env", ".env.local", ".env.example", ".env.staging", "docker.env",
		".devcontainer/devcontainer.env", "apps/api/.env.test", "apps/web/.env", "apps/web/.env.local", "packages/db/prisma/.env",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("names = %v\nwant    %v", got, want)
	}
}

func TestSubfolderFilesRoundTrip(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "apps/web/.env.local", "A=1\n")
	svc := New()
	if err := svc.Save(dir, "apps/web/.env.local", "A=2\n"); err != nil {
		t.Fatal(err)
	}
	file, err := svc.Read(dir, "apps/web/.env.local")
	if err != nil || file.Content != "A=2\n" || file.Name != "apps/web/.env.local" {
		t.Fatalf("file = %+v, %v", file, err)
	}
	if list := svc.List(dir); len(list) != 1 || list[0].Name != "apps/web/.env.local" || list[0].Content != "" {
		t.Fatalf("list = %+v", list)
	}
}

func TestRejectsPathsDiscoveryWouldNotProduce(t *testing.T) {
	dir := t.TempDir()
	write(t, dir, "node_modules/x/.env", "A=1\n")
	write(t, dir, "apps/web/notes.txt", "x")
	svc := New()
	for _, name := range []string{
		"node_modules/x/.env", "/etc/.env", "apps//web/.env", "./.env", "apps/web/", "apps/web/notes.txt",
		`apps\web\.env`, "a/b/c/d/e/f/.env", ".git/.env",
	} {
		if _, err := svc.Read(dir, name); err == nil {
			t.Errorf("read %q should fail", name)
		}
	}
}

func TestSymlinkedFolderCannotLeaveTheRepository(t *testing.T) {
	outside := t.TempDir()
	write(t, outside, ".env", "SECRET=1\n")
	dir := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(dir, "linked")); err != nil {
		t.Skip("symlinks unavailable:", err)
	}
	svc := New()
	// Discovery does not follow the link, and a hand-made name is refused.
	if names := svc.Names(dir); len(names) != 0 {
		t.Fatalf("names = %v", names)
	}
	if _, err := svc.Read(dir, "linked/.env"); err == nil {
		t.Fatal("reading through a symlinked folder outside the repository must fail")
	}
	if err := svc.Save(dir, "linked/.env", "X=1\n"); err == nil {
		t.Fatal("writing through a symlinked folder outside the repository must fail")
	}
}
