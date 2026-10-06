# Quality Gates

## Pull request gates

1. `gofmt` produces no changes.
2. Go tests pass with the race detector for concurrency-sensitive packages where the platform permits it.
3. Frontend typecheck passes.
4. Frontend production build passes.
5. No secrets or local environment files are introduced into source control.
6. Architecture dependency rules are preserved.
7. User-visible behavior has localization coverage.

## Release gates

Before a release candidate:

- Windows, macOS, and Linux packaging has been smoke-tested;
- start, stop, restart, sequence execution, and failed-command behavior are verified;
- process output ordering and stderr rendering are verified;
- workspace persistence and upgrade compatibility are verified;
- env file read/write behavior is verified without leaking values into logs;
- CPU/memory telemetry is checked against expected sampling frequency;
- the application can recover from a corrupted workspace file;
- release artifacts are checksummed and traceable to a commit.

## Performance targets for MVP

These are engineering targets, not hard product SLAs:

- app shell visible within 1 second after the Wails webview is ready;
- repository refresh does not block the UI thread;
- command output is streamed incrementally, not buffered until process exit;
- process telemetry samples at approximately 1 Hz;
- workspace writes are bounded and atomic from the user's perspective.

## Observability rules

Application logs may contain command metadata, repository IDs, and exit codes, but must not contain environment file contents, environment variable values, or raw command output by default.
