# ADR-0015: Several records per folder, aliases, plain folders and group ordering

- Status: Accepted (supersedes the "duplicate paths resolve to the existing record" rule of the original guide, and the package.json requirement of FR-01)
- Date: 2026-10-07

## Context

Users want to register the same folder more than once (e.g. one entry per environment or per set of sequences, in different groups), and to register parent or child folders of a repository, including folders without a `package.json` (a folder holding several repositories, a docker/infra folder). With several entries for one folder, the `package.json` name no longer identifies an entry, so entries need user-chosen names. Groups could only be ordered by creation.

## Decision

### Records

- The folder path is **no longer a unique key**. `AddRepository` always creates a new record. When the folder is already registered, the new record gets a numbered alias (`<name> (2)`, `(3)`, …) so entries are distinguishable at once.
- Nested folders (parent/child of a registered one) need no special handling; each is an ordinary record.
- `CheckRepositoryFolder` reports `registeredId/registeredName` for information only; `RelocateRepository` may point a record at a folder that another record uses.

### Plain folders

- A folder **without** `package.json` can be added. It has no scripts and `packageManager: ""`; custom commands, global commands and sequences work as usual. It is shown with a "folder" label.
- A missing `package.json` is a problem only for a record that had one (non-empty `packageManager`), so a broken checkout still shows a warning instead of silently losing its scripts. An unreadable or invalid `package.json` is always a problem.

### Aliases

- `Repository.alias` (string, `""` = none) is a display name that overrides the discovered `name`; `name` keeps refreshing from `package.json`/folder name. `domain.Repository.DisplayName()` / frontend `displayName()` are the single rule; group runs, the sidebar, header, sheets, notifications and the import preview use it.
- `RenameRepository(id, alias)` trims the alias, rejects line breaks/NUL and more than 200 characters; a blank alias clears it. The sidebar filter matches alias, name and path.
- Additive JSON field, no workspace version bump.

### Group ordering

- `MoveGroup(id, index)` places a group at `index` among the other groups (negative/out-of-range = last). The sidebar supports dragging a group by its header (same native HTML5 drag-and-drop as ADR-0014, private MIME type `application/x-repodock-group`) and Move group up/down in the group menu. Disabled while the sidebar filter is active.

### Export / import (document version 3)

- Repositories carry an optional `alias` and `plainFolder` flag. Version 1–2 documents are still read; either field in a version < 3 document is rejected (unknown fields are rejected anyway). An imported entry without `plainFolder` expects a package.json: until its first refresh it carries a placeholder package manager, so a folder without package.json reports a problem instead of silently becoming a plain folder.
- Sequences round-trip completely: step order always, and the enabled/disabled selection by default (the import dialog's "Keep the exported step selection" is ticked; unticking imports every step disabled). This amends ADR-0011's disabled-by-default rule. **Superseded by ADR-0022:** disabled steps are no longer stored; the opt-out now imports no sequences.
- Group order is part of the round trip: new groups are inserted after their predecessor in the file (or ahead of the first file group that already exists), never just appended; existing groups are not reordered.
- Import still skips entries whose folder was registered **before** the import, so re-importing a file is idempotent. A folder repeated **inside** the file is imported once per entry (it used to be flagged "duplicate in file"); the `duplicate` preview status is no longer produced.

## Consequences

- Two new bindings (`RenameRepository`, `MoveGroup`); the mock backend mirrors them.
- Code that looked repositories up by path for identity must not assume uniqueness; `RepositoryByPath` returns the first match and is informational.
- The project guide's repository rule is updated accordingly.

## Reconsider when

- Records of the same folder need to share state (e.g. one env editor), or users want to forbid duplicates per group.
