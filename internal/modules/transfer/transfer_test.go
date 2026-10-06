package transfer

import (
	"path/filepath"
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
	if api.CommandSequence[0].Enabled || api.CommandSequence[0].ID == "s2" {
		t.Fatalf("imported steps must be disabled with fresh IDs: %+v", api.CommandSequence)
	}
	if len(current.Repositories) != 1 || len(current.Groups) != 1 {
		t.Fatal("Merge must not mutate the current workspace")
	}

	_, _, kept := Merge(doc, domain.Workspace{}, e, domain.ImportOptions{KeepStepsEnabled: true})
	if kept.RepositoriesAdded != 2 {
		t.Fatalf("kept = %+v", kept)
	}
	merged2, _, _ := Merge(doc, domain.Workspace{}, e, domain.ImportOptions{KeepStepsEnabled: true})
	if !merged2.Repositories[0].CommandSequence[0].Enabled || !merged2.Repositories[0].CommandSequence[0].Background {
		t.Fatal("KeepStepsEnabled must preserve flags")
	}
}

func TestDuplicatePathsInsideFile(t *testing.T) {
	doc := Document{Format: Format, Version: 1, Groups: []DocumentGroup{
		{Name: "A", Repositories: []DocumentRepository{{Name: "x", Path: "~/x"}, {Name: "x again", Path: "~/x"}}},
	}}
	preview := Plan(doc, domain.Workspace{}, env(filepath.Join(home, "x")))
	if preview.New != 1 || preview.Groups[0].Repositories[1].Status != domain.ImportDuplicate {
		t.Fatalf("preview = %+v", preview)
	}
	_, added, _ := Merge(doc, domain.Workspace{}, env(), domain.ImportOptions{})
	if len(added) != 1 {
		t.Fatalf("added = %v", added)
	}
}
