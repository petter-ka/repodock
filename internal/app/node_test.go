package app

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/example/repodock/internal/domain"
	nodemod "github.com/example/repodock/internal/modules/nodeversion"
	processmod "github.com/example/repodock/internal/modules/process"
	"github.com/example/repodock/internal/testsupport"
)

// fakeNodes gives the app an nvm folder with two "node" scripts that print
// their version, and no default node.
func fakeNodes(t *testing.T, a *App) (home string) {
	t.Helper()
	home = t.TempDir()
	for _, v := range []string{"20.11.1", "22.19.0"} {
		bin := filepath.Join(home, ".nvm", "versions", "node", "v"+v, "bin")
		if err := os.MkdirAll(bin, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(bin, "node"), []byte("#!/bin/sh\necho fake-node-"+v+"\n"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	a.node = nodemod.New(nodemod.Options{
		Env:            nodemod.Env{Home: home, Getenv: func(string) string { return "" }, GOOS: runtime.GOOS},
		SearchPath:     func() string { return "" },
		FindExecutable: processmod.LookPath,
		Now:            time.Now,
	})
	return home
}

func TestNodeVersionSelection(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the fake installs are shell scripts")
	}
	a := newTestApp(t)
	home := fakeNodes(t, a)
	dir := fixture(t)
	if err := os.WriteFile(filepath.Join(dir, ".nvmrc"), []byte("20\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	repo, err := a.AddRepository(dir, "")
	if err != nil {
		t.Fatal(err)
	}
	if repo.NodeRequest.Spec != "20" || repo.NodeRequest.Source != ".nvmrc" {
		t.Fatalf("request = %+v", repo.NodeRequest)
	}
	status := func() domain.NodeStatus {
		for _, s := range a.NodeVersions().Repositories {
			if s.RepositoryID == repo.ID {
				return s
			}
		}
		t.Fatal("no status for the repository")
		return domain.NodeStatus{}
	}
	if s := status(); s.Version != "20.11.1" || s.Source != "request" || s.Newer != "22.19.0" {
		t.Fatalf("automatic status = %+v", s)
	}
	if err := a.SetRepositoryNodeVersion(repo.ID, "18.0.0"); err == nil {
		t.Fatal("a version that is not installed must be rejected")
	}
	if err := a.SetRepositoryNodeVersion(repo.ID, "v22.19.0"); err != nil {
		t.Fatal(err)
	}
	if stored, _ := a.workspace.Repository(repo.ID); stored.NodeVersion != "22.19.0" {
		t.Fatalf("stored = %q", stored.NodeVersion)
	}
	if s := status(); s.Version != "22.19.0" || s.Source != "selected" {
		t.Fatalf("selected status = %+v", s)
	}
	current, _ := a.workspace.Repository(repo.ID)
	want := filepath.Join(home, ".nvm", "versions", "node", "v22.19.0", "bin")
	if spec := a.runSpec(current, ""); len(spec.PathPrefix) != 1 || spec.PathPrefix[0] != want {
		t.Fatalf("path prefix = %v", spec.PathPrefix)
	}
	if err := a.SetRepositoryNodeVersion(repo.ID, ""); err != nil {
		t.Fatal(err)
	}
	if s := status(); s.Source != "request" {
		t.Fatalf("back to automatic: %+v", s)
	}
}

// The command runs with the chosen node first on PATH, whatever the login
// shell's profile does.
func TestCommandsRunWithTheChosenNode(t *testing.T) {
	testsupport.E2E(t)
	if runtime.GOOS == "windows" {
		t.Skip("the fake installs are shell scripts")
	}
	a := newTestApp(t)
	fakeNodes(t, a)
	var mu sync.Mutex
	var lines []string
	a.process.SetEmitter(func(event string, payload any) {
		if batch, ok := payload.([]domain.ProcessOutput); ok {
			mu.Lock()
			for _, line := range batch {
				lines = append(lines, line.Text)
			}
			mu.Unlock()
		}
	})
	repo, err := a.AddRepository(fixture(t), "")
	if err != nil {
		t.Fatal(err)
	}
	for _, version := range []string{"20.11.1", "22.19.0"} {
		if err := a.SetRepositoryNodeVersion(repo.ID, version); err != nil {
			t.Fatal(err)
		}
		run, err := a.RunCommand(repo.ID, "node", "")
		if err != nil {
			t.Fatal(err)
		}
		if final, _ := a.WaitForRun(run.ID); final.Status != domain.RunExited {
			t.Fatalf("run = %+v", final)
		}
		mu.Lock()
		got := strings.Join(lines, "\n")
		mu.Unlock()
		if !strings.Contains(got, "fake-node-"+version) {
			t.Fatalf("output %q does not come from node %s", got, version)
		}
	}
}

func TestRunTaskRequiresADiscoveredTask(t *testing.T) {
	a := newTestApp(t)
	dir := fixture(t)
	if err := os.WriteFile(filepath.Join(dir, "turbo.json"), []byte(`{"tasks": {"build": {}}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	repo, err := a.AddRepository(dir, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(repo.Monorepo.Tasks) != 1 || repo.Monorepo.Tools[0] != "turbo" {
		t.Fatalf("monorepo = %+v", repo.Monorepo)
	}
	if _, err := a.RunTask(repo.ID, "turbo", "deploy", ""); err == nil {
		t.Fatal("an unknown task must be rejected")
	}
	if _, err := a.RunTask(repo.ID, "nx", "build", ""); err == nil {
		t.Fatal("a task of another tool must be rejected")
	}
}

func TestEnvironmentFilesInSubfolders(t *testing.T) {
	a := newTestApp(t)
	dir := fixture(t)
	if err := os.MkdirAll(filepath.Join(dir, "apps", "api"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "apps", "api", ".env.staging"), []byte("A=1\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	repo, err := a.AddRepository(dir, "")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(repo.EnvFiles, ",") != ".env,.env.local,apps/api/.env.staging" {
		t.Fatalf("env files = %v", repo.EnvFiles)
	}
	if err := a.SaveEnvironmentFile(repo.ID, "apps/api/.env.staging", "A=2\n"); err != nil {
		t.Fatal(err)
	}
	if file, err := a.ReadEnvironmentFile(repo.ID, "apps/api/.env.staging"); err != nil || file.Content != "A=2\n" {
		t.Fatalf("file = %+v, %v", file, err)
	}
}

func TestOpenExternalURLAllowsHTTPSOnly(t *testing.T) {
	a := newTestApp(t)
	for _, link := range []string{"http://example.com", "file:///etc/passwd", "javascript:alert(1)", "https://"} {
		if err := a.OpenExternalURL(link); err == nil {
			t.Errorf("%q must be rejected", link)
		}
	}
}

func TestAppInfoReportsTheVersion(t *testing.T) {
	a := newTestApp(t)
	info := a.AppInfo()
	if info.Version != Version || info.Platform != runtime.GOOS+"/"+runtime.GOARCH || !strings.HasPrefix(info.Repository, "https://github.com/") {
		t.Fatalf("info = %+v", info)
	}
}
