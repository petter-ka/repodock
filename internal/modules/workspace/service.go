// Package workspace persists groups and repository registrations as a
// versioned JSON document (ADR-0003). It depends only on domain and the
// standard library.
package workspace

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/example/repodock/internal/domain"
	"github.com/google/uuid"
)

const defaultGroupName = "Ungrouped"

// ErrNotFound is returned when a group or repository ID is unknown.
var ErrNotFound = errors.New("not found")

type Service struct {
	mu     sync.RWMutex
	saveMu sync.Mutex
	state  domain.Workspace
	path   string
}

// New stores the workspace under the platform user config directory, or at
// $REPODOCK_WORKSPACE when set (useful for development and testing).
func New() *Service {
	if override := os.Getenv("REPODOCK_WORKSPACE"); override != "" {
		return NewAt(override)
	}
	base, err := os.UserConfigDir()
	if err != nil {
		base = "."
	}
	return NewAt(filepath.Join(base, "RepoDock", "workspace.json"))
}

// NewAt stores the workspace at an explicit file path.
func NewAt(path string) *Service {
	s := &Service{path: path, state: domain.Workspace{Version: domain.WorkspaceVersion}}
	normalize(&s.state)
	return s
}

func (s *Service) Path() string { return s.path }

// LoadResult describes recovery actions taken while loading.
type LoadResult struct {
	RecoveredBackup string
}

// Load reads the workspace file. A missing file yields an empty workspace.
// A corrupt file is moved aside to a timestamped backup and replaced by an
// empty workspace so the app can still start.
func (s *Service) Load() (LoadResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		s.state = domain.Workspace{Version: domain.WorkspaceVersion}
		normalize(&s.state)
		return LoadResult{}, nil
	}
	if err != nil {
		return LoadResult{}, fmt.Errorf("read workspace: %w", err)
	}

	state, err := decode(data)
	if err != nil {
		backup := s.path + ".corrupt-" + time.Now().Format("20060102-150405")
		if renameErr := os.Rename(s.path, backup); renameErr != nil {
			return LoadResult{}, fmt.Errorf("workspace is invalid (%v) and could not be moved aside: %w", err, renameErr)
		}
		s.state = domain.Workspace{Version: domain.WorkspaceVersion}
		normalize(&s.state)
		return LoadResult{RecoveredBackup: backup}, nil
	}

	if state.Version < domain.WorkspaceVersion {
		// Migrations are one-way: keep a copy of the original before upgrading.
		backup := fmt.Sprintf("%s.v%d.bak", s.path, state.Version)
		if err := os.WriteFile(backup, data, 0o600); err != nil {
			return LoadResult{}, fmt.Errorf("backup workspace before migration: %w", err)
		}
		migrate(&state)
	}
	normalize(&state)
	s.state = state
	return LoadResult{}, nil
}

func decode(data []byte) (domain.Workspace, error) {
	var state domain.Workspace
	if err := json.Unmarshal(data, &state); err != nil {
		return state, fmt.Errorf("decode workspace: %w", err)
	}
	if state.Version > domain.WorkspaceVersion {
		return state, fmt.Errorf("workspace version %d is newer than supported version %d", state.Version, domain.WorkspaceVersion)
	}
	return state, nil
}

// migrate upgrades older schemas in place. Version 0 (unversioned starter
// files) has the same shape as version 1.
func migrate(state *domain.Workspace) {
	if state.Version < 1 {
		state.Version = 1
	}
}

// normalize enforces invariants: at least one group exists, every repository
// belongs to exactly one existing group, and slices are never nil.
func normalize(state *domain.Workspace) {
	state.Version = domain.WorkspaceVersion
	if state.Repositories == nil {
		state.Repositories = []domain.Repository{}
	}
	if state.GlobalCommands == nil {
		state.GlobalCommands = []domain.GlobalCommand{}
	}
	if len(state.Groups) == 0 {
		state.Groups = []domain.Group{{ID: uuid.NewString(), Name: defaultGroupName}}
	}

	groupIndex := make(map[string]int, len(state.Groups))
	for i := range state.Groups {
		if state.Groups[i].ID == "" {
			state.Groups[i].ID = uuid.NewString()
		}
		if !state.Groups[i].RunMode.Valid() {
			state.Groups[i].RunMode = domain.GroupRunSequential
		}
		groupIndex[state.Groups[i].ID] = i
	}

	repoIDs := make(map[string]bool, len(state.Repositories))
	for i := range state.Repositories {
		repo := &state.Repositories[i]
		if repo.ID == "" {
			repo.ID = uuid.NewString()
		}
		repoIDs[repo.ID] = true
		if repo.Scripts == nil {
			repo.Scripts = []domain.Script{}
		}
		if repo.EnvFiles == nil {
			repo.EnvFiles = []string{}
		}
		if repo.QuickCommands == nil {
			repo.QuickCommands = []domain.QuickCommand{}
		}
		repo.CommandSequence = enabledSteps(repo.CommandSequence)
		if _, ok := groupIndex[repo.GroupID]; !ok {
			repo.GroupID = state.Groups[0].ID
		}
	}

	// Rebuild membership from repository.GroupID while keeping the existing
	// per-group ordering where possible.
	seen := map[string]bool{}
	for i := range state.Groups {
		g := &state.Groups[i]
		kept := make([]string, 0, len(g.RepositoryIDs))
		for _, id := range g.RepositoryIDs {
			if repoIDs[id] && !seen[id] && repoGroup(state, id) == g.ID {
				kept = append(kept, id)
				seen[id] = true
			}
		}
		g.RepositoryIDs = kept
	}
	for _, repo := range state.Repositories {
		if !seen[repo.ID] {
			g := &state.Groups[groupIndex[repo.GroupID]]
			g.RepositoryIDs = append(g.RepositoryIDs, repo.ID)
			seen[repo.ID] = true
		}
	}
}

func repoGroup(state *domain.Workspace, id string) string {
	for _, repo := range state.Repositories {
		if repo.ID == id {
			return repo.GroupID
		}
	}
	return ""
}

// Save writes the workspace atomically: temp file in the same directory,
// fsync, then rename over the previous file.
func (s *Service) Save() error {
	s.saveMu.Lock()
	defer s.saveMu.Unlock()

	s.mu.RLock()
	data, err := json.MarshalIndent(s.state, "", "  ")
	s.mu.RUnlock()
	if err != nil {
		return fmt.Errorf("encode workspace: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return fmt.Errorf("create workspace directory: %w", err)
	}
	return writeFileAtomic(s.path, data, 0o600)
}

func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".tmp-*")
	if err != nil {
		return fmt.Errorf("create temp workspace: %w", err)
	}
	tmpName := tmp.Name()
	cleanup := func() { _ = os.Remove(tmpName) }
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("write temp workspace: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("sync temp workspace: %w", err)
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return fmt.Errorf("close temp workspace: %w", err)
	}
	_ = os.Chmod(tmpName, perm)
	if err := os.Rename(tmpName, path); err != nil {
		cleanup()
		return fmt.Errorf("replace workspace: %w", err)
	}
	return nil
}

// Snapshot returns a deep copy safe to hand to other goroutines.
func (s *Service) Snapshot() domain.Workspace {
	s.mu.RLock()
	defer s.mu.RUnlock()
	data, _ := json.Marshal(s.state)
	var clone domain.Workspace
	_ = json.Unmarshal(data, &clone)
	return clone
}

func (s *Service) Repository(id string) (domain.Repository, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if i := s.repoIndex(id); i >= 0 {
		return cloneRepo(s.state.Repositories[i]), true
	}
	return domain.Repository{}, false
}

// RepositoryByPath finds a repository by its natural key, the folder path.
func (s *Service) RepositoryByPath(path string) (domain.Repository, bool) {
	normalized, err := filepath.Abs(path)
	if err != nil {
		normalized = path
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, repo := range s.state.Repositories {
		if SamePath(normalized, repo.Path) {
			return cloneRepo(repo), true
		}
	}
	return domain.Repository{}, false
}

// UpsertRepository inserts or replaces a repository record. A record with an
// unknown or empty GroupID is placed in the first group.
func (s *Service) UpsertRepository(repo domain.Repository) domain.Repository {
	s.mu.Lock()
	defer s.mu.Unlock()
	repo = cloneRepo(repo)
	if i := s.repoIndex(repo.ID); i >= 0 {
		s.state.Repositories[i] = repo
	} else {
		s.state.Repositories = append(s.state.Repositories, repo)
	}
	normalize(&s.state)
	i := s.repoIndex(repo.ID)
	return cloneRepo(s.state.Repositories[i])
}

// Update applies fn to the whole workspace under the write lock and then
// re-establishes invariants. Used for bulk changes such as imports.
func (s *Service) Update(fn func(*domain.Workspace)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	fn(&s.state)
	normalize(&s.state)
}

// MutateRepository applies fn to the stored record under the write lock, so
// concurrent updates of different fields cannot overwrite each other.
func (s *Service) MutateRepository(id string, fn func(*domain.Repository)) (domain.Repository, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	i := s.repoIndex(id)
	if i < 0 {
		return domain.Repository{}, fmt.Errorf("repository %s: %w", id, ErrNotFound)
	}
	fn(&s.state.Repositories[i])
	s.state.Repositories[i].ID = id
	normalize(&s.state)
	return cloneRepo(s.state.Repositories[s.repoIndex(id)]), nil
}

func (s *Service) RemoveRepository(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	i := s.repoIndex(id)
	if i < 0 {
		return fmt.Errorf("repository %s: %w", id, ErrNotFound)
	}
	s.state.Repositories = append(s.state.Repositories[:i], s.state.Repositories[i+1:]...)
	for g := range s.state.Groups {
		s.state.Groups[g].RepositoryIDs = removeString(s.state.Groups[g].RepositoryIDs, id)
	}
	return nil
}

func (s *Service) CreateGroup(name string) (domain.Group, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return domain.Group{}, fmt.Errorf("group name cannot be empty")
	}
	g := domain.Group{ID: uuid.NewString(), Name: name, RepositoryIDs: []string{}, RunMode: domain.GroupRunSequential}
	s.mu.Lock()
	s.state.Groups = append(s.state.Groups, g)
	s.mu.Unlock()
	return g, nil
}

func (s *Service) RenameGroup(id, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("group name cannot be empty")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	i := s.groupIndex(id)
	if i < 0 {
		return fmt.Errorf("group %s: %w", id, ErrNotFound)
	}
	s.state.Groups[i].Name = name
	return nil
}

// DeleteGroup removes a group and moves its repositories to the first
// remaining group. The last group cannot be deleted.
func (s *Service) DeleteGroup(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	i := s.groupIndex(id)
	if i < 0 {
		return fmt.Errorf("group %s: %w", id, ErrNotFound)
	}
	if len(s.state.Groups) == 1 {
		return fmt.Errorf("the last group cannot be deleted")
	}
	s.state.Groups = append(s.state.Groups[:i], s.state.Groups[i+1:]...)
	target := s.state.Groups[0].ID
	for r := range s.state.Repositories {
		if s.state.Repositories[r].GroupID == id {
			s.state.Repositories[r].GroupID = target
		}
	}
	normalize(&s.state)
	return nil
}

func (s *Service) SetGroupCollapsed(id string, collapsed bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	i := s.groupIndex(id)
	if i < 0 {
		return fmt.Errorf("group %s: %w", id, ErrNotFound)
	}
	s.state.Groups[i].Collapsed = collapsed
	return nil
}

func (s *Service) SetGroupRunMode(id string, mode domain.GroupRunMode) error {
	if !mode.Valid() {
		return fmt.Errorf("unknown run mode %q", mode)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	i := s.groupIndex(id)
	if i < 0 {
		return fmt.Errorf("group %s: %w", id, ErrNotFound)
	}
	s.state.Groups[i].RunMode = mode
	return nil
}

// Group returns a copy of the group with the given ID.
func (s *Service) Group(id string) (domain.Group, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	i := s.groupIndex(id)
	if i < 0 {
		return domain.Group{}, false
	}
	g := s.state.Groups[i]
	g.RepositoryIDs = append([]string{}, g.RepositoryIDs...)
	return g, true
}

// AssignRepository moves a repository to the end of the given group.
func (s *Service) AssignRepository(id, groupID string) error {
	return s.MoveRepository(id, groupID, -1)
}

// MoveRepository places a repository in the given group at index, counted
// within the group's members excluding the moved repository. A negative or
// out-of-range index appends. Moving within the same group reorders it.
func (s *Service) MoveRepository(id, groupID string, index int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.repoIndex(id)
	if r < 0 {
		return fmt.Errorf("repository %s: %w", id, ErrNotFound)
	}
	target := s.groupIndex(groupID)
	if target < 0 {
		return fmt.Errorf("group %s: %w", groupID, ErrNotFound)
	}
	for g := range s.state.Groups {
		s.state.Groups[g].RepositoryIDs = removeString(s.state.Groups[g].RepositoryIDs, id)
	}
	members := s.state.Groups[target].RepositoryIDs
	if index < 0 || index > len(members) {
		index = len(members)
	}
	members = append(members[:index], append([]string{id}, members[index:]...)...)
	s.state.Groups[target].RepositoryIDs = members
	s.state.Repositories[r].GroupID = groupID
	normalize(&s.state)
	return nil
}

// MaxQuickCommands bounds the pinned commands of one repository.
const MaxQuickCommands = 100

// CleanQuickCommands normalizes pinned commands: trims text, keeps exactly
// one kind per entry (script, then global command, then command), drops
// empty entries, assigns missing or repeated IDs and defaults the label.
// lookup resolves a global command's name for the default label.
func CleanQuickCommands(commands []domain.QuickCommand, lookup func(id string) (domain.GlobalCommand, bool)) ([]domain.QuickCommand, error) {
	if len(commands) > MaxQuickCommands {
		return nil, fmt.Errorf("more than %d quick commands", MaxQuickCommands)
	}
	clean := make([]domain.QuickCommand, 0, len(commands))
	seen := map[string]bool{}
	for _, cmd := range commands {
		cmd.Label = strings.TrimSpace(cmd.Label)
		cmd.Script = strings.TrimSpace(cmd.Script)
		cmd.GlobalCommand = strings.TrimSpace(cmd.GlobalCommand)
		cmd.Command = strings.TrimSpace(cmd.Command)
		if cmd.Script != "" {
			cmd.GlobalCommand, cmd.Command = "", ""
		} else if cmd.GlobalCommand != "" {
			cmd.Command = ""
		}
		if cmd.Script == "" && cmd.GlobalCommand == "" && cmd.Command == "" {
			continue
		}
		if strings.ContainsAny(cmd.Label+cmd.Script+cmd.GlobalCommand+cmd.Command, "\r\n\x00") {
			return nil, fmt.Errorf("quick command %q contains line breaks or NUL bytes", cmd.Label)
		}
		if len(cmd.Label) > MaxAliasLength {
			return nil, fmt.Errorf("quick command label is longer than %d characters", MaxAliasLength)
		}
		if cmd.ID == "" || seen[cmd.ID] {
			cmd.ID = uuid.NewString()
		}
		seen[cmd.ID] = true
		if cmd.Label == "" {
			switch {
			case cmd.Script != "":
				cmd.Label = cmd.Script
			case cmd.GlobalCommand != "":
				if global, ok := lookup(cmd.GlobalCommand); ok {
					cmd.Label = global.Name
				}
			default:
				cmd.Label = cmd.Command
			}
		}
		clean = append(clean, cmd)
	}
	return clean, nil
}

// UpdateQuickCommands replaces a repository's pinned commands.
func (s *Service) UpdateQuickCommands(id string, commands []domain.QuickCommand) ([]domain.QuickCommand, error) {
	clean, err := CleanQuickCommands(commands, s.GlobalCommand)
	if err != nil {
		return nil, err
	}
	repo, err := s.MutateRepository(id, func(repo *domain.Repository) { repo.QuickCommands = clean })
	if err != nil {
		return nil, err
	}
	return repo.QuickCommands, nil
}

// MaxAliasLength bounds repository aliases.
const MaxAliasLength = 200

// RenameRepository sets a repository's alias (display name). A blank alias
// clears it, so the discovered name shows again.
func (s *Service) RenameRepository(id, alias string) error {
	alias = strings.TrimSpace(alias)
	if len(alias) > MaxAliasLength {
		return fmt.Errorf("alias is longer than %d characters", MaxAliasLength)
	}
	if strings.ContainsAny(alias, "\r\n\x00") {
		return fmt.Errorf("alias contains line breaks or NUL bytes")
	}
	_, err := s.MutateRepository(id, func(repo *domain.Repository) { repo.Alias = alias })
	return err
}

// MoveGroup places a group at index in the sidebar order, counted among the
// other groups. A negative or out-of-range index moves it to the end.
func (s *Service) MoveGroup(id string, index int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	from := s.groupIndex(id)
	if from < 0 {
		return fmt.Errorf("group %s: %w", id, ErrNotFound)
	}
	group := s.state.Groups[from]
	rest := append(append([]domain.Group{}, s.state.Groups[:from]...), s.state.Groups[from+1:]...)
	if index < 0 || index > len(rest) {
		index = len(rest)
	}
	s.state.Groups = append(rest[:index], append([]domain.Group{group}, rest[index:]...)...)
	return nil
}

// MaxGlobalCommandName bounds global command names.
const MaxGlobalCommandName = 200

// GlobalCommand returns the global command with the given ID.
func (s *Service) GlobalCommand(id string) (domain.GlobalCommand, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, cmd := range s.state.GlobalCommands {
		if cmd.ID == id {
			return cmd, true
		}
	}
	return domain.GlobalCommand{}, false
}

// SaveGlobalCommands replaces the workspace's global commands. Names and
// commands are trimmed and must be non-empty, single-line, and names must
// be unique (case-insensitively). Commands missing an ID receive one.
// Sequence steps referencing a removed command are left as they are; they
// fail with a clear error when run.
func (s *Service) SaveGlobalCommands(commands []domain.GlobalCommand) ([]domain.GlobalCommand, error) {
	clean, err := CleanGlobalCommands(commands)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state.GlobalCommands = clean
	return append([]domain.GlobalCommand{}, clean...), nil
}

// CleanGlobalCommands validates and normalizes a list of global commands.
func CleanGlobalCommands(commands []domain.GlobalCommand) ([]domain.GlobalCommand, error) {
	clean := make([]domain.GlobalCommand, 0, len(commands))
	ids := map[string]bool{}
	names := map[string]bool{}
	for i, cmd := range commands {
		cmd.Name = strings.TrimSpace(cmd.Name)
		cmd.Command = strings.TrimSpace(cmd.Command)
		switch {
		case cmd.Name == "":
			return nil, fmt.Errorf("global command %d: name cannot be empty", i+1)
		case len(cmd.Name) > MaxGlobalCommandName:
			return nil, fmt.Errorf("global command %q: name is longer than %d characters", cmd.Name, MaxGlobalCommandName)
		case cmd.Command == "":
			return nil, fmt.Errorf("global command %q: command cannot be empty", cmd.Name)
		case strings.ContainsAny(cmd.Name+cmd.Command, "\r\n\x00"):
			return nil, fmt.Errorf("global command %q: line breaks are not allowed", cmd.Name)
		}
		key := strings.ToLower(cmd.Name)
		if names[key] {
			return nil, fmt.Errorf("global command name %q is used more than once", cmd.Name)
		}
		names[key] = true
		if cmd.ID == "" || ids[cmd.ID] {
			cmd.ID = uuid.NewString()
		}
		ids[cmd.ID] = true
		clean = append(clean, cmd)
	}
	return clean, nil
}

// enabledSteps keeps only the steps that run (ADR-0022): files written
// before it stored every script of the repository as a disabled step.
func enabledSteps(steps []domain.CommandStep) []domain.CommandStep {
	out := make([]domain.CommandStep, 0, len(steps))
	for _, step := range steps {
		if step.Enabled {
			out = append(out, step)
		}
	}
	return out
}

// UpdateCommandSequence replaces a repository's ordered steps. Only enabled
// steps are kept; steps without an ID receive one; blank labels are derived
// from the step content.
func (s *Service) UpdateCommandSequence(id string, steps []domain.CommandStep) error {
	clean := make([]domain.CommandStep, 0, len(steps))
	seen := map[string]bool{}
	for _, step := range enabledSteps(steps) {
		step.Label = strings.TrimSpace(step.Label)
		step.Script = strings.TrimSpace(step.Script)
		step.GlobalCommand = strings.TrimSpace(step.GlobalCommand)
		step.Command = strings.TrimSpace(step.Command)
		// A step has exactly one kind; script wins, then global command.
		if step.Script != "" {
			step.GlobalCommand, step.Command = "", ""
		} else if step.GlobalCommand != "" {
			step.Command = ""
		}
		if step.ID == "" || seen[step.ID] {
			step.ID = uuid.NewString()
		}
		seen[step.ID] = true
		if step.Label == "" {
			switch {
			case step.Script != "":
				step.Label = step.Script
			case step.GlobalCommand != "":
				if cmd, ok := s.GlobalCommand(step.GlobalCommand); ok {
					step.Label = cmd.Name
				}
			case step.Command != "":
				step.Label = step.Command
			}
		}
		clean = append(clean, step)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	r := s.repoIndex(id)
	if r < 0 {
		return fmt.Errorf("repository %s: %w", id, ErrNotFound)
	}
	s.state.Repositories[r].CommandSequence = clean
	return nil
}

func (s *Service) repoIndex(id string) int {
	for i := range s.state.Repositories {
		if s.state.Repositories[i].ID == id {
			return i
		}
	}
	return -1
}

func (s *Service) groupIndex(id string) int {
	for i := range s.state.Groups {
		if s.state.Groups[i].ID == id {
			return i
		}
	}
	return -1
}

// SamePath compares two filesystem paths, case-insensitively on Windows.
func SamePath(a, b string) bool {
	if absA, err := filepath.Abs(a); err == nil {
		a = absA
	}
	if absB, err := filepath.Abs(b); err == nil {
		b = absB
	}
	a, b = filepath.Clean(a), filepath.Clean(b)
	if os.PathSeparator == '\\' {
		return strings.EqualFold(a, b)
	}
	return a == b
}

func cloneRepo(repo domain.Repository) domain.Repository {
	repo.Scripts = append([]domain.Script{}, repo.Scripts...)
	repo.EnvFiles = append([]string{}, repo.EnvFiles...)
	if repo.CommandSequence != nil {
		repo.CommandSequence = append([]domain.CommandStep{}, repo.CommandSequence...)
	}
	repo.QuickCommands = append([]domain.QuickCommand{}, repo.QuickCommands...)
	return repo
}

func removeString(items []string, value string) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		if item != value {
			out = append(out, item)
		}
	}
	return out
}
