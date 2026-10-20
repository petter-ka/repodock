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
│   ├── graphql-map/            # mini app: schema files → merged model → React Flow graph + docs panel (ADR-0029)
│   ├── jwt-tool/ process-killer/  # mini apps (ADR-0018, ADR-0020)
│   ├── repository-manager/     # sidebar, dashboard, console, processes, sequences, env files, schedules, launch-folder dialog
│   ├── scheduled-stop/         # countdown before a scheduled stop (shell-level)
│   └── settings/
├── state/                      # cross-module state (notifications, mini app windows, console limit, appearance)
└── styles/                     # global tokens
```

## Module registry

Each feature module exports an `AppModule` (`lib/module.ts`): id, rail icon, label, `View`, and an optional `init` that wires backend events once for the app lifetime. The shell (`app/App.tsx`) only renders the rail and the active module's view; it knows nothing about repositories. Adding a module means adding one entry to `app/modules.ts`.

Mini apps (`MiniApp`, registered in `app/miniApps.ts`) open in non-modal `FloatingWindow`s (ADR-0018). A mini app may declare a default `height` and `resizable: true`; its size and maximized state are kept in `state/miniApps.ts` next to its position (ADR-0029). Heavy mini apps lazy-load their view.

## Text size and spacing

Settings → Size offers Text size and Spacing, S/M/L/XL each (ADR-0030). Text size is the root font size, so text must use rem (`text-xs`, `text-[0.6875rem]`), never px. Spacing scales Tailwind's `--spacing` unit. Components that need pixel metrics tied to the text (the console's virtualized line height) read `state/appearance.ts`.

## Bridge

`lib/bridge.ts` is the only code that touches `window.go` / `window.runtime`. When Wails is not present (`npm run dev` in a browser), it falls back to `lib/mockBridge.ts`, an in-memory backend that simulates runs, output, stats and sequences.

## Rendering strategy

- Process state lives in an external store (`modules/repository-manager/store/processStore.ts`) outside React. Mutations are cheap; subscribers are notified at most once per animation frame via `useSyncExternalStore`.
- Output lives in fixed-capacity ring buffers, globally and per repository, sized by the scrollback setting (`state/consoleLimit.ts`, default 2k lines); a run's view is filtered from its repository's buffer. Only the newest 200 finished runs are remembered. Memory is constant over long sessions (ADR-0016).
- The console virtualizes fixed-height rows with `@tanstack/react-virtual`, follows the tail unless the user scrolls up (compensating for evicted lines), and parses ANSI lazily into a `WeakMap` cache.
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
