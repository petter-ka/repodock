# Test Strategy

## Test layers

### Unit
Go unit tests cover package discovery, manager lifecycle transitions, persistence migration helpers and environment-file safety.

### Component
React tests should cover repository grouping, script chips, sequence editing, environment drawer and localization. Use a browser-like test environment once the test runner is introduced.

### Integration
Run a real temporary repository fixture containing `package.json`, scripts and `.env` files. Execute short commands and verify output, exit status and termination.

Tests that start real OS processes (shells, scripts, the watchdog, sockets) call `testsupport.E2E(t)` first. They are skipped under `go test -short`, which CI and the release workflow use because they depend on runner timing and installed tools. Run them locally with a plain `go test ./...` before changing process execution, the crash guard or host-process tools.

### Platform smoke
At least one smoke build/run is required on Windows, macOS and Linux for each release candidate.

## Critical cases

- repository without `package.json`;
- invalid `package.json`;
- zero scripts;
- many scripts;
- duplicate repository path;
- command exits 0;
- command exits non-zero;
- command writes stdout and stderr;
- command runs long enough for metrics polling;
- stopped process tree;
- corrupt workspace JSON;
- atomic environment-file save failure;
- empty/no-op sequence step;
- locale fallback;
- theme/system preference changes.

## Performance budget

A single log stream should not cause a full app re-render for every byte. Output is batched, the console is virtualized (TanStack Virtual) and scrollback is a fixed-size ring buffer; tests assert the buffers never exceed the configured limit (ADR-0016).
