# ADR-0032: Package managers in monorepos, Corepack, Turborepo and Nx tasks

- Status: Accepted
- Date: 2026-10-21

## Context

Package-manager detection looked only at the registered folder. A package inside a pnpm or Yarn monorepo has no lockfile of its own, so it was detected as npm and its scripts ran with `npm run`, which breaks `workspace:` dependencies. Machines often have no global pnpm or Yarn but do have Corepack (bundled with Node.js 16.9–24), so `pnpm run dev` failed with "command not found". Turborepo and Nx tasks, the usual way to run a monorepo, could only be typed as custom commands.

## Decision

- **Detection order** (repository module, filesystem only): the folder's `packageManager` field, then its hint files (`pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, `bun.lockb`, `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-workspace.yaml`, `.yarnrc.yml`), then the same two in each folder above it up to the Git root (never the home folder, at most 6 levels), then npm. The `packageManager` version is kept (`Repository.packageManagerVersion`, e.g. `9.12.0`) and shown next to the manager.
- **Monorepo facts** (`Repository.monorepo`): task runners found by their config file (`turbo.json`, `nx.json`, `lerna.json`, `rush.json`), whether the folder declares workspaces (`package.json` `workspaces` in either form, or `pnpm-workspace.yaml`), and — for a folder with neither — the workspace root above it (`root`). Turborepo, Nx and Lerna in dependencies also appear in the tech stack.
- **Tasks**: `turbo.json` `tasks` (Turborepo 2) or `pipeline` (1.x) keys, in declaration order (`//#lint` runs as `lint`), and `nx.json` `targetDefaults` keys that are target names (executor keys are skipped). Both files are JSONC: comments and trailing commas are stripped before decoding. A member package offers the root's Turborepo tasks (Turborepo scopes them to the package it runs in); Nx targets are offered at the root only.
- **Running a task** (`RunTask(repoID, tool, task, label)`): only a discovered task, as an argument vector through the package manager's local-binary runner — `pnpm exec turbo run <task>`, `yarn turbo run <task>`, `bun x turbo run <task>`, `npm exec -- turbo run <task>` (Nx: `nx run-many -t <task>`). Task names are never spliced into shell text (ADR-0008). Tasks appear as a collapsible **Tasks** chip row under the scripts.
- **Corepack fallback**: a script or task whose package manager is pnpm or Yarn runs as `corepack pnpm …` / `corepack yarn …` when that manager is not found on the run's PATH (the repository's Node.js bin folder first, ADR-0031) but `corepack` is. Corepack fetches the version the repository pins and asks before downloading; the prompt is answered from the console's input bar (ADR-0013). The run's command shows the `corepack` prefix.

## Consequences

- Monorepo members run their scripts with the right manager and Node.js version without registering the root.
- A task chip in a member package runs only that package's part of the pipeline; the root's chips run everything.
- A first Corepack run in a group or scheduled run waits at the download prompt until it is answered.

## Reconsider when

- Nx project targets (from `project.json` files) are wanted, or Lerna/Rush commands.
- Users ask to run Corepack downloads without a prompt (`COREPACK_ENABLE_DOWNLOAD_PROMPT=0`).
