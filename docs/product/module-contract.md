# Module Contract

A module is a vertical slice that can be added or removed without changing shared layout primitives.

## Module shape

```text
modules/<name>/
├── domain.ts
├── api.ts
├── hooks/
├── components/
├── views/
└── index.ts
```

## Module responsibilities

- define feature-specific domain types that are not shared globally;
- own feature UI and interaction logic;
- depend on bridge abstractions, not Wails globals;
- publish only the minimum surface required by the app shell.

## Current module

`repository-manager` owns repository grouping, script discovery UI, command execution controls, process output and environment editing.

Future independent modules should appear as separate entries in the application rail.
