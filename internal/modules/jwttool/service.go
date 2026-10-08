// Package jwttool generates and decodes JWTs for testing (the "JWT tool"
// mini app, ADR-0020) and remembers its input in a local settings file.
// Settings contain signing keys, so the file is written 0600 and its content
// is never logged.
package jwttool

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"

	"github.com/example/repodock/internal/domain"
)

// Defaults leave every claim empty except the device ID, a typical browser
// user agent.
func Defaults() domain.JWTSettings {
	return domain.JWTSettings{
		Algorithm:     AlgRS256,
		ExpiresInDays: 7,
		DeviceID:      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36",
		Roles:         []string{},
		SelectedRoles: []string{},
	}
}

type Service struct {
	path string
	mu   sync.Mutex
}

// New stores settings at path (normally next to the workspace file).
func New(path string) *Service { return &Service{path: path} }

// Settings returns the remembered input, or defaults when nothing is saved.
func (s *Service) Settings() (domain.JWTSettings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return Defaults(), nil
	}
	if err != nil {
		return Defaults(), fmt.Errorf("read JWT tool settings: %w", err)
	}
	settings := Defaults()
	if err := json.Unmarshal(data, &settings); err != nil {
		return Defaults(), fmt.Errorf("JWT tool settings are corrupt: %w", err)
	}
	return Normalize(settings), nil
}

// Save normalizes and persists settings, returning what was stored.
func (s *Service) Save(settings domain.JWTSettings) (domain.JWTSettings, error) {
	settings = Normalize(settings)
	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return settings, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return settings, fmt.Errorf("create settings folder: %w", err)
	}
	return settings, writeFileAtomic(s.path, data)
}

// Normalize trims roles, drops empty and duplicate ones, and keeps only
// selected roles that exist, in catalogue order.
func Normalize(settings domain.JWTSettings) domain.JWTSettings {
	roles := make([]string, 0, len(settings.Roles))
	for _, role := range settings.Roles {
		role = strings.TrimSpace(role)
		if role != "" && !slices.Contains(roles, role) {
			roles = append(roles, role)
		}
	}
	selected := make([]string, 0, len(settings.SelectedRoles))
	for _, role := range roles {
		if slices.Contains(settings.SelectedRoles, role) {
			selected = append(selected, role)
		}
	}
	settings.Roles, settings.SelectedRoles = roles, selected
	if settings.Algorithm != AlgHS256 {
		settings.Algorithm = AlgRS256
	}
	return settings
}

func writeFileAtomic(path string, data []byte) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".tmp-*")
	if err != nil {
		return fmt.Errorf("create temp settings: %w", err)
	}
	name := tmp.Name()
	defer func() { _ = os.Remove(name) }()
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("protect settings: %w", err)
	}
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write settings: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close settings: %w", err)
	}
	if err := os.Rename(name, path); err != nil {
		return fmt.Errorf("replace settings: %w", err)
	}
	return nil
}
