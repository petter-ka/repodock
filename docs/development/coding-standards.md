# Coding Standards

## Go

- `gofmt` mandatory.
- Errors are explicit and wrapped with context.
- Public binding methods return serializable domain-safe values.
- Avoid globals except immutable constants.
- Context cancellation must be respected in long-running operations.

## TypeScript

- Strict TypeScript.
- Prefer discriminated unions for async/process states.
- Keep Wails bridge calls in `lib/bridge.ts` rather than scattering `window` access through components.
- Avoid `any` except at the one narrow boundary where Wails injected globals are typed.

## React

- Functional components.
- Feature components stay within their module.
- Shared components stay dependency-light.
- Avoid deep prop-drilling by using a feature hook or small context when necessary.

## Commits

Use Conventional Commits where practical:

`feat(process): stream stderr independently`
