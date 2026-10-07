// Package domain holds transport-safe models shared between modules and the
// frontend bridge. It must not depend on Wails or any module.
package domain

import "time"

// WorkspaceVersion is the current persisted workspace schema version.
const WorkspaceVersion = 1

type Group struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	RepositoryIDs []string `json:"repositoryIds"`
	Collapsed     bool     `json:"collapsed"`
	// RunMode controls how "Run group" executes member sequences.
	RunMode GroupRunMode `json:"runMode"`
}

type GroupRunMode string

const (
	// GroupRunSequential runs one repository's sequence at a time, in group
	// order, and stops at the first failure. It is the default.
	GroupRunSequential GroupRunMode = "sequential"
	// GroupRunParallel starts every repository's sequence at once.
	GroupRunParallel GroupRunMode = "parallel"
)

// Valid reports whether m is a known run mode.
func (m GroupRunMode) Valid() bool { return m == GroupRunSequential || m == GroupRunParallel }

type Script struct {
	Name    string `json:"name"`
	Command string `json:"command"`
}

type Repository struct {
	ID string `json:"id"`
	// Name comes from package.json (or the folder name for plain folders)
	// and is refreshed on every inspection.
	Name string `json:"name"`
	// Alias is a user-chosen display name that overrides Name; empty means
	// none. It tells apart several records of the same folder (ADR-0015).
	Alias           string        `json:"alias"`
	Path            string        `json:"path"`
	PackageManager  string        `json:"packageManager"`
	Scripts         []Script      `json:"scripts"`
	CommandSequence []CommandStep `json:"commandSequence"`
	// QuickCommands are pinned scripts/commands shown as chips under the
	// sequence line; each click starts one in the background (ADR-0017).
	QuickCommands   []QuickCommand `json:"quickCommands"`
	EnvFiles        []string       `json:"envFiles"`
	GroupID         string         `json:"groupId"`
	LastRefreshedAt string         `json:"lastRefreshedAt"`
	// Problem describes why the last refresh could not read package.json.
	// Empty when the repository metadata is healthy.
	Problem string `json:"problem"`
}

// DisplayName is the alias when set, otherwise the discovered name.
func (r Repository) DisplayName() string {
	if r.Alias != "" {
		return r.Alias
	}
	return r.Name
}

type Workspace struct {
	Version      int          `json:"version"`
	Groups       []Group      `json:"groups"`
	Repositories []Repository `json:"repositories"`
	// GlobalCommands are reusable shell commands that any repository's
	// sequence can reference by ID (ADR-0012).
	GlobalCommands []GlobalCommand `json:"globalCommands"`
}

// GlobalCommand is a named shell command shared by the whole workspace. It
// runs in the folder of the repository whose sequence references it.
type GlobalCommand struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Command string `json:"command"`
}

// CommandStep is one entry of a repository's ordered command sequence.
//
// Resolution order: a non-empty Script runs that package.json script through
// the repository package manager; otherwise a non-empty GlobalCommand runs
// the referenced workspace global command; otherwise Command runs as shell
// text; when all are empty the step is a deliberate no-op (ADR-0006).
type CommandStep struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Script string `json:"script"`
	// GlobalCommand is the ID of a Workspace.GlobalCommands entry.
	GlobalCommand string `json:"globalCommand"`
	Command       string `json:"command"`
	Enabled       bool   `json:"enabled"`
	// Background steps are started and the sequence continues without waiting
	// for them to exit (typical for dev servers and watchers).
	Background bool `json:"background"`
}

// QuickCommand is a pinned script, global command or shell command. Exactly
// one of Script, GlobalCommand and Command is set.
type QuickCommand struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Script string `json:"script"`
	// GlobalCommand is the ID of a Workspace.GlobalCommands entry.
	GlobalCommand string `json:"globalCommand"`
	Command       string `json:"command"`
}

// HostProcess describes any process on this machine, for the "Kill
// process" mini app (ADR-0018). PID 0 means the owner of a port is unknown.
type HostProcess struct {
	PID       int    `json:"pid"`
	PPID      int    `json:"ppid"`
	Name      string `json:"name"`
	Command   string `json:"command"`
	User      string `json:"user"`
	StartedAt string `json:"startedAt"`
	// Ports this process listens on (TCP) or is bound to (UDP).
	Ports []int `json:"ports"`
	// RunID/RepositoryID are set when the process belongs to a RepoDock run;
	// killing it then stops that run.
	RunID        string `json:"runId"`
	RepositoryID string `json:"repositoryId"`
	// Protected explains why the process cannot be killed from RepoDock.
	Protected string `json:"protected"`
}

// KillResult reports a kill request.
type KillResult struct {
	PID int `json:"pid"`
	// Signalled lists the PIDs that received SIGTERM.
	Signalled []int `json:"signalled"`
	// Forced is true when something survived the grace period and was killed.
	Forced bool `json:"forced"`
	// RunID is set when the PID belonged to a RepoDock run, which was stopped
	// through the process manager instead.
	RunID string `json:"runId"`
}

type RunStatus string

const (
	RunQueued   RunStatus = "queued"
	RunStarting RunStatus = "starting"
	RunRunning  RunStatus = "running"
	RunStopping RunStatus = "stopping"
	RunExited   RunStatus = "exited"
	RunFailed   RunStatus = "failed"
	RunStopped  RunStatus = "stopped"
	RunSkipped  RunStatus = "skipped"
)

// Active reports whether a run still owns a live process.
func (s RunStatus) Active() bool {
	return s == RunQueued || s == RunStarting || s == RunRunning || s == RunStopping
}

type Run struct {
	ID           string    `json:"id"`
	RepositoryID string    `json:"repositoryId"`
	Command      string    `json:"command"`
	Label        string    `json:"label"`
	Status       RunStatus `json:"status"`
	PID          int       `json:"pid"`
	ExitCode     int       `json:"exitCode"`
	StartedAt    time.Time `json:"startedAt"`
	EndedAt      time.Time `json:"endedAt"`
	SequenceID   string    `json:"sequenceId"`
	StepID       string    `json:"stepId"`
}

type ProcessSnapshot struct {
	RunID        string `json:"runId"`
	RepositoryID string `json:"repositoryId"`
	PID          int32  `json:"pid"`
	Status       string `json:"status"`
	// MemoryBytes and CPUPercent aggregate the whole process tree.
	MemoryBytes  uint64    `json:"memoryBytes"`
	CPUPercent   float64   `json:"cpuPercent"`
	ProcessCount int       `json:"processCount"`
	ObservedAt   time.Time `json:"observedAt"`
}

type ProcessOutput struct {
	RunID        string `json:"runId"`
	RepositoryID string `json:"repositoryId"`
	PID          int    `json:"pid"`
	// Stream is "stdout", "stderr", or "stdin" for the echo of input the
	// user sent to the process.
	Stream string `json:"stream"`
	Text   string `json:"text"`
	// Partial marks an unterminated line emitted after output went quiet,
	// typically an interactive prompt waiting for input.
	Partial bool `json:"partial"`
	// Seq is a monotonically increasing sequence number across all runs so
	// the frontend can order lines that arrive in separate batches.
	Seq       uint64    `json:"seq"`
	Timestamp time.Time `json:"timestamp"`
}

type ProcessExit struct {
	RunID        string    `json:"runId"`
	RepositoryID string    `json:"repositoryId"`
	ExitCode     int       `json:"exitCode"`
	Status       RunStatus `json:"status"`
	EndedAt      time.Time `json:"endedAt"`
}

type EnvFile struct {
	Name       string    `json:"name"`
	Path       string    `json:"path"`
	Content    string    `json:"content"`
	Size       int64     `json:"size"`
	ModifiedAt time.Time `json:"modifiedAt"`
}

type SequenceStatus string

const (
	SequenceRunning   SequenceStatus = "running"
	SequenceCompleted SequenceStatus = "completed"
	SequenceFailed    SequenceStatus = "failed"
	SequenceCancelled SequenceStatus = "cancelled"
)

type StepStatus string

const (
	StepPending   StepStatus = "pending"
	StepRunning   StepStatus = "running"
	StepStarted   StepStatus = "started" // background step launched
	StepCompleted StepStatus = "completed"
	StepFailed    StepStatus = "failed"
	StepSkipped   StepStatus = "skipped"
	StepCancelled StepStatus = "cancelled"
)

type SequenceStepState struct {
	StepID string     `json:"stepId"`
	Label  string     `json:"label"`
	RunID  string     `json:"runId"`
	Status StepStatus `json:"status"`
	Error  string     `json:"error"`
}

type SequenceRun struct {
	ID           string              `json:"id"`
	RepositoryID string              `json:"repositoryId"`
	Status       SequenceStatus      `json:"status"`
	Steps        []SequenceStepState `json:"steps"`
	StartedAt    time.Time           `json:"startedAt"`
	EndedAt      time.Time           `json:"endedAt"`
}

// GroupRepoState is one repository's progress inside a group run. Status
// reuses step statuses: pending, running, completed, failed, skipped
// (no enabled steps), cancelled.
type GroupRepoState struct {
	RepositoryID string     `json:"repositoryId"`
	Name         string     `json:"name"`
	SequenceID   string     `json:"sequenceId"`
	Status       StepStatus `json:"status"`
	Error        string     `json:"error"`
}

// GroupRun executes the command sequences of every repository in a group.
type GroupRun struct {
	ID        string           `json:"id"`
	GroupID   string           `json:"groupId"`
	Mode      GroupRunMode     `json:"mode"`
	Status    SequenceStatus   `json:"status"`
	Repos     []GroupRepoState `json:"repos"`
	StartedAt time.Time        `json:"startedAt"`
	EndedAt   time.Time        `json:"endedAt"`
}

// ImportStatus describes what importing one repository entry would do.
type ImportStatus string

const (
	ImportNew       ImportStatus = "new"       // will be added
	ImportMissing   ImportStatus = "missing"   // will be added; folder not found on this machine
	ImportExisting  ImportStatus = "existing"  // already registered; left unchanged
	ImportDuplicate ImportStatus = "duplicate" // repeated inside the file; ignored
)

type ImportRepositoryPreview struct {
	Name   string        `json:"name"`
	Path   string        `json:"path"`
	Status ImportStatus  `json:"status"`
	Steps  []CommandStep `json:"steps"`
	// QuickCommands keep document global command IDs, like Steps.
	QuickCommands []QuickCommand `json:"quickCommands"`
}

// ImportGlobalCommandStatus describes what importing one global command does.
type ImportGlobalCommandStatus string

const (
	ImportGlobalNew      ImportGlobalCommandStatus = "new"      // will be added
	ImportGlobalExisting ImportGlobalCommandStatus = "existing" // same name and command already present; reused
	ImportGlobalRenamed  ImportGlobalCommandStatus = "renamed"  // name taken by a different command; added under ImportName
)

type ImportGlobalCommandPreview struct {
	// ID is the document-local ID that preview steps reference.
	ID      string                    `json:"id"`
	Name    string                    `json:"name"`
	Command string                    `json:"command"`
	Status  ImportGlobalCommandStatus `json:"status"`
	// ImportName is the name the command will have after import.
	ImportName string `json:"importName"`
}

type ImportGroupPreview struct {
	Name         string                    `json:"name"`
	Exists       bool                      `json:"exists"`
	Repositories []ImportRepositoryPreview `json:"repositories"`
}

// ImportPreview is shown to the user before an import is applied.
type ImportPreview struct {
	Path           string                       `json:"path"`
	ExportedAt     time.Time                    `json:"exportedAt"`
	Groups         []ImportGroupPreview         `json:"groups"`
	GlobalCommands []ImportGlobalCommandPreview `json:"globalCommands"`
	GroupsToCreate int                          `json:"groupsToCreate"`
	New            int                          `json:"new"`
	Existing       int                          `json:"existing"`
	Missing        int                          `json:"missing"`
	// ShellCommands counts free-form command steps in repositories that
	// will be added plus global commands that will be added, so the UI can
	// ask for an explicit review.
	ShellCommands int `json:"shellCommands"`
}

type ImportOptions struct {
	// KeepStepsEnabled preserves each step's enabled flag (the import
	// dialog sends true unless the user opts out); when false, all
	// imported steps are disabled until the user reviews them.
	KeepStepsEnabled bool `json:"keepStepsEnabled"`
	// PathOverrides maps a repository path shown in the preview to the
	// folder the user picked instead (e.g. when the original is missing).
	PathOverrides map[string]string `json:"pathOverrides"`
}

// FolderCheck describes whether a folder can be used as a repository.
type FolderCheck struct {
	// Path is the absolute, cleaned folder path.
	Path   string `json:"path"`
	Exists bool   `json:"exists"`
	// Valid is true when the folder can be registered: it has a readable
	// package.json, or none at all (a plain folder).
	Valid bool   `json:"valid"`
	Name  string `json:"name"`
	// Problem explains why the folder is not valid.
	Problem string `json:"problem"`
	// RegisteredID is set when another repository already uses this path.
	// Informational: several records may share a folder (ADR-0015).
	RegisteredID   string `json:"registeredId"`
	RegisteredName string `json:"registeredName"`
}

type ImportResult struct {
	GroupsCreated       int `json:"groupsCreated"`
	GlobalCommandsAdded int `json:"globalCommandsAdded"`
	RepositoriesAdded   int `json:"repositoriesAdded"`
	RepositoriesSkipped int `json:"repositoriesSkipped"`
}

// StartupReport surfaces non-fatal problems detected while the app booted,
// such as a corrupt workspace file that was moved aside.
type StartupReport struct {
	WorkspacePath   string   `json:"workspacePath"`
	RecoveredBackup string   `json:"recoveredBackup"`
	Warnings        []string `json:"warnings"`
}
