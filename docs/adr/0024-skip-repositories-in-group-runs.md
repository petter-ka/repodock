# ADR-0024: Skip repositories when a group runs

- Status: Accepted
- Date: 2026-10-19

## Context

A group is often "everything for one product" (ADR-0010), but on a given day some members are not needed (the marketing site, a rarely touched worker). The only way to leave one out of "Run group" was to empty its sequence or move it to another group, which loses either the sequence or the grouping.

## Decision

- Each group persists `skippedRepositoryIds`: members "Run group" leaves out. A skipped repository keeps its sequence and can still run on its own.
- The skip belongs to the group. Moving a repository to another group drops its skip (normalization removes IDs that are no longer members), so the new group runs it.
- `StartGroup` marks skipped members `skipped` with `excluded: true` before starting, so the UI can tell "skipped by the group" from "no sequence steps". A group where nothing would run is rejected with an explanatory error.
- Binding: `SetRepositorySkipped(repoID, skipped)`; it acts on the repository's current group.
- UI: a "Skip when the group runs" checkbox in the repository menu, and a "Repositories in group run" submenu on the group with one checkbox per member (the menu stays open while toggling). Skipped rows are dimmed with a skip icon. Toggling is disabled while the group run is in progress.

## Alternatives considered

- **A flag on the repository**: simpler, but it would silently follow the repository into another group.
- **A per-run picker dialog**: more clicks for the common case where the same members are skipped every day.

## Consequences

- Additive field; older workspace files load with no skips. Export/import does not carry skips yet.
