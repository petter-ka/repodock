//go:build !windows

package platform

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Commands run through `$SHELL -l -c`, which does not read ~/.zshrc or
// ~/.bashrc. Version managers that are shell functions there (nvm) or need
// shell setup (fnm) are therefore missing: `nvm use 18` fails with
// "zsh:1: command not found: nvm". RepoDock writes a short prelude that
// runs before the user's command (ADR-0031):
//
//   - a command that calls nvm gets nvm.sh sourced, with --no-use so it does
//     not switch versions by itself;
//   - folders RepoDock puts first on PATH (the repository's Node.js
//     version) are put first again, because login profiles and macOS
//     path_helper reorder PATH after the environment is set;
//   - a command that calls fnm gets `fnm env` after that, so `fnm use`
//     inside the command decides the version.
//
// The prelude holds only paths RepoDock found, single-quoted; the user's
// command follows unchanged.

// versionManagers locates the shell setup of nvm and fnm.
type versionManagers struct {
	nvmDir, nvmScript string
	fnm               string
}

var managerSetup = sync.OnceValue(findVersionManagers)

func findVersionManagers() versionManagers {
	var vm versionManagers
	home, _ := os.UserHomeDir()
	var dirs []string
	if dir := os.Getenv("NVM_DIR"); dir != "" {
		dirs = append(dirs, dir)
	}
	if home != "" {
		xdg := os.Getenv("XDG_CONFIG_HOME")
		if xdg == "" {
			xdg = filepath.Join(home, ".config")
		}
		dirs = append(dirs, filepath.Join(home, ".nvm"), filepath.Join(xdg, "nvm"))
	}
	scripts := []string{}
	for _, dir := range dirs {
		scripts = append(scripts, filepath.Join(dir, "nvm.sh"))
	}
	// Homebrew and distribution packages keep nvm.sh apart from NVM_DIR.
	scripts = append(scripts,
		"/opt/homebrew/opt/nvm/nvm.sh", "/usr/local/opt/nvm/nvm.sh",
		"/home/linuxbrew/.linuxbrew/opt/nvm/nvm.sh", "/usr/share/nvm/nvm.sh",
	)
	for _, script := range scripts {
		if info, err := os.Stat(script); err == nil && info.Mode().IsRegular() {
			vm.nvmScript = script
			break
		}
	}
	if vm.nvmScript != "" {
		vm.nvmDir = filepath.Dir(vm.nvmScript)
		for _, dir := range dirs {
			if info, err := os.Stat(dir); err == nil && info.IsDir() {
				vm.nvmDir = dir
				break
			}
		}
	}
	vm.fnm = FindExecutable("fnm", SearchPath())
	return vm
}

// shellSyntax is "posix" or "fish" for shells a prelude can be written
// for, and "" for others (they get the PATH only through the environment).
func shellSyntax(shell string) string {
	switch filepath.Base(shell) {
	case "sh", "bash", "zsh", "dash", "ksh", "mksh", "ash", "yash", "oksh", "loksh":
		return "posix"
	case "fish":
		return "fish"
	}
	return ""
}

// managersIn returns the version managers a command calls, as whole words.
func managersIn(command string) map[string]bool {
	used := map[string]bool{}
	words := strings.FieldsFunc(command, func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("_.-/~", r))
	})
	for _, word := range words {
		if word == "nvm" || word == "fnm" {
			used[word] = true
		}
	}
	return used
}

// prelude returns the shell text that runs before command ("" if none).
func prelude(shell, command string, pathPrefix []string, setup func() versionManagers) string {
	syntax := shellSyntax(shell)
	if syntax == "" {
		return ""
	}
	quote := posixQuote
	if syntax == "fish" {
		quote = fishQuote
	}
	used := managersIn(command)
	var vm versionManagers
	if len(used) > 0 {
		vm = setup()
	}
	var parts []string
	if used["nvm"] && syntax == "posix" && vm.nvmScript != "" {
		parts = append(parts, "export NVM_DIR="+quote(vm.nvmDir), ". "+quote(vm.nvmScript)+" --no-use")
	}
	if len(pathPrefix) > 0 {
		if syntax == "fish" {
			quoted := make([]string, len(pathPrefix))
			for i, dir := range pathPrefix {
				quoted[i] = quote(dir)
			}
			parts = append(parts, "set -gx PATH "+strings.Join(quoted, " ")+" $PATH")
		} else {
			parts = append(parts, "export PATH="+quote(strings.Join(pathPrefix, ":"))+`:"$PATH"`)
		}
	}
	if used["fnm"] && vm.fnm != "" {
		if syntax == "fish" {
			parts = append(parts, quote(vm.fnm)+" env --shell fish | source")
		} else {
			target := "bash"
			if filepath.Base(shell) == "zsh" {
				target = "zsh"
			}
			parts = append(parts, `eval "$(`+quote(vm.fnm)+" env --shell "+target+`)"`)
		}
	}
	if len(parts) == 0 {
		return ""
	}
	return strings.Join(parts, "; ") + "; "
}

func posixQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

func fishQuote(s string) string {
	return "'" + strings.ReplaceAll(strings.ReplaceAll(s, `\`, `\\`), "'", `\'`) + "'"
}
