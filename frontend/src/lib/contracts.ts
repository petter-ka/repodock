// Transport contracts mirroring internal/domain. Keep in sync with
// internal/domain/models.go and docs/api-contracts.md.

export type Script = { name: string; command: string }

/** Any process on this machine (Kill process mini app, ADR-0018). PID 0 = owner of a port not visible. */
export type HostProcess = {
  pid: number
  ppid: number
  name: string
  command: string
  user: string
  startedAt: string
  ports: number[]
  /** set when the process belongs to a RepoDock run (killing it stops that run) */
  runId: string
  repositoryId: string
  /** why it cannot be killed from RepoDock; "" when it can */
  protected: string
}
export type KillResult = { pid: number; signalled: number[]; forced: boolean; runId: string }

/** Progress while RepoDock stops its processes before quitting (ADR-0023). */
export type ClosingProgress = {
  /** runs still alive, oldest first */
  runs: { runId: string; label: string; repositoryName: string; pid: number }[]
  /** process groups that still have members */
  groups: number
  /** the grace period is over and survivors are being killed */
  forcing: boolean
  done: boolean
  elapsedMs: number
}

/** A run from an earlier RepoDock session that is still running (ADR-0021). */
export type LeftoverRun = {
  runId: string
  repositoryId: string
  /** display name; empty when the repository is no longer registered */
  repositoryName: string
  command: string
  startedAt: string
  /** surviving processes, the oldest (root) first */
  pids: number[]
  ports: number[]
}

export type JwtAlgorithm = "RS256" | "HS256"
export type JwtSettings = {
  algorithm: JwtAlgorithm
  id: string
  email: string
  expiresInDays: number
  issuer: string
  subject: string
  realm: string
  channel: string
  deviceId: string
  roles: string[]
  selectedRoles: string[]
  extraClaims: string
  privateKey: string
  publicKey: string
  secret: string
}
export type JwtToken = { token: string; payload: string; expiresAt: string }
export type JwtDecoded = {
  header: string
  payload: string
  algorithm: string
  issuedAt: string
  expiresAt: string
  expired: boolean
  roles: string[]
  signature: "valid" | "invalid" | "unverified"
  signatureError: string
}

/** A pinned script, global command or shell command (exactly one is set). */
export type QuickCommand = { id: string; label: string; script: string; globalCommand: string; command: string }

export type CommandStep = {
  id: string
  label: string
  /** package.json script name; takes precedence over globalCommand and command */
  script: string
  /** ID of a workspace global command; takes precedence over command */
  globalCommand: string
  /** shell text; empty together with script means a no-op step */
  command: string
  enabled: boolean
  /** start and continue without waiting for exit */
  background: boolean
}

export type Repository = {
  id: string
  /** from package.json, or the folder name for a plain folder */
  name: string
  /** user-chosen display name; "" when none (ADR-0015) */
  alias: string
  path: string
  /** "" for a plain folder without package.json */
  packageManager: string
  scripts: Script[]
  /** null when the record never had a sequence */
  commandSequence: CommandStep[] | null
  /** pinned chips under the sequence line (ADR-0017) */
  quickCommands: QuickCommand[]
  /** its sequence ends in a process that runs until stopped (dev server) — ADR-0028 */
  continuous: boolean
  envFiles: string[]
  groupId: string
  lastRefreshedAt: string
  /** package.json dependency counts */
  dependencies: number
  devDependencies: number
  /** well-known frameworks and tools found among the dependencies */
  stack: string[] | null
  problem: string
}

export type GroupRunMode = "sequential" | "parallel"

/** Starts/stops a group at local times on chosen weekdays (ADR-0025). */
export type GroupSchedule = {
  /** weekdays, 0 = Sunday … 6 = Saturday */
  days: number[]
  startEnabled: boolean
  /** "HH:MM" */
  startAt: string
  stopEnabled: boolean
  /** "HH:MM" */
  stopAt: string
}

export type Group = {
  id: string
  name: string
  repositoryIds: string[]
  collapsed: boolean
  runMode: GroupRunMode
  /** members "Run group" leaves out (ADR-0024) */
  skippedRepositoryIds: string[] | null
  schedule: GroupSchedule | null
}

/** A scheduled stop of a running group, announced with a countdown (ADR-0025). */
export type ScheduledStop = { groupId: string; groupName: string; stopAt: string; postponed: boolean; running: number }
export type ScheduleKind = "start" | "stop"
/** What a group's schedule does next; a zero time (isZeroTime) means none within a week. */
export type GroupScheduleStatus = {
  groupId: string
  nextStart: string
  /** the user cancelled nextStart */
  startSkipped: boolean
  nextStop: string
  /** the user cancelled nextStop */
  stopSkipped: boolean
  stopPostponed: boolean
}
/** A schedule acted on its own. */
export type ScheduleEvent = { groupId: string; groupName: string; action: "started" | "stopped"; error: string }

/** Reusable shell command shared by every repository's sequence. */
export type GlobalCommand = { id: string; name: string; command: string }

export type Workspace = { version: number; groups: Group[]; repositories: Repository[]; globalCommands: GlobalCommand[] }

export type RunStatus = "queued" | "starting" | "running" | "stopping" | "exited" | "failed" | "stopped" | "skipped"

export type Run = {
  id: string
  repositoryId: string
  command: string
  label: string
  status: RunStatus
  pid: number
  exitCode: number
  startedAt: string
  endedAt: string
  sequenceId: string
  stepId: string
}

export type ProcessOutput = {
  runId: string
  repositoryId: string
  pid: number
  /** "stdin" is the echo of input sent with SendInput */
  stream: "stdout" | "stderr" | "stdin"
  text: string
  /** unterminated line shown after output paused — usually a prompt */
  partial: boolean
  seq: number
  timestamp: string
}

export type ProcessSnapshot = {
  runId: string
  repositoryId: string
  pid: number
  status: string
  memoryBytes: number
  cpuPercent: number
  processCount: number
  observedAt: string
}

export type ProcessExit = { runId: string; repositoryId: string; exitCode: number; status: RunStatus; endedAt: string }

export type EnvFile = { name: string; path: string; content: string; size: number; modifiedAt: string }

export type SequenceStatus = "running" | "completed" | "failed" | "cancelled"
export type StepStatus = "pending" | "running" | "started" | "completed" | "failed" | "skipped" | "cancelled"
export type SequenceStepState = { stepId: string; label: string; runId: string; status: StepStatus; error: string }
export type SequenceRun = {
  id: string
  repositoryId: string
  status: SequenceStatus
  steps: SequenceStepState[]
  startedAt: string
  endedAt: string
}

/** `excluded`: skipped because the group skips this member (ADR-0024). */
/** `continuous`: a long-running member, "started" once its last step runs and not counted as something to finish (ADR-0028). */
export type GroupRepoState = { repositoryId: string; name: string; sequenceId: string; status: StepStatus; error: string; excluded: boolean; continuous: boolean }
export type GroupRun = {
  id: string
  groupId: string
  mode: GroupRunMode
  status: SequenceStatus
  repos: GroupRepoState[]
  startedAt: string
  endedAt: string
}

export type ImportStatus = "new" | "missing" | "existing" | "duplicate"
export type ImportRepositoryPreview = { name: string; path: string; status: ImportStatus; steps: CommandStep[] | null; quickCommands: QuickCommand[] | null }
export type ImportGlobalCommandStatus = "new" | "existing" | "renamed"
export type ImportGlobalCommandPreview = {
  /** document-local ID referenced by preview steps */
  id: string
  name: string
  command: string
  status: ImportGlobalCommandStatus
  /** name after import (differs from name when renamed) */
  importName: string
}
export type ImportGroupPreview = { name: string; exists: boolean; repositories: ImportRepositoryPreview[] }
export type ImportPreview = {
  path: string
  exportedAt: string
  groups: ImportGroupPreview[]
  globalCommands: ImportGlobalCommandPreview[] | null
  groupsToCreate: number
  new: number
  existing: number
  missing: number
  shellCommands: number
}
export type ImportOptions = {
  /** import each repository's command sequence; false adds empty sequences */
  importSequences: boolean
  /** preview path → replacement folder chosen by the user */
  pathOverrides?: Record<string, string>
}

export type FolderCheck = {
  path: string
  exists: boolean
  /** usable: a readable package.json, or none at all (plain folder) */
  valid: boolean
  name: string
  /** has a readable package.json */
  packageJson: boolean
  problem: string
  registeredId: string
  registeredName: string
}
export type ImportResult = { groupsCreated: number; globalCommandsAdded: number; repositoriesAdded: number; repositoriesSkipped: number }

export type StartupReport = { workspacePath: string; recoveredBackup: string; warnings: string[] }

/** Methods bound from internal/app.App. */
export type AppBinding = {
  StartupReport(): Promise<StartupReport>
  Workspace(): Promise<Workspace>
  OpenRepositoryInVSCode(id: string): Promise<void>
  BrowseRepository(): Promise<string>
  AddRepository(path: string, groupID: string): Promise<Repository>
  RefreshRepository(id: string): Promise<Repository>
  RefreshAll(): Promise<void>
  CheckRepositoryFolder(path: string): Promise<FolderCheck>
  RelocateRepository(id: string, path: string): Promise<Repository>
  RemoveRepository(id: string): Promise<void>
  CreateGroup(name: string): Promise<Group>
  RenameGroup(id: string, name: string): Promise<void>
  DeleteGroup(id: string): Promise<void>
  SetGroupCollapsed(id: string, collapsed: boolean): Promise<void>
  AssignRepository(id: string, groupID: string): Promise<void>
  MoveRepository(id: string, groupID: string, index: number): Promise<void>
  RenameRepository(id: string, alias: string): Promise<void>
  SaveQuickCommands(repoID: string, commands: QuickCommand[]): Promise<QuickCommand[]>
  FindProcessByPID(pid: number): Promise<HostProcess>
  FindProcessesByPort(port: number): Promise<HostProcess[]>
  KillHostProcess(pid: number, includeChildren: boolean): Promise<KillResult>
  LeftoverProcesses(): Promise<LeftoverRun[]>
  StopLeftoverProcesses(runIDs: string[]): Promise<number>
  JWTSettings(): Promise<JwtSettings>
  SaveJWTSettings(settings: JwtSettings): Promise<JwtSettings>
  GenerateJWT(settings: JwtSettings): Promise<JwtToken>
  DecodeJWT(token: string, settings: JwtSettings): Promise<JwtDecoded>
  MoveGroup(id: string, index: number): Promise<void>
  SetGroupRunMode(id: string, mode: GroupRunMode): Promise<void>
  SetRepositorySkipped(repoID: string, skipped: boolean): Promise<void>
  SetRepositoryContinuous(repoID: string, continuous: boolean): Promise<void>
  SetGroupSchedule(groupID: string, schedule: GroupSchedule): Promise<Group>
  ScheduledStops(): Promise<ScheduledStop[]>
  PostponeScheduledStop(groupID: string, minutes: number): Promise<void>
  SkipScheduledStop(groupID: string): Promise<void>
  StopScheduledNow(groupID: string): Promise<void>
  ScheduleStatuses(): Promise<GroupScheduleStatus[]>
  SkipNextScheduled(groupID: string, kind: ScheduleKind): Promise<void>
  ResumeScheduled(groupID: string, kind: ScheduleKind): Promise<void>
  TakeLaunchFolders(): Promise<FolderCheck[]>
  RunGroup(groupID: string): Promise<GroupRun>
  StopGroup(groupID: string): Promise<void>
  GroupRuns(): Promise<GroupRun[]>
  ExportWorkspace(groupIDs: string[]): Promise<string>
  ChooseImportFile(): Promise<string>
  PreviewImport(path: string): Promise<ImportPreview>
  ApplyImport(path: string, options: ImportOptions): Promise<ImportResult>
  SaveCommandSequence(repoID: string, steps: CommandStep[]): Promise<void>
  SaveGlobalCommands(commands: GlobalCommand[]): Promise<GlobalCommand[]>
  RunScript(repoID: string, scriptName: string, label: string): Promise<Run>
  RunCommand(repoID: string, command: string, label: string): Promise<Run>
  WaitForRun(runID: string): Promise<Run>
  StopProcess(runID: string): Promise<void>
  SendInput(runID: string, text: string, secret: boolean): Promise<void>
  CloseInput(runID: string): Promise<void>
  RestartProcess(runID: string): Promise<Run>
  StopRepository(repoID: string): Promise<void>
  ActiveRuns(): Promise<Run[]>
  Runs(): Promise<Run[]>
  ProcessSnapshots(): Promise<ProcessSnapshot[]>
  RunSequence(repoID: string): Promise<SequenceRun>
  CancelSequence(sequenceID: string): Promise<void>
  Sequences(): Promise<SequenceRun[]>
  EnvironmentFiles(repoID: string): Promise<EnvFile[]>
  ReadEnvironmentFile(repoID: string, name: string): Promise<EnvFile>
  SaveEnvironmentFile(repoID: string, name: string, content: string): Promise<void>
}

/** Backend event names and payloads. */
export type EventMap = {
  "workspace:changed": Workspace
  "process:started": Run
  "process:output-batch": ProcessOutput[]
  "process:stats": ProcessSnapshot
  "process:exited": ProcessExit
  "sequence:updated": SequenceRun
  "group:updated": GroupRun
  "app:closing": ClosingProgress
  "schedule:pending": ScheduledStop[]
  "schedule:fired": ScheduleEvent
  "schedule:status": GroupScheduleStatus[]
  /** folders handed to RepoDock are waiting; fetch them with TakeLaunchFolders */
  "launch:folder": null
}

export function isActive(status: RunStatus) {
  return status === "queued" || status === "starting" || status === "running" || status === "stopping"
}

/** Go encodes zero time.Time as 0001-01-01T00:00:00Z. */
export function isZeroTime(value: string | undefined) {
  return !value || value.startsWith("0001-01-01")
}

/** The name to show for a repository: its alias, else its discovered name. */
export function displayName(repo: Pick<Repository, "name" | "alias">) {
  return repo.alias || repo.name
}
