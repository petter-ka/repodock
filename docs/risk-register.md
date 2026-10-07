# Initial Risk Register

| ID | Risk | Impact | Probability | Mitigation | Owner |
|---|---|---|---|---|---|
| R-001 | Killing a shell does not terminate its child tree | High | Medium | Platform-specific process-group/tree termination plus integration tests | Process module |
| R-002 | Command output floods the renderer | Medium | Medium | Bounded frontend history, incremental events, future batching/backpressure | Process + frontend |
| R-003 | `.env` values are exposed in logs or diagnostics | High | Medium | Secret-handling policy, redaction, no raw env logging | Environment module |
| R-004 | Workspace schema changes break existing installs | High | Medium | Versioned JSON, migration layer before schema changes | Workspace module |
| R-005 | Windows shell semantics differ from Unix shells | High | High | Platform runner abstraction and OS-specific tests | Process module |
| R-010 | GUI launches on macOS/Linux lack the terminal PATH (`command not found: npm`) | High | High | Resolve the interactive login shell PATH once at startup, plus fallback tool folders; covered by a real-zsh test | Process module |
| R-006 | Long-lived process table grows without bounds | Medium | Medium | Backend keeps 200 finished runs and no output history; frontend keeps 200 finished runs and fixed-size ring-buffer scrollback (ADR-0016) | Process module |
| R-007 | User command injection through future remote/import features | High | Medium | File import (ADR-0011): preview with visible commands and each step's enabled state, shell-command warning, opt-out that imports every step disabled (the exported selection is kept by default since ADR-0015), nothing executed, strict validation. Remote/URL import still requires a new review | Product |
| R-008 | A module bypasses shared contracts and couples the app shell | Medium | Medium | Dependency rules and module contract docs | Architecture |
| R-009 | Large repositories make refresh expensive | Medium | Medium | Lazy refresh, file watchers, and incremental scanning in later stage | Repository module |
| R-011 | Killing the wrong process from the Kill process mini app | Medium | Low | Explicit search with full process details, per-kill inline confirmation, graceful SIGTERM first, backend refuses PID ≤ 1, RepoDock and its ancestors, RepoDock runs are stopped through the process manager (ADR-0018) | Product |
| R-012 | Child processes outlive RepoDock (ghosts holding ports) after quit, signal or crash | High | Medium | Synchronous group kill on shutdown, signal handling, out-of-process watchdog, same-boot startup sweep with PID-reuse checks; Windows Job Objects (ADR-0019) | Process module |
