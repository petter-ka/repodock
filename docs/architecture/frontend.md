# Frontend Architecture

## Structure

```text
src/
├── app/                        # composition root, module registry (modules.ts)
├── components/
│   ├── layout/                 # application rail
│   ├── shared/                 # Toaster, PromptDialog, ConfirmDialog
│   └── ui/                     # shadcn-style primitives over Radix
├── lib/                        # bridge, contracts, mock backend, i18n, theme, ansi, keyboard
├── modules/
│   ├── repository-manager/     # sidebar, console, processes, sequences, env files
│   └── settings/
├── state/                      # cross-module state (notifications)
└── styles/                     # global tokens
```

## Module registry

Each feature module exports an `AppModule` (`lib/module.ts`): id, rail icon, label, `View`, and an optional `init` that wires backend events once for the app lifetime. The shell (`app/App.tsx`) only renders the rail and the active module's view; it knows nothing about repositories. Adding a module means adding one entry to `app/modules.ts`.

## Bridge

`lib/bridge.ts` is the only code that touches `window.go` / `window.runtime`. When Wails is not present (`npm run dev` in a browser), it falls back to `lib/mockBridge.ts`, an in-memory backend that simulates runs, output, stats and sequences.

## Rendering strategy

- Process state lives in an external store (`modules/repository-manager/store/processStore.ts`) outside React. Mutations are cheap; subscribers are notified at most once per animation frame via `useSyncExternalStore`.
- Output is indexed per run (5k lines), per repository and globally (10k lines each), trimmed in chunks.
- The console virtualizes fixed-height rows, follows the tail unless the user scrolls up, and parses ANSI lazily per line.
- Use `useMemo`/`useCallback` where profiling shows it matters; do not pre-optimize every component.

## Keyboard

`lib/keyboard.ts` provides `useShortcuts` (platform-aware `mod` = ⌘/Ctrl). Current shortcuts: Ctrl/⌘+O add repository, Ctrl/⌘+K filter repositories, Alt+↑/↓ previous/next repository, Ctrl/⌘+J command input, Ctrl/⌘+L clear console, Ctrl/⌘+S save env file, ↑/↓ command history, Alt+↑/↓ reorder sequence step, Esc closes panels.

## Design tokens

Use CSS variables for semantic colors and let Tailwind classes consume them. This keeps light/dark themes and future brand changes centralized.

## Internationalization

Translation keys should be stable semantic identifiers, e.g. `sidebar.add`, not literal English phrases. `lib/locales/en.ts` defines the message shape; other locales are typed against it, so a missing key is a compile error. Interpolation uses `{name}` placeholders via `f(template, values)`.

The locale layer currently supports:
- `en`
- `hu`

Fallback is always English.
