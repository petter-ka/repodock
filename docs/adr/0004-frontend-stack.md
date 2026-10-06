# ADR-0004: React + TypeScript + Vite + Tailwind + shadcn/ui

- Status: Accepted
- Date: 2026-10-06

## Context

The UI must feel modern, fast, themeable and easy to extend with conventional React patterns.

## Decision

Use React + TypeScript + Vite, Tailwind CSS 4 and shadcn/ui-style components.

## Consequences

- Shared components live in source code and can be modified locally.
- The app benefits from the current Vite/Rolldown build toolchain.
- We need to keep browser-only assumptions out of the native boundary.
