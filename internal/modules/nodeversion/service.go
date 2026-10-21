// Package nodeversion finds the Node.js versions installed by version
// managers (nvm, fnm, Volta, asdf, mise, n, nodenv, nvs, Homebrew) and
// decides which one each repository's commands run with (ADR-0031).
//
// Installed versions are found by reading the managers' folders; the only
// thing executed is `node --version` of the shell's default node, when its
// version cannot be told from its location.
package nodeversion

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/example/repodock/internal/domain"
)

// probeTimeout bounds `node --version` of the default node.
const probeTimeout = 3 * time.Second

// Options are the machine facts the service depends on; tests replace them.
type Options struct {
	Env Env
	// SearchPath returns the PATH commands run with (the user's shell PATH).
	SearchPath func() string
	// FindExecutable looks a command up in a PATH-style list; "" = missing.
	FindExecutable func(name, pathList string) string
	// Probe returns the output of `<node> --version`.
	Probe func(node, pathList string) (string, error)
	Now   func() time.Time
}

// DefaultOptions describe this machine.
func DefaultOptions(searchPath func() string, findExecutable func(name, pathList string) string) Options {
	home, _ := os.UserHomeDir()
	return Options{
		Env:            Env{Home: home, Getenv: os.Getenv, GOOS: runtime.GOOS},
		SearchPath:     searchPath,
		FindExecutable: findExecutable,
		Probe:          probe,
		Now:            time.Now,
	}
}

type Service struct {
	opts Options

	mu    sync.Mutex
	ready bool
	state state
}

// state is one scan: every install, newest first, and the default one.
type state struct {
	managers  []domain.NodeManager
	installs  []install
	defaultAt int // index into installs; -1 when no node was found
	scannedAt time.Time
}

func New(opts Options) *Service { return &Service{opts: opts} }

// Warm scans once if nothing was scanned yet, so the first request does not
// wait for it.
func (s *Service) Warm() { s.current() }

// Rescan looks for installed versions again.
func (s *Service) Rescan() {
	next := s.scan()
	s.mu.Lock()
	s.state, s.ready = next, true
	s.mu.Unlock()
}

// current returns the last scan, scanning first if there was none.
func (s *Service) current() state {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.ready {
		s.state, s.ready = s.scan(), true
	}
	return s.state
}

func (s *Service) scan() state {
	found := discover(s.opts.Env)
	st := state{managers: found.managers, installs: found.installs, defaultAt: -1, scannedAt: s.opts.Now().UTC()}
	s.findDefault(&st)
	sortInstalls(st.installs)
	for i := range st.installs {
		if st.installs[i].Default {
			st.defaultAt = i
		}
		st.installs[i].EOL = IsEOL(st.installs[i].version.Major, s.opts.Now())
	}
	return st
}

// findDefault marks the node the shell finds first on its PATH. A node
// that belongs to a discovered install is that install; any other one
// (a system install, a shim) is asked for its version.
func (s *Service) findDefault(st *state) {
	if s.opts.SearchPath == nil || s.opts.FindExecutable == nil {
		return
	}
	pathList := s.opts.SearchPath()
	node := s.opts.FindExecutable("node", pathList)
	if node == "" {
		return
	}
	real := realPath(node)
	for i := range st.installs {
		if realPath(filepath.Join(st.installs[i].BinDir, s.opts.Env.nodeExe())) == real {
			st.installs[i].Default = true
			return
		}
	}
	if s.opts.Probe == nil {
		return
	}
	out, err := s.opts.Probe(node, pathList)
	if err != nil {
		return
	}
	version, ok := ParseVersion(strings.TrimSpace(out))
	if !ok {
		return
	}
	bin := filepath.Dir(node)
	st.installs = append(st.installs, install{
		NodeInstall: domain.NodeInstall{Version: version.String(), Manager: s.guessManager(bin), BinDir: bin, Default: true},
		version:     version,
	})
}

// guessManager names the owner of a node that is not a discovered install.
func (s *Service) guessManager(bin string) string {
	clean := filepath.ToSlash(bin)
	switch {
	case strings.Contains(clean, "/.volta/"):
		return "volta"
	case strings.Contains(clean, "/.asdf/"):
		return "asdf"
	case strings.Contains(clean, "/mise/"):
		return "mise"
	case strings.Contains(clean, "/.nodenv/"):
		return "nodenv"
	case strings.HasPrefix(clean, "/opt/homebrew/"), strings.HasPrefix(clean, "/home/linuxbrew/"):
		return "homebrew"
	}
	return "system"
}

func realPath(path string) string {
	if real, err := filepath.EvalSymlinks(path); err == nil {
		return real
	}
	return filepath.Clean(path)
}

// probe runs `<node> --version` from the home folder so no project
// configuration influences it.
func probe(node, pathList string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), probeTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, node, "--version")
	cmd.Dir, _ = os.UserHomeDir()
	cmd.Env = append(os.Environ(), "PATH="+pathList)
	cmd.WaitDelay = time.Second
	out, err := cmd.Output()
	return string(out), err
}

// Installed reports whether exactly this version is installed.
func (s *Service) Installed(version string) bool {
	v, ok := ParseVersion(version)
	if !ok {
		return false
	}
	for _, in := range s.current().installs {
		if in.version == v {
			return true
		}
	}
	return false
}

// Overview lists the installs and every repository's status.
func (s *Service) Overview(repos []domain.Repository) domain.NodeOverview {
	st := s.current()
	out := domain.NodeOverview{
		Managers:     append([]domain.NodeManager{}, st.managers...),
		Installs:     make([]domain.NodeInstall, 0, len(st.installs)),
		Repositories: make([]domain.NodeStatus, 0, len(repos)),
		ScannedAt:    st.scannedAt,
	}
	for _, in := range st.installs {
		out.Installs = append(out.Installs, in.NodeInstall)
	}
	if st.defaultAt >= 0 {
		out.Default = st.installs[st.defaultAt].Version
	}
	for _, repo := range repos {
		status, _ := resolve(st, repo)
		out.Repositories = append(out.Repositories, status)
	}
	return out
}

// Resolve returns a repository's status and the folder to put first on
// PATH for its commands ("" when no node was found).
func (s *Service) Resolve(repo domain.Repository) (domain.NodeStatus, string) {
	return resolve(s.current(), repo)
}

// resolve applies the order: the user's choice, then what the repository
// asks for, then the shell's default. A choice or request that is not
// installed is reported as Missing and the next one is used.
func resolve(st state, repo domain.Repository) (domain.NodeStatus, string) {
	status := domain.NodeStatus{RepositoryID: repo.ID}
	chosen, source := -1, ""
	if selected := strings.TrimSpace(repo.NodeVersion); selected != "" {
		if i := exact(st, selected); i >= 0 {
			chosen, source = i, "selected"
		} else {
			status.Missing = selected
		}
	}
	if chosen < 0 && repo.NodeRequest.Spec != "" {
		if i := match(st, repo.NodeRequest.Spec); i >= 0 {
			chosen, source = i, "request"
		} else if status.Missing == "" {
			status.Missing = repo.NodeRequest.Spec
		}
	}
	if chosen < 0 && st.defaultAt >= 0 {
		chosen, source = st.defaultAt, "default"
	}
	if chosen < 0 {
		return status, ""
	}
	in := st.installs[chosen]
	status.Version, status.Manager, status.Source, status.EOL = in.Version, in.Manager, source, in.EOL
	if engines := repo.NodeRequest.Engines; engines != "" {
		if r, ok := ParseRange(engines); ok && !r.Contains(in.version) {
			status.EnginesMismatch = true
		}
	}
	if newest := st.installs[0]; newest.version.Major > in.version.Major {
		status.Newer = newest.Version
	}
	return status, in.BinDir
}

func exact(st state, version string) int {
	v, ok := ParseVersion(version)
	if !ok {
		return -1
	}
	for i, in := range st.installs {
		if in.version == v {
			return i
		}
	}
	return -1
}

// match finds the newest install a version request accepts: an alias
// ("node", "lts/*", "lts/iron", "system"), a version prefix ("20",
// "v20.11") or a range (">=18"). It returns -1 when nothing matches.
func match(st state, spec string) int {
	spec = strings.ToLower(strings.TrimSpace(spec))
	newest := func(accept func(Version) bool) int {
		for i, in := range st.installs {
			if accept(in.version) {
				return i
			}
		}
		return -1
	}
	switch spec {
	case "system", "default":
		return st.defaultAt
	case "node", "stable", "latest", "current", "*":
		return newest(func(Version) bool { return true })
	case "lts", "lts/*", "lts/latest", "lts-latest":
		return newest(func(v Version) bool { return isLTSLine(v.Major) })
	}
	if name, ok := strings.CutPrefix(spec, "lts/"); ok {
		major, known := ltsCodenames[name]
		if !known {
			return -1
		}
		return newest(func(v Version) bool { return v.Major == major })
	}
	r, ok := ParseRange(spec)
	if !ok {
		return -1
	}
	return newest(r.Contains)
}
