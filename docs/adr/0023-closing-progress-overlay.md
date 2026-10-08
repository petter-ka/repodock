# ADR-0023: Stop processes behind a progress overlay when closing

- Status: Accepted
- Date: 2026-10-08

## Context

ADR-0019 made quitting stop every process synchronously in `OnShutdown`: SIGTERM, up to 5 s grace, SIGKILL, then the marker sweep (ADR-0021). While that ran, the window stayed on screen with no feedback and looked frozen.

## Decision

- `OnBeforeClose` (window ✕, Cmd+Q, menu Quit, `runtime.Quit`) checks whether any run or process group is still alive. If none is, the close goes through at once.
- Otherwise the close is held back and the same shutdown runs in a goroutine. Every 250 ms it emits `app:closing` (`ClosingProgress`: live runs with label, repository and PID; live group count; `forcing` once the grace period is over; `done`).
- The frontend shows a full-window, non-dismissable overlay: a spinner, "Stopping N running process(es)…", a progress bar, and every run seen since the close began, ticked off as it exits, with a warning once survivors are force-stopped.
- When the shutdown finishes, a final `done` event is sent and the backend calls `runtime.Quit`. The second `OnBeforeClose` lets it through, and `OnShutdown` is a no-op (the shutdown runs once). Closing again while stopping is ignored.
- Signals (SIGINT/SIGTERM/SIGHUP) keep the direct, synchronous path: there is no window to report to.

## Consequences

- The window stays visible and responsive while processes stop; the time to quit is unchanged.
- If RepoDock is force-quit during the overlay, the watchdog and the startup list (ADR-0019, ADR-0021) still apply.
