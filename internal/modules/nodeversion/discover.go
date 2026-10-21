package nodeversion

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/example/repodock/internal/domain"
)

// Env is what discovery may look at. Tests point it at a fake home folder.
type Env struct {
	Home   string
	Getenv func(string) string
	// GOOS selects the folder layouts ("darwin", "linux", "windows").
	GOOS string
	// Root is where fixed system locations (/usr/local/n, /opt/homebrew,
	// …) are looked up; empty means the real filesystem root. Tests point
	// it at a folder of their own so the machine's installs stay out.
	Root string
}

func (e Env) get(key string) string {
	if e.Getenv == nil {
		return ""
	}
	return strings.TrimSpace(e.Getenv(key))
}

func (e Env) home(parts ...string) string {
	if e.Home == "" {
		return ""
	}
	return filepath.Join(append([]string{e.Home}, parts...)...)
}

// system returns a fixed system location under Root.
func (e Env) system(path string) string {
	if e.Root == "" {
		return path
	}
	return filepath.Join(e.Root, filepath.FromSlash(path))
}

func (e Env) nodeExe() string {
	if e.GOOS == "windows" {
		return "node.exe"
	}
	return "node"
}

// found is one installed version before it becomes a domain.NodeInstall.
type found struct {
	version Version
	binDir  string
}

// manager knows where one version manager keeps Node.js versions. Only the
// filesystem is read; nothing is executed.
type manager struct {
	id, name string
	roots    func(Env) []string
	versions func(Env, string) []found
}

// managerOrder breaks ties between equal versions from several managers.
var managerOrder = []string{"nvm", "fnm", "volta", "asdf", "mise", "n", "nodenv", "nvs", "nvm-windows", "homebrew", "system"}

func managerRank(id string) int {
	for i, candidate := range managerOrder {
		if candidate == id {
			return i
		}
	}
	return len(managerOrder)
}

func managers() []manager {
	return []manager{
		{
			id: "nvm", name: "nvm",
			roots: func(e Env) []string {
				if e.GOOS == "windows" {
					return nil
				}
				xdg := e.get("XDG_CONFIG_HOME")
				if xdg == "" {
					xdg = e.home(".config")
				}
				return []string{e.get("NVM_DIR"), e.home(".nvm"), filepath.Join(xdg, "nvm")}
			},
			versions: func(e Env, root string) []found {
				return versionDirs(e, filepath.Join(root, "versions", "node"), "bin")
			},
		},
		{
			id: "fnm", name: "fnm",
			roots: func(e Env) []string {
				xdg := e.get("XDG_DATA_HOME")
				if xdg == "" {
					xdg = e.home(".local", "share")
				}
				roots := []string{e.get("FNM_DIR"), filepath.Join(xdg, "fnm"), e.home(".fnm")}
				switch e.GOOS {
				case "darwin":
					roots = append(roots, e.home("Library", "Application Support", "fnm"))
				case "windows":
					roots = append(roots, filepath.Join(e.get("APPDATA"), "fnm"))
				}
				return roots
			},
			versions: func(e Env, root string) []found {
				sub := filepath.Join("installation", "bin")
				if e.GOOS == "windows" {
					sub = "installation"
				}
				return versionDirs(e, filepath.Join(root, "node-versions"), sub)
			},
		},
		{
			id: "volta", name: "Volta",
			roots: func(e Env) []string {
				roots := []string{e.get("VOLTA_HOME"), e.home(".volta")}
				if e.GOOS == "windows" {
					roots = append(roots, filepath.Join(e.get("LOCALAPPDATA"), "Volta"))
				}
				return roots
			},
			versions: func(e Env, root string) []found {
				sub := "bin"
				if e.GOOS == "windows" {
					sub = ""
				}
				return versionDirs(e, filepath.Join(root, "tools", "image", "node"), sub)
			},
		},
		{
			id: "asdf", name: "asdf",
			roots: func(e Env) []string { return []string{e.get("ASDF_DATA_DIR"), e.home(".asdf")} },
			versions: func(e Env, root string) []found {
				return versionDirs(e, filepath.Join(root, "installs", "nodejs"), "bin")
			},
		},
		{
			id: "mise", name: "mise",
			roots: func(e Env) []string {
				xdg := e.get("XDG_DATA_HOME")
				if xdg == "" {
					xdg = e.home(".local", "share")
				}
				roots := []string{e.get("MISE_DATA_DIR"), filepath.Join(xdg, "mise")}
				if e.GOOS == "windows" {
					roots = append(roots, filepath.Join(e.get("LOCALAPPDATA"), "mise"))
				}
				return roots
			},
			versions: func(e Env, root string) []found {
				sub := "bin"
				if e.GOOS == "windows" {
					sub = ""
				}
				return versionDirs(e, filepath.Join(root, "installs", "node"), sub)
			},
		},
		{
			id: "n", name: "n",
			roots: func(e Env) []string {
				if e.GOOS == "windows" {
					return nil
				}
				roots := []string{e.system("/usr/local/n")}
				if prefix := e.get("N_PREFIX"); prefix != "" {
					roots = append([]string{filepath.Join(prefix, "n")}, roots...)
				}
				return roots
			},
			versions: func(e Env, root string) []found {
				return versionDirs(e, filepath.Join(root, "versions", "node"), "bin")
			},
		},
		{
			id: "nodenv", name: "nodenv",
			roots: func(e Env) []string { return []string{e.get("NODENV_ROOT"), e.home(".nodenv")} },
			versions: func(e Env, root string) []found {
				return versionDirs(e, filepath.Join(root, "versions"), "bin")
			},
		},
		{
			id: "nvs", name: "nvs",
			roots: func(e Env) []string {
				roots := []string{e.get("NVS_HOME"), e.home(".nvs")}
				if e.GOOS == "windows" {
					roots = append(roots, filepath.Join(e.get("LOCALAPPDATA"), "nvs"))
				}
				return roots
			},
			// nvs keeps one folder per architecture: node/<version>/<arch>/bin.
			versions: func(e Env, root string) []found {
				var out []found
				entries, _ := os.ReadDir(filepath.Join(root, "node"))
				for _, entry := range entries {
					version, ok := ParseVersion(entry.Name())
					if !ok || !entry.IsDir() {
						continue
					}
					arches, _ := os.ReadDir(filepath.Join(root, "node", entry.Name()))
					for _, arch := range arches {
						bin := filepath.Join(root, "node", entry.Name(), arch.Name())
						if e.GOOS != "windows" {
							bin = filepath.Join(bin, "bin")
						}
						if isFile(filepath.Join(bin, e.nodeExe())) {
							out = append(out, found{version, bin})
							break
						}
					}
				}
				return out
			},
		},
		{
			id: "nvm-windows", name: "nvm for Windows",
			roots: func(e Env) []string {
				if e.GOOS != "windows" {
					return nil
				}
				return []string{e.get("NVM_HOME"), filepath.Join(e.get("APPDATA"), "nvm")}
			},
			versions: func(e Env, root string) []found { return versionDirs(e, root, "") },
		},
		{
			id: "homebrew", name: "Homebrew",
			roots: func(e Env) []string {
				if e.GOOS == "windows" {
					return nil
				}
				return []string{e.get("HOMEBREW_PREFIX"), e.system("/opt/homebrew"), e.system("/usr/local"), e.system("/home/linuxbrew/.linuxbrew")}
			},
			// Cellar/node/<version> and Cellar/node@<major>/<version>.
			versions: func(e Env, root string) []found {
				var out []found
				formulas, _ := os.ReadDir(filepath.Join(root, "Cellar"))
				for _, formula := range formulas {
					name := formula.Name()
					if name != "node" && !strings.HasPrefix(name, "node@") {
						continue
					}
					out = append(out, versionDirs(e, filepath.Join(root, "Cellar", name), "bin")...)
				}
				return out
			},
		},
	}
}

// versionDirs lists the subfolders of dir named like a full version
// ("v22.19.0", "22.19.0", Homebrew's "22.1.0_1") whose sub folder holds a
// node executable. Aliases such as mise's "20" or "latest" are skipped.
func versionDirs(e Env, dir, sub string) []found {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []found
	for _, entry := range entries {
		version, ok := ParseVersion(entry.Name())
		if !ok || entry.Type()&os.ModeSymlink != 0 {
			continue
		}
		bin := filepath.Join(dir, entry.Name(), sub)
		if isFile(filepath.Join(bin, e.nodeExe())) {
			out = append(out, found{version, filepath.Clean(bin)})
		}
	}
	return out
}

func isFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

// scanned is the result of one discovery pass.
type scanned struct {
	managers []domain.NodeManager
	installs []install
}

// install is a domain.NodeInstall with its parsed version.
type install struct {
	domain.NodeInstall
	version Version
}

// discover finds every Node.js version the known managers have installed.
func discover(e Env) scanned {
	result := scanned{managers: []domain.NodeManager{}}
	seenRoot := map[string]bool{}
	seenBin := map[string]bool{}
	for _, m := range managers() {
		for _, root := range m.roots(e) {
			if root == "" || !filepath.IsAbs(root) {
				continue
			}
			key := filepath.Clean(root)
			if real, err := filepath.EvalSymlinks(key); err == nil {
				key = real
			}
			if seenRoot[key] {
				continue
			}
			seenRoot[key] = true
			versions := m.versions(e, root)
			if len(versions) == 0 {
				continue
			}
			count := 0
			for _, f := range versions {
				if seenBin[f.binDir] {
					continue
				}
				seenBin[f.binDir] = true
				count++
				result.installs = append(result.installs, install{
					NodeInstall: domain.NodeInstall{Version: f.version.String(), Manager: m.id, BinDir: f.binDir},
					version:     f.version,
				})
			}
			result.managers = append(result.managers, domain.NodeManager{ID: m.id, Name: m.name, Root: root, Versions: count})
		}
	}
	sortInstalls(result.installs)
	return result
}

// sortInstalls orders newest first, then by manager preference.
func sortInstalls(installs []install) {
	sort.SliceStable(installs, func(i, j int) bool {
		if d := installs[i].version.Compare(installs[j].version); d != 0 {
			return d > 0
		}
		return managerRank(installs[i].Manager) < managerRank(installs[j].Manager)
	})
}
