# ADR-0002: Process execution is owned by Go

- Status: Accepted
- Date: 2026-10-06

## Context

The core product is process orchestration. The backend must control process lifecycle consistently across platforms.

## Decision

Go owns process creation, output capture, lifecycle, cancellation and metrics. React only requests operations and renders state.

## Consequences

- Fewer platform-specific concerns in UI code.
- Better control over stdout/stderr and cancellation.
- Native process APIs are available where required.
