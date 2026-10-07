package workspace

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/example/repodock/internal/domain"
)

func newTemp(t *testing.T) *Service {
	t.Helper()
	return NewAt(filepath.Join(t.TempDir(), "RepoDock", "workspace.json"))
}

func TestLoadMissingFileCreatesDefaultGroup(t *testing.T) {
	s := newTemp(t)
	if _, err := s.Load(); err != nil {
		t.Fatal(err)
	}
	snap := s.Snapshot()
	if len(snap.Groups) != 1 || snap.Version != domain.WorkspaceVersion {
		t.Fatalf("snapshot = %#v", snap)
	}
}

func TestSaveLoadRoundTrip(t *testing.T) {
	s := newTemp(t)
	_, _ = s.Load()
	g, err := s.CreateGroup("  Services ")
	if err != nil {
		t.Fatal(err)
	}
	repo := s.UpsertRepository(domain.Repository{ID: "r1", Name: "api", Path: t.TempDir(), GroupID: g.ID})
	if err := s.UpdateCommandSequence(repo.ID, []domain.CommandStep{{Script: "dev"}, {Command: ""}}); err != nil {
		t.Fatal(err)
	}
	if err := s.Save(); err != nil {
		t.Fatal(err)
	}

	loaded := NewAt(s.Path())
	if _, err := loaded.Load(); err != nil {
		t.Fatal(err)
	}
	snap := loaded.Snapshot()
	if len(snap.Groups) != 2 || snap.Groups[1].Name != "Services" {
		t.Fatalf("groups = %#v", snap.Groups)
	}
	got, ok := loaded.Repository("r1")
	if !ok || got.GroupID != g.ID {
		t.Fatalf("repository = %#v", got)
	}
	if len(got.CommandSequence) != 2 || got.CommandSequence[0].Label != "dev" || got.CommandSequence[0].ID == "" {
		t.Fatalf("sequence = %#v", got.CommandSequence)
	}
	if got.CommandSequence[1].Script != "" || got.CommandSequence[1].Command != "" {
		t.Fatal("empty step must be preserved as a no-op")
	}
}

func TestCorruptWorkspaceIsMovedAside(t *testing.T) {
	s := newTemp(t)
	if err := os.MkdirAll(filepath.Dir(s.Path()), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(s.Path(), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	result, err := s.Load()
	if err != nil {
		t.Fatal(err)
	}
	if result.RecoveredBackup == "" || !strings.Contains(result.RecoveredBackup, ".corrupt-") {
		t.Fatalf("backup = %q", result.RecoveredBackup)
	}
	if data, err := os.ReadFile(result.RecoveredBackup); err != nil || string(data) != "{not json" {
		t.Fatalf("backup content = %q, %v", data, err)
	}
	if len(s.Snapshot().Groups) != 1 {
		t.Fatal("recovered workspace must have a default group")
	}
}

func TestNewerVersionIsTreatedAsUnreadable(t *testing.T) {
	s := newTemp(t)
	_ = os.MkdirAll(filepath.Dir(s.Path()), 0o700)
	_ = os.WriteFile(s.Path(), []byte(`{"version": 99}`), 0o600)
	result, err := s.Load()
	if err != nil || result.RecoveredBackup == "" {
		t.Fatalf("result = %#v, err = %v", result, err)
	}
}

func TestLegacyVersionIsBackedUpAndMigrated(t *testing.T) {
	s := newTemp(t)
	_ = os.MkdirAll(filepath.Dir(s.Path()), 0o700)
	_ = os.WriteFile(s.Path(), []byte(`{"groups": [], "repositories": [{"id": "r", "path": "x"}]}`), 0o600)
	if _, err := s.Load(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(s.Path() + ".v0.bak"); err != nil {
		t.Fatalf("expected migration backup: %v", err)
	}
	snap := s.Snapshot()
	if snap.Version != domain.WorkspaceVersion || len(snap.Groups[0].RepositoryIDs) != 1 {
		t.Fatalf("snapshot = %#v", snap)
	}
}

func TestNormalizeRepairsMembership(t *testing.T) {
	state := domain.Workspace{
		Groups: []domain.Group{{ID: "g1", Name: "A", RepositoryIDs: []string{"ghost", "r2", "r2"}}, {ID: "g2", Name: "B"}},
		Repositories: []domain.Repository{
			{ID: "r1", GroupID: "missing"},
			{ID: "r2", GroupID: "g2"},
		},
	}
	normalize(&state)
	if got := state.Groups[0].RepositoryIDs; len(got) != 1 || got[0] != "r1" {
		t.Fatalf("group A = %v", got)
	}
	if got := state.Groups[1].RepositoryIDs; len(got) != 1 || got[0] != "r2" {
		t.Fatalf("group B = %v", got)
	}
}

func TestGroupLifecycle(t *testing.T) {
	s := newTemp(t)
	_, _ = s.Load()
	first := s.Snapshot().Groups[0]
	second, _ := s.CreateGroup("Second")
	s.UpsertRepository(domain.Repository{ID: "r1", Path: "p1", GroupID: second.ID})

	if _, err := s.CreateGroup("   "); err == nil {
		t.Fatal("blank group name must be rejected")
	}
	if err := s.AssignRepository("r1", "nope"); err == nil {
		t.Fatal("assigning to unknown group must fail")
	}
	if err := s.AssignRepository("r1", first.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.AssignRepository("r1", second.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteGroup(second.ID); err != nil {
		t.Fatal(err)
	}
	repo, _ := s.Repository("r1")
	if repo.GroupID != first.ID {
		t.Fatalf("repository should move to the first group, got %q", repo.GroupID)
	}
	if err := s.DeleteGroup(first.ID); err == nil {
		t.Fatal("the last group must not be deletable")
	}
	if err := s.SetGroupCollapsed(first.ID, true); err != nil || !s.Snapshot().Groups[0].Collapsed {
		t.Fatalf("collapse failed: %v", err)
	}
}

func TestRepositoryByPathDeduplicates(t *testing.T) {
	s := newTemp(t)
	_, _ = s.Load()
	dir := t.TempDir()
	s.UpsertRepository(domain.Repository{ID: "r1", Path: dir})
	if _, ok := s.RepositoryByPath(filepath.Join(dir, ".")); !ok {
		t.Fatal("equivalent path must match")
	}
	if os.PathSeparator == '\\' {
		if _, ok := s.RepositoryByPath(strings.ToUpper(dir)); !ok {
			t.Fatal("paths are case-insensitive on Windows")
		}
	}
}

func TestSnapshotIsIsolated(t *testing.T) {
	s := newTemp(t)
	_, _ = s.Load()
	s.UpsertRepository(domain.Repository{ID: "r1", Path: "p", Scripts: []domain.Script{{Name: "dev"}}})
	snap := s.Snapshot()
	snap.Repositories[0].Scripts[0].Name = "mutated"
	repo, _ := s.Repository("r1")
	if repo.Scripts[0].Name != "dev" {
		t.Fatal("snapshot mutation leaked into state")
	}
}

func TestMoveRepositoryPlacesAtIndex(t *testing.T) {
	s := newTemp(t)
	_, _ = s.Load()
	first := s.Snapshot().Groups[0]
	second, _ := s.CreateGroup("Second")
	for _, id := range []string{"a", "b", "c"} {
		s.UpsertRepository(domain.Repository{ID: id, Path: id, GroupID: first.ID})
	}
	s.UpsertRepository(domain.Repository{ID: "x", Path: "x", GroupID: second.ID})

	members := func(id string) []string { g, _ := s.Group(id); return g.RepositoryIDs }
	steps := []struct {
		id, group string
		index     int
		first     []string
		second    []string
	}{
		{"c", first.ID, 0, []string{"c", "a", "b"}, []string{"x"}},   // reorder up
		{"c", first.ID, 2, []string{"a", "b", "c"}, []string{"x"}},   // reorder down
		{"a", second.ID, 0, []string{"b", "c"}, []string{"a", "x"}},  // cross-group, front
		{"b", second.ID, 99, []string{"c"}, []string{"a", "x", "b"}}, // out of range appends
		{"x", first.ID, -1, []string{"c", "x"}, []string{"a", "b"}},  // negative appends
	}
	for _, step := range steps {
		if err := s.MoveRepository(step.id, step.group, step.index); err != nil {
			t.Fatal(err)
		}
		if got := members(first.ID); !slices.Equal(got, step.first) {
			t.Fatalf("move %s: first = %v, want %v", step.id, got, step.first)
		}
		if got := members(second.ID); !slices.Equal(got, step.second) {
			t.Fatalf("move %s: second = %v, want %v", step.id, got, step.second)
		}
		if repo, _ := s.Repository(step.id); repo.GroupID != step.group {
			t.Fatalf("move %s: group = %q", step.id, repo.GroupID)
		}
	}
	if err := s.MoveRepository("missing", first.ID, 0); err == nil {
		t.Fatal("moving an unknown repository must fail")
	}
	if err := s.MoveRepository("a", "nope", 0); err == nil {
		t.Fatal("moving to an unknown group must fail")
	}
}

func TestMoveGroupReorders(t *testing.T) {
	s := newTemp(t)
	_, _ = s.Load()
	a := s.Snapshot().Groups[0].ID
	b, _ := s.CreateGroup("B")
	c, _ := s.CreateGroup("C")
	order := func() []string {
		ids := []string{}
		for _, g := range s.Snapshot().Groups {
			ids = append(ids, g.ID)
		}
		return ids
	}
	for _, step := range []struct {
		id    string
		index int
		want  []string
	}{
		{c.ID, 0, []string{c.ID, a, b.ID}},
		{c.ID, 2, []string{a, b.ID, c.ID}},
		{a, -1, []string{b.ID, c.ID, a}},
		{a, 1, []string{b.ID, a, c.ID}},
	} {
		if err := s.MoveGroup(step.id, step.index); err != nil {
			t.Fatal(err)
		}
		if got := order(); !slices.Equal(got, step.want) {
			t.Fatalf("move %s to %d: %v, want %v", step.id, step.index, got, step.want)
		}
	}
	if err := s.MoveGroup("nope", 0); err == nil {
		t.Fatal("moving an unknown group must fail")
	}
}

func TestGroupRunMode(t *testing.T) {
	s := newTemp(t)
	_, _ = s.Load()
	g := s.Snapshot().Groups[0]
	if g.RunMode != domain.GroupRunSequential {
		t.Fatalf("default run mode = %q", g.RunMode)
	}
	if err := s.SetGroupRunMode(g.ID, "sideways"); err == nil {
		t.Fatal("unknown mode must be rejected")
	}
	if err := s.SetGroupRunMode(g.ID, domain.GroupRunParallel); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Group(g.ID); got.RunMode != domain.GroupRunParallel {
		t.Fatalf("run mode = %q", got.RunMode)
	}

	// Files written before run modes existed load as sequential.
	_ = os.MkdirAll(filepath.Dir(s.Path()), 0o700)
	_ = os.WriteFile(s.Path(), []byte(`{"version":1,"groups":[{"id":"g","name":"A"}]}`), 0o600)
	if _, err := s.Load(); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.Group("g"); got.RunMode != domain.GroupRunSequential {
		t.Fatalf("legacy run mode = %q", got.RunMode)
	}
}

func TestCleanGlobalCommands(t *testing.T) {
	clean, err := CleanGlobalCommands([]domain.GlobalCommand{{ID: "x", Name: " lint ", Command: " npx eslint . "}, {ID: "x", Name: "b", Command: "c"}})
	if err != nil {
		t.Fatal(err)
	}
	if clean[0].Name != "lint" || clean[0].Command != "npx eslint ." || clean[1].ID == "x" || clean[1].ID == "" {
		t.Fatalf("clean = %+v", clean)
	}
	for name, input := range map[string][]domain.GlobalCommand{
		"empty name":    {{Name: " ", Command: "x"}},
		"empty command": {{Name: "x", Command: " "}},
		"multiline":     {{Name: "x", Command: "a\nb"}},
		"duplicate":     {{Name: "Lint", Command: "a"}, {Name: "lint", Command: "b"}},
	} {
		if _, err := CleanGlobalCommands(input); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
}
