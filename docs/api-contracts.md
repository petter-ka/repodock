# Application Contract Surface

RepoDock uses Wails v2 bindings between React/TypeScript and Go. The facade is `internal/app.App`, exposed to the frontend as `window.go.app.App` and wrapped exclusively by `frontend/src/lib/bridge.ts`. TypeScript mirrors of the payloads live in `frontend/src/lib/contracts.ts` and must be kept in sync with `internal/domain`.

Lifecycle hooks are package-level (`app.Hooks`) so they are not bound to the frontend. Errors reject the promise with a message string.

## Workspace

- `StartupReport()` — workspace path, recovered-backup path (if a corrupt file was moved aside) and warnings.
- `Workspace()` — current workspace snapshot.
- `BrowseRepository()` — native folder picker; empty string means cancelled.
- `AddRepository(path, groupID)` — always creates a new record. The folder may have a readable `package.json` or none (plain folder: no scripts, `packageManager: ""`). A folder that is already registered is allowed; the new record gets a numbered alias `<name> (n)` (ADR-0015).
- `RefreshRepository(id)`, `RefreshAll()` — re-read metadata. A missing/invalid `package.json` keeps the record and sets `problem` (a plain folder without `package.json` stays healthy).
- `CheckRepositoryFolder(path)` — never fails; returns `{ path, exists, valid (readable package.json, or none), name, packageJson (has a readable package.json), problem, registeredId, registeredName }`. `registeredId` is informational: several records may share a folder. Changes nothing.
- `RelocateRepository(id, path)` — points a repository at another folder; keeps ID, group and sequence; refreshes metadata. Rejected for unusable folders, folders registered to another repository, or while the repository has running processes.
- `RemoveRepository(id)` — stops the repository's processes and removes the registration. Nothing on disk is touched.
- `SetGroupRunMode(id, mode)` — `"sequential"` or `"parallel"`; persisted on the group.
- `SetRepositoryContinuous(repoID, continuous)` — marks a long-running repository (dev server); group runs count it as up once its last step starts (ADR-0028).
- `SetRepositorySkipped(repoID, skipped)` — "Run group" leaves the repository out (ADR-0024); stored in its current group's `skippedRepositoryIds`.
- `SetGroupSchedules(groupIDs, schedule)` → `Group[]` — validates `{ days, startEnabled, startAt, stopEnabled, stopAt }` and gives every listed group its own copy (ADR-0025); other groups keep theirs. At least one existing group is required. Forgets postponed and cancelled starts/stops of those groups.
- `TakeLaunchFolders()` → `FolderCheck[]` — folders handed to RepoDock on its command line, by a second launch or a macOS "open" event, waiting for the user; returns and forgets them (ADR-0026).
- `NodeVersions()` → `NodeOverview { managers[], installs[] (newest first: { version, manager, binDir, default, eol }), default, repositories[] (NodeStatus), scannedAt }`; `NodeStatus` = `{ repositoryId, version ("" = none found), manager, source (selected|request|default), missing, enginesMismatch, eol, newer }` (ADR-0031). `RescanNodeVersions()` scans the version managers' folders again and returns the same. `SetRepositoryNodeVersion(repoID, version)` — an exact installed version, or `""` for automatic; persisted, emits `workspace:changed`.
- `AppInfo()` → `{ version (release tag or "dev"), commit, commitTime, modified, platform, goVersion, repository }`; `CheckForUpdates()` → `UpdateCheck { current, latest (Release), updateAvailable, comparable, releases[] (newest first: { tag, name, url, notes, publishedAt, prerelease, newer }), checkedAt }` — the only network request (GitHub releases API), made only when called (ADR-0034); `OpenExternalURL(url)` opens an `https` link in the default browser.
- `CreateGroup(name)`, `RenameGroup(id, name)`, `DeleteGroup(id)` (members move to the first remaining group; the last group cannot be deleted), `SetGroupCollapsed(id, collapsed)`, `AssignRepository(id, groupID)` (appends), `FindProcessByPID(pid)`, `FindProcessesByPort(port)` → `HostProcess { pid, ppid, name, command, user, startedAt, ports, runId, repositoryId, protected }`; `KillHostProcess(pid, includeChildren)` → `{ pid, signalled, forced, runId }` (SIGTERM, SIGKILL after 3 s; refuses PID ≤ 1, RepoDock and its ancestors; a RepoDock run's PID stops that run — ADR-0018). `JWTSettings()` / `SaveJWTSettings(settings)` → `JWTSettings { algorithm, id, email, expiresInDays, issuer, subject, realm, channel, deviceId, roles, selectedRoles, extraClaims, privateKey, publicKey, secret }` (normalized; stored in `jwt-tool.json`, 0600), `GenerateJWT(settings)` → `{ token, payload, expiresAt }`, `DecodeJWT(token, settings)` → `{ header, payload, algorithm, issuedAt, expiresAt, expired, roles, signature: valid|invalid|unverified, signatureError }` (ADR-0020). `SaveQuickCommands(repoID, commands)` (pinned chips `{ id, label, script, globalCommand, command }`; returns the normalized list — ADR-0017), `RenameRepository(id, alias)` (display name; trimmed, single line, ≤ 200 chars; blank clears), `MoveGroup(id, index)` (sidebar order; index excludes the group; negative appends), `MoveRepository(id, groupID, index)` (inserts at `index` among the target group's other members; negative or out-of-range appends; same group reorders — ADR-0014).
- `SaveCommandSequence(repoID, steps)` — persists ordered steps; blank labels and missing IDs are filled in. Each step keeps one kind: `script`, else `globalCommand`, else `command`.
- `SaveGlobalCommands(commands)` — replaces the workspace's global commands (`{ id, name, command }`, ADR-0012) and returns the normalized list. Rejects empty or duplicate names, empty or multi-line commands. Steps referencing a removed command fail when run.

## Process

- `RunScript(repoID, scriptName, label)` — runs a declared script as `[pm, "run", name]` argv (ADR-0008); `corepack` is put in front when pnpm/Yarn is missing but Corepack is not (ADR-0032).
- `RunTask(repoID, tool, task, label)` — runs a discovered Turborepo task or Nx target (`repository.monorepo.tasks`) through the package manager's runner, e.g. `pnpm exec turbo run build` (ADR-0032).

Every run of a repository gets its Node.js version's bin folder first on PATH, and commands that call `nvm` or `fnm` get their shell setup (ADR-0031).
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

- `RunGroup(groupID)` — runs every member repository's saved sequence using the group's run mode (ADR-0010), leaving out skipped members (ADR-0024). Rejected when the group is already running or no member would run.
- `StopGroup(groupID)` — cancels the group run and stops all processes of all members (background steps included).
- `GroupRuns()` — latest run per group.

`GroupRun` = `{ id, groupId, mode, status (running|completed|failed|cancelled), repos[], startedAt, endedAt }`; each `repos[]` entry is `{ repositoryId, name, sequenceId, status (pending|running|completed|failed|skipped|cancelled), error, excluded }` (`excluded`: skipped because the group skips it; `continuous`: a long-running member, `started` once its last step runs and left out of the progress counter — ADR-0028).

## Schedules

- `ScheduledStops()` → `ScheduledStop[]` — stops announced with a countdown: `{ groupId, groupName, stopAt, postponed, running }`, soonest first (ADR-0025).
- `PostponeScheduledStop(groupID, minutes)` — moves the announced stop by 1–720 minutes from its current time.
- `SkipScheduledStop(groupID)` — cancels this occurrence; the next scheduled stop applies.
- `StopScheduledNow(groupID)` — stops the group immediately; the announced stop counts as done.
- `ScheduleStatuses()` → `GroupScheduleStatus[]` — `{ groupId, nextStart, startSkipped, nextStop, stopSkipped, stopPostponed }` per scheduled group; a zero time means none within a week.
- `SkipNextScheduled(groupID, kind)` — cancels the next `"start"` or `"stop"` ahead of time; the schedule continues with the one after. An empty `groupID` cancels it for every group with a schedule (the same for `ResumeScheduled`).
- `ResumeScheduled(groupID, kind)` — takes back a cancelled start or stop.

## Export / import

- `ExportWorkspace(groupIDs)` — native Save dialog, then writes the export document (all groups when `groupIDs` is empty). Returns the path, or `""` when cancelled.
- `ChooseImportFile()` — native Open dialog (`*.json`). Returns the path, or `""` when cancelled.
- `PreviewImport(path)` — validates the file and returns an `ImportPreview` (`groups[]` with `exists`, repositories with `status` new|missing|existing (a folder repeated in the file is imported once per entry; `duplicate` is no longer produced) and `steps`; `globalCommands[]` with `{ id, name, command, status (new|existing|renamed), importName }`; counts `groupsToCreate`, `new`, `existing`, `missing`, `shellCommands`). Preview steps reference `globalCommands[].id`. Changes nothing.
- `ApplyImport(path, { importSequences, pathOverrides })` — `importSequences` imports each repository's sequence in order (the dialog defaults to true; false adds empty sequences). Disabled steps in older files are dropped (ADR-0022). `pathOverrides` maps a preview path to a replacement folder; every override is validated first and an unusable one rejects the import. Merges and returns `{ groupsCreated, globalCommandsAdded, repositoriesAdded, repositoriesSkipped }`. Emits `workspace:changed`. Executes nothing.

## Environment

Names are slash-separated paths relative to the repository (`apps/web/.env.local`), as discovered: `.env`, `.env.*` and `*.env` files in the folder and its sub-folders, skipping dependency, build and hidden folders (ADR-0033).

- `EnvironmentFiles(repoID)` — metadata only (name, path, size, modifiedAt); never content.
- `ReadEnvironmentFile(repoID, name)` — content of a discoverable file (≤ 1 MiB); the path must stay inside the repository.
- `SaveEnvironmentFile(repoID, name, content)` — atomic overwrite of an existing discoverable file; text is written exactly as given.

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
| `schedule:pending` | `ScheduledStop[]` | Announced stops, whenever the list changes (ADR-0025) |
| `schedule:status` | `GroupScheduleStatus[]` | Next start/stop per scheduled group, whenever it changes |
| `schedule:fired` | `ScheduleEvent` | `{ groupId, groupName, action: started\|stopped, error }` after a schedule acted |
| `launch:folder` | `null` | Folders are waiting; fetch them with `TakeLaunchFolders` (ADR-0026) |
| `app:closing` | `ClosingProgress` | Progress while quitting (ADR-0023) |

`process:output-batch` replaced the starter's per-line `process:output` event to keep IPC volume bounded under chatty processes (risk R-002). Future additions should use business nouns and remain backward compatible with the frontend consumer.
