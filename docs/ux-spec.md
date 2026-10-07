# UX Spec

## Primary layout

1. Narrow application rail on the far left.
2. Grouped repository navigation. Each repository shows a status in place of its folder icon: a green pulsing dot plus the running-count badge while any command runs — dev servers and watchers (`npm start`, `npm run dev`) never finish, so a live process wins over other results; otherwise the most recently *finished* command decides: green check for exit code 0, red ✗ for a failure or crash (including a process killed outside RepoDock). A command stopped by the user from RepoDock is neutral (normal folder icon), never red. Skipped no-op steps are ignored; the tooltip names the command, status, exit code and time. Each group header has a run/stop control, progress (`done/total`) while running, and a menu with the run mode (Sequential / Parallel). Repositories can be dragged within a group or onto another group (insertion line; header/empty/collapsed group appends; disabled while filtering); the repository menu has Rename (alias)…, Move up / Move down and Move to group. Groups are dragged by their header (insertion line above/below a group) or moved with Move group up/down in the group menu. A repository shows its alias when set (the header also shows the discovered name in muted text); plain folders show a "folder" label instead of the package manager.
3. Repository header with path, package manager, refresh, sequence and environment actions.
4. Script chips (collapsed by default behind a "Scripts N" toggle that shows a running count; the open/closed choice is remembered per device), a **Sequence** line with the enabled steps as chips in run order (latest run's per-step status; click a chip to run just that step; Run/Cancel sequence and Edit controls), a **Quick** row of pinned chips (drag script chips onto it, + to pin a script/global/custom command, drag to reorder, × to unpin; a click runs the command in the background and opens the **Background** drawer with its process strip and console), and the custom command input. The sidebar is resizable from its right edge (220–560 px, keyboard ←/→, double-click resets).
5. Active process strip with PID / RAM / CPU / stop.
6. Main console.

## Interaction principles

- Destructive operations should be obvious and reversible where possible.
- Command execution is always an explicit user action.
- Long-running commands expose a persistent stop control.
- Environment content is visually distinct and clearly marked sensitive.
- Empty states should explain the next action.
- Keyboard input should work for custom commands and basic navigation.

## Sequence editor

- Steps run strictly top to bottom in the order shown; drag a step by its grip handle, or use ↑/↓ (or Alt+↑/↓), to reorder them before saving.
- Each row leads with what the step runs: a Script/Command switch and the script picker or the command field. The name is a secondary, optional field below (defaults to the script or command).
- "Command step" adds a row and puts the cursor in its command field.
- The step type switch is Script / Global / Command. **Global** shows a select of the workspace's global commands (name — command) and a ⚙ button that opens the **Global commands** dialog. "Global step" adds a row using the first global command, or opens the dialog when none exist. A step whose global command was deleted is flagged.

## Global commands

- Opened from the sidebar workspace menu ("Global commands…") or from a Global step in the sequence editor.
- One row per command: name and command fields, usage count ("Used in N step(s)"), remove. Edits are a draft saved with **Save**; closing with unsaved edits asks for confirmation.
- Empty or duplicate names and empty commands are shown inline and block saving; removing a command that is in use shows a warning.
- A command step with an empty command is a valid no-op (ADR-0006) but is flagged in the row: "No command — this step will be skipped".
- Long-running steps (`npm start`, `npm run dev`) placed in the middle should be marked **Background**; otherwise the next step waits for them to exit.

## Answering prompts

- While any process in scope is running, an input bar sits under the console. It targets the run selected in the console, else the newest run waiting on a prompt, else the newest running run; a picker appears when several are running (runs waiting on a prompt are marked ●).
- When the latest output of a run is an unterminated prompt, the bar turns amber with "Waiting for input", shows the prompt as placeholder, and the run's process card shows a "Waiting for input" badge.
- Enter sends the line (empty Enter sends an empty line to accept the default); quick buttons send **y**, **n**, **⏎**; **EOF** (or Ctrl+D in an empty field) closes input. The eye toggle hides typed text and masks the console echo; it switches on automatically for password/token-like prompts.
- Sent input appears in the console in green with a `›` marker.

## Export / import

- The sidebar header has a workspace menu (⇅) with "Import…" and "Export workspace…"; each group menu has "Export group…".
- Import always shows a preview dialog before changing anything. Commands that will be imported are visible, shell commands trigger a warning, and "Keep imported sequence steps enabled" is off by default.
- Global commands in the file are listed first with their full command text and a status: new, already present, or renamed ("name taken — added as …"). Global steps in the repository list show the name and command they resolve to.
- Results are announced as a notification.
- Repositories whose folder is missing on this machine show an inline path field with **Browse…** in the preview. Validation appears under the field (package.json found / folder not found / already registered). Invalid folders are outlined in red and block **Import** until fixed or cleared; leaving the field empty imports the repository with a warning.
- A repository with a problem shows a banner with **Change folder…**; the same action is in the repository menu.

## Group runs

- The run button uses the group's saved mode; its tooltip names the mode ("Run group (Parallel)").
- While a sequential run is in progress, waiting members show a clock icon and a failed member shows a warning icon.
- The stop control stays visible while any member still has processes, because background steps outlive the run.
- Completion, failure (with the failing repository and step) and cancellation are announced as notifications.
