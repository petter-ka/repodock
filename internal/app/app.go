// Package app is the thin Wails binding facade. It composes feature modules
// and exposes a small, stable, user-oriented API to the frontend. Business
// logic belongs in internal/modules.
package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/example/repodock/internal/domain"
	envmod "github.com/example/repodock/internal/modules/environment"
	processmod "github.com/example/repodock/internal/modules/process"
	repomod "github.com/example/repodock/internal/modules/repository"
	seqmod "github.com/example/repodock/internal/modules/sequence"
	workspacemod "github.com/example/repodock/internal/modules/workspace"
	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// EventWorkspaceChanged carries a full Workspace snapshot.
const EventWorkspaceChanged = "workspace:changed"

type App struct {
	ctx context.Context

	workspace *workspacemod.Service
	repo      *repomod.Service
	env       *envmod.Service
	process   *processmod.Manager
	sequence  *seqmod.Runner

	reportMu sync.RWMutex
	report   domain.StartupReport

	shutdownOnce sync.Once
}

func New() *App {
	return NewWith(workspacemod.New(), processmod.DefaultOptions())
}

// NewWith allows tests and tools to supply a workspace location and process
// tuning.
func NewWith(ws *workspacemod.Service, opts processmod.Options) *App {
	a := &App{
		workspace: ws,
		repo:      repomod.New(),
		env:       envmod.New(),
		process:   processmod.New(opts),
	}
	a.sequence = seqmod.New(stepExecutor{a})
	return a
}

// Hooks returns the Wails lifecycle callbacks. They are package-level so they
// are not exposed as frontend bindings.
func Hooks(a *App) (onStartup func(context.Context), onShutdown func(context.Context)) {
	return a.startup, a.shutdown
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	emit := func(event string, payload any) { runtime.EventsEmit(ctx, event, payload) }
	a.process.SetEmitter(emit)
	a.sequence.SetEmitter(emit)
	a.boot()
}

// boot loads persisted state and refreshes repository metadata off the UI
// thread.
func (a *App) boot() {
	report := domain.StartupReport{WorkspacePath: a.workspace.Path(), Warnings: []string{}}
	result, err := a.workspace.Load()
	if err != nil {
		slog.Error("load workspace", "error", err)
		report.Warnings = append(report.Warnings, err.Error())
	}
	report.RecoveredBackup = result.RecoveredBackup
	a.reportMu.Lock()
	a.report = report
	a.reportMu.Unlock()

	go func() {
		a.refreshAll()
		if err := a.persist(); err != nil {
			slog.Error("save workspace after startup refresh", "error", err)
		}
	}()
}

func (a *App) shutdown(_ context.Context) {
	a.shutdownOnce.Do(func() {
		a.process.Shutdown(5 * time.Second)
		if err := a.workspace.Save(); err != nil {
			slog.Error("save workspace on shutdown", "error", err)
		}
	})
}

// ---- Workspace -------------------------------------------------------------

func (a *App) StartupReport() domain.StartupReport {
	a.reportMu.RLock()
	defer a.reportMu.RUnlock()
	report := a.report
	report.Warnings = append([]string{}, report.Warnings...)
	return report
}

func (a *App) Workspace() domain.Workspace { return a.workspace.Snapshot() }

// BrowseRepository opens the native folder picker. An empty path means the
// user cancelled.
func (a *App) BrowseRepository() (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("application is not ready")
	}
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:                "Select repository",
		ShowHiddenFiles:      true,
		CanCreateDirectories: false,
	})
}

// AddRepository registers a folder as a new record. The folder may have a
// package.json or none at all (a plain folder with no scripts). The same
// folder, or a parent/child of a registered one, may be added any number of
// times; each extra record of an already registered folder gets a numbered
// alias so the entries can be told apart (ADR-0015).
func (a *App) AddRepository(path string, groupID string) (domain.Repository, error) {
	abs, err := a.repo.ResolvePath(path)
	if err != nil {
		return domain.Repository{}, err
	}
	meta, err := a.repo.Inspect(abs)
	if err != nil && !errors.Is(err, repomod.ErrNoPackageJSON) {
		return domain.Repository{}, err
	}
	repo := domain.Repository{ID: uuid.NewString(), GroupID: groupID}
	applyMetadata(&repo, meta)
	repo.Alias = a.duplicateAlias(repo)
	repo.EnvFiles = a.env.Names(repo.Path)
	repo.CommandSequence = repomod.DefaultSequence(repo.Scripts)
	repo = a.workspace.UpsertRepository(repo)
	return repo, a.persist()
}

func (a *App) RefreshRepository(id string) (domain.Repository, error) {
	repo, err := a.refresh(id)
	if err != nil {
		return domain.Repository{}, err
	}
	return repo, a.persist()
}

// RefreshAll re-reads metadata for every repository.
func (a *App) RefreshAll() error {
	a.refreshAll()
	return a.persist()
}

// RemoveRepository stops the repository's processes and removes its
// registration. Nothing on disk is touched.
func (a *App) RemoveRepository(id string) error {
	if _, ok := a.workspace.Repository(id); !ok {
		return fmt.Errorf("repository not found: %s", id)
	}
	_ = a.StopRepository(id)
	if err := a.workspace.RemoveRepository(id); err != nil {
		return err
	}
	return a.persist()
}

func (a *App) CreateGroup(name string) (domain.Group, error) {
	g, err := a.workspace.CreateGroup(name)
	if err != nil {
		return domain.Group{}, err
	}
	return g, a.persist()
}

func (a *App) RenameGroup(id string, name string) error {
	if err := a.workspace.RenameGroup(id, name); err != nil {
		return err
	}
	return a.persist()
}

func (a *App) DeleteGroup(id string) error {
	if err := a.workspace.DeleteGroup(id); err != nil {
		return err
	}
	return a.persist()
}

func (a *App) SetGroupCollapsed(id string, collapsed bool) error {
	if err := a.workspace.SetGroupCollapsed(id, collapsed); err != nil {
		return err
	}
	return a.persist()
}

// SetGroupRunMode persists whether "Run group" is sequential or parallel.
func (a *App) SetGroupRunMode(id string, mode string) error {
	if err := a.workspace.SetGroupRunMode(id, domain.GroupRunMode(mode)); err != nil {
		return err
	}
	return a.persist()
}

// SaveQuickCommands replaces a repository's pinned quick commands and
// returns the normalized list.
func (a *App) SaveQuickCommands(repoID string, commands []domain.QuickCommand) ([]domain.QuickCommand, error) {
	saved, err := a.workspace.UpdateQuickCommands(repoID, commands)
	if err != nil {
		return nil, err
	}
	return saved, a.persist()
}

// RenameRepository sets a repository's alias (display name); a blank alias
// restores the discovered name.
func (a *App) RenameRepository(id string, alias string) error {
	if err := a.workspace.RenameRepository(id, alias); err != nil {
		return err
	}
	return a.persist()
}

// MoveGroup places a group at index in the sidebar order (drag and drop).
// The index excludes the moved group itself; a negative index moves it last.
func (a *App) MoveGroup(id string, index int) error {
	if err := a.workspace.MoveGroup(id, index); err != nil {
		return err
	}
	return a.persist()
}

func (a *App) AssignRepository(id string, groupID string) error {
	if err := a.workspace.AssignRepository(id, groupID); err != nil {
		return err
	}
	return a.persist()
}

// MoveRepository places a repository at index within a group (drag and
// drop in the sidebar). The index excludes the moved repository itself; a
// negative index appends.
func (a *App) MoveRepository(id string, groupID string, index int) error {
	if err := a.workspace.MoveRepository(id, groupID, index); err != nil {
		return err
	}
	return a.persist()
}

func (a *App) SaveCommandSequence(repoID string, steps []domain.CommandStep) error {
	if err := a.workspace.UpdateCommandSequence(repoID, steps); err != nil {
		return err
	}
	return a.persist()
}

// SaveGlobalCommands replaces the workspace's reusable global commands and
// returns the normalized list (IDs assigned, text trimmed).
func (a *App) SaveGlobalCommands(commands []domain.GlobalCommand) ([]domain.GlobalCommand, error) {
	saved, err := a.workspace.SaveGlobalCommands(commands)
	if err != nil {
		return nil, err
	}
	return saved, a.persist()
}

// ---- Processes -------------------------------------------------------------

// RunScript runs a package.json script through the repository's package
// manager. The script name is passed as a separate argument, never spliced
// into shell text.
func (a *App) RunScript(repoID string, scriptName string, label string) (domain.Run, error) {
	repo, err := a.repository(repoID)
	if err != nil {
		return domain.Run{}, err
	}
	if !repomod.HasScript(repo, scriptName) {
		return domain.Run{}, fmt.Errorf("script not found: %s", scriptName)
	}
	return a.process.Start(processmod.Spec{
		RepositoryID: repo.ID, Workdir: repo.Path, Label: label,
		Argv: repomod.ScriptArgv(repo.PackageManager, scriptName),
	})
}

// RunCommand runs user-entered shell text in the repository folder. An empty
// command is recorded as a skipped no-op run.
func (a *App) RunCommand(repoID string, command string, label string) (domain.Run, error) {
	repo, err := a.repository(repoID)
	if err != nil {
		return domain.Run{}, err
	}
	return a.process.Start(processmod.Spec{RepositoryID: repo.ID, Workdir: repo.Path, Label: label, Command: command})
}

func (a *App) WaitForRun(runID string) (domain.Run, error) { return a.process.Wait(runID) }

func (a *App) StopProcess(runID string) error { return a.process.Stop(runID) }

// SendInput writes one line to a running process's standard input, e.g. to
// answer a "(y/n)" prompt. Secret input is echoed masked in the console.
func (a *App) SendInput(runID string, text string, secret bool) error {
	return a.process.SendInput(runID, text, secret)
}

// CloseInput closes a running process's standard input (EOF, like Ctrl+D).
func (a *App) CloseInput(runID string) error { return a.process.CloseInput(runID) }

func (a *App) RestartProcess(runID string) (domain.Run, error) {
	run, ok := a.process.Run(runID)
	if !ok {
		return domain.Run{}, fmt.Errorf("run not found: %s", runID)
	}
	if _, err := a.repository(run.RepositoryID); err != nil {
		return domain.Run{}, err
	}
	return a.process.Restart(runID)
}

// StopRepository cancels the repository's sequence and stops all its runs.
func (a *App) StopRepository(repoID string) error {
	return errors.Join(a.sequence.CancelRepository(repoID), a.process.StopRepository(repoID))
}

func (a *App) ActiveRuns() []domain.Run { return a.process.ActiveRuns() }

func (a *App) Runs() []domain.Run { return a.process.Runs() }

func (a *App) ProcessSnapshots() []domain.ProcessSnapshot { return a.process.Snapshots() }

// ---- Sequences -------------------------------------------------------------

// RunSequence executes the repository's saved, enabled steps in order.
func (a *App) RunSequence(repoID string) (domain.SequenceRun, error) {
	repo, err := a.repository(repoID)
	if err != nil {
		return domain.SequenceRun{}, err
	}
	return a.sequence.Start(repo, repo.CommandSequence)
}

func (a *App) CancelSequence(sequenceID string) error { return a.sequence.Cancel(sequenceID) }

func (a *App) Sequences() []domain.SequenceRun { return a.sequence.List() }

// ---- Group runs ------------------------------------------------------------

// RunGroup runs the saved sequence of every repository in the group, in
// sidebar order, using the group's run mode.
func (a *App) RunGroup(groupID string) (domain.GroupRun, error) {
	group, ok := a.workspace.Group(groupID)
	if !ok {
		return domain.GroupRun{}, fmt.Errorf("group not found: %s", groupID)
	}
	repos := make([]domain.Repository, 0, len(group.RepositoryIDs))
	for _, id := range group.RepositoryIDs {
		if repo, ok := a.workspace.Repository(id); ok {
			repos = append(repos, repo)
		}
	}
	return a.sequence.StartGroup(group, repos)
}

// StopGroup cancels the group run and stops every process of its members.
func (a *App) StopGroup(groupID string) error {
	group, ok := a.workspace.Group(groupID)
	if !ok {
		return fmt.Errorf("group not found: %s", groupID)
	}
	errs := []error{a.sequence.CancelGroup(groupID)}
	for _, id := range group.RepositoryIDs {
		errs = append(errs, a.StopRepository(id))
	}
	return errors.Join(errs...)
}

func (a *App) GroupRuns() []domain.GroupRun { return a.sequence.GroupRuns() }

// ---- Environment -----------------------------------------------------------

func (a *App) EnvironmentFiles(repoID string) ([]domain.EnvFile, error) {
	repo, err := a.repository(repoID)
	if err != nil {
		return nil, err
	}
	return a.env.List(repo.Path), nil
}

func (a *App) ReadEnvironmentFile(repoID string, name string) (domain.EnvFile, error) {
	repo, err := a.repository(repoID)
	if err != nil {
		return domain.EnvFile{}, err
	}
	return a.env.Read(repo.Path, name)
}

func (a *App) SaveEnvironmentFile(repoID string, name string, content string) error {
	repo, err := a.repository(repoID)
	if err != nil {
		return err
	}
	return a.env.Save(repo.Path, name, content)
}

// ---- internals -------------------------------------------------------------

func (a *App) repository(id string) (domain.Repository, error) {
	repo, ok := a.workspace.Repository(id)
	if !ok {
		return domain.Repository{}, fmt.Errorf("repository not found: %s", id)
	}
	return repo, nil
}

// refresh re-inspects a repository. When package.json is missing or invalid
// the record is kept with its last known scripts and Problem is set.
func (a *App) refresh(id string) (domain.Repository, error) {
	current, err := a.repository(id)
	if err != nil {
		return domain.Repository{}, err
	}
	meta, inspectErr := a.repo.Inspect(current.Path)
	// A plain folder (registered without package.json) stays healthy while
	// it has none. A record that had a package.json reports its loss as a
	// problem instead of silently dropping its scripts.
	if errors.Is(inspectErr, repomod.ErrNoPackageJSON) && current.PackageManager == "" {
		inspectErr = nil
	}
	envFiles := a.env.Names(current.Path)
	return a.workspace.MutateRepository(id, func(repo *domain.Repository) {
		if inspectErr != nil {
			repo.Problem = inspectErr.Error()
		} else {
			applyMetadata(repo, meta)
		}
		repo.EnvFiles = envFiles
		if repo.CommandSequence == nil {
			repo.CommandSequence = repomod.DefaultSequence(repo.Scripts)
		}
	})
}

func (a *App) refreshAll() {
	for _, repo := range a.workspace.Snapshot().Repositories {
		if _, err := a.refresh(repo.ID); err != nil {
			slog.Warn("refresh repository", "repositoryId", repo.ID, "error", err)
		}
	}
}

// duplicateAlias returns "<name> (n)" when repo's folder is already
// registered, so records of the same folder are distinguishable; otherwise
// "".
func (a *App) duplicateAlias(repo domain.Repository) string {
	taken := map[string]bool{}
	shared := false
	for _, other := range a.workspace.Snapshot().Repositories {
		taken[strings.ToLower(other.DisplayName())] = true
		if workspacemod.SamePath(other.Path, repo.Path) {
			shared = true
		}
	}
	if !shared {
		return ""
	}
	for n := 2; ; n++ {
		alias := fmt.Sprintf("%s (%d)", repo.Name, n)
		if !taken[strings.ToLower(alias)] {
			return alias
		}
	}
}

func applyMetadata(repo *domain.Repository, meta repomod.Metadata) {
	repo.Name = meta.Name
	repo.Path = meta.Path
	repo.PackageManager = meta.PackageManager
	repo.Scripts = meta.Scripts
	repo.Problem = ""
	repo.LastRefreshedAt = time.Now().UTC().Format(time.RFC3339)
}

// persist saves the workspace and broadcasts the new snapshot.
func (a *App) persist() error {
	err := a.workspace.Save()
	if err != nil {
		slog.Error("save workspace", "error", err)
		err = fmt.Errorf("save workspace: %w", err)
	}
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, EventWorkspaceChanged, a.workspace.Snapshot())
	}
	return err
}

// stepExecutor adapts the process manager to the sequence runner.
type stepExecutor struct{ a *App }

func (e stepExecutor) StartStep(repo domain.Repository, step domain.CommandStep, sequenceID string) (domain.Run, error) {
	spec := processmod.Spec{
		RepositoryID: repo.ID, Workdir: repo.Path, Label: step.Label,
		SequenceID: sequenceID, StepID: step.ID,
	}
	if step.Script != "" {
		current, err := e.a.repository(repo.ID)
		if err != nil {
			return domain.Run{}, err
		}
		if !repomod.HasScript(current, step.Script) {
			return domain.Run{}, fmt.Errorf("script %q is no longer defined in package.json", step.Script)
		}
		spec.Argv = repomod.ScriptArgv(current.PackageManager, step.Script)
	} else if step.GlobalCommand != "" {
		// Resolved at run time so edits to the global command apply to
		// every sequence that uses it.
		cmd, ok := e.a.workspace.GlobalCommand(step.GlobalCommand)
		if !ok {
			return domain.Run{}, fmt.Errorf("global command for step %q no longer exists", step.Label)
		}
		spec.Command = cmd.Command
	} else {
		spec.Command = step.Command
	}
	return e.a.process.Start(spec)
}

func (e stepExecutor) Wait(runID string) (domain.Run, error) { return e.a.process.Wait(runID) }

func (e stepExecutor) Stop(runID string) error { return e.a.process.Stop(runID) }
