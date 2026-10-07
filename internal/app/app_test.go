package app

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/example/repodock/internal/domain"
	processmod "github.com/example/repodock/internal/modules/process"
	workspacemod "github.com/example/repodock/internal/modules/workspace"
)

func fixture(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	files := map[string]string{
		"package.json": `{"name": "fixture", "scripts": {"hello": "node -e \"console.log('hi from script')\"", "build": "node -e \"process.exit(0)\""}}`,
		".env":         "PORT=3000\n",
		".env.local":   "SECRET=1\n",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func newTestApp(t *testing.T) *App {
	t.Helper()
	ws := workspacemod.NewAt(filepath.Join(t.TempDir(), "workspace.json"))
	opts := processmod.DefaultOptions()
	opts.StopGrace = 500 * time.Millisecond
	a := NewWith(ws, opts)
	if _, err := ws.Load(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { a.shutdown(context.Background()) })
	return a
}

func TestAddRepositoryDiscoversAndDeduplicates(t *testing.T) {
	a := newTestApp(t)
	dir := fixture(t)

	repo, err := a.AddRepository(dir, "")
	if err != nil {
		t.Fatal(err)
	}
	if repo.Name != "fixture" || repo.PackageManager != "npm" || len(repo.Scripts) != 2 || repo.Scripts[0].Name != "hello" {
		t.Fatalf("repo = %#v", repo)
	}
	if len(repo.EnvFiles) != 2 || len(repo.CommandSequence) != 2 || repo.GroupID == "" {
		t.Fatalf("repo = %#v", repo)
	}

	again, err := a.AddRepository(filepath.Join(dir, "."), "")
	if err != nil {
		t.Fatal(err)
	}
	if again.ID != repo.ID || len(a.Workspace().Repositories) != 1 {
		t.Fatal("duplicate path must resolve to the existing record")
	}

	if _, err := a.AddRepository(t.TempDir(), ""); err == nil {
		t.Fatal("folders without package.json must be rejected")
	}

	// A broken package.json keeps the record and reports the problem.
	if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte("{"), 0o600); err != nil {
		t.Fatal(err)
	}
	refreshed, err := a.RefreshRepository(repo.ID)
	if err != nil {
		t.Fatal(err)
	}
	if refreshed.Problem == "" || len(refreshed.Scripts) != 2 {
		t.Fatalf("refreshed = %#v", refreshed)
	}

	// Persisted to disk.
	reloaded := workspacemod.NewAt(a.workspace.Path())
	if _, err := reloaded.Load(); err != nil {
		t.Fatal(err)
	}
	if _, ok := reloaded.Repository(repo.ID); !ok {
		t.Fatal("repository was not persisted")
	}

	if err := a.RemoveRepository(repo.ID); err != nil {
		t.Fatal(err)
	}
	if len(a.Workspace().Repositories) != 0 {
		t.Fatal("repository not removed")
	}
	if _, err := os.Stat(filepath.Join(dir, ".env")); err != nil {
		t.Fatal("removing a repository must not touch its files")
	}
}

func TestEnvironmentRoundTrip(t *testing.T) {
	a := newTestApp(t)
	repo, err := a.AddRepository(fixture(t), "")
	if err != nil {
		t.Fatal(err)
	}
	files, err := a.EnvironmentFiles(repo.ID)
	if err != nil || len(files) != 2 || files[0].Content != "" {
		t.Fatalf("files = %#v, %v (listing must not include content)", files, err)
	}
	if err := a.SaveEnvironmentFile(repo.ID, ".env", "PORT=4000\n# keep\n"); err != nil {
		t.Fatal(err)
	}
	file, err := a.ReadEnvironmentFile(repo.ID, ".env")
	if err != nil || file.Content != "PORT=4000\n# keep\n" {
		t.Fatalf("file = %#v, %v", file, err)
	}
}

func TestRunScriptAndSequence(t *testing.T) {
	if _, err := exec.LookPath("npm"); err != nil {
		t.Skip("npm is not available")
	}
	a := newTestApp(t)
	repo, err := a.AddRepository(fixture(t), "")
	if err != nil {
		t.Fatal(err)
	}

	if _, err := a.RunScript(repo.ID, "missing", ""); err == nil {
		t.Fatal("unknown script must be rejected")
	}
	run, err := a.RunScript(repo.ID, "hello", "hello")
	if err != nil {
		t.Fatal(err)
	}
	if run.Command != "npm run hello" {
		t.Fatalf("command = %q", run.Command)
	}
	final, _ := a.WaitForRun(run.ID)
	if final.Status != domain.RunExited {
		t.Fatalf("final = %#v", final)
	}

	steps := []domain.CommandStep{
		{ID: "a", Script: "build", Enabled: true},
		{ID: "b", Enabled: true}, // no-op placeholder
		{ID: "c", Command: "exit 2", Enabled: true},
		{ID: "d", Script: "hello", Enabled: true},
	}
	if err := a.SaveCommandSequence(repo.ID, steps); err != nil {
		t.Fatal(err)
	}
	seq, err := a.RunSequence(repo.ID)
	if err != nil {
		t.Fatal(err)
	}
	done, err := a.sequence.Wait(seq.ID)
	if err != nil {
		t.Fatal(err)
	}
	got := []domain.StepStatus{}
	for _, s := range done.Steps {
		got = append(got, s.Status)
	}
	want := []domain.StepStatus{domain.StepCompleted, domain.StepSkipped, domain.StepFailed, domain.StepCancelled}
	if done.Status != domain.SequenceFailed || len(got) != 4 || got[0] != want[0] || got[1] != want[1] || got[2] != want[2] || got[3] != want[3] {
		t.Fatalf("sequence = %s %v", done.Status, got)
	}
	for _, r := range a.Runs() {
		if r.SequenceID == seq.ID && r.StepID == "" {
			t.Fatal("sequence runs must carry their step ID")
		}
	}
}

func TestRunGroupModes(t *testing.T) {
	a := newTestApp(t)
	first, err := a.AddRepository(fixture(t), "")
	if err != nil {
		t.Fatal(err)
	}
	second, err := a.AddRepository(fixture(t), "")
	if err != nil {
		t.Fatal(err)
	}
	groupID := first.GroupID
	_ = a.SaveCommandSequence(first.ID, []domain.CommandStep{{ID: "a", Command: "echo first", Enabled: true}})
	_ = a.SaveCommandSequence(second.ID, []domain.CommandStep{{ID: "b", Command: "exit 4", Enabled: true}})

	if err := a.SetGroupRunMode(groupID, "bogus"); err == nil {
		t.Fatal("unknown mode must be rejected")
	}
	for _, mode := range []string{"sequential", "parallel"} {
		if err := a.SetGroupRunMode(groupID, mode); err != nil {
			t.Fatal(err)
		}
		run, err := a.RunGroup(groupID)
		if err != nil {
			t.Fatal(err)
		}
		if string(run.Mode) != mode {
			t.Fatalf("mode = %s, want %s", run.Mode, mode)
		}
		final, _ := a.sequence.WaitGroup(groupID)
		if final.Status != domain.SequenceFailed || final.Repos[0].Status != domain.StepCompleted || final.Repos[1].Status != domain.StepFailed {
			t.Fatalf("%s: %#v", mode, final)
		}
	}
	if err := a.StopGroup(groupID); err != nil {
		t.Fatal(err)
	}
	if len(a.GroupRuns()) != 1 {
		t.Fatal("expected the latest group run to be retained")
	}
}

func TestExportImportRoundTrip(t *testing.T) {
	source := newTestApp(t)
	repo, err := source.AddRepository(fixture(t), "")
	if err != nil {
		t.Fatal(err)
	}
	group, err := source.CreateGroup("Shared")
	if err != nil {
		t.Fatal(err)
	}
	_ = source.AssignRepository(repo.ID, group.ID)
	_ = source.SetGroupRunMode(group.ID, "parallel")
	_ = source.SaveCommandSequence(repo.ID, []domain.CommandStep{{ID: "x", Script: "hello", Enabled: true, Background: true}})

	file := filepath.Join(t.TempDir(), "export.json")
	if err := source.exportTo(file, []string{group.ID}); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(file)
	if strings.Contains(string(data), "PORT=3000") || strings.Contains(string(data), "SECRET") {
		t.Fatal("env contents must never be exported")
	}

	// Add a repository whose folder does not exist on the importing machine.
	doc := strings.Replace(string(data), `"repositories": [`, `"repositories": [{"name": "gone", "path": "/definitely/missing/repo", "commandSequence": null},`, 1)
	_ = os.WriteFile(file, []byte(doc), 0o600)

	target := newTestApp(t)
	preview, err := target.PreviewImport(file)
	if err != nil {
		t.Fatal(err)
	}
	if preview.GroupsToCreate != 1 || preview.New != 2 || preview.Missing != 1 {
		t.Fatalf("preview = %+v", preview)
	}
	result, err := target.ApplyImport(file, domain.ImportOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if result.GroupsCreated != 1 || result.RepositoriesAdded != 2 {
		t.Fatalf("result = %+v", result)
	}
	ws := target.Workspace()
	var shared domain.Group
	for _, g := range ws.Groups {
		if g.Name == "Shared" {
			shared = g
		}
	}
	if shared.RunMode != domain.GroupRunParallel || len(shared.RepositoryIDs) != 2 {
		t.Fatalf("shared = %+v", shared)
	}
	for _, r := range ws.Repositories {
		switch r.Name {
		case "fixture":
			if len(r.Scripts) != 2 || len(r.EnvFiles) != 2 || r.Problem != "" {
				t.Fatalf("imported repository was not refreshed: %+v", r)
			}
			if len(r.CommandSequence) != 1 || r.CommandSequence[0].Enabled || !r.CommandSequence[0].Background {
				t.Fatalf("steps = %+v", r.CommandSequence)
			}
		case "gone":
			if r.Problem == "" {
				t.Fatal("a missing folder must be reported")
			}
		default:
			t.Fatalf("unexpected repository %q", r.Name)
		}
	}

	again, err := target.ApplyImport(file, domain.ImportOptions{})
	if err != nil || again.RepositoriesAdded != 0 || again.RepositoriesSkipped != 2 || again.GroupsCreated != 0 {
		t.Fatalf("re-import = %+v, %v", again, err)
	}

	if _, err := target.PreviewImport(filepath.Join(t.TempDir(), "notes.txt")); err == nil {
		t.Fatal("non-JSON files must be rejected")
	}
}

func TestRelocateRepository(t *testing.T) {
	a := newTestApp(t)
	original := fixture(t)
	repo, err := a.AddRepository(original, "")
	if err != nil {
		t.Fatal(err)
	}
	_ = a.SaveCommandSequence(repo.ID, []domain.CommandStep{{ID: "keep", Script: "build", Enabled: true}})
	other, err := a.AddRepository(fixture(t), "")
	if err != nil {
		t.Fatal(err)
	}

	// Simulate the checkout moving: the old folder disappears.
	moved := filepath.Join(t.TempDir(), "moved")
	if err := os.Rename(original, moved); err != nil {
		t.Fatal(err)
	}
	if refreshed, _ := a.RefreshRepository(repo.ID); !strings.Contains(refreshed.Problem, "folder not found") {
		t.Fatalf("problem = %q", refreshed.Problem)
	}

	if check := a.CheckRepositoryFolder(moved); !check.Valid || !check.Exists || check.Name != "fixture" || check.RegisteredID != "" {
		t.Fatalf("check = %+v", check)
	}
	if check := a.CheckRepositoryFolder(t.TempDir()); check.Valid || !check.Exists || !strings.Contains(check.Problem, "package.json") {
		t.Fatalf("empty folder check = %+v", check)
	}
	if check := a.CheckRepositoryFolder(filepath.Join(moved, "nope")); check.Exists || check.Valid {
		t.Fatalf("missing folder check = %+v", check)
	}

	if _, err := a.RelocateRepository(repo.ID, other.Path); err == nil || !strings.Contains(err.Error(), "already registered") {
		t.Fatalf("relocating onto another repository must fail, got %v", err)
	}
	if _, err := a.RelocateRepository(repo.ID, t.TempDir()); err == nil {
		t.Fatal("a folder without package.json must be rejected")
	}

	relocated, err := a.RelocateRepository(repo.ID, moved)
	if err != nil {
		t.Fatal(err)
	}
	if relocated.ID != repo.ID || relocated.Problem != "" || relocated.GroupID != repo.GroupID || len(relocated.Scripts) != 2 {
		t.Fatalf("relocated = %+v", relocated)
	}
	if len(relocated.CommandSequence) != 1 || relocated.CommandSequence[0].ID != "keep" {
		t.Fatalf("sequence must be preserved: %+v", relocated.CommandSequence)
	}
}

func TestImportWithPathOverride(t *testing.T) {
	a := newTestApp(t)
	actual := fixture(t)
	file := filepath.Join(t.TempDir(), "import.json")
	doc := `{"format":"repodock.workspace-export","version":1,"exportedAt":"2026-10-06T00:00:00Z","groups":[{"name":"Team","runMode":"sequential","collapsed":false,"repositories":[{"name":"api","path":"/not/on/this/machine/api","commandSequence":null}]}]}`
	if err := os.WriteFile(file, []byte(doc), 0o600); err != nil {
		t.Fatal(err)
	}
	preview, err := a.PreviewImport(file)
	if err != nil || preview.Missing != 1 {
		t.Fatalf("preview = %+v, %v", preview, err)
	}
	missingPath := preview.Groups[0].Repositories[0].Path

	if _, err := a.ApplyImport(file, domain.ImportOptions{PathOverrides: map[string]string{missingPath: t.TempDir()}}); err == nil {
		t.Fatal("an override without package.json must be rejected")
	}
	if len(a.Workspace().Repositories) != 0 {
		t.Fatal("a rejected import must not change the workspace")
	}

	if _, err := a.ApplyImport(file, domain.ImportOptions{PathOverrides: map[string]string{missingPath: actual}}); err != nil {
		t.Fatal(err)
	}
	repos := a.Workspace().Repositories
	if len(repos) != 1 || repos[0].Problem != "" || !workspacemod.SamePath(repos[0].Path, actual) || len(repos[0].Scripts) != 2 {
		t.Fatalf("repos = %+v", repos)
	}
}

func TestGlobalCommandSteps(t *testing.T) {
	a := newTestApp(t)
	repo, err := a.AddRepository(fixture(t), "")
	if err != nil {
		t.Fatal(err)
	}
	saved, err := a.SaveGlobalCommands([]domain.GlobalCommand{{Name: " ok ", Command: " exit 0 "}, {Name: "fail", Command: "exit 3"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(saved) != 2 || saved[0].ID == "" || saved[0].Name != "ok" || saved[0].Command != "exit 0" {
		t.Fatalf("saved = %+v", saved)
	}
	if _, err := a.SaveGlobalCommands([]domain.GlobalCommand{{Name: "a", Command: "x"}, {Name: "A", Command: "y"}}); err == nil {
		t.Fatal("duplicate names must be rejected")
	}

	steps := []domain.CommandStep{
		{ID: "a", GlobalCommand: saved[0].ID, Command: "ignored", Enabled: true},
		{ID: "b", GlobalCommand: saved[1].ID, Enabled: true},
	}
	if err := a.SaveCommandSequence(repo.ID, steps); err != nil {
		t.Fatal(err)
	}
	stored, _ := a.workspace.Repository(repo.ID)
	if stored.CommandSequence[0].Label != "ok" || stored.CommandSequence[0].Command != "" {
		t.Fatalf("global steps get the command name as label and no inline text: %+v", stored.CommandSequence[0])
	}
	seq, err := a.RunSequence(repo.ID)
	if err != nil {
		t.Fatal(err)
	}
	done, _ := a.sequence.Wait(seq.ID)
	if done.Steps[0].Status != domain.StepCompleted || done.Steps[1].Status != domain.StepFailed {
		t.Fatalf("steps = %+v", done.Steps)
	}

	// Removing a global command makes referencing steps fail with a clear error.
	if _, err := a.SaveGlobalCommands(saved[1:]); err != nil {
		t.Fatal(err)
	}
	seq, _ = a.RunSequence(repo.ID)
	done, _ = a.sequence.Wait(seq.ID)
	if done.Steps[0].Status != domain.StepFailed || !strings.Contains(done.Steps[0].Error, "no longer exists") {
		t.Fatalf("steps = %+v", done.Steps)
	}
}
