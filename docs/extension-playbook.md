# Extension Playbook

RepoDock is intended to grow by adding modules rather than by making the application shell aware of every feature.

## Add a module

1. Create `frontend/src/modules/<module-name>/` with `domain.ts`, `api.ts`, `hooks/`, `components/`, and `views/` as needed.
2. Create `internal/modules/<module-name>/` for business logic. Keep platform details behind interfaces.
3. Add only the minimal methods to `internal/app.App` needed by the UI.
4. Add module docs under `docs/architecture/` or `docs/product/` when boundaries are non-obvious.
5. Add an ADR if the module creates a new persistence, lifecycle, security, or platform decision.
6. Register the module in the application rail or another feature entry point.

## Module checklist

- no direct imports from another feature module's internal implementation;
- no access to Wails runtime from feature business logic;
- user-visible strings are localized;
- destructive actions are explicit and cancellable;
- long-running work is asynchronous;
- errors are surfaced as useful user-facing states;
- tests cover the module's high-risk logic;
- no feature logs secret contents.

## Future examples

Possible independent modules include Docker/compose controls, database tools, HTTP/API consoles, task templates, project health checks, or deployment helpers. None of these should require the repository-manager module to own their implementation.
