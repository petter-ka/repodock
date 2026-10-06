# Extension Points

## Backend

Create a new `internal/modules/<module>` package and expose it through `internal/app` only at the boundary needed by the UI.

## Frontend

Create `frontend/src/modules/<module>` and register a navigation item in the app rail. Keep feature components out of `components/ui`.

## Native platform

Place platform differences under a package-owned `platform/` boundary with build tags. Keep the public service interface OS-neutral.

## Persistence

The versioned workspace format is the stable migration boundary. Introducing SQLite later should implement a repository abstraction rather than changing UI contracts.
