// Transport contracts mirroring internal/domain. Keep in sync with
// internal/domain/models.go and docs/api-contracts.md.

export type Script = { name: string; command: string }

export type CommandStep = {
  id: string
  label: string
  /** package.json script name; takes precedence over command */
  script: string
  /** shell text; empty together with script means a no-op step */
  command: string
  enabled: boolean
  /** start and continue without waiting for exit */
  background: boolean
}

export type Repository = {
  id: string
  name: string
  path: string
  packageManager: string
  scripts: Script[]
  /** null when the record never had a sequence */
  commandSequence: CommandStep[] | null
  envFiles: string[]
  groupId: string
  lastRefreshedAt: string
  problem: string
}

export type GroupRunMode = "sequential" | "parallel"

export type Group = { id: string; name: string; repositoryIds: string[]; collapsed: boolean; runMode: GroupRunMode }

export type Workspace = { version: number; groups: Group[]; repositories: Repository[] }

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
  stream: "stdout" | "stderr"
  text: string
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

export type GroupRepoState = { repositoryId: string; name: string; sequenceId: string; status: StepStatus; error: string }
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
export type ImportRepositoryPreview = { name: string; path: string; status: ImportStatus; steps: CommandStep[] | null }
export type ImportGroupPreview = { name: string; exists: boolean; repositories: ImportRepositoryPreview[] }
export type ImportPreview = {
  path: string
  exportedAt: string
  groups: ImportGroupPreview[]
  groupsToCreate: number
  new: number
  existing: number
  missing: number
  shellCommands: number
}
export type ImportOptions = { keepStepsEnabled: boolean }
export type ImportResult = { groupsCreated: number; repositoriesAdded: number; repositoriesSkipped: number }

export type StartupReport = { workspacePath: string; recoveredBackup: string; warnings: string[] }

/** Methods bound from internal/app.App. */
export type AppBinding = {
  StartupReport(): Promise<StartupReport>
  Workspace(): Promise<Workspace>
  BrowseRepository(): Promise<string>
  AddRepository(path: string, groupID: string): Promise<Repository>
  RefreshRepository(id: string): Promise<Repository>
  RefreshAll(): Promise<void>
  RemoveRepository(id: string): Promise<void>
  CreateGroup(name: string): Promise<Group>
  RenameGroup(id: string, name: string): Promise<void>
  DeleteGroup(id: string): Promise<void>
  SetGroupCollapsed(id: string, collapsed: boolean): Promise<void>
  AssignRepository(id: string, groupID: string): Promise<void>
  SetGroupRunMode(id: string, mode: GroupRunMode): Promise<void>
  RunGroup(groupID: string): Promise<GroupRun>
  StopGroup(groupID: string): Promise<void>
  GroupRuns(): Promise<GroupRun[]>
  ExportWorkspace(groupIDs: string[]): Promise<string>
  ChooseImportFile(): Promise<string>
  PreviewImport(path: string): Promise<ImportPreview>
  ApplyImport(path: string, options: ImportOptions): Promise<ImportResult>
  SaveCommandSequence(repoID: string, steps: CommandStep[]): Promise<void>
  RunScript(repoID: string, scriptName: string, label: string): Promise<Run>
  RunCommand(repoID: string, command: string, label: string): Promise<Run>
  WaitForRun(runID: string): Promise<Run>
  StopProcess(runID: string): Promise<void>
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
}

export function isActive(status: RunStatus) {
  return status === "queued" || status === "starting" || status === "running" || status === "stopping"
}

/** Go encodes zero time.Time as 0001-01-01T00:00:00Z. */
export function isZeroTime(value: string | undefined) {
  return !value || value.startsWith("0001-01-01")
}
