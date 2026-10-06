# Threat Model

## Assets

- Local source tree paths.
- Environment files and secret values.
- Developer command strings.
- Process state.
- Workspace configuration.

## Main threats

### Accidental command execution
A custom command is effectively code execution under the user's account. The UI must show the repository path and command clearly before launch where confirmation is appropriate.

### Secret disclosure
`.env` files can contain credentials. Avoid logging file contents, analytics, crash telemetry or clipboard operations by default.

### Path abuse
All filesystem operations should be rooted in explicit user-selected repositories. Avoid accepting path traversal sequences for module-relative files.

### Malicious repository metadata
`package.json` content is data. Never execute package scripts during discovery.

### Imported configuration
An export file may come from someone else and contain shell commands. Import never executes anything, shows every command in a preview, and disables imported steps by default (ADR-0011). Files are size-limited and strictly validated; env file contents are never exported.

### Resource exhaustion
A repository can launch a process tree that consumes significant CPU/RAM. Expose stop controls and basic stats. Add future concurrency limits.

## Security baseline

- No external network requests in the MVP core.
- No automatic uploading of environment files.
- No command execution without an explicit user action.
- Sanitize UI rendering of logs; render text, never interpret HTML.
- Atomic writes for env files.
- Redact secrets from future crash reports.
