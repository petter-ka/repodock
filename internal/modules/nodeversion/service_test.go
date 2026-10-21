package nodeversion

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/example/repodock/internal/domain"
)

func TestParseRange(t *testing.T) {
	cases := []struct {
		spec string
		in   []string
		out  []string
	}{
		{"20", []string{"20.0.0", "20.19.5"}, []string{"19.9.9", "21.0.0"}},
		{"v20.11", []string{"20.11.0", "20.11.9"}, []string{"20.12.0"}},
		{"20.11.1", []string{"20.11.1"}, []string{"20.11.2"}},
		{"20.x", []string{"20.5.0"}, []string{"21.0.0"}},
		{"^18.17", []string{"18.17.0", "18.20.8"}, []string{"18.16.9", "19.0.0"}},
		{"~20.1", []string{"20.1.5"}, []string{"20.2.0"}},
		{">=18 <21", []string{"18.0.0", "20.99.0"}, []string{"17.9.0", "21.0.0"}},
		{">= 18", []string{"22.0.0"}, []string{"16.0.0"}},
		{">18", []string{"19.0.0"}, []string{"18.20.0"}},
		{"<=20", []string{"20.9.9"}, []string{"21.0.0"}},
		{"16 - 18", []string{"16.0.0", "18.9.0"}, []string{"19.0.0"}},
		{"18 || 20 || >=22", []string{"18.1.0", "20.1.0", "24.0.0"}, []string{"19.0.0", "21.0.0"}},
		{"*", []string{"4.0.0", "26.0.0"}, nil},
	}
	for _, c := range cases {
		r, ok := ParseRange(c.spec)
		if !ok {
			t.Fatalf("%q did not parse", c.spec)
		}
		for _, v := range c.in {
			version, _ := ParseVersion(v)
			if !r.Contains(version) {
				t.Errorf("%q should contain %s", c.spec, v)
			}
		}
		for _, v := range c.out {
			version, _ := ParseVersion(v)
			if r.Contains(version) {
				t.Errorf("%q should not contain %s", c.spec, v)
			}
		}
	}
	for _, bad := range []string{"lts/iron", "abc", ">=", "1.2.3.4"} {
		if _, ok := ParseRange(bad); ok {
			t.Errorf("%q should not parse", bad)
		}
	}
}

func TestParseVersionIgnoresSuffixes(t *testing.T) {
	for in, want := range map[string]string{"v22.19.0": "22.19.0", "22.1.0_1": "22.1.0", "23.0.0-rc.1": "23.0.0"} {
		if v, ok := ParseVersion(in); !ok || v.String() != want {
			t.Errorf("ParseVersion(%q) = %v, %v", in, v, ok)
		}
	}
	if _, ok := ParseVersion("20"); ok {
		t.Error("a partial version is not a full version")
	}
}

func TestIsEOL(t *testing.T) {
	now := time.Date(2026, 10, 21, 0, 0, 0, 0, time.UTC)
	for major, want := range map[int]bool{0: true, 16: true, 18: true, 20: true, 21: true, 22: false, 24: false, 25: true, 99: false} {
		if got := IsEOL(major, now); got != want {
			t.Errorf("IsEOL(%d) = %v, want %v", major, got, want)
		}
	}
}

// fakeHome lays out versions the way the managers do.
func fakeHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	node := func(parts ...string) {
		dir := filepath.Join(append([]string{home}, parts...)...)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "node"), []byte("#!/bin/sh\n"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	node(".nvm", "versions", "node", "v18.20.8", "bin")
	node(".nvm", "versions", "node", "v22.19.0", "bin")
	node(".nvm", "versions", "node", "v20.11.1", "bin")
	node(".local", "share", "fnm", "node-versions", "v20.11.1", "installation", "bin")
	node(".volta", "tools", "image", "node", "16.20.2", "bin")
	node(".asdf", "installs", "nodejs", "21.7.1", "bin")
	// Not versions: an alias folder and a folder without node.
	node(".local", "share", "mise", "installs", "node", "lts", "bin")
	if err := os.MkdirAll(filepath.Join(home, ".nvm", "versions", "node", "v19.0.0", "bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	return home
}

func newTestService(t *testing.T, home, pathList string, probe func(string, string) (string, error)) *Service {
	t.Helper()
	return New(Options{
		Env:        Env{Home: home, Getenv: func(string) string { return "" }, GOOS: "linux", Root: filepath.Join(home, "system-root")},
		SearchPath: func() string { return pathList },
		FindExecutable: func(name, list string) string {
			for _, dir := range filepath.SplitList(list) {
				if path := filepath.Join(dir, name); isFile(path) {
					return path
				}
			}
			return ""
		},
		Probe: probe,
		Now:   func() time.Time { return time.Date(2026, 10, 21, 0, 0, 0, 0, time.UTC) },
	})
}

func TestDiscoverFindsManagersNewestFirst(t *testing.T) {
	home := fakeHome(t)
	s := newTestService(t, home, filepath.Join(home, ".nvm", "versions", "node", "v22.19.0", "bin"), nil)
	ov := s.Overview(nil)
	var got []string
	for _, in := range ov.Installs {
		got = append(got, in.Manager+"@"+in.Version)
	}
	want := []string{"nvm@22.19.0", "asdf@21.7.1", "nvm@20.11.1", "fnm@20.11.1", "nvm@18.20.8", "volta@16.20.2"}
	if len(got) != len(want) {
		t.Fatalf("installs = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("installs = %v, want %v", got, want)
		}
	}
	if ov.Default != "22.19.0" || !ov.Installs[0].Default || ov.Installs[1].Default {
		t.Fatalf("default = %q, installs = %+v", ov.Default, ov.Installs)
	}
	if !ov.Installs[4].EOL || ov.Installs[0].EOL {
		t.Fatalf("EOL flags wrong: %+v", ov.Installs)
	}
	if len(ov.Managers) != 4 {
		t.Fatalf("managers = %+v", ov.Managers)
	}
}

func TestDefaultNodeOutsideManagersIsProbed(t *testing.T) {
	home := fakeHome(t)
	system := t.TempDir()
	if err := os.WriteFile(filepath.Join(system, "node"), []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	probed := ""
	s := newTestService(t, home, system, func(node, _ string) (string, error) {
		probed = node
		return "v24.1.0\n", nil
	})
	ov := s.Overview(nil)
	if probed != filepath.Join(system, "node") || ov.Default != "24.1.0" || ov.Installs[0].Manager != "system" || ov.Installs[0].BinDir != system {
		t.Fatalf("probed %q, overview %+v", probed, ov)
	}

	failing := newTestService(t, home, system, func(string, string) (string, error) { return "", errors.New("boom") })
	if failing.Overview(nil).Default != "" {
		t.Fatal("a failed probe must leave no default")
	}
}

func TestResolveOrder(t *testing.T) {
	home := fakeHome(t)
	s := newTestService(t, home, filepath.Join(home, ".nvm", "versions", "node", "v22.19.0", "bin"), nil)
	nvm := func(v string) string { return filepath.Join(home, ".nvm", "versions", "node", "v"+v, "bin") }

	cases := []struct {
		name   string
		repo   domain.Repository
		want   domain.NodeStatus
		binDir string
	}{
		{"default", domain.Repository{}, domain.NodeStatus{Version: "22.19.0", Manager: "nvm", Source: "default"}, nvm("22.19.0")},
		{"request prefix", domain.Repository{NodeRequest: domain.NodeRequest{Spec: "20"}}, domain.NodeStatus{Version: "20.11.1", Manager: "nvm", Source: "request", EOL: true, Newer: "22.19.0"}, nvm("20.11.1")},
		{"lts codename", domain.Repository{NodeRequest: domain.NodeRequest{Spec: "lts/hydrogen"}}, domain.NodeStatus{Version: "18.20.8", Manager: "nvm", Source: "request", EOL: true, Newer: "22.19.0"}, nvm("18.20.8")},
		{"lts newest", domain.Repository{NodeRequest: domain.NodeRequest{Spec: "lts/*"}}, domain.NodeStatus{Version: "22.19.0", Manager: "nvm", Source: "request"}, nvm("22.19.0")},
		{"missing request", domain.Repository{NodeRequest: domain.NodeRequest{Spec: "14"}}, domain.NodeStatus{Version: "22.19.0", Manager: "nvm", Source: "default", Missing: "14"}, nvm("22.19.0")},
		{"selection wins", domain.Repository{NodeVersion: "21.7.1", NodeRequest: domain.NodeRequest{Spec: "20"}}, domain.NodeStatus{Version: "21.7.1", Manager: "asdf", Source: "selected", EOL: true, Newer: "22.19.0"}, filepath.Join(home, ".asdf", "installs", "nodejs", "21.7.1", "bin")},
		{"missing selection", domain.Repository{NodeVersion: "19.1.0", NodeRequest: domain.NodeRequest{Spec: "20"}}, domain.NodeStatus{Version: "20.11.1", Manager: "nvm", Source: "request", Missing: "19.1.0", EOL: true, Newer: "22.19.0"}, nvm("20.11.1")},
		{"engines", domain.Repository{NodeRequest: domain.NodeRequest{Engines: ">=18 <21"}}, domain.NodeStatus{Version: "22.19.0", Manager: "nvm", Source: "default", EnginesMismatch: true}, nvm("22.19.0")},
	}
	for _, c := range cases {
		got, bin := s.Resolve(c.repo)
		c.want.RepositoryID = c.repo.ID
		if got != c.want || bin != c.binDir {
			t.Errorf("%s: got %+v %q, want %+v %q", c.name, got, bin, c.want, c.binDir)
		}
	}
	if !s.Installed("v20.11.1") || s.Installed("20") || s.Installed("19.0.0") {
		t.Fatal("Installed must match exact installed versions only")
	}
}

// n and Homebrew live in fixed system folders; they are found under Root,
// and nothing from the real machine leaks into a test.
func TestSystemLocations(t *testing.T) {
	home := t.TempDir()
	root := filepath.Join(home, "system-root")
	for _, dir := range []string{
		filepath.Join(root, "usr", "local", "n", "versions", "node", "22.23.3", "bin"),
		filepath.Join(root, "opt", "homebrew", "Cellar", "node@24", "24.21.0_2", "bin"),
		filepath.Join(root, "opt", "homebrew", "Cellar", "python@3.12", "3.12.1", "bin"),
	} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "node"), []byte("#!/bin/sh\n"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	s := newTestService(t, home, "", nil)
	var got []string
	for _, in := range s.Overview(nil).Installs {
		got = append(got, in.Manager+"@"+in.Version)
	}
	if len(got) != 2 || got[0] != "homebrew@24.21.0" || got[1] != "n@22.23.3" {
		t.Fatalf("installs = %v", got)
	}
}

func TestNoNodeAtAll(t *testing.T) {
	s := newTestService(t, t.TempDir(), "", nil)
	status, bin := s.Resolve(domain.Repository{ID: "r", NodeRequest: domain.NodeRequest{Spec: "20"}})
	if status.Version != "" || status.Missing != "20" || bin != "" {
		t.Fatalf("status = %+v, bin = %q", status, bin)
	}
}
