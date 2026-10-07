# ADR-0018: Mini apps (floating tools) and the "Kill process" app

- Status: Accepted
- Date: 2026-10-07

## Context

Developers often need small utilities next to their work — the most common being "something is still on port 3000, kill it". Such tools should not replace the current view (rail modules do) and must not block it (dialogs and sheets do). We want a pattern for adding more of them.

## Decision

### Mini app framework (frontend)

- A **mini app** is `{ id, icon, label, View, width }` (`lib/module.ts` `MiniApp`), registered in `app/miniApps.ts`. Each lives in its own feature module (`modules/<name>/`).
- The application rail shows a toggle per mini app below the modules (`aria-pressed`; a dot marks open ones). Several can be open at once.
- Open apps render in `FloatingWindow` (`components/shared`): fixed position, **no overlay, non-modal** (`role="dialog" aria-modal="false"`), so the rest of the UI stays usable. Drag by the title bar (pointer capture) or Alt+arrows (Shift for larger steps); Esc or × closes; interacting raises it to the front. Positions are clamped so the title bar always stays reachable, also after the app window shrinks.
- Open state, stacking order and positions live in `state/miniApps.ts` (cross-module: the rail toggles, the shell renders) and persist per device, so windows reopen where they were left. Windows sit above views (z 30+) and below drawers/dialogs.

### "Kill process" app

- Backend module `internal/modules/hostprocess` (gopsutil): `Describe(pid)`, `ByPort(port)` (TCP `LISTEN` sockets and bound UDP sockets; owner PID 0 = not visible, e.g. another user's), `Kill(pid, children)`: SIGTERM to the process (descendants first when asked), wait up to 3 s, then SIGKILL whatever survived. "Already exited" counts as success.
- **Protected PIDs** are refused in the backend, not only hidden in the UI: PID ≤ 1, RepoDock itself, and every ancestor of RepoDock (killing the launching shell/terminal would take RepoDock down).
- The facade (`FindProcessByPID`, `FindProcessesByPort`, `KillHostProcess`) checks whether the PID belongs to an active RepoDock run's process tree; if so, the result says so and a kill **stops that run through the process manager** (ADR-0007 tree termination), so run state and console stay consistent.
- Lookups are bounded by a 15 s timeout (gopsutil uses `lsof` on macOS).
- UI: find by Port (default) or PID; each result shows name, PID, ports, command line, user, parent and start time; a kill needs an inline confirmation (with an opt-in "also child processes"); results refresh after a kill and a notification reports what happened, including when force was needed.

## Consequences

- RepoDock can terminate any process the user is allowed to signal. Mitigations: explicit search, full process details before acting, per-kill confirmation, backend-enforced protections, graceful-first termination. See risk R-011.
- New mini apps need only a module and a registry entry.

## Reconsider when

- A mini app needs a resizable window, or docking into the layout.
- Port lookup needs to be faster than `lsof` on macOS (native `proc_pidinfo`).
