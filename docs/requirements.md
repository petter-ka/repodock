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

## Non-functional requirements

- Startup should feel instant on a normal developer workstation.
- UI must remain responsive while many processes stream output.
- Process state must survive frontend rerenders without losing backend truth.
- Local data must stay local by default.
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

- FR-01: a folder must contain a valid `package.json` to be added. A registered repository whose `package.json` later becomes unreadable keeps its last known scripts and shows the problem.
- FR-09: memory and CPU are aggregated over the whole process tree of a run.
- FR-11: sequence steps are foreground (must exit 0) or background (start and continue). Sequences run in the backend (ADR-0009).
- Environment values are masked by default and revealed explicitly for editing.
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
  - import shows a preview (new/existing groups; new, missing, already registered and duplicate repositories; every step's command) before anything changes;
  - import merges: groups by name, repositories by path; existing records are not modified;
  - imported steps are disabled unless the user opts in; nothing runs during import;
  - invalid, foreign or newer-version files are rejected with a clear message.

## Empty command semantics

For the MVP, an empty command is a valid saved step that performs a no-op and is recorded as skipped/completed. This is useful when a sequence is configured before every step has a concrete command. Future versions may optionally map an empty command to "open shell in repository" without changing the data model.
