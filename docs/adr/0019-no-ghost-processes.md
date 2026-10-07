# ADR-0019: No ghost processes after quit, signal or crash

- Status: Accepted
- Date: 2026-10-07

## Context

Dev servers and watchers started by RepoDock must not outlive it: a leftover `next dev` keeps port 3000 busy, file watchers keep files locked. ADR-0007 terminates process trees on Stop, but:

- On a normal quit, `Shutdown` sent SIGTERM and waited for the *shell* to exit; the SIGKILL escalation ran in a goroutine that died with the app, and children left in the group by an already-exited shell were never signalled.
- SIGTERM/SIGINT/SIGHUP to RepoDock (logout, `kill`, Ctrl+C in `wails dev`) skipped `OnShutdown` entirely.
- A crash, Force Quit (SIGKILL) or OOM kill cannot run any in-process code.

Windows is already covered: every run is in a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, and the OS closes the handle on any exit.

## Decision

Four layers on macOS/Linux (`internal/modules/process/guard`, process manager, app facade):

1. **Group tracking + synchronous shutdown.** The manager tracks every process group it starts until **no member** is alive (a group whose shell exited but left children stays tracked). `Shutdown` SIGTERMs all tracked groups, waits up to 5 s, then SIGKILLs survivors **synchronously** before returning.
2. **Signals.** The app handles SIGINT/SIGTERM/SIGHUP by running the normal shutdown, then exits.
3. **Watchdog for crashes.** At startup RepoDock starts its own binary with `--repodock-process-watchdog` (branching off in `main` before any UI), in a new session so terminal signals do not reach it. RepoDock streams `track <pgid> <leaderStart>` / `untrack <pgid>` over the watchdog's stdin. A clean shutdown sends `bye`. If the pipe closes **without** `bye` — the kernel closes it however RepoDock died — the watchdog SIGTERMs, then after 2 s SIGKILLs every tracked group, and exits.
4. **Startup sweep.** Live groups are also written to `running-processes.json` next to the workspace file (removed on clean exit). On launch, if the record is from the **same boot**, groups that still run the recorded processes are killed and the user is told ("Stopped N process group(s) left running by the previous session"). This covers the watchdog being killed too (e.g. `killall repodock`).

**PID-reuse safety**: a group is only killed if its leader is alive with the recorded creation time, or — leader gone — a member of the group started after the leader. A PID cannot be reused as a group ID while that group exists. Records from another boot are discarded.

## Consequences

- One extra small process per RepoDock instance on macOS/Linux (blocked on a pipe read, no UI).
- Processes that deliberately leave their group (`setsid`, daemonizing) are out of reach, as before; they are not "ours" anymore by design.
- Tests cover the watchdog killing groups when the pipe closes without goodbye, sparing them after goodbye, the sweep (including a recycled-PID entry and a different boot), and shutdown killing a SIGTERM-ignoring child of an exited shell.

## Reconsider when

- Linux-only: `PR_SET_CHILD_SUBREAPER` could replace parts of this; macOS has no equivalent.
