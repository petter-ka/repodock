# ADR-0010: Run every repository in a group, sequentially or in parallel

- Status: Accepted
- Date: 2026-10-06

## Context

Groups often represent one product made of several repositories (API, web, worker). Starting them one by one is the main friction RepoDock exists to remove. Some groups need ordering (the API must be up before the web app starts its proxy); others are independent and should start as fast as possible.

## Decision

- "Run group" executes each member repository's **saved command sequence** (ADR-0009), in sidebar order. No separate group-level step list exists; the repository sequence remains the single source of "how to start this repo".
- Each group persists a `runMode`:
  - `sequential` (default): one repository at a time. The next repository starts when the previous repository's sequence **completes** — foreground steps exited 0 and background steps were started. The group stops at the first failure; remaining repositories are marked `cancelled`.
  - `parallel`: every repository's sequence starts at once; each finishes independently and a failure does not stop the others.
- Repositories without enabled steps are `skipped`. A group with no runnable repository is rejected with an explanatory error.
- One running group run per group. A repository's own sequence already running makes that member `failed` with the reason.
- Group runs live in the `sequence` module (`StartGroup`, `CancelGroup`, `GroupRuns`), built on the existing sequence runner; the app facade resolves the group's members.
- `StopGroup` cancels the group run **and** stops every process of every member, because background steps intentionally outlive the run.
- Every change emits `group:updated` with a full `GroupRun` snapshot.

## Alternatives considered

- **Group-level step list** (pick scripts across repos): more flexible but duplicates per-repo sequences and needs cross-repo editing UI. Can be added later as an optional override.
- **Per-run mode choice only** (no persistence): the right mode is a property of the group, so it is stored and shown as the default; changing it is one menu click.
- **Continue on failure in sequential mode**: hides broken prerequisites; parallel mode covers the "independent" case.

## Consequences

- `Group` gains `runMode`; older workspace files load as `sequential` without a schema version bump (additive field, normalized on load).
- Members run in sidebar order, so reordering repositories within a group becomes a useful future feature (today: order of addition / move between groups).
- Group run history is in memory only (latest per group).

## Reconsider when

Users need readiness checks (wait for a port or log line) before the next repository starts, or mixed modes inside one group (parallel stages).
