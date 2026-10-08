# ADR-0005: Treat environment files as explicit local documents

- Status: Accepted
- Date: 2026-10-06

## Context

Developers need to inspect and edit repo env files, but accidental secret disclosure is a major risk.

## Decision

RepoDock discovers common `.env*` files but only reads and writes their content through explicit user interaction. It does not upload or log these values.

## Consequences

- The Environment drawer is a distinct module/service boundary.
- Future secret masking can be added without changing repository registration.
- The drawer offers a Form view (parsed key/value rows) and a Raw view over one text draft. Form edits go through line-preserving helpers (`envDocument.ts`) instead of re-serializing the file, keeping the "preserve file text" rule. Saving is confirmed with a variable-level change list.
