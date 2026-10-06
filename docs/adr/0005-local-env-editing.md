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
