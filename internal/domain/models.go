// Package domain holds transport-safe models shared between modules and the
// frontend bridge. It must not depend on Wails or any module.
package domain

import (
	"strconv"
	"strings"
	"time"
)

// WorkspaceVersion is the current persisted workspace schema version.
const WorkspaceVersion = 1

type Group struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	RepositoryIDs []string `json:"repositoryIds"`
	Collapsed     bool     `json:"collapsed"`
	// RunMode controls how "Run group" executes member sequences.
	RunMode GroupRunMode `json:"runMode"`
	// SkippedRepositoryIDs are members that "Run group" leaves out; they can
	// still be run on their own (ADR-0024).
	SkippedRepositoryIDs []string `json:"skippedRepositoryIds"`
	// Schedule starts and stops this group at set times (ADR-0025).
	Schedule GroupSchedule `json:"schedule"`
}

// GroupSchedule starts and stops one group at fixed local times on chosen
// weekdays (ADR-0025). Every group has its own; the dialog can apply the
// same settings to several groups at once.
type GroupSchedule struct {
	// Days are the weekdays the schedule applies on: 0 = Sunday … 6 =
	// Saturday, sorted and unique.
	Days []int `json:"days"`
	// StartEnabled runs the group at StartAt ("HH:MM", local time).
	StartEnabled bool   `json:"startEnabled"`
	StartAt      string `json:"startAt"`
	// StopEnabled stops the group at StopAt ("HH:MM", local time).
	StopEnabled bool   `json:"stopEnabled"`
	StopAt      string `json:"stopAt"`
}

// Active reports whether the schedule starts or stops anything.
func (s GroupSchedule) Active() bool { return (s.StartEnabled || s.StopEnabled) && len(s.Days) > 0 }

// ParseClock parses a 24-hour "HH:MM" (or "H:MM") time of day.
func ParseClock(value string) (hour, minute int, ok bool) {
	h, m, found := strings.Cut(value, ":")
	if !found || len(h) < 1 || len(h) > 2 || len(m) != 2 || !digits(h) || !digits(m) {
		return 0, 0, false
	}
	hour, _ = strconv.Atoi(h)
	minute, _ = strconv.Atoi(m)
	if hour > 23 || minute > 59 {
		return 0, 0, false
	}
	return hour, minute, true
}

func digits(value string) bool {
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// ScheduledStop is a scheduled stop of a running group that is close
// enough to be announced with a countdown (ADR-0025).
type ScheduledStop struct {
	GroupID   string    `json:"groupId"`
	GroupName string    `json:"groupName"`
	StopAt    time.Time `json:"stopAt"`
	// Postponed is true when the user moved the stop from its scheduled time.
	Postponed bool `json:"postponed"`
	// Running counts the group's live processes.
	Running int `json:"running"`
}

// GroupScheduleStatus is what a group's schedule does next (ADR-0025). A
// zero time means nothing within the next week.
type GroupScheduleStatus struct {
	GroupID   string    `json:"groupId"`
	NextStart time.Time `json:"nextStart"`
	// StartSkipped means the user cancelled NextStart; it will not run.
	StartSkipped bool      `json:"startSkipped"`
	NextStop     time.Time `json:"nextStop"`
	// StopSkipped means the user cancelled NextStop; nothing is stopped then.
	StopSkipped bool `json:"stopSkipped"`
	// StopPostponed means NextStop was moved from its scheduled time.
	StopPostponed bool `json:"stopPostponed"`
}

// ScheduleEvent reports a schedule acting on its own.
type ScheduleEvent struct {
	GroupID   string `json:"groupId"`
	GroupName string `json:"groupName"`
	// Action is "started" or "stopped".
	Action string `json:"action"`
	// Error is set when the action failed.
	Error string `json:"error"`
}

type GroupRunMode string

const (
	// GroupRunSequential runs one repository's sequence at a time, in group
	// order, and stops at the first failure.
	GroupRunSequential GroupRunMode = "sequential"
	// GroupRunParallel starts every repository's sequence at once. It is
	// the default for new groups (ADR-0028).
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
	QuickCommands []QuickCommand `json:"quickCommands"`
	// Continuous marks a repository whose sequence ends in a process that
	// runs until stopped (a dev server). Group runs treat it as up once that
	// step has started (ADR-0028).
	Continuous      bool     `json:"continuous"`
	EnvFiles        []string `json:"envFiles"`
	GroupID         string   `json:"groupId"`
	LastRefreshedAt string   `json:"lastRefreshedAt"`
	// Dependencies and DevDependencies count package.json entries; Stack
	// lists well-known frameworks and tools found among them (dashboard).
	Dependencies    int      `json:"dependencies"`
	DevDependencies int      `json:"devDependencies"`
	Stack           []string `json:"stack"`
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
//
// A saved sequence holds only the steps that run, in order (ADR-0022);
// package.json scripts that are not part of it are not stored. Enabled is
// always true in saved data and is kept so older files, where disabled steps
// were stored too, can be read (their disabled steps are dropped).
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

// LeftoverRun is a run started by an earlier RepoDock session that ended,
// whose processes are still running (ADR-0021). They are found by the
// marker environment variables RepoDock gives every child process.
type LeftoverRun struct {
	RunID        string `json:"runId"`
	RepositoryID string `json:"repositoryId"`
	// RepositoryName is the repository's display name, empty when it is no
	// longer registered.
	RepositoryName string `json:"repositoryName"`
	// Command is the command line of the run's oldest surviving process.
	Command   string `json:"command"`
	StartedAt string `json:"startedAt"`
	// PIDs lists the surviving processes, that root process first.
	PIDs []int `json:"pids"`
	// Ports are the TCP ports the processes listen on.
	Ports []int `json:"ports"`
}

// ClosingProgress is reported while RepoDock stops its processes before
// quitting (ADR-0023).
type ClosingProgress struct {
	// Runs are the runs still alive, oldest first.
	Runs []ClosingRun `json:"runs"`
	// Groups counts process groups that still have members (it may stay
	// above zero briefly after every run has exited).
	Groups int `json:"groups"`
	// Forcing is true once the grace period is over and survivors are
	// being killed.
	Forcing   bool  `json:"forcing"`
	Done      bool  `json:"done"`
	ElapsedMs int64 `json:"elapsedMs"`
}

type ClosingRun struct {
	RunID          string `json:"runId"`
	Label          string `json:"label"`
	RepositoryName string `json:"repositoryName"`
	PID            int    `json:"pid"`
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
// (no enabled steps, or excluded by the user), cancelled.
type GroupRepoState struct {
	RepositoryID string     `json:"repositoryId"`
	Name         string     `json:"name"`
	SequenceID   string     `json:"sequenceId"`
	Status       StepStatus `json:"status"`
	Error        string     `json:"error"`
	// Excluded marks a member skipped because the group skips it (ADR-0024).
	Excluded bool `json:"excluded"`
	// Continuous marks a long-running member: it is "started" once its last
	// step runs and is not counted as something to finish (ADR-0028).
	Continuous bool `json:"continuous"`
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
	// ImportSequences imports each repository's command sequence (the
	// import dialog sends true unless the user opts out); when false,
	// repositories are added with an empty sequence.
	ImportSequences bool `json:"importSequences"`
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
	// PackageJSON is true when the folder has a readable package.json; a
	// valid folder without one is a plain folder.
	PackageJSON bool `json:"packageJson"`
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

// JWTSettings is the remembered input of the "JWT tool" mini app. Keys are
// secrets: they are stored only in the app's local settings file (0600) and
// never logged or exported.
type JWTSettings struct {
	// Algorithm is RS256 (PEM key pair) or HS256 (shared secret).
	Algorithm string `json:"algorithm"`
	ID        string `json:"id"`
	Email     string `json:"email"`
	// ExpiresInDays may be fractional (0.5 = 12 hours).
	ExpiresInDays float64 `json:"expiresInDays"`
	Issuer        string  `json:"issuer"`
	Subject       string  `json:"subject"`
	Realm         string  `json:"realm"`
	Channel       string  `json:"channel"`
	DeviceID      string  `json:"deviceId"`
	// Roles is the user's role catalogue; SelectedRoles go into the token.
	Roles         []string `json:"roles"`
	SelectedRoles []string `json:"selectedRoles"`
	// ExtraClaims is an optional JSON object merged over the payload.
	ExtraClaims string `json:"extraClaims"`
	// PrivateKey/PublicKey are PEM text or base64-encoded PEM (RS256);
	// Secret is the HS256 shared secret.
	PrivateKey string `json:"privateKey"`
	PublicKey  string `json:"publicKey"`
	Secret     string `json:"secret"`
}

// JWTToken is a generated token and its decoded parts.
type JWTToken struct {
	Token     string `json:"token"`
	Payload   string `json:"payload"`
	ExpiresAt string `json:"expiresAt"`
}

// JWTDecoded is a parsed token. Signature is "valid", "invalid" or
// "unverified" (no key to check it with).
type JWTDecoded struct {
	Header         string   `json:"header"`
	Payload        string   `json:"payload"`
	Algorithm      string   `json:"algorithm"`
	IssuedAt       string   `json:"issuedAt"`
	ExpiresAt      string   `json:"expiresAt"`
	Expired        bool     `json:"expired"`
	Roles          []string `json:"roles"`
	Signature      string   `json:"signature"`
	SignatureError string   `json:"signatureError"`
}
