# Delivery Stages

## Status (2026-10-06)

| Stage | Status | Notes |
|---|---|---|
| 0 Foundation | Done | `wails build` and `wails dev` verified on Windows |
| 1 Repository Manager MVP | Done | Group CRUD, ordered script discovery, dedup, problem reporting, JSON export/import (ADR-0011) |
| 2 Process Center | Done | Batched streaming, tree stats, stop/restart/stop-all, retention |
| 3 Command Plans | Done | Backend-owned sequences (ADR-0009), background and no-op steps, group runs sequential/parallel (ADR-0010), global commands (ADR-0012) |
| 4 Environment Workspace | Done | Atomic writes, masked-by-default view, unsaved-change guards |
| 5 Hardening | Partial | Tree kill per OS, corrupt-workspace recovery, and Windows/macOS release builds on GitHub Releases done; code signing, Linux packaging, accessibility audit and telemetry decision open |
| 6 Extensibility | Ready | Module registry in place; no extra modules yet |

Open items: the 10-simultaneous-process exit criterion has been exercised with simulated output only; macOS/Linux packaging and real-device smoke tests are still required; OS keychain integration is future work.

## Stage 0 — Foundation

- Wails v2 app boots on all target OSes.
- React + TS + Vite + Tailwind + shadcn-style shared UI.
- App shell, theme and i18n.
- Domain models and bridge facade.
- Documentation skeleton.

Exit criteria: `wails dev` boots and the frontend build passes.

## Stage 1 — Repository Manager MVP

- Add/remove repositories.
- Native folder picker.
- Group CRUD and repository assignment.
- `package.json` script discovery.
- Package manager detection.
- Main console shell.
- Export/import groups and repositories as JSON (FR-17).

Exit criteria: a user can register 10+ repos and see scripts for every valid `package.json`.

## Stage 2 — Process Center

- Async process execution.
- Live stdout/stderr.
- PID, status, exit code.
- Stop process and restart process.
- Stop-all for a repository.
- Basic RSS/CPU polling.
- Process list scoped by repository.

Exit criteria: at least 10 simultaneous local dev processes can run without UI freezes in normal workstation conditions.

## Stage 3 — Command Plans

- User-defined command ordering.
- Saved run-all / stop-all for a repository.
- Saved custom commands.
- Empty/no-op steps.
- Per-step output grouping.
- Run a whole group, sequentially or in parallel (FR-16).

Exit criteria: a repository can have a repeatable local startup sequence that can be reordered without editing files.

## Stage 4 — Environment Workspace

- `.env*` discovery.
- Read/edit/save drawer.
- File validation and atomic writes.
- Secret masking UX.

Exit criteria: common dotenv files can be edited without formatting destruction or app crashes.

## Stage 5 — Hardening

- Process-tree kill per OS.
- Crash recovery.
- Corrupt workspace-state recovery.
- Accessibility pass.
- Telemetry opt-in decision.
- Packaging/signing/installer pipeline.

## Stage 6 — Extensibility

Potential modules:

- Git workspace tools.
- Port manager.
- Docker compose control.
- Database tools.
- Local service health dashboard.
- Build/test history.

Every module should follow `module boundary → service → domain contract → UI feature` and avoid direct access to another module's internals.
