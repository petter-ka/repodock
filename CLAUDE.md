# RepoDock — Claude Code Guide

## Mission

Build a polished, native, local-first desktop command center for many local Node.js repositories.

## Non-negotiable architecture rules

- Go is the source of truth for filesystem access, process execution, persistence and native dialogs.
- React/TypeScript is presentation + client interaction state only.
- `internal/domain` contains transport-safe models. Do not put Wails/runtime concerns there.
- `internal/modules/*` owns feature logic. Avoid a "god service".
- `internal/app` is a thin application facade that composes modules and exposes stable bindings to the frontend.
- `frontend/src/modules/*` owns feature UI and local feature state.
- `frontend/src/components/ui` is shared UI only. Feature-specific components do not belong here.
- Cross-module state should be minimal and live under `frontend/src/state`.

## Process execution rules

- Every command gets its own `exec.Cmd` and goroutine.
- Never block the Wails UI thread on streaming I/O.
- Emit stdout/stderr incrementally.
- Always attach repository ID, run ID, PID and stream type to output events.
- Track exit code and terminal state.
- Prefer process-tree termination over killing only the parent.
- Treat shell command text as untrusted input: do not concatenate user-controlled values into commands without an explicit boundary.

## Repository rules

- `package.json` is parsed, never executed, during discovery.
- Supported package-manager detection is `packageManager`, then lockfile hints, then npm.
- Scripts are displayed exactly as they appear in `package.json`.
- A repository may have zero scripts.
- Duplicate repository paths should resolve to the existing repository record instead of creating another record.

## Environment rules

- `.env`, `.env.local`, `.env.development`, `.env.development.local`, `.env.test`, `.env.test.local`, `.env.production`, `.env.production.local` are candidates.
- Preserve file text when saving rather than serializing it into a new format.
- Do not print environment contents to logs.
- Consider secrets sensitive even though the app is local.
- Future work should add secret-value masking and OS keychain integration.

## UI rules

- Default language: English.
- Also ship Hungarian translations.
- Default theme: system, with explicit Light/Dark override support.
- Prefer shadcn/ui patterns and Tailwind utilities over custom one-off controls.
- Use Lucide icons.
- Main layout: application rail → grouped repo sidebar → console/content.
- The console should remain useful when no repository is selected.
- Keyboard-friendly interactions are expected.

## Quality gates

Before declaring a change complete:

```bash
gofmt -w .
go test ./...
cd frontend && npm run typecheck && npm run build
```

Also run `wails dev` for any change touching bindings, dialogs, process execution or native runtime integration.

## Documentation gate

Any meaningful architectural change requires either:
- an update to an existing ADR, or
- a new ADR in `docs/adr/`.

Update `docs/requirements.md`, `docs/stages.md` and `docs/architecture/` when scope changes.
