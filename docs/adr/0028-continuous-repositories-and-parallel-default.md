# ADR-0028: Continuous repositories in group runs; parallel by default

- Status: Accepted
- Date: 2026-10-19

## Context

Most group members end their sequence in a process that never exits: `npm run dev`, `nest start --watch`. Unless that step was marked background, the member never "completed". The group run stayed "running" forever, the sidebar counter stuck at "1/2 done", sequential groups never reached the next member, and "group finished" never came. Most groups are also independent services that users want to start together, yet new groups defaulted to sequential.

## Decision

- A repository can be marked **continuous** ("Runs continuously (dev server)", in its menu): its sequence ends in a long-running process.
- In a group run, a continuous member is **up** once its last step's process has started. Earlier steps (install, migrate) must still succeed first. The member then becomes `started` and the group run no longer waits for it. If the sequence fails before its last step starts, the member fails as before.
  - The sequence runner exposes this as `WaitSettled(sequenceID)`: it returns when the last step has started a process, or when the sequence ended.
  - Sequential groups move to the next member once a continuous member is up.
  - `GroupRepoState.continuous` marks such members. The sidebar counter ("done/total") leaves them out and shows "∞ N up" instead. Continuous repositories carry an ∞ marker in the sidebar and on the dashboard.
- The setting is per repository (it describes its sequence, wherever it is grouped). It is persisted and exported/imported as an optional `continuous` field in version 3 documents.
- **Parallel is the default run mode** for new groups, for groups stored without a mode and for imported groups without one. Groups saved with a mode keep it.

## Alternatives considered

- **Require the last step to be marked background**: already possible, but the step then shows as "started" in the repository's own sequence too, and users kept missing the switch. The repository-level flag says what users mean.
- **Readiness checks (port or log line)**: more precise, and still the "reconsider when" of ADR-0010; process start is the signal available today.
- **Rewriting existing groups to parallel**: rejected; a stored sequential mode may be deliberate.

## Consequences

- A continuous member's later crash does not affect the finished group run; it shows in the repository's status as any process exit does.
- ADR-0010's "sequential is the default" no longer holds.
