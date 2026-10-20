package graphqlscan

import (
	"os"
	"path/filepath"
	"testing"
)

func write(t *testing.T, root, rel, content string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestScanFindsSchemaFilesAndSkipsDependencies(t *testing.T) {
	root := t.TempDir()
	write(t, root, "schema.graphql", "type Query { a: Int }")
	write(t, root, "src/users/user.GQL", "type User { id: ID }")
	write(t, root, "src/posts/post.graphqls", "type Post { id: ID }")
	write(t, root, "src/index.ts", "export {}")
	write(t, root, "node_modules/lib/schema.graphql", "type Lib { x: Int }")
	write(t, root, "dist/schema.graphql", "type Copy { x: Int }")
	write(t, root, ".cache/schema.graphql", "type Hidden { x: Int }")

	scan, err := Scan(root)
	if err != nil {
		t.Fatal(err)
	}
	var paths []string
	for _, file := range scan.Files {
		paths = append(paths, file.Path)
	}
	want := []string{"schema.graphql", "src/posts/post.graphqls", "src/users/user.GQL"}
	if len(paths) != len(want) {
		t.Fatalf("paths = %v, want %v", paths, want)
	}
	for i := range want {
		if paths[i] != want[i] {
			t.Fatalf("paths = %v, want %v", paths, want)
		}
	}
	if scan.Files[0].Content != "type Query { a: Int }" || scan.Truncated || scan.Skipped != 0 {
		t.Fatalf("unexpected scan: %+v", scan)
	}
}

func TestScanRejectsRelativeAndMissingFolders(t *testing.T) {
	if _, err := Scan("relative/path"); err == nil {
		t.Fatal("expected an error for a relative path")
	}
	if _, err := Scan(filepath.Join(t.TempDir(), "missing")); err == nil {
		t.Fatal("expected an error for a missing folder")
	}
}

func TestScanSkipsOversizedFiles(t *testing.T) {
	root := t.TempDir()
	write(t, root, "big.graphql", string(make([]byte, MaxFileSize+1)))
	write(t, root, "small.graphql", "scalar Date")
	scan, err := Scan(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(scan.Files) != 1 || scan.Skipped != 1 {
		t.Fatalf("unexpected scan: %+v", scan)
	}
}
