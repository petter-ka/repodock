# Data Model

## Workspace (persisted, version 1)

```text
Workspace
├── version
├── globalCommands[]          # reusable shell commands — see ADR-0012
│   ├── id
│   ├── name                  # unique, case-insensitive
│   └── command               # single-line shell text
├── groups[]
│   ├── id
│   ├── name
│   ├── repositoryIds[]      # display order within the group (also group-run order)
│   ├── collapsed
│   └── runMode              # sequential (default) | parallel — see ADR-0010
└── repositories[]
    ├── id
    ├── name                  # package.json "name", else folder name
    ├── path                  # absolute; natural dedup key (case-insensitive on Windows)
    ├── packageManager        # npm | pnpm | yarn | bun
    ├── scripts[]             # { name, command } in package.json declaration order
    ├── commandSequence[]     # null = never configured
    │   ├── id, label
    │   ├── script            # package script name (resolved at run time)
    │   ├── globalCommand     # global command ID (used when script is empty; resolved at run time)
    │   ├── command           # shell text (used when script and globalCommand are empty)
    │   ├── enabled
    │   └── background        # start and continue without waiting
    ├── envFiles[]            # discovered allow-listed .env* names
    ├── groupId
    ├── lastRefreshedAt
    └── problem               # last refresh error, empty when healthy
```

Location: `<user config dir>/RepoDock/workspace.json`, overridable with `REPODOCK_WORKSPACE`.

## Invariants (enforced on every load and mutation)

- At least one group exists (`Ungrouped` is created when needed).
- Every repository belongs to exactly one existing group; `groupId` and `repositoryIds` agree.
- Slices are never `null` except `commandSequence`, where `null` means "never configured".
- A missing or unknown `runMode` is normalized to `sequential` (additive field; no version bump).
- A missing `globalCommands` is normalized to `[]` (additive field; no version bump).

## Stability rules

IDs are UUIDs and remain stable across refreshes. Scripts are refreshed from `package.json`; the user-owned command sequence is preserved, and a default (all steps disabled, one per script) is generated only when the record has never had a sequence. When `package.json` becomes unreadable, the last known scripts are kept and `problem` is set.

## Persistence and recovery

- Writes are atomic: temp file in the same directory → fsync → rename.
- A file that cannot be decoded, or has a newer `version` than supported, is moved to `workspace.json.corrupt-<timestamp>` and the app starts with an empty workspace; the frontend shows a persistent notice.
- Older versions are copied to `workspace.json.v<N>.bak` before the one-way migration runs.

## Export document (version 2)

A separate, shareable format written by "Export" and read by "Import" (ADR-0011). It is not the persisted workspace.

```text
ExportDocument
├── format              # always "repodock.workspace-export"
├── version             # 2 (version 1 files, without globalCommands, are still read)
├── exportedAt
├── globalCommands[]    # optional; { id, name, command } — id is document-local
└── groups[]
    ├── name            # matched case-insensitively on import
    ├── runMode
    ├── collapsed
    └── repositories[]
        ├── name
        ├── path        # forward slashes; "~/" = home folder; matched on import
        └── commandSequence[]   # same shape as the workspace; null = never configured;
                                # step globalCommand references globalCommands[].id
```

Excluded on purpose: internal IDs, scripts, package manager, env file names and contents, refresh timestamps, problems.

## Runtime-only state (not persisted)

Runs, process snapshots, output, sequence runs and group runs (latest per group) live in memory. The backend retains up to 200 finished runs; the frontend keeps at most 5,000 lines per run and 10,000 per repository/global view.
