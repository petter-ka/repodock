# ADR-0009: Command sequences execute in the backend

- Status: Accepted
- Date: 2026-10-06

## Context

The starter ran sequences as a frontend loop (`RunCommand` + `WaitForRun`). A rerender, reload or view switch could silently abandon a sequence, contradicting "UI is disposable" and ADR-0002.

Typical startup sequences mix one-shot steps (install, migrate, build) with long-running ones (dev servers, watchers) that never exit.

## Decision

- A new `internal/modules/sequence` package runs the enabled steps of a repository's saved sequence in order. It depends on process execution only through an `Executor` interface implemented by the app facade.
- Foreground steps must exit with code 0 before the next step starts; a failure marks the sequence `failed` and the remaining steps `cancelled`.
- `CommandStep.Background` steps are started and the sequence continues immediately (step status `started`).
- Empty steps (no script, no command) produce a `skipped` run (ADR-0006).
- At most one running sequence per repository. Cancelling stops the step currently being waited on; already started background steps keep running (Stop all stops them).
- Every state change emits `sequence:updated` with a full snapshot; runs carry `sequenceId`/`stepId` for per-step output grouping.
- `CommandStep.Script` references a package script by name and is resolved at run time, so steps follow package-manager changes.

## Consequences

- Sequences survive frontend reloads; the UI rehydrates via `Sequences()`.
- Sequence history is in memory only (latest per repository).

## Reconsider when

Users need parallel groups, retries or readiness probes (e.g. "wait until port 3000 is open").
