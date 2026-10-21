# ADR-0033: Every kind of env file, in sub-folders too

- Status: Accepted
- Date: 2026-10-21

## Context

The Environment drawer (ADR-0005) listed eight fixed names (`.env`, `.env.local`, `.env.development[.local]`, `.env.test[.local]`, `.env.production[.local]`) in the repository root only. Real repositories also have `.env.staging`, `.env.example`, `docker.env`, and — in monorepos — env files per app and package (`apps/web/.env.local`, `packages/db/.env`).

## Decision

- **Names**: `.env`, `.env.<anything>` and `<name>.env`. Editor swap and backup files (`~`, `.swp`, `.swo`, `.swx`, `.tmp`) and RepoDock's own temp files are not env files. `.envrc` (direnv, a shell script) is not one either.
- **Where**: the repository folder and its sub-folders, at most 5 levels deep. Dependency, build and cache folders (`node_modules`, `vendor`, `dist`, `build`, `out`, `coverage`, `target`, `venv`, …) and hidden folders are skipped, except `.devcontainer` and `.docker`. Symlinked folders are not followed. A scan visits at most 50,000 entries and lists at most 200 files.
- **Names are slash-separated relative paths** (`apps/web/.env.local`) in `Repository.envFiles` and the bindings. Order: the root first, then folders in path order; within a folder the well-known names first, in the order above, then the rest alphabetically.
- **Validation**: `ReadEnvironmentFile`/`SaveEnvironmentFile` accept only names discovery could produce — relative, clean, forward slashes, an env file name, not deeper than the limit, not inside a skipped folder. A file in a sub-folder must resolve (after symlinks of its folders) inside the repository, so a symlinked folder cannot lead a read or write outside it. Content handling is unchanged (≤ 1 MiB, exact text, atomic write, symlinked files written through).
- **UI**: the drawer's file list is grouped by folder (root first), with a filter when there are more than eight files; the open file's path is shown above the editor.

## Consequences

- Monorepo env files are reachable without registering each package.
- Discovery runs on every refresh; the limits keep it fast on very large repositories, at the cost of missing files deeper than 5 levels or past the limits.
