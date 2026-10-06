# UX Spec

## Primary layout

1. Narrow application rail on the far left.
2. Grouped repository navigation. Each group header has a run/stop control, progress (`done/total`) while running, and a menu with the run mode (Sequential / Parallel).
3. Repository header with path, package manager, refresh, sequence and environment actions.
4. Script chips + custom command input.
5. Active process strip with PID / RAM / CPU / stop.
6. Main console.

## Interaction principles

- Destructive operations should be obvious and reversible where possible.
- Command execution is always an explicit user action.
- Long-running commands expose a persistent stop control.
- Environment content is visually distinct and clearly marked sensitive.
- Empty states should explain the next action.
- Keyboard input should work for custom commands and basic navigation.

## Export / import

- The sidebar header has a workspace menu (⇅) with "Import…" and "Export workspace…"; each group menu has "Export group…".
- Import always shows a preview dialog before changing anything. Commands that will be imported are visible, shell commands trigger a warning, and "Keep imported sequence steps enabled" is off by default.
- Results are announced as a notification.

## Group runs

- The run button uses the group's saved mode; its tooltip names the mode ("Run group (Parallel)").
- While a sequential run is in progress, waiting members show a clock icon and a failed member shows a warning icon.
- The stop control stays visible while any member still has processes, because background steps outlive the run.
- Completion, failure (with the failing repository and step) and cancellation are announced as notifications.
