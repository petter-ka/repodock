// Package environment discovers, reads and writes local dotenv files
// (ADR-0005). File contents must never be logged.
package environment

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/example/repodock/internal/domain"
)

// MaxFileSize bounds env files RepoDock will open or write.
const MaxFileSize = 1 << 20

// Candidates lists supported env file names in display order.
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

var allowed = func() map[string]bool {
	m := make(map[string]bool, len(Candidates))
	for _, name := range Candidates {
		m[name] = true
	}
	return m
}()

type Service struct{}

func New() *Service { return &Service{} }

// Names returns the candidate files that exist in repoPath.
func (s *Service) Names(repoPath string) []string {
	out := make([]string, 0, len(Candidates))
	for _, name := range Candidates {
		if info, err := os.Stat(filepath.Join(repoPath, name)); err == nil && info.Mode().IsRegular() {
			out = append(out, name)
		}
	}
	return out
}

// List returns metadata (without content) for existing candidate files.
func (s *Service) List(repoPath string) []domain.EnvFile {
	out := make([]domain.EnvFile, 0, len(Candidates))
	for _, name := range s.Names(repoPath) {
		path := filepath.Join(repoPath, name)
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

// resolve validates name against the allow-list, which also rules out path
// separators and traversal.
func resolve(repoPath, name string) (string, error) {
	if !allowed[name] {
		return "", fmt.Errorf("unsupported env file: %q", name)
	}
	if repoPath == "" {
		return "", fmt.Errorf("repository path is empty")
	}
	return filepath.Join(repoPath, name), nil
}
