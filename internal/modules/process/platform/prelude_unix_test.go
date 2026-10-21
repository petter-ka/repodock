//go:build !windows

package platform

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/example/repodock/internal/testsupport"
)

func TestManagersInMatchesWholeWords(t *testing.T) {
	cases := map[string]string{
		"nvm use 18 && npm run dev": "nvm",
		"(fnm use) ; node -v":       "fnm",
		"nvm fnm":                   "fnm,nvm",
		"cat ~/.nvm/nvm.sh":         "",
		"./nvm install":             "",
		"nvm-update && fnmx":        "",
		"npm run dev":               "",
	}
	for command, want := range cases {
		used := managersIn(command)
		var got []string
		for _, name := range []string{"fnm", "nvm"} {
			if used[name] {
				got = append(got, name)
			}
		}
		if strings.Join(got, ",") != want {
			t.Errorf("%q: got %v, want %q", command, got, want)
		}
	}
}

func TestPreludeOnlyWhenNeeded(t *testing.T) {
	calls := 0
	setup := func() versionManagers {
		calls++
		return versionManagers{nvmDir: "/home/u/.nvm", nvmScript: "/opt/homebrew/opt/nvm/nvm.sh", fnm: "/usr/bin/fnm"}
	}
	if got := prelude("/bin/zsh", "npm run dev", nil, setup); got != "" || calls != 0 {
		t.Fatalf("plain command: %q (setup called %d times)", got, calls)
	}
	got := prelude("/bin/zsh", "nvm use 18", []string{"/n/v22/bin"}, setup)
	want := `export NVM_DIR='/home/u/.nvm'; . '/opt/homebrew/opt/nvm/nvm.sh' --no-use; export PATH='/n/v22/bin':"$PATH"; `
	if got != want {
		t.Fatalf("nvm prelude:\n got %q\nwant %q", got, want)
	}
	if got := prelude("/bin/bash", "fnm use 20", nil, setup); got != `eval "$('/usr/bin/fnm' env --shell bash)"; ` {
		t.Fatalf("fnm prelude: %q", got)
	}
	if got := prelude("/usr/bin/fish", "fnm use", []string{"/it's"}, setup); got != `set -gx PATH '/it\'s' $PATH; '/usr/bin/fnm' env --shell fish | source; ` {
		t.Fatalf("fish prelude: %q", got)
	}
	if got := prelude("/bin/tcsh", "nvm use", []string{"/x"}, setup); got != "" {
		t.Fatalf("unknown shells get no prelude: %q", got)
	}
	// Without nvm installed, nothing is sourced.
	none := func() versionManagers { return versionManagers{} }
	if got := prelude("/bin/zsh", "nvm use", nil, none); got != "" {
		t.Fatalf("missing nvm: %q", got)
	}
}

// Reproduces "zsh:1: command not found: nvm": nvm is a shell function that
// only ~/.zshrc defines, and `zsh -l -c` does not read it. With the
// prelude, the command finds nvm. A login profile that puts another node
// first must not win over the PATH prefix either.
func TestPreludeMakesNvmAndPathPrefixWork(t *testing.T) {
	testsupport.E2E(t)
	for _, name := range []string{"zsh", "bash"} {
		shell, err := exec.LookPath(name)
		if err != nil {
			continue
		}
		t.Run(name, func(t *testing.T) {
			home := t.TempDir()
			nvmDir := filepath.Join(home, ".nvm")
			for _, dir := range []string{nvmDir, filepath.Join(home, "chosen", "bin"), filepath.Join(home, "other", "bin")} {
				if err := os.MkdirAll(dir, 0o755); err != nil {
					t.Fatal(err)
				}
			}
			writeScript(t, filepath.Join(nvmDir, "nvm.sh"), "nvm() { echo \"fake nvm $* in $NVM_DIR\"; }\n")
			chosen := filepath.Join(home, "chosen", "bin")
			other := filepath.Join(home, "other", "bin")
			writeScript(t, filepath.Join(chosen, "repodock-node"), "#!/bin/sh\necho chosen\n")
			writeScript(t, filepath.Join(other, "repodock-node"), "#!/bin/sh\necho other\n")
			// Login profiles that prepend another folder, like path_helper does.
			profile := "export PATH=\"" + other + ":$PATH\"\n"
			writeScript(t, filepath.Join(home, ".zprofile"), profile)
			writeScript(t, filepath.Join(home, ".bash_profile"), profile)
			env := append(os.Environ(), "HOME="+home, "ZDOTDIR="+home, "PATH=/usr/bin:/bin")

			run := func(command string, prefix []string, vm versionManagers) string {
				script := prelude(shell, command, prefix, func() versionManagers { return vm }) + command
				cmd := exec.Command(shell, "-l", "-c", script)
				cmd.Env = WithPath(env, strings.Join(prefix, ":"), nil)
				out, _ := cmd.CombinedOutput()
				return strings.TrimSpace(string(out))
			}
			if out := run("nvm use 18", nil, versionManagers{}); !strings.Contains(out, "not found") {
				t.Fatalf("precondition: nvm should be missing without the prelude, got %q", out)
			}
			vm := versionManagers{nvmDir: nvmDir, nvmScript: filepath.Join(nvmDir, "nvm.sh")}
			if out := run("nvm use 18", nil, vm); out != "fake nvm use 18 in "+nvmDir {
				t.Fatalf("nvm through the prelude: %q", out)
			}
			if out := run("repodock-node", []string{chosen}, vm); out != "chosen" {
				t.Fatalf("PATH prefix lost to the login profile: %q", out)
			}
		})
	}
}
