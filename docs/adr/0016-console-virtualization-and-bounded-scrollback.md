# ADR-0016: TanStack Virtual console and constant-memory scrollback

- Status: Accepted
- Date: 2026-10-07

## Context

The console used a hand-written fixed-row virtualizer, and output was kept per run (5k lines), per repository and globally (10k each), trimmed with `splice`. Finished runs were never forgotten on the frontend, so a long session with restarts, watchers or many sequence runs grew memory without bound. Parsed ANSI segments were stored on every line object, multiplying the memory per line even for lines never shown.

## Decision

- **Virtualization**: the console uses `@tanstack/react-virtual` (`useVirtualizer`, fixed 20 px rows, overscan 20). Rows stay in normal flow inside one translated wrapper so long lines still scroll horizontally. Follow-tail behavior is unchanged; while scrolled up, the view compensates for lines evicted from the top so the visible text does not jump.
- **Scrollback setting**: Settings → Console offers 1k / 2k / 5k / 10k / 20k rows, **default 2k**. It is a per-device preference (`state/consoleLimit.ts`, cross-module: the settings page writes it, the process store reads it). Changing it resizes the buffers in place, keeping the newest lines.
- **Constant memory**:
  - Output lives in fixed-capacity ring buffers (`lib/ringBuffer.ts`): one global and one per repository, each sized by the setting. Pushing into a full buffer overwrites the oldest line — no array growth, no `splice` copies.
  - Line objects are shared between the global and repository buffers. There is no per-run buffer: a run's view is filtered from its repository's buffer and cached until output changes.
  - Parsed ANSI segments are cached in a `WeakMap` keyed by line, only for rendered rows, and are collected with the line once it is evicted.
  - The frontend keeps at most 200 finished runs (the backend's retention); older ones are forgotten.
  - Upper bound: `(repositories with output + 1) × limit` lines, each ≤ 16 KiB (the backend splits longer lines).
- The backend is unchanged: it stores no output history, only batches lines (50 ms / 500 lines) to the frontend, and retains 200 finished runs.

## Consequences

- One new dependency (`@tanstack/react-virtual`), headless and small; it fits ADR-0004's stack.
- A run's history is limited by its repository's scrollback, shared with the repository's other runs.
- Run-filtered and text-filtered views are arrays rebuilt per frame of new output (O(limit), ≤ 20k).

## Reconsider when

- Rows need variable height (wrapping) — TanStack Virtual supports measured rows, at extra cost.
- Users need full logs: write to disk in the backend instead of growing the in-memory buffers.
