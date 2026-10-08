package transfer

import (
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/example/repodock/internal/domain"
)

var home = filepath.Join(string(filepath.Separator)+"home", "dev")

func env(existing ...string) Environment {
	dirs := map[string]bool{}
	for _, d := range existing {
		dirs[d] = true
	}
	return Environment{
		Home:      home,
		DirExists: func(p string) bool { return dirs[p] },
		SamePath:  func(a, b string) bool { return filepath.Clean(a) == filepath.Clean(b) },
	}
}

func sample() domain.Workspace {
	web := filepath.Join(home, "work", "web")
	other := filepath.Join(string(filepath.Separator)+"srv", "api")
	return domain.Workspace{
		Version: 1,
		Groups: []domain.Group{
			{ID: "g1", Name: "Frontend", RunMode: domain.GroupRunParallel, RepositoryIDs: []string{"r1"}},
			{ID: "g2", Name: "Services", RunMode: domain.GroupRunSequential, RepositoryIDs: []string{"r2"}},
		},
		Repositories: []domain.Repository{
			{ID: "r1", Name: "web", Path: web, GroupID: "g1", Scripts: []domain.Script{{Name: "dev", Command: "vite"}},
				CommandSequence: []domain.CommandStep{{ID: "s1", Label: "dev", Script: "dev", Enabled: true, Background: true}}},
			{ID: "r2", Name: "api", Path: other, GroupID: "g2",
				CommandSequence: []domain.CommandStep{{ID: "s2", Label: "migrate", Command: "npx prisma migrate deploy", Enabled: true}}},
		},
	}
}

func TestBuildEncodeParseRoundTrip(t *testing.T) {
	doc, err := Build(sample(), nil, home, time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	data, err := Encode(doc)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	if !strings.Contains(text, `"path": "~/work/web"`) {
		t.Fatalf("home paths must be portable:\n%s", text)
	}
	for _, leaked := range []string{"scripts", "envFiles", `"id": "r1"`, "lastRefreshedAt"} {
		if strings.Contains(text, leaked) {
			t.Fatalf("export must not contain %q", leaked)
		}
	}
	parsed, err := Parse(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(parsed.Groups) != 2 || parsed.Groups[0].RunMode != domain.GroupRunParallel || parsed.Groups[1].Repositories[0].CommandSequence[0].Command != "npx prisma migrate deploy" {
		t.Fatalf("parsed = %#v", parsed)
	}
	if got := LocalPath(parsed.Groups[0].Repositories[0].Path, home); got != filepath.Join(home, "work", "web") {
		t.Fatalf("local path = %q", got)
	}
}

func TestBuildSelectedGroups(t *testing.T) {
	doc, err := Build(sample(), []string{"g2"}, home, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Groups) != 1 || doc.Groups[0].Name != "Services" {
		t.Fatalf("groups = %#v", doc.Groups)
	}
	if _, err := Build(sample(), []string{"missing"}, home, time.Now()); err == nil {
		t.Fatal("unknown group must fail")
	}
}

func TestParseRejectsInvalidDocuments(t *testing.T) {
	cases := map[string]string{
		"not json":       `{`,
		"foreign format": `{"format":"other","version":1,"groups":[]}`,
		"newer version":  `{"format":"repodock.workspace-export","version":99,"groups":[]}`,
		"unknown field":  `{"format":"repodock.workspace-export","version":1,"groups":[],"extra":true}`,
		"empty group":    `{"format":"repodock.workspace-export","version":1,"groups":[{"name":" ","repositories":[]}]}`,
		"bad mode":       `{"format":"repodock.workspace-export","version":1,"groups":[{"name":"A","runMode":"chaos","repositories":[]}]}`,
		"empty path":     `{"format":"repodock.workspace-export","version":1,"groups":[{"name":"A","repositories":[{"name":"x","path":""}]}]}`,
		"multiline step": `{"format":"repodock.workspace-export","version":1,"groups":[{"name":"A","repositories":[{"name":"x","path":"/x","commandSequence":[{"id":"1","label":"x","script":"","command":"echo a\nrm -rf /","enabled":true,"background":false}]}]}]}`,
	}
	for name, input := range cases {
		if _, err := Parse([]byte(input)); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
}

func TestPlanAndMerge(t *testing.T) {
	doc, _ := Build(sample(), nil, home, time.Now())
	web := filepath.Join(home, "work", "web")

	// Current workspace: "frontend" exists (different case) and already has web.
	current := domain.Workspace{
		Groups:       []domain.Group{{ID: "local", Name: "frontend", RunMode: domain.GroupRunSequential, RepositoryIDs: []string{"mine"}}},
		Repositories: []domain.Repository{{ID: "mine", Name: "web", Path: web, GroupID: "local"}},
	}
	e := env() // no folders exist on "this machine"

	preview := Plan(doc, current, e)
	if preview.GroupsToCreate != 1 || preview.Existing != 1 || preview.New != 1 || preview.Missing != 1 || preview.ShellCommands != 1 {
		t.Fatalf("preview = %+v", preview)
	}
	if preview.Groups[0].Repositories[0].Status != domain.ImportExisting || preview.Groups[1].Repositories[0].Status != domain.ImportMissing {
		t.Fatalf("statuses = %+v", preview.Groups)
	}

	merged, added, result := Merge(doc, current, e, domain.ImportOptions{})
	if result.GroupsCreated != 1 || result.RepositoriesAdded != 1 || result.RepositoriesSkipped != 1 || len(added) != 1 {
		t.Fatalf("result = %+v added=%v", result, added)
	}
	if merged.Groups[0].RunMode != domain.GroupRunSequential {
		t.Fatal("existing groups must keep their local settings")
	}
	api := merged.Repositories[len(merged.Repositories)-1]
	if api.ID == "r2" || api.GroupID != merged.Groups[1].ID || merged.Groups[1].Name != "Services" || merged.Groups[1].RunMode != domain.GroupRunSequential {
		t.Fatalf("api = %+v groups = %+v", api, merged.Groups)
	}
	if len(api.CommandSequence) != 0 {
		t.Fatalf("sequences must not be imported when opted out: %+v", api.CommandSequence)
	}
	if len(current.Repositories) != 1 || len(current.Groups) != 1 {
		t.Fatal("Merge must not mutate the current workspace")
	}

	_, _, kept := Merge(doc, domain.Workspace{}, e, domain.ImportOptions{ImportSequences: true})
	if kept.RepositoriesAdded != 2 {
		t.Fatalf("kept = %+v", kept)
	}
	merged2, _, _ := Merge(doc, domain.Workspace{}, e, domain.ImportOptions{ImportSequences: true})
	step := merged2.Repositories[0].CommandSequence[0]
	if !step.Enabled || !step.Background || step.ID == "s1" {
		t.Fatalf("imported steps keep their flags and get fresh IDs: %+v", step)
	}
}

func TestDuplicatePathsInsideFileImportOncePerEntry(t *testing.T) {
	doc := Document{Format: Format, Version: 3, Groups: []DocumentGroup{
		{Name: "A", Repositories: []DocumentRepository{{Name: "x", Path: "~/x"}, {Name: "x", Alias: "x staging", Path: "~/x"}}},
	}}
	preview := Plan(doc, domain.Workspace{}, env(filepath.Join(home, "x")))
	if preview.New != 2 || preview.Groups[0].Repositories[1].Status != domain.ImportNew || preview.Groups[0].Repositories[1].Name != "x staging" {
		t.Fatalf("preview = %+v", preview)
	}
	merged, added, _ := Merge(doc, domain.Workspace{}, env(), domain.ImportOptions{})
	if len(added) != 2 || merged.Repositories[1].Alias != "x staging" || merged.Repositories[0].Alias != "" {
		t.Fatalf("merged = %+v", merged.Repositories)
	}
	// Re-importing skips every entry whose folder is already registered.
	_, again, result := Merge(doc, merged, env(), domain.ImportOptions{})
	if len(again) != 0 || result.RepositoriesSkipped != 2 {
		t.Fatalf("re-import added %v, result %+v", again, result)
	}
}

func TestAliasRoundTripAndVersionGate(t *testing.T) {
	ws := domain.Workspace{
		Groups:       []domain.Group{{ID: "g", Name: "G", RepositoryIDs: []string{"r"}}},
		Repositories: []domain.Repository{{ID: "r", Name: "api", Alias: "api (prod)", Path: filepath.Join(home, "api"), GroupID: "g"}},
	}
	doc, err := Build(ws, nil, home, time.Now())
	if err != nil || doc.Version != 3 || doc.Groups[0].Repositories[0].Alias != "api (prod)" {
		t.Fatalf("doc = %+v, %v", doc, err)
	}
	old := `{"format":"repodock.workspace-export","version":2,"groups":[{"name":"G","runMode":"sequential","collapsed":false,"repositories":[{"name":"a","alias":"b","path":"/x","commandSequence":null}]}]}`
	if _, err := Parse([]byte(old)); err == nil {
		t.Fatal("an alias in a version 2 document must be rejected")
	}
}

func TestMergeAppliesPathOverrides(t *testing.T) {
	doc := Document{Format: Format, Version: 1, Groups: []DocumentGroup{
		{Name: "A", Repositories: []DocumentRepository{{Name: "api", Path: "/elsewhere/api"}, {Name: "web", Path: "~/web"}}},
	}}
	moved := filepath.Join(home, "src", "api")
	opts := domain.ImportOptions{PathOverrides: map[string]string{
		filepath.FromSlash("/elsewhere/api"): moved,
		filepath.Join(home, "web"):           "  ", // blank override = keep original
	}}
	merged, _, _ := Merge(doc, domain.Workspace{}, env(), opts)
	if merged.Repositories[0].Path != moved {
		t.Fatalf("override not applied: %q", merged.Repositories[0].Path)
	}
	if merged.Repositories[1].Path != filepath.Join(home, "web") {
		t.Fatalf("blank override must keep the original: %q", merged.Repositories[1].Path)
	}

	// An override onto an already registered folder is skipped like any duplicate.
	current := domain.Workspace{Repositories: []domain.Repository{{ID: "x", Path: moved}}}
	_, _, result := Merge(doc, current, env(), opts)
	if result.RepositoriesSkipped != 1 || result.RepositoriesAdded != 1 {
		t.Fatalf("result = %+v", result)
	}
}

func withGlobals() domain.Workspace {
	ws := sample()
	ws.GlobalCommands = []domain.GlobalCommand{{ID: "gc1", Name: "Install", Command: "npm ci"}, {ID: "gc2", Name: "Unused", Command: "echo"}}
	ws.Repositories[1].CommandSequence = append(ws.Repositories[1].CommandSequence, domain.CommandStep{ID: "s3", Label: "Install", GlobalCommand: "gc1", Enabled: true})
	return ws
}

func TestBuildIncludesGlobalCommands(t *testing.T) {
	full, _ := Build(withGlobals(), nil, home, time.Now())
	if full.Version != Version || len(full.GlobalCommands) != 2 {
		t.Fatalf("a full export carries every global command: %+v", full.GlobalCommands)
	}
	partial, _ := Build(withGlobals(), []string{"g2"}, home, time.Now())
	if len(partial.GlobalCommands) != 1 || partial.GlobalCommands[0].ID != "gc1" {
		t.Fatalf("a partial export carries only used global commands: %+v", partial.GlobalCommands)
	}
	none, _ := Build(withGlobals(), []string{"g1"}, home, time.Now())
	data, _ := Encode(none)
	if strings.Contains(string(data), "globalCommands") {
		t.Fatal("unused global commands must be omitted")
	}
	parsed, err := Parse(mustEncode(t, full))
	if err != nil || len(parsed.GlobalCommands) != 2 {
		t.Fatalf("parsed = %+v, %v", parsed.GlobalCommands, err)
	}
}

func mustEncode(t *testing.T, doc Document) []byte {
	t.Helper()
	data, err := Encode(doc)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestParseRejectsInvalidGlobalCommands(t *testing.T) {
	step := func(ref string) string {
		return `{"name":"A","repositories":[{"name":"x","path":"/x","commandSequence":[{"id":"1","label":"x","script":"","globalCommand":"` + ref + `","command":"","enabled":true,"background":false}]}]}`
	}
	cases := map[string]string{
		"v1 with globals":  `{"format":"repodock.workspace-export","version":1,"globalCommands":[{"id":"a","name":"n","command":"c"}],"groups":[]}`,
		"unknown ref":      `{"format":"repodock.workspace-export","version":2,"globalCommands":[{"id":"a","name":"n","command":"c"}],"groups":[` + step("b") + `]}`,
		"empty command":    `{"format":"repodock.workspace-export","version":2,"globalCommands":[{"id":"a","name":"n","command":" "}],"groups":[]}`,
		"duplicate name":   `{"format":"repodock.workspace-export","version":2,"globalCommands":[{"id":"a","name":"n","command":"c"},{"id":"b","name":"N","command":"c"}],"groups":[]}`,
		"duplicate id":     `{"format":"repodock.workspace-export","version":2,"globalCommands":[{"id":"a","name":"n","command":"c"},{"id":"a","name":"m","command":"c"}],"groups":[]}`,
		"multiline global": `{"format":"repodock.workspace-export","version":2,"globalCommands":[{"id":"a","name":"n","command":"c\nrm -rf /"}],"groups":[]}`,
	}
	for name, input := range cases {
		if _, err := Parse([]byte(input)); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
	ok := `{"format":"repodock.workspace-export","version":2,"globalCommands":[{"id":"a","name":"n","command":"c"}],"groups":[` + step("a") + `]}`
	if _, err := Parse([]byte(ok)); err != nil {
		t.Fatal(err)
	}
}

func TestMergeGlobalCommands(t *testing.T) {
	doc, _ := Build(withGlobals(), nil, home, time.Now())
	doc.GlobalCommands = append(doc.GlobalCommands, domain.GlobalCommand{ID: "gc3", Name: "Build", Command: "npm run build"})
	current := domain.Workspace{GlobalCommands: []domain.GlobalCommand{
		{ID: "mine-install", Name: "install", Command: "npm ci"},            // identical (name case differs) → reused
		{ID: "mine-unused", Name: "Unused", Command: "echo something else"}, // name clash → renamed copy
		{ID: "mine-taken", Name: "Unused (imported)", Command: "x"},
	}}

	preview := Plan(doc, current, env())
	statuses := map[string]domain.ImportGlobalCommandPreview{}
	for _, g := range preview.GlobalCommands {
		statuses[g.ID] = g
	}
	if statuses["gc1"].Status != domain.ImportGlobalExisting || statuses["gc2"].Status != domain.ImportGlobalRenamed ||
		statuses["gc2"].ImportName != "Unused (imported 2)" || statuses["gc3"].Status != domain.ImportGlobalNew {
		t.Fatalf("preview = %+v", preview.GlobalCommands)
	}
	// Two new global commands plus no inline commands in added repos besides "migrate".
	if preview.ShellCommands != 3 {
		t.Fatalf("shell commands = %d", preview.ShellCommands)
	}
	if steps := preview.Groups[1].Repositories[0].Steps; steps[1].GlobalCommand != "gc1" {
		t.Fatalf("preview steps keep document IDs: %+v", steps)
	}

	merged, _, result := Merge(doc, current, env(), domain.ImportOptions{ImportSequences: true})
	if result.GlobalCommandsAdded != 2 || len(merged.GlobalCommands) != 5 || len(current.GlobalCommands) != 3 {
		t.Fatalf("result = %+v globals = %+v", result, merged.GlobalCommands)
	}
	var api domain.Repository
	for _, r := range merged.Repositories {
		if r.Name == "api" {
			api = r
		}
	}
	if api.CommandSequence[1].GlobalCommand != "mine-install" {
		t.Fatalf("references must be remapped to local IDs: %+v", api.CommandSequence)
	}
}

func TestMergeKeepsDocumentGroupOrder(t *testing.T) {
	current := domain.Workspace{Groups: []domain.Group{{ID: "x", Name: "X"}, {ID: "b", Name: "B"}}}
	names := func(ws domain.Workspace) []string {
		out := []string{}
		for _, g := range ws.Groups {
			out = append(out, g.Name)
		}
		return out
	}
	for _, tc := range []struct {
		doc  []string
		want []string
	}{
		{[]string{"A", "B", "C"}, []string{"X", "A", "B", "C"}}, // around an existing group
		{[]string{"A", "C"}, []string{"X", "B", "A", "C"}},      // nothing shared: appended in order
		// Existing groups keep their order; each new group follows its
		// predecessor in the document (A after B, C after X).
		{[]string{"B", "A", "X", "C"}, []string{"X", "C", "B", "A"}},
	} {
		doc := Document{Format: Format, Version: 3}
		for _, n := range tc.doc {
			doc.Groups = append(doc.Groups, DocumentGroup{Name: n})
		}
		merged, _, _ := Merge(doc, current, env(), domain.ImportOptions{})
		if got := names(merged); !slices.Equal(got, tc.want) {
			t.Fatalf("doc %v: groups = %v, want %v", tc.doc, got, tc.want)
		}
	}
}

func TestPlainFolderFlagRoundTrip(t *testing.T) {
	ws := domain.Workspace{
		Groups: []domain.Group{{ID: "g", Name: "G", RepositoryIDs: []string{"p", "n"}}},
		Repositories: []domain.Repository{
			{ID: "p", Name: "infra", Path: filepath.Join(home, "infra"), GroupID: "g"},
			{ID: "n", Name: "api", PackageManager: "pnpm", Path: filepath.Join(home, "api"), GroupID: "g"},
		},
	}
	doc, _ := Build(ws, nil, home, time.Now())
	if !doc.Groups[0].Repositories[0].PlainFolder || doc.Groups[0].Repositories[1].PlainFolder {
		t.Fatalf("flags = %+v", doc.Groups[0].Repositories)
	}
	merged, _, _ := Merge(doc, domain.Workspace{}, env(), domain.ImportOptions{})
	if merged.Repositories[0].PackageManager != "" || merged.Repositories[1].PackageManager != UnknownPackageManager {
		t.Fatalf("imported = %+v", merged.Repositories)
	}
}

func TestMergeKeepsStepOrderAndDropsDisabledSteps(t *testing.T) {
	steps := []domain.CommandStep{
		{ID: "1", Label: "install", Command: "npm ci", Enabled: false},
		{ID: "2", Label: "build", Script: "build", Enabled: true},
		{ID: "3", Label: "dev", Script: "dev", Enabled: true, Background: true},
		{ID: "4", Label: "lint", Script: "lint", Enabled: false},
	}
	doc := Document{Format: Format, Version: 3, Groups: []DocumentGroup{{Name: "G", Repositories: []DocumentRepository{{Name: "x", Path: "~/x", CommandSequence: steps}}}}}
	describe := func(list []domain.CommandStep) []string {
		out := []string{}
		for _, s := range list {
			out = append(out, fmt.Sprintf("%s enabled=%v bg=%v", s.Label, s.Enabled, s.Background))
		}
		return out
	}

	kept, _, _ := Merge(doc, domain.Workspace{}, env(), domain.ImportOptions{ImportSequences: true})
	if got, want := describe(kept.Repositories[0].CommandSequence), describe(steps[1:3]); !slices.Equal(got, want) {
		t.Fatalf("kept = %v, want %v", got, want)
	}
	skipped, _, _ := Merge(doc, domain.Workspace{}, env(), domain.ImportOptions{})
	if len(skipped.Repositories[0].CommandSequence) != 0 {
		t.Fatalf("opt-out = %+v", skipped.Repositories[0].CommandSequence)
	}
}
