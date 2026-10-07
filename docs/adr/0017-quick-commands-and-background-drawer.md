# ADR-0017: Quick commands, Background drawer and resizable sidebar

- Status: Accepted
- Date: 2026-10-07

## Context

Users repeatedly run the same few scripts and commands per repository (lint, test, `git status`, `docker compose logs -f`) that are not part of the startup sequence. Running them from the Scripts chips mixes their output into the main console. The sidebar had a fixed 300 px width, too narrow for long repository names and aliases.

## Decision

### Model and API

- `Repository.quickCommands[]` — `{ id, label, script, globalCommand, command }`, exactly one of script / global command / command set (script wins, then global). Additive field; a missing value normalizes to `[]`.
- `SaveQuickCommands(repoID, commands)` replaces the list and returns it normalized (`workspace.CleanQuickCommands`): trimmed, one kind per entry, empty entries dropped, IDs assigned, default label (script name, global command name, or the command text), single-line only, ≤ 100 entries.
- Running uses the existing bindings (`RunScript`, `RunCommand` with the label); a global command is resolved to its current text when clicked. No new execution path, so ADR-0008's boundary is unchanged.

### UI

- A **Quick** row under the Sequence line shows the chips. Script chips (Scripts section) can be dragged onto it (private MIME type `application/x-repodock-script`; a script already pinned is moved, not duplicated); chips are reordered by dragging; × unpins; **+** pins a script, a global command or a custom command. Edits save immediately.
- Clicking a chip starts the command and opens the **Background** drawer: the repository's quick-command runs with their own process strip (stop, restart, dismiss, CPU/RAM) and a console limited to those runs. Closing the drawer leaves them running; the row's Background button shows how many are active. Which runs came from quick chips is client-side state in the process store (bounded with the finished-run retention, ADR-0016); the main console still shows all output.
- The repository sidebar is **resizable**: drag its right edge (220–560 px), ←/→ (Shift for larger steps) on the focused handle, double-click or Home resets to 300 px. The width is a per-device preference.

### Export / import (document version 3)

- `repositories[].quickCommands` (optional) carries the chips; a `globalCommand` refers to the document's `globalCommands[].id`, like steps, and such commands are exported with partial exports. Import maps references to local IDs, gives fresh IDs, and counts custom commands in the shell-command warning; the preview lists the chips. Quick commands in a version < 3 document are rejected.

## Consequences

- One new binding; the mock backend mirrors it.
- The Global commands dialog counts quick-command references as uses.

## Reconsider when

- Background runs should be hidden from the main console, or survive a frontend reload as "background" (the backend would need to tag runs).
