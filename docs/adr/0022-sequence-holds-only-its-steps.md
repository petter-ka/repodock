# ADR-0022: A sequence holds only its steps; palette-based editor

- Status: Accepted
- Date: 2026-10-08

## Context

Adding a repository generated a default sequence with one **disabled** step per `package.json` script, and the editor toggled steps on and off. The workspace file therefore stored every script of every repository a second time — mostly disabled entries that never run — and the editor was a long list of checkboxes rather than "what runs, in what order".

## Decision

- A saved command sequence contains only the steps that run, in order. New repositories start with an empty sequence; scripts are not copied into it.
- `CommandStep.Enabled` stays in the data format (always `true` when saved) so older files can be read. On load, `UpdateCommandSequence` and import, disabled steps are dropped.
- The sequence editor is two panes: a **palette** (package.json scripts with their command text, global commands with a ⚙ manage button, a custom command and an empty step) and the **sequence**. Palette items are dragged into the sequence at an insertion line, or clicked (Enter) to append. Steps are reordered by their grip, ↑/↓ or Alt+↑/↓, and removed with the trash button. A palette item shows how often it is already used; a script can be used more than once.
- A script or global step shows what it runs and is not re-pointed in place: remove it and add another. Command steps keep their command field.
- Import: the opt-out "Keep the exported step selection" (ADR-0015) becomes "Import the command sequences" (`ImportOptions.importSequences`, default on). Unticked, repositories are added with empty sequences. The disabled-for-review import mode no longer exists, because disabled steps are not stored.

## Consequences

- Workspace files shrink to what the user configured; the first save after upgrading drops old disabled steps (they were never run).
- Users who parked steps as "disabled" to keep them for later lose those entries; scripts are always available again from the palette.
- The sequence runner and group runner keep filtering on `Enabled`, which is now always true.
