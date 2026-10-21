package app

import (
	"fmt"
	"strings"

	"github.com/example/repodock/internal/domain"
	processmod "github.com/example/repodock/internal/modules/process"
	repomod "github.com/example/repodock/internal/modules/repository"
)

// NodeVersions lists the installed Node.js versions and the version every
// repository's commands run with (ADR-0031).
func (a *App) NodeVersions() domain.NodeOverview {
	return a.node.Overview(a.workspace.Snapshot().Repositories)
}

// RescanNodeVersions looks for installed Node.js versions again, e.g.
// after one was installed or removed.
func (a *App) RescanNodeVersions() domain.NodeOverview {
	a.node.Rescan()
	return a.NodeVersions()
}

// SetRepositoryNodeVersion chooses the Node.js version a repository's
// commands run with. The version must be installed; "" returns to
// automatic (version file, else the shell's default).
func (a *App) SetRepositoryNodeVersion(repoID string, version string) error {
	version = strings.TrimPrefix(strings.TrimSpace(version), "v")
	if version != "" && !a.node.Installed(version) {
		return fmt.Errorf("Node.js %s is not installed", version)
	}
	if _, err := a.workspace.MutateRepository(repoID, func(repo *domain.Repository) { repo.NodeVersion = version }); err != nil {
		return err
	}
	return a.persist()
}

// RunTask runs a monorepo task (`turbo run <task>`, `nx run-many -t
// <task>`) through the repository's package manager. The task must be one
// discovered in the repository's task-runner configuration (ADR-0032).
func (a *App) RunTask(repoID string, tool string, task string, label string) (domain.Run, error) {
	repo, err := a.repository(repoID)
	if err != nil {
		return domain.Run{}, err
	}
	found, ok := repomod.HasTask(repo, tool, task)
	if !ok {
		return domain.Run{}, fmt.Errorf("task not found: %s %s", tool, task)
	}
	argv, err := repomod.TaskArgv(repo.PackageManager, found)
	if err != nil {
		return domain.Run{}, err
	}
	if strings.TrimSpace(label) == "" {
		label = tool + " " + task
	}
	spec := a.runSpec(repo, label)
	spec.Argv = viaCorepack(argv, spec.PathPrefix)
	return a.process.Start(spec)
}

// runSpec is the base of every run in a repository: its folder, and its
// Node.js version first on PATH, so what the header shows is what runs.
func (a *App) runSpec(repo domain.Repository, label string) processmod.Spec {
	spec := processmod.Spec{RepositoryID: repo.ID, Workdir: repo.Path, Label: label}
	if _, bin := a.node.Resolve(repo); bin != "" {
		spec.PathPrefix = []string{bin}
	}
	return spec
}

// viaCorepack runs a pnpm or Yarn invocation through `corepack` when that
// package manager is not installed but Corepack (bundled with Node.js
// 16.9–24) is; Corepack fetches the version the repository pins and asks
// before downloading (ADR-0032).
func viaCorepack(argv []string, pathPrefix []string) []string {
	if len(argv) == 0 || (argv[0] != "pnpm" && argv[0] != "yarn") {
		return argv
	}
	if processmod.FindExecutable(argv[0], pathPrefix) != "" || processmod.FindExecutable("corepack", pathPrefix) == "" {
		return argv
	}
	return append([]string{"corepack"}, argv...)
}
