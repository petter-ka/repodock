//go:build !windows

package platform

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeScript(t *testing.T, path, body string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
}

func TestShellPathIgnoresProfileNoise(t *testing.T) {
	shell := filepath.Join(t.TempDir(), "fakesh")
	// Called as: fakesh -i -l -c <script>
	writeScript(t, shell, "#!/bin/sh\necho 'Welcome! Last login: today'\necho 'warning: something' >&2\nPATH=\"/fake/nvm/bin:$PATH\"\neval \"$4\"\necho 'trailing banner'\n")
	path, err := shellPath(shell, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(path, "/fake/nvm/bin:") || strings.Contains(path, "Welcome") || strings.Contains(path, "banner") {
		t.Fatalf("path = %q", path)
	}
}

func TestShellPathTimesOut(t *testing.T) {
	shell := filepath.Join(t.TempDir(), "hangsh")
	writeScript(t, shell, "#!/bin/sh\nsleep 30\n")
	start := time.Now()
	if _, err := shellPath(shell, 300*time.Millisecond); err == nil {
		t.Fatal("expected a timeout error")
	}
	if time.Since(start) > 5*time.Second {
		t.Fatal("timeout was not enforced")
	}
}

// Reproduces the macOS bug: npm is only on PATH via ~/.zshrc (as nvm sets
// it up), so `zsh -l -c npm` fails with "command not found" unless the
// child environment carries the interactive shell's PATH.
func TestZshrcPathReachesChildProcesses(t *testing.T) {
	zsh, err := exec.LookPath("zsh")
	if err != nil {
		t.Skip("zsh is not installed")
	}
	home := t.TempDir()
	bin := filepath.Join(home, ".nvm-like", "bin")
	if err := os.MkdirAll(bin, 0o755); err != nil {
		t.Fatal(err)
	}
	writeScript(t, filepath.Join(bin, "npm"), "#!/bin/sh\necho npm-from-zshrc\n")
	writeScript(t, filepath.Join(home, ".zshrc"), "export PATH=\""+bin+":$PATH\"\necho 'zshrc banner'\n")

	t.Setenv("HOME", home)
	t.Setenv("ZDOTDIR", home)
	t.Setenv("PATH", "/usr/bin:/bin")

	// Without the resolved PATH the login shell alone cannot find npm.
	plain := exec.Command(zsh, "-l", "-c", "npm")
	plain.Env = os.Environ()
	if out, err := plain.CombinedOutput(); err == nil {
		t.Fatalf("precondition failed: npm was found without .zshrc: %s", out)
	}

	path, err := shellPath(zsh, 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(zsh, "-l", "-c", "npm")
	cmd.Env = WithPath(os.Environ(), path, nil)
	out, err := cmd.CombinedOutput()
	if err != nil || strings.TrimSpace(string(out)) != "npm-from-zshrc" {
		t.Fatalf("npm via resolved PATH: %q, %v", out, err)
	}
}

func TestNewestNodeVersionComparesNumerically(t *testing.T) {
	dir := t.TempDir()
	for _, v := range []string{"v9.11.2", "v22.1.0", "v18.20.4", "not-a-version"} {
		if err := os.MkdirAll(filepath.Join(dir, v, "bin"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if got := filepath.Base(newestNodeVersion(dir)); got != "v22.1.0" {
		t.Fatalf("newest = %q", got)
	}
	if newestNodeVersion(filepath.Join(dir, "missing")) != "" {
		t.Fatal("missing folder must yield empty")
	}
}
