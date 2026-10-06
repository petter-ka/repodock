# ADR-0006: Empty command entries are valid no-op steps

- Status: Accepted
- Date: 2026-10-06

## Context

Command sequences benefit from placeholders during setup, and an empty action is useful as a deliberate gap.

## Decision

Allow empty command entries. Execution marks them `skipped` / `noop` and continues the sequence.

## Consequences

- UI can build a sequence before all commands are known.
- Interactive terminal behavior remains a separate future feature.
