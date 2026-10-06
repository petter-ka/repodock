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
	ID              string        `json:"id"`
	Name            string        `json:"name"`
	Path            string        `json:"path"`
	PackageManager  string        `json:"packageManager"`
	Scripts         []Script      `json:"scripts"`
	CommandSequence []CommandStep `json:"commandSequence"`
	EnvFiles        []string      `json:"envFiles"`
	GroupID         string        `json:"groupId"`
	LastRefreshedAt string        `json:"lastRefreshedAt"`
	// Problem describes why the last refresh could not read package.json.
	// Empty when the repository metadata is healthy.
	Problem string `json:"problem"`
}

type Workspace struct {
	Version      int          `json:"version"`
	Groups       []Group      `json:"groups"`
	Repositories []Repository `json:"repositories"`
}

// CommandStep is one entry of a repository's ordered command sequence.
//
// Resolution order: a non-empty Script runs that package.json script through
// the repository package manager; otherwise Command runs as shell text; when
// both are empty the step is a deliberate no-op (ADR-0006).
type CommandStep struct {
	ID      string `json:"id"`
	Label   string `json:"label"`
	Script  string `json:"script"`
	Command string `json:"command"`
	Enabled bool   `json:"enabled"`
	// Background steps are started and the sequence continues without waiting
	// for them to exit (typical for dev servers and watchers).
	Background bool `json:"background"`
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
	Stream       string `json:"stream"`
	Text         string `json:"text"`
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
}

type ImportGroupPreview struct {
	Name         string                    `json:"name"`
	Exists       bool                      `json:"exists"`
	Repositories []ImportRepositoryPreview `json:"repositories"`
}

// ImportPreview is shown to the user before an import is applied.
type ImportPreview struct {
	Path           string               `json:"path"`
	ExportedAt     time.Time            `json:"exportedAt"`
	Groups         []ImportGroupPreview `json:"groups"`
	GroupsToCreate int                  `json:"groupsToCreate"`
	New            int                  `json:"new"`
	Existing       int                  `json:"existing"`
	Missing        int                  `json:"missing"`
	// ShellCommands counts free-form command steps in repositories that
	// will be added, so the UI can ask for an explicit review.
	ShellCommands int `json:"shellCommands"`
}

type ImportOptions struct {
	// KeepStepsEnabled preserves each step's enabled flag; by default all
	// imported steps are disabled until the user reviews them.
	KeepStepsEnabled bool `json:"keepStepsEnabled"`
}

type ImportResult struct {
	GroupsCreated       int `json:"groupsCreated"`
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
