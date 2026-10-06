# ADR-0007: Terminate process trees, not just the parent

- Status: Accepted
- Date: 2026-10-06

## Context

Node dev servers frequently spawn child watchers and bundlers. Killing only the parent can leave orphan processes running.

## Decision

The process module should use platform-specific process-tree termination helpers while preserving a platform-neutral `Stop(runID)` contract.

## Implementation

- **Windows:** each run's shell is placed in a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. Stop calls `TerminateJobObject`; if no job could be created, `taskkill /PID <pid> /T /F` is the fallback. Closing the job handle after the shell exits also ends descendants that outlived it, and the OS kills every job member if RepoDock itself crashes. Children are spawned with `CREATE_NO_WINDOW` so no console windows flash.
- **Unix:** the shell is started with `Setpgid`; Stop sends `SIGTERM` to the process group and escalates to `SIGKILL` after a grace period (3 s by default) if any member is still alive.
- `cmd.WaitDelay` bounds how long the manager waits for output pipes held open by orphaned descendants.

Tree kill is covered by `TestStopTerminatesProcessTree` on Windows and Linux.

## Alternatives considered

- Killing only the parent PID: leaves Node watchers/bundlers orphaned (the original problem).
- `taskkill /T` only on Windows: misses descendants whose intermediate parent already exited.

## Consequences

Additional OS-specific code is acceptable inside the process module because it protects the core user experience. Windows has no graceful phase: console processes started without a console cannot receive Ctrl+C.
