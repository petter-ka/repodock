.PHONY: dev build test fmt frontend-typecheck frontend-test frontend-build check

dev:
	wails dev

build:
	wails build

test:
	go test ./...

fmt:
	gofmt -w .

frontend-typecheck:
	cd frontend && npm run typecheck

frontend-test:
	cd frontend && npm test

frontend-build:
	cd frontend && npm run build

check: test frontend-typecheck frontend-test frontend-build
