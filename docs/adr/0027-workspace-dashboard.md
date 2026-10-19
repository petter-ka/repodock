# ADR-0027: A workspace dashboard as the default "All repositories" view

- Status: Accepted
- Date: 2026-10-19

## Context

With nothing selected, "All repositories" showed every process and the combined console. That answers "what is running", not "what does my workspace look like": how ready each group is, what it is built with, and when it runs by itself.

## Decision

- "All repositories" gets two tabs: **Dashboard** (default) and **Processes & console** (the previous view, unchanged). The tab is remembered per device; ←/→ switch tabs. The console stays useful without a selection, as the UI rules require.
- The dashboard is grouped and about the big picture, not processes:
  - stat tiles: repositories, groups, scripts, ready to run (share with a sequence), scheduled groups, repositories needing attention;
  - **Repositories per group**: stacked bars of each member's readiness (has a sequence, skipped in group run — hatched, no sequence, package.json problem) with totals;
  - **Week at a glance**: seven day rows on a 24-hour axis with each scheduled group's running window in its colour (a start-only or stop-only schedule fades), today highlighted with a now marker;
  - **Package managers** (donut), **Tech stack** (frameworks found in `package.json`), **Dependencies per group** (dependencies vs dev dependencies);
  - one card per group: run mode, skips, readiness bar, member chips (open a repository), next start/stop, last run, run/stop and schedule;
  - a "Needs attention" list of repositories with problems.
- Discovery additionally counts `dependencies`/`devDependencies` and detects a short `stack` (Next.js, React, Vue, NestJS, Express, Vite, TypeScript, …; a meta-framework hides the library it implies). It is parsed, never executed.
- Charts are plain SVG/CSS (no chart library). Groups take a fixed categorical palette slot by sidebar order (`--series-1…8`, light and dark steps). A ninth group and later share a neutral "other" colour, never a generated hue. Text never wears series colours. Every mark has a hover tooltip, every chart has a legend or direct labels, and each chart card can switch to a table.
- Figures are computed in a pure function (`dashboard.ts`) with unit tests.

## Consequences

- `Repository` gains `dependencies`, `devDependencies` and `stack`; they fill in on the next refresh (every start refreshes all repositories).
