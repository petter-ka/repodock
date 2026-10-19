package app

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestFolderArgsSkipFlagsAndResolvePaths(t *testing.T) {
	cwd := t.TempDir()
	file := filepath.Join(cwd, "repo", "package.json")
	if err := os.MkdirAll(filepath.Dir(file), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	got := FolderArgs([]string{"-psn_0_123", "repo", "repo/package.json", " ", "/abs/elsewhere"}, cwd)
	want := []string{filepath.Join(cwd, "repo"), filepath.Join(cwd, "repo"), filepath.Clean("/abs/elsewhere")}
	if !slices.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestTakeLaunchFoldersReportsAndForgets(t *testing.T) {
	a := newTestApp(t)
	dir := fixture(t)
	missing := filepath.Join(t.TempDir(), "gone")
	a.queueFolders([]string{dir, dir, missing})

	got := a.TakeLaunchFolders()
	if len(got) != 2 || !got[0].Valid || got[0].Name != "fixture" || got[1].Exists {
		t.Fatalf("folders = %#v", got)
	}
	if len(a.TakeLaunchFolders()) != 0 {
		t.Fatal("folders were not forgotten")
	}
}

func TestSetRepositorySkippedIsStoredOnTheGroup(t *testing.T) {
	a := newTestApp(t)
	group := a.workspace.Snapshot().Groups[0].ID
	first, err := a.AddRepository(fixture(t), group)
	if err != nil {
		t.Fatal(err)
	}
	second, err := a.AddRepository(fixture(t), group)
	if err != nil {
		t.Fatal(err)
	}
	for _, repo := range []string{first.ID, second.ID} {
		if err := a.SaveCommandSequence(repo, nil); err != nil {
			t.Fatal(err)
		}
	}
	if err := a.SetRepositorySkipped(second.ID, true); err != nil {
		t.Fatal(err)
	}
	if g, _ := a.workspace.Group(group); !slices.Equal(g.SkippedRepositoryIDs, []string{second.ID}) {
		t.Fatalf("skipped = %v", g.SkippedRepositoryIDs)
	}
}

func TestRepeatedHandOverIsIgnoredBriefly(t *testing.T) {
	a := newTestApp(t)
	dir := fixture(t)
	a.queueFolders([]string{dir})
	if len(a.TakeLaunchFolders()) != 1 {
		t.Fatal("expected the folder")
	}
	// The same folder again right away (macOS "open file" echo) is dropped.
	a.queueFolders([]string{dir})
	if got := a.TakeLaunchFolders(); len(got) != 0 {
		t.Fatalf("echo was queued: %#v", got)
	}
}
