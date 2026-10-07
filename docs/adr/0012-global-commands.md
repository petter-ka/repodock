# ADR-0012: Workspace-wide global commands referenced by sequence steps

- Status: Accepted
- Date: 2026-10-07

## Context

The same shell commands (`npm ci`, `npx rimraf node_modules && npm ci`, `docker compose up -d`, a lint or codegen tool) are typed into the sequences of many repositories. Copies drift, and changing one means editing every sequence. Users want to define such a command once and pick it from a list when building a sequence, and expect it to travel with export/import (ADR-0011).

## Decision

### Model

- `Workspace.globalCommands[]` — `{ id, name, command }`. Names are trimmed, non-empty, at most 200 characters and unique case-insensitively; commands are trimmed, non-empty and single-line (no CR/LF/NUL). An additive field: a missing value normalizes to `[]` with no workspace version bump.
- `CommandStep.globalCommand` — the ID of a global command. Step resolution becomes **script → globalCommand → command → no-op**. `SaveCommandSequence` keeps exactly one kind per step (clears the lower-priority fields) and defaults a blank label to the global command's name.

### Execution

- The reference is resolved **at run time** in the backend step executor, so editing a global command applies to every sequence that uses it. The command runs as shell text in the repository's folder, through the same path as an inline command step (ADR-0008 boundary unchanged; the text is user-authored, never concatenated with other values).
- A step whose global command was deleted fails with "global command … no longer exists"; the sequence editor flags such steps before running.

### API

- `SaveGlobalCommands(commands)` replaces the whole list (draft-and-save, like sequences) and returns the normalized list. `Workspace()` / `workspace:changed` carry `globalCommands`.

### UI

- The sequence editor gains a third step type, **Global**, with a select of all global commands and a button that opens the **Global commands** dialog. The dialog is also in the sidebar's workspace menu. It shows how many saved steps use each command and warns before removing one that is in use.

### Export / import (export document version 2)

- The document gains optional `globalCommands[]` (`{ id, name, command }`); step `globalCommand` holds the document-local ID. A full export carries every global command; a group export carries only those its steps reference.
- `Parse` reads versions 1 and 2. It rejects `globalCommands` in a version-1 file, duplicate IDs or names, empty or multi-line commands, and steps referencing an unknown ID.
- Import merges global commands without changing existing ones: same name (case-insensitive) **and** same command → reused; same name with different text → added as `"<name> (imported)"` (then `(imported 2)`, …); otherwise added. Step references are remapped to local IDs.
- The preview lists every global command with its full text and status (`new`, `existing`, `renamed`). Commands that will be added count toward the shell-command warning (R-007), and the existing "imported steps are disabled" default still applies.

## Alternatives considered

- **Copy the command text into the step when picked**: simple, but edits would not propagate, which is the main point of the feature.
- **Global commands in a separate preferences file**: they are workspace configuration and must be exported with sequences; keeping them in `workspace.json` reuses atomic saves and recovery.
- **Overwrite existing global commands with imported text on a name match**: would silently change what local sequences run; rejected for the same reason as overwriting sequences in ADR-0011.
- **Per-group commands**: more scoping than needed today; can be layered on later by adding an optional scope field.

## Consequences

- Export files written by this version use `version: 2` and are rejected by older RepoDock builds with a clear "version not supported" message.
- Deleting a global command can break sequences that use it; this is surfaced in the dialog (usage count, warning) and in the sequence editor, and fails loudly at run time rather than silently skipping.
- A single edit to a global command changes behaviour in many repositories — intended, and visible because the editor shows the command next to its name.

## Reconsider when

Users need parameters (e.g. `{script}` placeholders), per-OS variants, or commands scoped to a group.
