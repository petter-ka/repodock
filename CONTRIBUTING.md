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
