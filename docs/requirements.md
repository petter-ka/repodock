# Product Requirements

## Problem

Developers often have many local JavaScript/TypeScript repositories. Starting each project manually means repeatedly switching folders, remembering package scripts, opening terminals, and scanning many console windows.

RepoDock provides one native desktop workspace where repositories can be grouped and operated through repeatable commands while their output and process state remain visible.

## Personas

### Daily full-stack developer
Needs a compact control surface for 5–30 local repos.

### Staff engineer / team lead
Needs predictable command sequences, group organization and fast status checks.

### Platform engineer
Needs enough observability to diagnose runaway local dev processes.

## Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | Add a repository using a native folder picker | P0 |
| FR-02 | Discover scripts from `package.json` | P0 |
| FR-03 | Show scripts as clickable chips | P0 |
| FR-04 | Support custom shell commands | P0 |
| FR-05 | Persist grouped repositories | P0 |
| FR-06 | Run commands independently | P0 |
| FR-07 | Stream stdout and stderr into the console | P0 |
| FR-08 | Stop a running process | P0 |
| FR-08a | Restart a process with its previous command | P0 |
| FR-09 | Show PID, memory and basic CPU stats | P1 |
| FR-10 | Detect and edit common `.env*` files | P1 |
| FR-11 | Configure ordered command sequences | P1 |
| FR-12 | Support empty/no-op command entries in a sequence | P1 |
| FR-13 | Switch English/Hungarian | P1 |
| FR-14 | Switch light/dark/system theme | P1 |
| FR-15 | Add future feature modules without coupling to Repository Manager | P1 |
| FR-16 | Run the sequences of all repositories in a group, sequentially or in parallel (selectable per group) | P0 |
| FR-17 | Export groups and repositories to a JSON file and import them back (merge) | P1 |
| FR-18 | Define workspace-wide global CLI commands and pick them as sequence steps; include them in export/import | P1 |
| FR-19 | Answer interactive prompts (y/n, text, passwords) of running processes from the console | P1 |
| FR-20 | Reorder repositories and move them between groups, and reorder sequence steps, by drag and drop | P1 |
| FR-21 | Reorder groups by drag and drop | P1 |
| FR-22 | Rename a repository with an alias; register the same folder several times and plain folders without package.json | P1 |
| FR-23 | Pin scripts/commands as Quick chips per repository, run them in the background in a separate drawer; include them in export/import | P1 |
| FR-24 | Resize the repository sidebar | P2 |
| FR-25 | Mini apps: toggleable, draggable, non-blocking floating tools; first app kills a process by PID or port | P1 |
| FR-26 | JWT tool mini app: generate test tokens with selectable roles and decode/verify tokens; input is remembered | P2 |
| FR-27 | Mark repositories of a group as skipped when the group runs | P1 |
| FR-28 | Start and stop a group at set times on chosen days, with a countdown before a stop | P1 |
| FR-29 | Accept a folder on the command line and ask which group it goes to | P1 |
| FR-30 | Show a grouped workspace dashboard as the default "All repositories" view | P1 |
| FR-31 | Mark repositories as continuous (dev servers) so group runs do not wait for them; parallel group runs by default | P1 |

## Non-functional requirements

- Startup should feel instant on a normal developer workstation.
- UI must remain responsive while many processes stream output.
- Process state must survive frontend rerenders without losing backend truth.
- Local data must stay local by default.
- No process started by RepoDock may outlive it — on quit, on termination signals, or after a crash/Force Quit (ADR-0019), including descendants that left their process group; whatever still survived is listed at the next launch so the user can stop it (ADR-0021).
- The application should work without Node.js on the target machine after packaging.
- The process layer must support Windows/macOS/Linux semantics.

## Explicit non-goals for MVP

- Remote server orchestration.
- Cloud sync.
- CI/CD provider integrations.
- Secrets management beyond local file editing.
- Built-in terminal emulation with full interactive stdin.
- Docker/Kubernetes management.

## Clarifications (2026-10-06)

- FR-01: any folder can be added; one without `package.json` is a plain folder with no scripts (ADR-0015). The same folder, or a parent/child of a registered one, can be added again as a separate record (numbered alias). A registered repository whose `package.json` later becomes unreadable or disappears keeps its last known scripts and shows the problem.
- FR-09: memory and CPU are aggregated over the whole process tree of a run.
- FR-07: the sidebar shows each repository's command status. Green while any command is running (long-running scripts such as `npm run dev` stay green with a running count) or when the most recently finished command exited 0; red when it failed or crashed; yellow (warning) after the user stopped it from RepoDock. Process cards use the same colors (exited 0 green, stopped yellow), and a sequence step whose process the user stopped shows as a yellow "cancelled" chip rather than a failure. The status reflects runs of the current app session; dismissed or cleared runs no longer count.
- FR-11: sequence steps are foreground (must exit 0) or background (start and continue). Sequences run in the backend (ADR-0009). A saved sequence holds only the steps that run; steps are added by dragging scripts, global commands or custom steps from a palette (ADR-0022).
- Environment values are masked by default and revealed explicitly. An env file can be edited as a key/value form (values in password inputs until revealed; add, rename, remove variables) or as raw text after revealing; both edit the same text draft, and form edits rewrite only the affected line so comments and formatting are preserved. Saving shows a confirmation listing added, changed and removed variables (values masked unless revealed). From that dialog the user can also save while keeping previous values: each changed variable's old line is kept as a comment above the new one, removed ones at the end of the file, each with a dated `# RepoDock: previous value, replaced YYYY-MM-DD HH:mm` note; discarding unsaved changes lists them too.
- FR-16: see ADR-0010. Acceptance criteria:
  - each group has a persisted run mode, `sequential` (default) or `parallel`, changeable from the group menu;
  - "Run group" runs every member's saved sequence in sidebar order; members without enabled steps are skipped;
  - sequential mode starts the next repository only after the previous sequence completes (background steps count as started) and stops at the first failure;
  - parallel mode starts all members at once; one failure does not stop the others;
  - progress (`done/total`), queued and failed members are visible in the sidebar, and completion/failure is announced;
  - "Stop group" cancels the run and stops every process of every member.

- FR-17: see ADR-0011. Acceptance criteria:
  - export all groups, or a single group, to a user-chosen `.json` file via the native Save dialog;
  - the file contains group names, run modes, repository names, portable paths (`~/…`) and command sequences — never env file contents, discovered scripts or internal IDs;
  - import shows a preview (new/existing groups; new, missing and already registered repositories (a folder repeated in the file is imported once per entry); every step's command) before anything changes;
  - import merges: groups by name, repositories by path; existing records are not modified;
  - command sequences are imported unless the user opts out (then repositories get empty sequences); nothing runs during import (ADR-0022);
  - invalid, foreign or newer-version files are rejected with a clear message;
  - for repositories whose folder is not found on this machine, the user can type or browse to the right folder in the preview; the folder is validated before import, and an invalid folder blocks the import until it is fixed or cleared;
  - any repository can later be pointed at another folder with "Change folder…" (from the repository menu or the problem banner), keeping its group and sequence.

- FR-18 (2026-10-07): see ADR-0012. Acceptance criteria:
  - the user can add, rename, edit and remove named global commands from the sidebar workspace menu or the sequence editor;
  - a sequence step can be of type Global and pick a global command from a select; it runs in the repository's folder;
  - editing a global command changes every sequence that uses it; a step whose global command was removed is flagged in the editor and fails with a clear message when run;
  - exports include the global commands used by the exported steps (all of them for a full export);
  - import previews global commands with their full text, reuses identical ones, adds a renamed copy when a name is taken by a different command, never modifies existing ones, and counts added commands in the shell-command warning.

- FR-19 (2026-10-07): see ADR-0013. Acceptance criteria:
  - a prompt that does not end with a newline becomes visible in the console and the run is marked as waiting for input;
  - the user can send a line, an empty line, `y`, `n`, or EOF to any running process, including sequence steps;
  - sent input is echoed in the console; hidden input is masked and never shown, logged or emitted in clear text;
  - a process that does not read its input cannot freeze the app;
  - limitation: prompts that require a real terminal (arrow-key menus) are not supported.

- FR-20 (2026-10-07): see ADR-0014. Acceptance criteria:
  - a repository can be dragged to any position in its own group or another group; an insertion line shows where it lands; dropping on a group header, empty group or collapsed group appends;
  - the new order is persisted and used by sequential group runs;
  - the repository menu offers Move up / Move down as the keyboard alternative; dragging is disabled while the sidebar filter is active;
  - sequence steps can be dragged by their grip handle; the draft is reordered and saved only with Save;
  - dropping files or text onto the sidebar or the sequence editor does nothing.

- FR-21 / FR-22 (2026-10-07): see ADR-0015. Acceptance criteria:
  - a group can be dragged by its header above or below another group, or moved with Move group up/down; the order persists;
  - "Rename (alias)…" in the repository menu sets a display name used everywhere; clearing it restores the discovered name;
  - adding an already registered folder creates another record named "<name> (2)", "(3)", …; parent and child folders can be added;
  - a folder without package.json is added as a plain folder: no scripts, no warning, a "folder" label; custom and global commands and sequences work;
  - exports carry group order, member order, aliases, duplicate/nested/plain folders and full sequences — step order and the enabled selection (document version 3); importing into an empty workspace reproduces the same sidebar; re-importing skips folders that were already registered.

- FR-23 / FR-24 (2026-10-07): see ADR-0017. Acceptance criteria:
  - script chips can be dragged onto the Quick row; scripts, global commands and custom commands can also be pinned with +; chips can be reordered by dragging and unpinned with ×;
  - clicking a chip starts it and opens the Background drawer with its output, process stats and stop/restart; closing the drawer keeps it running;
  - quick commands are exported and imported (with their global command references), shown in the import preview and counted in the shell-command warning;
  - the sidebar width can be changed by dragging its edge or with the keyboard, and is remembered.

- FR-25 (2026-10-07): see ADR-0018. Acceptance criteria:
  - mini apps are toggled from the application rail and open as floating windows that can be dragged (pointer or Alt+arrows), closed with Esc/×, and do not block the rest of the UI; positions are remembered;
  - "Kill process" finds processes by port (listening TCP / bound UDP) or PID and shows name, PID, ports, command line, user and start time;
  - killing requires an inline confirmation, sends SIGTERM and force-kills after 3 s if needed, optionally including child processes;
  - system processes, RepoDock itself and its parent processes cannot be killed; a process started by RepoDock stops its run instead.

- FR-26 (2026-10-08): see ADR-0020. Acceptance criteria:
  - Encode signs a token (RS256 with a PEM or base64-encoded PEM key, or HS256 with a secret) with the payload shape of the team's previous script (id, userId/userName/name = email, deviceId, realm, resource_access.roles, channel, iat, exp, iss, sub), optional extra JSON claims merged over it; ID, email, a positive expiry and a key are required;
  - roles are a remembered catalogue with search, create, rename, delete and selection (single and "shown"); only selected roles go into the token;
  - all fields, roles and keys are remembered on this computer (0600 file, not exported);
  - Decode shows header, payload, issue/expiry time and expired state, and verifies the signature with the configured key (valid / invalid / not verified); decoding a token fills the Encode form from it (fields, expiry, algorithm, roles added to the catalogue and selected, other claims as extra claims; keys unchanged);
  - the generated token can be copied or opened in the decoder.

- FR-27 (2026-10-19): see ADR-0024. Acceptance criteria:
  - a repository can be marked "skipped when the group runs" from its menu, and every member can be toggled from the group's "Repositories in group run" submenu;
  - "Run group" leaves skipped members out (shown as skipped in the run); they can still be run on their own; a group where nothing would run is rejected with a clear message;
  - the skip is stored on the group and dropped when the repository moves to another group; skipped rows are visibly marked in the sidebar.

- FR-28 (2026-10-19): see ADR-0025. Acceptance criteria:
  - a group's schedule has a start time and/or a stop time (each can be switched on and off) and the days it applies to: every day, weekdays, weekends, or any custom set of weekdays;
  - at the start time RepoDock runs the group (unless it is already running); at the stop time it stops every process of the group; schedules act only while RepoDock is open;
  - 30 minutes before a stop of a running group a countdown dialog appears with postpone (+15/+30/+60 min), "Skip this time" and "Stop now"; it can be hidden into a corner pill and returns at 5 minutes and 1 minute left; idle groups are not announced;
  - the schedule dialog previews the day on a 24-hour strip and shows the next start and stop; scheduled groups show a clock in the sidebar; schedule actions are announced as notifications;
  - the countdown's "Cancel this stop" keeps everything running and the schedule continues next time;
  - the next start or stop can be cancelled at any time ahead (sidebar clock menu, or the × on a dashboard group card's chip) and restored with Undo; cancelled ones are shown struck through and the clock turns amber.

- FR-29 (2026-10-19): see ADR-0026. Acceptance criteria:
  - `repodock <folder>` (relative or absolute; a file means its folder) shows "Add this folder?" with the folder's details and a group choice (existing groups, or a new group by name), defaulting to the group with neighbouring folders;
  - launching RepoDock again while it runs focuses the running window and hands it the folder; only one RepoDock runs per workspace file;
  - a missing or unusable folder is reported; an already registered folder offers to open it or to add another record.

- FR-30 (2026-10-19): see ADR-0027. Acceptance criteria:
  - "All repositories" opens on a Dashboard tab; the previous processes and console view is the second tab;
  - the dashboard shows workspace totals, readiness per group, a weekly schedule chart, package managers, tech stack, dependencies per group, a card per group with its members, schedule and run controls, and the repositories needing attention;
  - charts support light and dark themes, have legends or direct labels and hover tooltips, and each can be shown as a table.

- FR-31 (2026-10-19): see ADR-0028. Acceptance criteria:
  - a repository can be marked "Runs continuously (dev server)" from its menu and shows an ∞ marker;
  - in a group run, a continuous repository is up once its last step has started (earlier steps must succeed); the group run does not wait for it to exit, sequential groups continue with the next member, and the group finishes;
  - the sidebar progress counter leaves continuous members out and shows how many are up;
  - new groups (and groups or imports without a stored mode) run in parallel.

## Empty command semantics

For the MVP, an empty command is a valid saved step that performs a no-op and is recorded as skipped/completed. This is useful when a sequence is configured before every step has a concrete command. Future versions may optionally map an empty command to "open shell in repository" without changing the data model.
