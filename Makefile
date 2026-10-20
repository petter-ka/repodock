.PHONY: dev build test fmt frontend-typecheck frontend-test frontend-build check logo

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

# Regenerates the app icon and in-app logo from scripts/generate-logo.mjs
# (PNG and ICO need Chrome; set CHROME if it is not found).
logo:
	node scripts/generate-logo.mjs
