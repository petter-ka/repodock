# Dependency Rules

- `domain` depends on nothing from infrastructure.
- `workspace` may depend on domain and standard library only.
- `repository`, `environment` and `process` may depend on domain and infrastructure libraries. They do not import each other or `workspace`; `app` composes them.
- `sequence` depends on domain only and reaches process execution through its `Executor` interface, implemented in `app`.
- OS-specific code lives in `process/platform` behind build tags.
- `transfer` depends on domain only; filesystem checks are injected by `app` so planning and merging stay pure and testable.
- `app` composes modules and Wails runtime.
- Frontend feature modules may depend on shared UI, `lib/` and `state/`, but shared UI and `lib/` must not import feature modules. Transport types live in `lib/contracts.ts` for this reason.
- Feature modules must not import each other; the shell discovers them through `app/modules.ts`.
- A future module may share domain primitives but must not reach into another module's internal services.
