package repository

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/example/repodock/internal/domain"
)

func writeFile(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func scriptNames(meta Metadata) []string {
	names := make([]string, 0, len(meta.Scripts))
	for _, s := range meta.Scripts {
		names = append(names, s.Name)
	}
	return names
}

func TestInspectPreservesScriptOrder(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "package.json", `{
		"name": "web",
		"scripts": {"dev": "vite", "build": "tsc && vite build", "a:lint": "eslint .", "Zeta": "x"}
	}`)
	meta, err := New().Inspect(dir)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"dev", "build", "a:lint", "Zeta"}; !reflect.DeepEqual(scriptNames(meta), want) {
		t.Fatalf("order = %v, want %v", scriptNames(meta), want)
	}
	if meta.Scripts[1].Command != "tsc && vite build" {
		t.Fatalf("command not preserved verbatim: %q", meta.Scripts[1].Command)
	}
	if meta.Name != "web" {
		t.Fatalf("name = %q", meta.Name)
	}
}

func TestInspectZeroScriptsAndFallbackName(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "package.json", `{"version": "1.0.0"}`)
	meta, err := New().Inspect(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(meta.Scripts) != 0 || meta.Scripts == nil {
		t.Fatalf("expected empty non-nil scripts, got %#v", meta.Scripts)
	}
	if meta.Name != filepath.Base(dir) {
		t.Fatalf("name = %q, want folder name", meta.Name)
	}
}

func TestInspectSkipsNonStringScriptsAndDuplicateKeys(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "package.json", `{"scripts": {"dev": "a", "weird": {"x": 1}, "num": 3, "dev": "b"}}`)
	meta, err := New().Inspect(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(meta.Scripts) != 1 || meta.Scripts[0].Command != "b" {
		t.Fatalf("scripts = %#v", meta.Scripts)
	}
}

func TestInspectMissingAndInvalidPackageJSON(t *testing.T) {
	dir := t.TempDir()
	if _, err := New().Inspect(dir); !errors.Is(err, ErrNoPackageJSON) {
		t.Fatalf("missing package.json: err = %v", err)
	}
	writeFile(t, dir, "package.json", `{"scripts": `)
	if _, err := New().Inspect(dir); err == nil {
		t.Fatal("expected error for invalid package.json")
	}
	writeFile(t, dir, "package.json", `{"scripts": ["dev"]}`)
	if _, err := New().Inspect(dir); err == nil {
		t.Fatal("expected error for non-object scripts")
	}
}

func TestInspectRejectsFiles(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "file.txt", "x")
	if _, err := New().Inspect(filepath.Join(dir, "file.txt")); err == nil {
		t.Fatal("expected error for non-directory")
	}
	if _, err := New().Inspect(filepath.Join(dir, "missing")); err == nil {
		t.Fatal("expected error for missing directory")
	}
}

func TestDetectPackageManager(t *testing.T) {
	dir := t.TempDir()
	if got := DetectPackageManager(dir, "pnpm@10.0.0"); got != "pnpm" {
		t.Fatalf("packageManager field: got %q", got)
	}
	if got := DetectPackageManager(dir, ""); got != "npm" {
		t.Fatalf("fallback: got %q", got)
	}
	writeFile(t, dir, "yarn.lock", "")
	if got := DetectPackageManager(dir, ""); got != "yarn" {
		t.Fatalf("lockfile: got %q", got)
	}
	if got := DetectPackageManager(dir, "deno@2"); got != "yarn" {
		t.Fatalf("unsupported field should fall back to lockfile: got %q", got)
	}
	if got := DetectPackageManager(dir, "bun@1.1"); got != "bun" {
		t.Fatalf("field wins over lockfile: got %q", got)
	}
}

func TestScriptArgvKeepsNameAsSeparateArgument(t *testing.T) {
	got := ScriptArgv("pnpm", "dev && rm -rf /")
	want := []string{"pnpm", "run", "dev && rm -rf /"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("argv = %#v", got)
	}
	if ScriptArgv("unknown", "x")[0] != "npm" {
		t.Fatal("unknown package manager should fall back to npm")
	}
}

func scriptsOf(names ...string) []domain.Script {
	out := make([]domain.Script, 0, len(names))
	for _, n := range names {
		out = append(out, domain.Script{Name: n, Command: n})
	}
	return out
}
