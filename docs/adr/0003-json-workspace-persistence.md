# ADR-0003: Persist the MVP workspace as versioned JSON

- Status: Accepted
- Date: 2026-10-06

## Context

The initial data set is small and local. A database would add operational complexity without a user-visible benefit for the core MVP.

## Decision

Store the workspace as a versioned JSON file in the platform user config directory.

## Consequences

- Simple backups and debugging.
- Easy migration to SQLite later.
- Need explicit corruption handling and atomic writes.
