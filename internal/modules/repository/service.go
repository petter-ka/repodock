// Package repository inspects local repository folders. It parses
// package.json as data and never executes anything during discovery.
package repository

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/example/repodock/internal/domain"
)

// maxPackageJSONSize bounds how much of a package.json is read.
const maxPackageJSONSize = 4 << 20

var supportedManagers = map[string]bool{"npm": true, "pnpm": true, "yarn": true, "bun": true}

// ErrNoPackageJSON is returned when the folder has no package.json.
var ErrNoPackageJSON = errors.New("package.json not found")

// ErrFolderNotFound is returned when the repository folder does not exist.
var ErrFolderNotFound = errors.New("folder not found")

// Metadata is everything discovery learns about a repository folder.
type Metadata struct {
	Path           string
	Name           string
	PackageManager string
	Scripts        []domain.Script
	// Dependencies and DevDependencies count the package.json entries.
	Dependencies    int
	DevDependencies int
	// Stack lists well-known frameworks and tools among the dependencies.
	Stack []string
}

type Service struct{}

func New() *Service { return &Service{} }

// ResolvePath validates that path is an existing directory and returns its
// absolute, cleaned form.
func (s *Service) ResolvePath(path string) (string, error) {
	if strings.TrimSpace(path) == "" {
		return "", fmt.Errorf("repository path is empty")
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("resolve repository path: %w", err)
	}
	info, err := os.Stat(abs)
	if errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("%w: %s", ErrFolderNotFound, abs)
	}
	if err != nil {
		return "", fmt.Errorf("repository folder %s: %w", abs, err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("%s is not a folder", abs)
	}
	return filepath.Clean(abs), nil
}

// Inspect reads package.json in the given folder.
func (s *Service) Inspect(path string) (Metadata, error) {
	abs, err := s.ResolvePath(path)
	if err != nil {
		return Metadata{}, err
	}
	meta := Metadata{Path: abs, Name: filepath.Base(abs), Scripts: []domain.Script{}, Stack: []string{}}

	file, err := os.Open(filepath.Join(abs, "package.json"))
	if errors.Is(err, os.ErrNotExist) {
		return meta, ErrNoPackageJSON
	}
	if err != nil {
		return meta, fmt.Errorf("open package.json: %w", err)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxPackageJSONSize+1))
	if err != nil {
		return meta, fmt.Errorf("read package.json: %w", err)
	}
	if len(data) > maxPackageJSONSize {
		return meta, fmt.Errorf("package.json is larger than %d bytes", maxPackageJSONSize)
	}

	pkg, err := parsePackageJSON(data)
	if err != nil {
		return meta, err
	}
	if name := strings.TrimSpace(pkg.Name); name != "" {
		meta.Name = name
	}
	meta.Scripts = pkg.Scripts
	meta.Dependencies = len(pkg.Dependencies)
	meta.DevDependencies = len(pkg.DevDependencies)
	meta.Stack = DetectStack(pkg.Dependencies, pkg.DevDependencies)
	meta.PackageManager = DetectPackageManager(abs, pkg.PackageManager)
	return meta, nil
}

type packageJSON struct {
	Name            string
	PackageManager  string
	Scripts         []domain.Script
	Dependencies    map[string]any
	DevDependencies map[string]any
}

// parsePackageJSON decodes the fields RepoDock needs while preserving the
// declaration order of "scripts", which encoding/json maps would lose.
func parsePackageJSON(data []byte) (packageJSON, error) {
	var out packageJSON
	var shape struct {
		Name           any             `json:"name"`
		PackageManager any             `json:"packageManager"`
		Scripts        json.RawMessage `json:"scripts"`
		// Malformed dependency maps are ignored rather than failing discovery.
		Dependencies    any `json:"dependencies"`
		DevDependencies any `json:"devDependencies"`
	}
	if err := json.Unmarshal(data, &shape); err != nil {
		return out, fmt.Errorf("invalid package.json: %w", err)
	}
	out.Dependencies, _ = shape.Dependencies.(map[string]any)
	out.DevDependencies, _ = shape.DevDependencies.(map[string]any)
	out.Name, _ = shape.Name.(string)
	out.PackageManager, _ = shape.PackageManager.(string)
	out.Scripts = []domain.Script{}

	raw := bytes.TrimSpace(shape.Scripts)
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return out, nil
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	tok, err := dec.Token()
	if err != nil {
		return out, fmt.Errorf("invalid package.json scripts: %w", err)
	}
	if delim, ok := tok.(json.Delim); !ok || delim != '{' {
		return out, fmt.Errorf("invalid package.json: \"scripts\" must be an object")
	}
	seen := map[string]int{}
	for dec.More() {
		keyTok, err := dec.Token()
		if err != nil {
			return out, fmt.Errorf("invalid package.json scripts: %w", err)
		}
		key, _ := keyTok.(string)
		var value any
		if err := dec.Decode(&value); err != nil {
			return out, fmt.Errorf("invalid package.json script %q: %w", key, err)
		}
		command, ok := value.(string)
		if !ok {
			// Non-string entries are not runnable scripts; skip them.
			continue
		}
		// Later duplicates win, matching JSON.parse in Node, but keep the
		// first position.
		if i, dup := seen[key]; dup {
			out.Scripts[i].Command = command
			continue
		}
		seen[key] = len(out.Scripts)
		out.Scripts = append(out.Scripts, domain.Script{Name: key, Command: command})
	}
	return out, nil
}

// stackMarkers maps a dependency name to the framework or tool it reveals,
// in display order.
var stackMarkers = []struct{ pkg, label string }{
	{"next", "Next.js"},
	{"nuxt", "Nuxt"},
	{"@remix-run/react", "Remix"},
	{"@sveltejs/kit", "SvelteKit"},
	{"astro", "Astro"},
	{"@angular/core", "Angular"},
	{"react-native", "React Native"},
	{"react", "React"},
	{"vue", "Vue"},
	{"svelte", "Svelte"},
	{"solid-js", "Solid"},
	{"@nestjs/core", "NestJS"},
	{"express", "Express"},
	{"fastify", "Fastify"},
	{"hono", "Hono"},
	{"electron", "Electron"},
	{"vite", "Vite"},
	{"typescript", "TypeScript"},
}

// DetectStack names the well-known frameworks and tools found among the
// dependencies. A meta-framework hides the library it is built on (Next.js
// implies React), so the list stays short.
func DetectStack(deps, devDeps map[string]any) []string {
	has := func(name string) bool {
		_, a := deps[name]
		_, b := devDeps[name]
		return a || b
	}
	implied := map[string]string{"Next.js": "React", "Remix": "React", "React Native": "React", "Nuxt": "Vue", "SvelteKit": "Svelte"}
	hidden := map[string]bool{}
	for _, m := range stackMarkers {
		if has(m.pkg) && implied[m.label] != "" {
			hidden[implied[m.label]] = true
		}
	}
	stack := []string{}
	for _, m := range stackMarkers {
		if has(m.pkg) && !hidden[m.label] {
			stack = append(stack, m.label)
		}
	}
	return stack
}

// DetectPackageManager uses the packageManager field, then lockfile hints,
// then falls back to npm.
func DetectPackageManager(repoPath, packageManager string) string {
	if packageManager != "" {
		name := strings.ToLower(strings.TrimSpace(strings.SplitN(packageManager, "@", 2)[0]))
		if supportedManagers[name] {
			return name
		}
	}
	checks := []struct {
		file string
		name string
	}{
		{"pnpm-lock.yaml", "pnpm"},
		{"yarn.lock", "yarn"},
		{"bun.lockb", "bun"},
		{"bun.lock", "bun"},
		{"package-lock.json", "npm"},
		{"npm-shrinkwrap.json", "npm"},
	}
	for _, c := range checks {
		if _, err := os.Stat(filepath.Join(repoPath, c.file)); err == nil {
			return c.name
		}
	}
	return "npm"
}

// ScriptArgv returns the package-manager invocation for a script as an
// argument vector. Callers must hand it to the process layer as argv, never
// concatenate it into shell text.
func ScriptArgv(packageManager, scriptName string) []string {
	pm := packageManager
	if !supportedManagers[pm] {
		pm = "npm"
	}
	return []string{pm, "run", scriptName}
}

// HasScript reports whether the repository declares the named script.
func HasScript(repo domain.Repository, name string) bool {
	for _, script := range repo.Scripts {
		if script.Name == name {
			return true
		}
	}
	return false
}
