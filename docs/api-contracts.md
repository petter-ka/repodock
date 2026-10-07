# Application Contract Surface

RepoDock uses Wails v2 bindings between React/TypeScript and Go. The facade is `internal/app.App`, exposed to the frontend as `window.go.app.App` and wrapped exclusively by `frontend/src/lib/bridge.ts`. TypeScript mirrors of the payloads live in `frontend/src/lib/contracts.ts` and must be kept in sync with `internal/domain`.

Lifecycle hooks are package-level (`app.Hooks`) so they are not bound to the frontend. Errors reject the promise with a message string.

## Workspace

- `StartupReport()` — workspace path, recovered-backup path (if a corrupt file was moved aside) and warnings.
- `Workspace()` — current workspace snapshot.
- `BrowseRepository()` — native folder picker; empty string means cancelled.
- `AddRepository(path, groupID)` — always creates a new record. The folder may have a readable `package.json` or none (plain folder: no scripts, `packageManager: ""`). A folder that is already registered is allowed; the new record gets a numbered alias `<name> (n)` (ADR-0015).
- `RefreshRepository(id)`, `RefreshAll()` — re-read metadata. A missing/invalid `package.json` keeps the record and sets `problem` (a plain folder without `package.json` stays healthy).
- `CheckRepositoryFolder(path)` — never fails; returns `{ path, exists, valid (readable package.json, or none), name, problem, registeredId, registeredName }`. `registeredId` is informational: several records may share a folder. Changes nothing.
- `RelocateRepository(id, path)` — points a repository at another folder; keeps ID, group and sequence; refreshes metadata. Rejected for unusable folders, folders registered to another repository, or while the repository has running processes.
- `RemoveRepository(id)` — stops the repository's processes and removes the registration. Nothing on disk is touched.
- `SetGroupRunMode(id, mode)` — `"sequential"` or `"parallel"`; persisted on the group.
- `CreateGroup(name)`, `RenameGroup(id, name)`, `DeleteGroup(id)` (members move to the first remaining group; the last group cannot be deleted), `SetGroupCollapsed(id, collapsed)`, `AssignRepository(id, groupID)` (appends), `RenameRepository(id, alias)` (display name; trimmed, single line, ≤ 200 chars; blank clears), `MoveGroup(id, index)` (sidebar order; index excludes the group; negative appends), `MoveRepository(id, groupID, index)` (inserts at `index` among the target group's other members; negative or out-of-range appends; same group reorders — ADR-0014).
- `SaveCommandSequence(repoID, steps)` — persists ordered steps; blank labels and missing IDs are filled in. Each step keeps one kind: `script`, else `globalCommand`, else `command`.
- `SaveGlobalCommands(commands)` — replaces the workspace's global commands (`{ id, name, command }`, ADR-0012) and returns the normalized list. Rejects empty or duplicate names, empty or multi-line commands. Steps referencing a removed command fail when run.

## Process

- `RunScript(repoID, scriptName, label)` — runs a declared script as `[pm, "run", name]` argv (ADR-0008).
- `RunCommand(repoID, command, label)` — runs single-line shell text in the repository folder. Empty text is a `skipped` no-op run.
- `WaitForRun(runID)`, `StopProcess(runID)` (tree termination, ADR-0007), `RestartProcess(runID)` (same spec, new run ID).
- `SendInput(runID, text, secret)` — writes one line (`text` + newline) to a running process's stdin to answer a prompt (ADR-0013). Single line, ≤ 4 KiB; rejected when the run is not running, input was closed, or the process does not read within 3 s. The line is echoed as a `stdin` output line, masked when `secret`.
- `CloseInput(runID)` — closes the running process's stdin (EOF); later input is rejected.
- `StopRepository(repoID)` — cancels the repository's sequence and stops all its runs.
- `ActiveRuns()`, `Runs()` (active + up to 200 retained finished runs), `ProcessSnapshots()`.

A spawn failure (e.g. missing working directory) returns a `failed` run with an explanatory stderr line instead of an error.

## Sequences

- `RunSequence(repoID)` — runs the saved, enabled steps (ADR-0009). Global command steps resolve their command text at run time (ADR-0012).
- `CancelSequence(sequenceID)`, `Sequences()` (latest per repository).

## Group runs

- `RunGroup(groupID)` — runs every member repository's saved sequence using the group's run mode (ADR-0010). Rejected when the group is already running or no member has enabled steps.
- `StopGroup(groupID)` — cancels the group run and stops all processes of all members (background steps included).
- `GroupRuns()` — latest run per group.

`GroupRun` = `{ id, groupId, mode, status (running|completed|failed|cancelled), repos[], startedAt, endedAt }`; each `repos[]` entry is `{ repositoryId, name, sequenceId, status (pending|running|completed|failed|skipped|cancelled), error }`.

## Export / import

- `ExportWorkspace(groupIDs)` — native Save dialog, then writes the export document (all groups when `groupIDs` is empty). Returns the path, or `""` when cancelled.
- `ChooseImportFile()` — native Open dialog (`*.json`). Returns the path, or `""` when cancelled.
- `PreviewImport(path)` — validates the file and returns an `ImportPreview` (`groups[]` with `exists`, repositories with `status` new|missing|existing (a folder repeated in the file is imported once per entry; `duplicate` is no longer produced) and `steps`; `globalCommands[]` with `{ id, name, command, status (new|existing|renamed), importName }`; counts `groupsToCreate`, `new`, `existing`, `missing`, `shellCommands`). Preview steps reference `globalCommands[].id`. Changes nothing.
- `ApplyImport(path, { keepStepsEnabled, pathOverrides })` — step order is always kept; `keepStepsEnabled` keeps each step's enabled flag (the dialog defaults to true; false imports every step disabled). `pathOverrides` maps a preview path to a replacement folder; every override is validated first and an unusable one rejects the import. Merges and returns `{ groupsCreated, globalCommandsAdded, repositoriesAdded, repositoriesSkipped }`. Emits `workspace:changed`. Executes nothing.

## Environment

- `EnvironmentFiles(repoID)` — metadata only (name, path, size, modifiedAt); never content.
- `ReadEnvironmentFile(repoID, name)` — content of an allow-listed file (≤ 1 MiB).
- `SaveEnvironmentFile(repoID, name, content)` — atomic overwrite of an existing allow-listed file; text is written exactly as given.

## Events

| Event | Payload | Purpose |
|---|---|---|
| `workspace:changed` | `Workspace` | Refresh sidebar and repository metadata |
| `process:started` | `Run` | New run, or stopping-state update |
| `process:output-batch` | `ProcessOutput[]` | Output lines coalesced every ~50 ms (or 500 lines); each line carries run ID, repository ID, PID, stream (`stdout`, `stderr`, or `stdin` for echoed input), `partial` (unterminated line shown after output paused — usually a prompt), global `seq` and timestamp |
| `process:stats` | `ProcessSnapshot` | ~1 Hz RSS/CPU aggregated over the run's process tree |
| `process:exited` | `ProcessExit` | Terminal state; always emitted after the run's final output batch |
| `sequence:updated` | `SequenceRun` | Full sequence snapshot after every state change |
| `group:updated` | `GroupRun` | Full group-run snapshot after every state change |

`process:output-batch` replaced the starter's per-line `process:output` event to keep IPC volume bounded under chatty processes (risk R-002). Future additions should use business nouns and remain backward compatible with the frontend consumer.
