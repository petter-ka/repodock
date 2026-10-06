# Application Contract Surface

RepoDock uses Wails v2 bindings between React/TypeScript and Go. The facade is `internal/app.App`, exposed to the frontend as `window.go.app.App` and wrapped exclusively by `frontend/src/lib/bridge.ts`. TypeScript mirrors of the payloads live in `frontend/src/lib/contracts.ts` and must be kept in sync with `internal/domain`.

Lifecycle hooks are package-level (`app.Hooks`) so they are not bound to the frontend. Errors reject the promise with a message string.

## Workspace

- `StartupReport()` — workspace path, recovered-backup path (if a corrupt file was moved aside) and warnings.
- `Workspace()` — current workspace snapshot.
- `BrowseRepository()` — native folder picker; empty string means cancelled.
- `AddRepository(path, groupID)` — requires a valid `package.json`. An already registered path returns the existing (refreshed) record.
- `RefreshRepository(id)`, `RefreshAll()` — re-read metadata. A missing/invalid `package.json` keeps the record and sets `problem`.
- `RemoveRepository(id)` — stops the repository's processes and removes the registration. Nothing on disk is touched.
- `SetGroupRunMode(id, mode)` — `"sequential"` or `"parallel"`; persisted on the group.
- `CreateGroup(name)`, `RenameGroup(id, name)`, `DeleteGroup(id)` (members move to the first remaining group; the last group cannot be deleted), `SetGroupCollapsed(id, collapsed)`, `AssignRepository(id, groupID)`.
- `SaveCommandSequence(repoID, steps)` — persists ordered steps; blank labels and missing IDs are filled in.

## Process

- `RunScript(repoID, scriptName, label)` — runs a declared script as `[pm, "run", name]` argv (ADR-0008).
- `RunCommand(repoID, command, label)` — runs single-line shell text in the repository folder. Empty text is a `skipped` no-op run.
- `WaitForRun(runID)`, `StopProcess(runID)` (tree termination, ADR-0007), `RestartProcess(runID)` (same spec, new run ID).
- `StopRepository(repoID)` — cancels the repository's sequence and stops all its runs.
- `ActiveRuns()`, `Runs()` (active + up to 200 retained finished runs), `ProcessSnapshots()`.

A spawn failure (e.g. missing working directory) returns a `failed` run with an explanatory stderr line instead of an error.

## Sequences

- `RunSequence(repoID)` — runs the saved, enabled steps (ADR-0009).
- `CancelSequence(sequenceID)`, `Sequences()` (latest per repository).

## Group runs

- `RunGroup(groupID)` — runs every member repository's saved sequence using the group's run mode (ADR-0010). Rejected when the group is already running or no member has enabled steps.
- `StopGroup(groupID)` — cancels the group run and stops all processes of all members (background steps included).
- `GroupRuns()` — latest run per group.

`GroupRun` = `{ id, groupId, mode, status (running|completed|failed|cancelled), repos[], startedAt, endedAt }`; each `repos[]` entry is `{ repositoryId, name, sequenceId, status (pending|running|completed|failed|skipped|cancelled), error }`.

## Export / import

- `ExportWorkspace(groupIDs)` — native Save dialog, then writes the export document (all groups when `groupIDs` is empty). Returns the path, or `""` when cancelled.
- `ChooseImportFile()` — native Open dialog (`*.json`). Returns the path, or `""` when cancelled.
- `PreviewImport(path)` — validates the file and returns an `ImportPreview` (`groups[]` with `exists`, repositories with `status` new|missing|existing|duplicate and `steps`; counts `groupsToCreate`, `new`, `existing`, `missing`, `shellCommands`). Changes nothing.
- `ApplyImport(path, { keepStepsEnabled })` — merges and returns `{ groupsCreated, repositoriesAdded, repositoriesSkipped }`. Emits `workspace:changed`. Executes nothing.

## Environment

- `EnvironmentFiles(repoID)` — metadata only (name, path, size, modifiedAt); never content.
- `ReadEnvironmentFile(repoID, name)` — content of an allow-listed file (≤ 1 MiB).
- `SaveEnvironmentFile(repoID, name, content)` — atomic overwrite of an existing allow-listed file; text is written exactly as given.

## Events

| Event | Payload | Purpose |
|---|---|---|
| `workspace:changed` | `Workspace` | Refresh sidebar and repository metadata |
| `process:started` | `Run` | New run, or stopping-state update |
| `process:output-batch` | `ProcessOutput[]` | Output lines coalesced every ~50 ms (or 500 lines); each line carries run ID, repository ID, PID, stream, global `seq` and timestamp |
| `process:stats` | `ProcessSnapshot` | ~1 Hz RSS/CPU aggregated over the run's process tree |
| `process:exited` | `ProcessExit` | Terminal state; always emitted after the run's final output batch |
| `sequence:updated` | `SequenceRun` | Full sequence snapshot after every state change |
| `group:updated` | `GroupRun` | Full group-run snapshot after every state change |

`process:output-batch` replaced the starter's per-line `process:output` event to keep IPC volume bounded under chatty processes (risk R-002). Future additions should use business nouns and remain backward compatible with the frontend consumer.
