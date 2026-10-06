//go:build !windows

package platform

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	pathStart = "__REPODOCK_PATH_START__"
	pathEnd   = "__REPODOCK_PATH_END__"
	// shellEnvTimeout bounds how long a slow or hanging shell profile can
	// delay the first command.
	shellEnvTimeout = 8 * time.Second
)

// Apps launched from Finder/Dock (macOS) or a desktop launcher (Linux) do
// not inherit the PATH a terminal has. Version managers (nvm, fnm, asdf,
// volta) usually extend PATH in ~/.zshrc or ~/.bashrc, which a login shell
// (`-l`) alone does not read. Resolve the PATH of an interactive login
// shell once and reuse it for every child process.
var resolvedPath = sync.OnceValue(func() string {
	path, err := shellPath(userShell(), shellEnvTimeout)
	if err != nil {
		slog.Warn("could not resolve PATH from the login shell; using fallback directories", "error", err)
		return ""
	}
	return path
})

// WarmEnvironment starts resolving the shell PATH in the background so the
// first command does not wait for it.
func WarmEnvironment() { go resolvedPath() }

// ChildEnvironment returns base with PATH extended by the interactive login
// shell's PATH and common tool directories that exist on this machine.
func ChildEnvironment(base []string) []string {
	return WithPath(base, resolvedPath(), fallbackDirs())
}

func userShell() string {
	shell := os.Getenv("SHELL")
	if shell == "" || !filepath.IsAbs(shell) {
		return "/bin/sh"
	}
	if _, err := os.Stat(shell); err != nil {
		return "/bin/sh"
	}
	return shell
}

// shellPath runs `$SHELL -i -l -c` and extracts PATH between markers, so
// banners or warnings printed by shell profiles are ignored.
func shellPath(shell string, timeout time.Duration) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	script := fmt.Sprintf(`printf '%%s%%s%%s' '%s' "$PATH" '%s'`, pathStart, pathEnd)
	cmd := exec.CommandContext(ctx, shell, "-i", "-l", "-c", script)
	// No stdin: a profile that prompts (e.g. an update check) reads EOF
	// instead of hanging. Ask common frameworks not to prompt at all.
	cmd.Stdin = nil
	cmd.Env = append(os.Environ(), "DISABLE_AUTO_UPDATE=true", "ZSH_DISABLE_COMPFIX=true")
	cmd.WaitDelay = time.Second
	out, err := cmd.Output()
	if ctx.Err() != nil {
		return "", fmt.Errorf("%s did not finish within %s", shell, timeout)
	}
	start := bytes.LastIndex(out, []byte(pathStart))
	end := bytes.LastIndex(out, []byte(pathEnd))
	if start < 0 || end < start {
		if err != nil {
			return "", fmt.Errorf("run %s: %w", shell, err)
		}
		return "", fmt.Errorf("%s printed no PATH", shell)
	}
	path := strings.TrimSpace(string(out[start+len(pathStart) : end]))
	if path == "" {
		return "", fmt.Errorf("%s reported an empty PATH", shell)
	}
	return path, nil
}

// fallbackDirs lists well-known tool locations that exist, appended after
// the resolved PATH in case resolution failed or a profile is unusual.
func fallbackDirs() []string {
	home, _ := os.UserHomeDir()
	candidates := []string{
		"/opt/homebrew/bin", "/opt/homebrew/sbin", // Homebrew on Apple Silicon
		"/usr/local/bin", "/usr/local/sbin", // Homebrew on Intel, manual installs
		"/opt/local/bin", // MacPorts
	}
	if home != "" {
		candidates = append(candidates,
			filepath.Join(home, ".volta", "bin"),
			filepath.Join(home, ".bun", "bin"),
			filepath.Join(home, "Library", "pnpm"),
			filepath.Join(home, ".local", "share", "pnpm"),
			filepath.Join(home, ".local", "bin"),
			filepath.Join(home, ".asdf", "shims"),
			filepath.Join(home, ".local", "share", "mise", "shims"),
			filepath.Join(home, ".nodenv", "shims"),
		)
		// nvm without a shell: use the newest installed Node version.
		if newest := newestNodeVersion(filepath.Join(home, ".nvm", "versions", "node")); newest != "" {
			candidates = append(candidates, filepath.Join(newest, "bin"))
		}
	}
	out := make([]string, 0, len(candidates))
	for _, dir := range candidates {
		if info, err := os.Stat(dir); err == nil && info.IsDir() {
			out = append(out, dir)
		}
	}
	return out
}

// newestNodeVersion returns the highest semver-named subdirectory (v22.1.0
// beats v9.11.2) of an nvm versions folder.
func newestNodeVersion(dir string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	best, bestVersion := "", []int(nil)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		version := parseVersion(entry.Name())
		if version == nil {
			continue
		}
		if bestVersion == nil || compareVersions(version, bestVersion) > 0 {
			best, bestVersion = filepath.Join(dir, entry.Name()), version
		}
	}
	return best
}

func parseVersion(name string) []int {
	parts := strings.Split(strings.TrimPrefix(name, "v"), ".")
	out := make([]int, 0, len(parts))
	for _, part := range parts {
		n, err := strconv.Atoi(part)
		if err != nil {
			return nil
		}
		out = append(out, n)
	}
	return out
}

func compareVersions(a, b []int) int {
	for i := 0; i < len(a) || i < len(b); i++ {
		var x, y int
		if i < len(a) {
			x = a[i]
		}
		if i < len(b) {
			y = b[i]
		}
		if x != y {
			return x - y
		}
	}
	return 0
}
