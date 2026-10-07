package app

import (
	"fmt"
	"strings"

	"github.com/example/repodock/internal/domain"
)

// CheckRepositoryFolder reports whether path can be used as a repository
// folder: it must exist and contain a readable package.json. It never
// changes anything and never returns an error; problems are in the result.
func (a *App) CheckRepositoryFolder(path string) domain.FolderCheck {
	check := domain.FolderCheck{Path: strings.TrimSpace(path)}
	abs, err := a.repo.ResolvePath(path)
	if err != nil {
		check.Problem = err.Error()
		return check
	}
	check.Path, check.Exists = abs, true
	if meta, err := a.repo.Inspect(abs); err != nil {
		check.Problem = err.Error()
	} else {
		check.Valid, check.Name = true, meta.Name
	}
	if existing, ok := a.workspace.RepositoryByPath(abs); ok {
		check.RegisteredID, check.RegisteredName = existing.ID, existing.Name
	}
	return check
}

// RelocateRepository points an existing repository record at a different
// folder (e.g. after an import from another machine, or after moving the
// checkout). ID, group and command sequence are kept; metadata is refreshed.
func (a *App) RelocateRepository(id string, path string) (domain.Repository, error) {
	if _, err := a.repository(id); err != nil {
		return domain.Repository{}, err
	}
	check := a.CheckRepositoryFolder(path)
	if !check.Valid {
		return domain.Repository{}, fmt.Errorf("cannot use %s: %s", check.Path, check.Problem)
	}
	if check.RegisteredID != "" && check.RegisteredID != id {
		return domain.Repository{}, fmt.Errorf("%s is already registered as %q", check.Path, check.RegisteredName)
	}
	for _, run := range a.process.ActiveRuns() {
		if run.RepositoryID == id {
			return domain.Repository{}, fmt.Errorf("stop the repository's running processes before changing its folder")
		}
	}
	if _, err := a.workspace.MutateRepository(id, func(repo *domain.Repository) { repo.Path = check.Path }); err != nil {
		return domain.Repository{}, err
	}
	repo, err := a.refresh(id)
	if err != nil {
		return domain.Repository{}, err
	}
	return repo, a.persist()
}

// validateOverrides rejects import path overrides that do not point at a
// usable repository folder, so a typo cannot silently add a broken record.
func (a *App) validateOverrides(overrides map[string]string) error {
	for from, to := range overrides {
		if strings.TrimSpace(to) == "" {
			continue
		}
		if check := a.CheckRepositoryFolder(to); !check.Valid {
			return fmt.Errorf("replacement folder for %s: %s", from, check.Problem)
		}
	}
	return nil
}
