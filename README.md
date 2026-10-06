# RepoDock

[![Latest release](https://img.shields.io/github/v/release/petter-ka/repodock?label=download)](https://github.com/petter-ka/repodock/releases/latest)
[![CI](https://github.com/petter-ka/repodock/actions/workflows/ci.yml/badge.svg)](https://github.com/petter-ka/repodock/actions/workflows/ci.yml)

Native multiplatform developer command center for local Node.js repositories.

RepoDock is designed for teams who have many Node.js / React / Next.js / NestJS repositories and want a fast native UI for starting, stopping, grouping and observing repository commands without opening each project individually.

## Download

Get the latest build from the **[Releases page](https://github.com/petter-ka/repodock/releases/latest)**:

| Platform | File |
|---|---|
| Windows 10/11 x64 | `RepoDock-<version>-windows-amd64-installer.exe` (installer) or `…-windows-amd64.zip` (portable) |
| macOS (Apple Silicon and Intel) | `RepoDock-<version>-macos-universal.zip` — unzip and move `RepoDock.app` to Applications |

**macOS/Linux: `command not found: npm`?** RepoDock reads the PATH of your interactive shell (including `~/.zshrc`, where nvm/fnm usually live) when it starts. Restart RepoDock after installing Node or a version manager. If your shell profile takes longer than 8 seconds to load, RepoDock falls back to common install folders (Homebrew, volta, nvm, …).

Builds are not code-signed yet. On Windows, SmartScreen may ask you to confirm (*More info → Run anyway*). On macOS, right-click the app and choose *Open* the first time, or run `xattr -dr com.apple.quarantine /Applications/RepoDock.app`. Verify downloads against `SHA256SUMS.txt`.

## Goals

- Wails + Go backend for Windows, macOS and Linux.
- React + TypeScript + Vite + Tailwind CSS + shadcn/ui style components.
- Native repository picker.
- Automatic `package.json` script discovery.
- Per-repository command chips and custom commands.
- Ordered command sequences per repository.
- Run a whole group of repositories at once — sequentially (in order, stop on failure) or in parallel.
- Export groups and repositories to JSON and import them on another machine (reviewed merge; `.env` contents never exported).
- Independent process execution with live stdout/stderr streaming.
- PID, RSS memory and CPU visibility.
- Process termination.
- `.env*` discovery with editable drawer.
- English and Hungarian localization, English by default.
- Left application rail + grouped repository navigation + main console.
- Feature modules isolated from shared UI and platform services.
- Local persistence only for MVP; no server dependency.

## Architecture at a glance

```text
┌────────────────────────────────────────────────────────────┐
│                        Wails Desktop                       │
│                                                            │
│  React/TS UI                                               │
│  ├─ app shell / theme / i18n                               │
│  ├─ shared UI                                              │
│  └─ modules/repository-manager                             │
│             │                                               │
│             ▼                                               │
│       typed bridge layer                                   │
│             │                                               │
│             ▼                                               │
│  Go application                                            │
│  ├─ app bindings                                            │
│  ├─ domain models                                           │
│  ├─ repository module                                       │
│  ├─ process module                                          │
│  ├─ environment module                                     │
│  └─ workspace/persistence module                            │
│                                                            │
│  OS resources                                               │
│  ├─ filesystem                                              │
│  ├─ shell / child processes                                │
│  └─ process metrics                                         │
└────────────────────────────────────────────────────────────┘
```

## Prerequisites

- Go 1.26+ (see `go.mod`).
- Wails CLI v2.15.0 (`go install github.com/wailsapp/wails/v2/cmd/wails@v2.15.0`).
- Node.js 20.19+ or 22.12+ for the Vite 8 frontend.
- npm 10+ (or a compatible npm version shipped with your Node.js release).
- Platform requirements from Wails for the selected OS/toolchain.

## Development

```bash
cd frontend
npm install
cd ..
wails dev
```

For frontend-only development:

```bash
cd frontend
npm run dev
```

The browser-only mode uses an in-memory mock backend (`frontend/src/lib/mockBridge.ts`) that simulates repositories, processes, output and sequences, so the UI can be iterated without Wails.

To keep development data away from your real workspace, point RepoDock at a scratch file:

```bash
REPODOCK_WORKSPACE=/tmp/repodock-dev.json wails dev
```

## Tests

```bash
go test ./...                 # unit + real-process integration tests
cd frontend && npm test       # Vitest: process store, ANSI parser, env masking
```

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| Ctrl/⌘ + O | Add repository |
| Ctrl/⌘ + K | Filter repositories |
| Alt + ↑ / ↓ | Previous / next repository |
| Ctrl/⌘ + J | Focus command input (↑/↓ for history) |
| Ctrl/⌘ + L | Clear console |
| Ctrl/⌘ + S | Save environment file |

## Production build

```bash
wails build
```

Wails embeds the built frontend into the application binary; no Node.js installation is required on the target machine for the final application runtime.

## Project layout

```text
.
├── build/                    # Wails platform build configuration
├── cmd/                      # future CLI / migration entry points
├── docs/                     # product, architecture, ADR, security, ops, development
├── frontend/                 # React + TypeScript + Vite frontend
│   └── src/
│       ├── app/              # app shell / composition root
│       ├── components/       # shared UI and layout primitives
│       ├── modules/          # feature modules
│       ├── state/            # cross-module client state
│       └── styles/
├── internal/
│   ├── app/                  # Wails binding facade
│   ├── domain/               # stable domain models
│   └── modules/              # business capabilities
├── main.go
├── go.mod
└── wails.json
```

## Important MVP decisions

1. Use Wails v2 stable first. Wails v3 is intentionally not the baseline until a migration decision is made.
2. Treat the OS shell as an implementation detail behind `process/platform`; script names are passed as argv, never spliced into shell text (ADR-0008).
3. Persist workspace configuration as JSON under the platform user config directory.
4. Do not send repository contents or environment values anywhere outside the local machine.
5. Keep modules independent. New functionality should add a module rather than grow the app shell directly.

See `docs/` before changing architectural boundaries.
