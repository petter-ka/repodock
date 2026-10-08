# ADR-0021: Marker environment variables and the leftover-process list

- Status: Accepted
- Date: 2026-10-08

## Context

ADR-0019 kills process **groups**. Ghost processes were still reported after closing RepoDock: tools that move children into a session or group of their own (`setsid`, daemons such as build-tool servers, some monorepo runners) are invisible to group tracking, so quitting, the watchdog and the startup sweep all miss them. Nothing on a process says "RepoDock started me" once it has left the group.

## Decision

1. **Markers.** Every process RepoDock starts gets four environment variables, inherited by all descendants whatever group they move to:
   - `REPODOCK_SESSION` — random ID per launch;
   - `REPODOCK_OWNER` — `<pid>:<creation time ms>` of the RepoDock instance;
   - `REPODOCK_RUN_ID`, `REPODOCK_REPOSITORY_ID`.
   Marker variables RepoDock itself inherited (it was started from another instance's run) are replaced, never passed on.
2. **Quit and crash.** After the group shutdown, RepoDock scans the processes it may read and kills (SIGTERM, then SIGKILL after 2 s) every one carrying its session. The watchdog receives the session ID as an argument and does the same when RepoDock dies without a goodbye.
3. **Leftover list at startup.** The frontend asks `LeftoverProcesses()` once. Processes whose session is not the current one **and** whose owner is not alive (PID gone, or reused with another creation time) are grouped by run and shown in a dialog with repository, command, PIDs, listening ports and start time. The user can stop one run, stop all, or leave them running. `StopLeftoverProcesses(runIDs)` scans again, so only processes still marked by a dead session are touched; SIGKILL is only sent if the creation time is unchanged.

Processes of a second, running RepoDock instance are never listed or killed: their owner is alive.

## Consequences

- A scan reads every visible process's environment (~20 ms for ~600 processes on macOS), once on quit, once at launch, and once per stop action.
- macOS does not reveal the environment of Apple platform binaries (`/bin/sh`, `zsh`, `sleep`), so a shell left behind cannot be found by marker; the group layers of ADR-0019 still cover it. Node, Python, Go, Rust and other user-installed binaries are readable, which is where dev servers live.
- A process that clears its environment (`env -i`) is out of reach, as are containers run by a Docker daemon.
- Environment values are only matched by the `REPODOCK_` prefix; other variables are never logged or kept.
- Windows: markers are set too; Job Objects already end the tree, so the list is normally empty.

## Reconsider when

- macOS offers a supported way to attribute processes to a responsible app (e.g. responsibility PID APIs) without reading environments.
