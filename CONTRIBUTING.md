# Contributing

## Before a PR

```bash
gofmt -w .
go vet ./...
go test ./...
cd frontend && npm run typecheck && npm test && npm run build
```

Run `wails dev` when native behavior changed.

## Pull request expectations

- Explain the user-visible effect.
- Note any architecture or security implications.
- Add or update tests for business logic.
- Add/update an ADR for meaningful architectural decisions.

## Logo and app icon

The isometric R logo is generated, not drawn: edit `scripts/generate-logo.mjs` (the polygon outline, depth, border width, colours) and run `make logo`. It writes `build/appicon.svg`, `build/appicon.png` (Wails turns it into the macOS `.icns`), `build/windows/icon.ico` and the in-app mark `frontend/src/assets/logo.svg`. The PNG and ICO are rendered with Chrome; set `CHROME=/path/to/chrome` if it is not found (`--svg-only` skips them while iterating). Commit all generated files.
