// Package environment discovers, reads and writes local dotenv files
// (ADR-0005, ADR-0033). File contents must never be logged.
package environment

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"github.com/example/repodock/internal/domain"
)

// MaxFileSize bounds env files RepoDock will open or write.
const MaxFileSize = 1 << 20

// Discovery limits keep a scan of a huge repository bounded.
const (
	// MaxDepth is how many folders below the repository root are searched.
	MaxDepth = 5
	// MaxFiles bounds how many env files one repository lists.
	MaxFiles = 200
	// maxEntries bounds the directory entries one scan visits.
	maxEntries = 50_000
)

// Candidates are the well-known env file names. Within a folder they are
// listed first, in this order; other env files follow by name.
var Candidates = []string{
	".env",
	".env.local",
	".env.development",
	".env.development.local",
	".env.test",
	".env.test.local",
	".env.production",
	".env.production.local",
}

var rank = func() map[string]int {
	m := make(map[string]int, len(Candidates))
	for i, name := range Candidates {
		m[name] = i
	}
	return m
}()

// skipDirs are dependency, build and cache folders. Hidden folders are
// skipped too, except allowedHidden.
var skipDirs = map[string]bool{
	"node_modules": true, "bower_components": true, "jspm_packages": true, "vendor": true,
	"dist": true, "build": true, "out": true, "coverage": true, "target": true,
	"venv": true, "__pycache__": true,
}

var allowedHidden = map[string]bool{".devcontainer": true, ".docker": true}

// skipDir reports whether discovery leaves a folder out.
func skipDir(name string) bool {
	if strings.HasPrefix(name, ".") {
		return !allowedHidden[name]
	}
	return skipDirs[name]
}

// IsEnvFileName reports whether a file name is a dotenv file: ".env",
// ".env.<anything>" (".env.staging", ".env.example") or "<name>.env"
// ("docker.env"). Editor swap files and RepoDock's temp files are not.
func IsEnvFileName(name string) bool {
	if name == ".env" {
		return true
	}
	if !strings.HasPrefix(name, ".env.") && !(strings.HasSuffix(name, ".env") && len(name) > len(".env")) {
		return false
	}
	if strings.Contains(name, ".repodock-") || strings.HasSuffix(name, "~") {
		return false
	}
	for _, suffix := range []string{".swp", ".swo", ".swx", ".tmp"} {
		if strings.HasSuffix(name, suffix) {
			return false
		}
	}
	return true
}

type Service struct{}

func New() *Service { return &Service{} }

// Names returns the env files under repoPath as slash-separated paths
// relative to it ("apps/web/.env.local"): the repository root first, then
// sub-folders in path order. Dependency, build and hidden folders are not
// searched, nor anything deeper than MaxDepth; at most MaxFiles are listed.
func (s *Service) Names(repoPath string) []string {
	type hit struct{ dir, name string }
	var hits []hit
	errStop := errors.New("limit reached")
	entries := 0
	_ = filepath.WalkDir(repoPath, func(p string, entry fs.DirEntry, err error) error {
		if err != nil {
			if p == repoPath {
				return err
			}
			if entry != nil && entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		if entries++; entries > maxEntries {
			return errStop
		}
		if p == repoPath {
			return nil
		}
		rel, err := filepath.Rel(repoPath, p)
		if err != nil {
			return nil
		}
		rel = filepath.ToSlash(rel)
		if entry.IsDir() {
			if skipDir(entry.Name()) || strings.Count(rel, "/")+1 > MaxDepth {
				return fs.SkipDir
			}
			return nil
		}
		if !IsEnvFileName(entry.Name()) || !regularFile(p, entry) {
			return nil
		}
		hits = append(hits, hit{dir: path.Dir(rel), name: entry.Name()})
		if len(hits) >= MaxFiles {
			return errStop
		}
		return nil
	})
	sort.Slice(hits, func(i, j int) bool {
		a, b := hits[i], hits[j]
		if a.dir != b.dir {
			if a.dir == "." || b.dir == "." {
				return a.dir == "."
			}
			return a.dir < b.dir
		}
		ra, okA := rank[a.name]
		rb, okB := rank[b.name]
		switch {
		case okA && okB:
			return ra < rb
		case okA != okB:
			return okA
		}
		return a.name < b.name
	})
	out := make([]string, 0, len(hits))
	for _, h := range hits {
		out = append(out, path.Join(h.dir, h.name))
	}
	return out
}

// regularFile accepts regular files and symlinks to them.
func regularFile(p string, entry fs.DirEntry) bool {
	if entry.Type().IsRegular() {
		return true
	}
	if entry.Type()&fs.ModeSymlink == 0 {
		return false
	}
	info, err := os.Stat(p)
	return err == nil && info.Mode().IsRegular()
}

// List returns metadata (without content) for the discovered env files.
func (s *Service) List(repoPath string) []domain.EnvFile {
	names := s.Names(repoPath)
	out := make([]domain.EnvFile, 0, len(names))
	for _, name := range names {
		path := filepath.Join(repoPath, filepath.FromSlash(name))
		info, err := os.Stat(path)
		if err != nil {
			continue
		}
		out = append(out, domain.EnvFile{Name: name, Path: path, Size: info.Size(), ModifiedAt: info.ModTime().UTC()})
	}
	return out
}

func (s *Service) Read(repoPath, name string) (domain.EnvFile, error) {
	path, err := resolve(repoPath, name)
	if err != nil {
		return domain.EnvFile{}, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return domain.EnvFile{}, fmt.Errorf("stat %s: %w", name, err)
	}
	if !info.Mode().IsRegular() {
		return domain.EnvFile{}, fmt.Errorf("%s is not a regular file", name)
	}
	if info.Size() > MaxFileSize {
		return domain.EnvFile{}, fmt.Errorf("%s is larger than %d bytes", name, MaxFileSize)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return domain.EnvFile{}, fmt.Errorf("read %s: %w", name, err)
	}
	return domain.EnvFile{Name: name, Path: path, Content: string(data), Size: info.Size(), ModifiedAt: info.ModTime().UTC()}, nil
}

// Save overwrites an existing, discovered env file with content exactly as
// given (no re-serialization). The write is atomic: a temp file in the same
// directory is synced and renamed over the target. Symlinked env files are
// written through to their target so the link is preserved.
func (s *Service) Save(repoPath, name, content string) error {
	path, err := resolve(repoPath, name)
	if err != nil {
		return err
	}
	if len(content) > MaxFileSize {
		return fmt.Errorf("content is larger than %d bytes", MaxFileSize)
	}
	if bytes.IndexByte([]byte(content), 0) >= 0 {
		return fmt.Errorf("content contains NUL bytes; refusing to write a binary file")
	}

	target, err := filepath.EvalSymlinks(path)
	if errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("%s no longer exists; refresh the repository", name)
	}
	if err != nil {
		return fmt.Errorf("resolve %s: %w", name, err)
	}
	info, err := os.Stat(target)
	if err != nil {
		return fmt.Errorf("stat %s: %w", name, err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("%s is not a regular file", name)
	}

	tmp, err := os.CreateTemp(filepath.Dir(target), "."+filepath.Base(target)+".repodock-*")
	if err != nil {
		return fmt.Errorf("create temp file for %s: %w", name, err)
	}
	tmpName := tmp.Name()
	fail := func(step string, cause error) error {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return fmt.Errorf("%s %s: %w", step, name, cause)
	}
	if _, err := tmp.WriteString(content); err != nil {
		return fail("write", err)
	}
	if err := tmp.Sync(); err != nil {
		return fail("sync", err)
	}
	if err := tmp.Close(); err != nil {
		return fail("close", err)
	}
	_ = os.Chmod(tmpName, info.Mode().Perm())
	if err := os.Rename(tmpName, target); err != nil {
		_ = os.Remove(tmpName)
		return fmt.Errorf("replace %s: %w", name, err)
	}
	return nil
}

// ValidName reports whether name is a path discovery could have produced:
// relative, clean, slash-separated, an env file name, not deeper than
// MaxDepth and not inside a skipped (or "..") folder.
func ValidName(name string) bool {
	if name == "" || strings.ContainsAny(name, "\\\x00") || path.Clean(name) != name || path.IsAbs(name) {
		return false
	}
	if !filepath.IsLocal(filepath.FromSlash(name)) {
		return false
	}
	parts := strings.Split(name, "/")
	if len(parts)-1 > MaxDepth {
		return false
	}
	for _, dir := range parts[:len(parts)-1] {
		if skipDir(dir) {
			return false
		}
	}
	return IsEnvFileName(parts[len(parts)-1])
}

// resolve validates name and returns its absolute path. A file in a
// sub-folder must stay inside the repository even when a folder on the way
// is a symlink.
func resolve(repoPath, name string) (string, error) {
	if repoPath == "" {
		return "", fmt.Errorf("repository path is empty")
	}
	if !ValidName(name) {
		return "", fmt.Errorf("unsupported env file: %q", name)
	}
	full := filepath.Join(repoPath, filepath.FromSlash(name))
	if strings.Contains(name, "/") {
		root, err := filepath.EvalSymlinks(repoPath)
		if err != nil {
			return "", fmt.Errorf("resolve repository folder: %w", err)
		}
		dir, err := filepath.EvalSymlinks(filepath.Dir(full))
		if err != nil {
			return "", fmt.Errorf("%s no longer exists; refresh the repository", name)
		}
		if rel, err := filepath.Rel(root, dir); err != nil || !filepath.IsLocal(rel) {
			return "", fmt.Errorf("%s is outside the repository", name)
		}
	}
	return full, nil
}
