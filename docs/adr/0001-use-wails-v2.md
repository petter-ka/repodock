# ADR-0001: Use Wails v2 as the initial desktop framework

- Status: Accepted
- Date: 2026-10-06

## Context

RepoDock needs native Windows/macOS/Linux packaging while keeping Go as the backend and React/TypeScript as the UI layer.

## Decision

Use Wails v2 for the initial production line.

## Why

- v2 is the stable Wails line.
- v2 supports React TypeScript templates, native dialogs, method binding and runtime events.
- It keeps the application lightweight compared with an Electron-style Node runtime model.

## Consequences

- We use the v2 binding/runtime APIs.
- We avoid adopting v3 beta APIs until a dedicated migration ADR is approved.
- The app's bridge should be designed so a future Wails major upgrade is isolated.

## Reconsider when

Wails v3 becomes stable and its packaging/runtime surface provides a clear benefit worth migration cost.
