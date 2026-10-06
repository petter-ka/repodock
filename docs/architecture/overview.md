# Architecture Overview

## Principles

### Local-first
No network service is required for the core product.

### Backend owns side effects
Filesystem, process creation, process metrics, native dialogs and persistence happen in Go.

### UI is disposable
Frontend state can be reconstructed from backend state plus ephemeral UI state.

### Module boundaries
The Repository Manager is a feature module, not the whole application. Shared services can support multiple modules but should not know feature-specific UI concepts.

## Layers

```text
Presentation
  React components + hooks + i18n
       │
Application bridge
  Stable Wails-bound methods/events
       │
Domain
  Repository / Group / Run / Env models
       │
Modules
  repository / process / sequence / environment / workspace / transfer
       │
Infrastructure
  filesystem / os/exec / gopsutil / user config dir
```

## Backend module contracts

### repository
Responsibilities:
- Validate repository folder.
- Read `package.json`.
- Discover scripts.
- Detect package manager.

### process
Responsibilities:
- Start child process.
- Stream output.
- Track lifecycle.
- Poll metrics.
- Stop process.

### sequence
Responsibilities:
- Run a repository's enabled steps in order (ADR-0009).
- Wait for foreground steps; continue past background steps.
- Report per-step state; cancel on request.
- Run all repositories of a group sequentially or in parallel (ADR-0010).

### transfer
Responsibilities:
- Build, validate, plan and merge export documents (ADR-0011).
- Read/write export files; native dialogs stay in `app`.

### environment
Responsibilities:
- Discover candidate env files.
- Read file content.
- Write content atomically.

### workspace
Responsibilities:
- Load/save groups and repositories.
- Maintain stable IDs.
- Recover from invalid persisted state.

## Event model

The backend emits events instead of forcing polling for output:

- `process:started`
- `process:output-batch`
- `process:stats`
- `process:exited`
- `sequence:updated`
- `group:updated`
- `workspace:changed`

Event payloads must be versionable and include IDs so the frontend can reconcile out-of-order deliveries.

## Persistence

The first implementation stores one JSON document in the platform user config directory:

```text
RepoDock/
  workspace.json
```

The persistence interface should remain replaceable so SQLite can be introduced later for history or richer querying.

## Concurrency

Each process owns:
- its command handle;
- stdout reader;
- stderr reader;
- lifecycle channel;
- stats loop;
- stop operation.

No process goroutine should mutate global state without going through the process manager's synchronization boundary.
