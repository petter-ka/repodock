# ADR-0011: Export and import groups and repositories as JSON

- Status: Accepted
- Date: 2026-10-06

## Context

Users want to back up their setup, move it to a new machine, and share a team's "how to start our services" configuration. The persisted `workspace.json` is an internal format (IDs, refresh timestamps, discovered scripts) and is not meant to be edited or shared. Importing configuration that contains shell commands is an explicit risk (R-007).

## Decision

### Document

A separate, versioned export format (`docs/data-model.md`, "Export document"). Version 2 adds optional `globalCommands[]` and the step `globalCommand` reference (ADR-0012); version 1 files are still read:

```json
{
  "format": "repodock.workspace-export",
  "version": 1,
  "exportedAt": "2026-10-06T12:00:00Z",
  "groups": [
    { "name": "Platform", "runMode": "parallel", "collapsed": false,
      "repositories": [
        { "name": "api", "path": "~/work/api", "commandSequence": [ { "id": "…", "label": "dev", "script": "dev", "command": "", "enabled": true, "background": true } ] }
      ] }
  ]
}
```

- Contains only user-owned configuration: group name, run mode, collapsed state, repository name, path and command sequence.
- Never contains discovered data (scripts, package manager, env file names), internal IDs, or **any `.env` content**.
- Paths under the user's home folder are written as `~/…` with forward slashes so the file works across machines and operating systems.
- Unknown fields, foreign `format`, unsupported `version`, empty names/paths, more than 200 steps per repository, and multi-line or NUL-containing step text are rejected. Files are limited to 4 MiB and must have a `.json` extension.

### Export

- "Export workspace…" (all groups) from the sidebar's workspace menu, and "Export group…" from a group menu.
- The native Save dialog chooses the destination; the file is written atomically.

### Import is a reviewed, non-destructive merge

1. The native Open dialog picks a file; `PreviewImport` parses it and returns what would change. Nothing is modified.
2. The preview dialog lists every group (new/existing) and repository (`new`, `missing` folder, `existing`, `duplicate`), with every step's command visible, and warns explicitly when free-form shell commands are present.
3. `ApplyImport` merges:
   - groups match by name (case-insensitive); existing groups keep their local run mode;
   - repositories match by path; existing registrations are left unchanged;
   - new repositories get fresh IDs and are refreshed from their `package.json`;
   - for a repository whose folder is **missing on this machine**, the preview offers a path field with a native folder picker. The chosen folder is checked live (`CheckRepositoryFolder`: exists, readable `package.json`, already registered) and sent as `pathOverrides`. `ApplyImport` re-validates every override and rejects the whole import if one is unusable, so a typo cannot add a broken record. An override that points at an already registered folder is skipped like any duplicate;
   - a missing folder left empty is still added and shows its problem; it can be fixed later with **Change folder…** (`RelocateRepository`), which keeps the record's ID, group and command sequence;
   - **imported steps are disabled** unless the user ticks "Keep imported sequence steps enabled".
4. Nothing is executed during or after import.

The `transfer` backend module owns building, parsing, planning and merging (pure functions) plus file I/O; the app facade owns the native dialogs.

## Alternatives considered

- **Copy `workspace.json`**: leaks internal IDs and machine-specific data, no validation, no merge.
- **Replace mode** (wipe and load): destructive; importing into an empty workspace already gives the same result. Can be added later behind an explicit confirmation.
- **Overwrite existing repositories' sequences on import**: would silently replace local work; users can remove and re-import a repository instead.

## Relocating a repository

`RelocateRepository(id, path)` points an existing record at another folder (after an import from another machine, or after moving a checkout). The folder must exist and contain a readable `package.json`, must not belong to another registered repository, and the repository must have no running processes. Metadata is refreshed; the ID, group and command sequence are kept.

## Consequences

- R-007 is mitigated by preview, visible commands, disabled-by-default steps and no execution.
- The export format is a public contract: changes need a `version` bump and a migration in `Parse`.
- Shared files may still contain internal hostnames or paths; users decide what to share.

## Reconsider when

Teams want a checked-in project file (e.g. `.repodock.json` in a monorepo) or remote/URL imports. Remote sources require a new security review.
