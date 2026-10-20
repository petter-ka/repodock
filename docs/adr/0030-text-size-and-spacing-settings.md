# ADR-0030: Text size and spacing settings

- Status: Accepted
- Date: 2026-10-20

## Context

People run RepoDock on very different screens and eyes: some want a denser UI on a laptop, others larger text on a big monitor. Browser-style zoom scales everything together; we want text size and spacing to be chosen separately, as simple steps rather than free numbers.

## Decision

- Two per-device settings in Settings → Size, each **S / M / L / XL**, default **M**, which is exactly the original design:
  - **Text size** sets the root font size: S 14px, M 16px, L 18px, XL 20px. Text uses rem everywhere (Tailwind's `text-*`; the former `text-[11px]`-style classes were converted to rem), so all text follows.
  - **Spacing** sets Tailwind's spacing unit: `--spacing: calc(4px * var(--ui-spacing))` in `index.css`, with S 0.85, M 1, L 1.15, XL 1.3. Paddings, gaps and `size-*`/`h-*`/`w-*` follow. It is in px so it stays independent of the text size.
- `state/appearance.ts` holds the values (local storage, like the theme), applies them to `<html>` before React renders (no flash) and notifies subscribers. Views with pixel metrics that must follow the text read it: the console's virtualized line height is 20px × text scale, and its timestamp column is sized in `ch`.
- Not affected: the GraphQL map's node cards (they have their own zoom and fixed pixel row metrics, ADR-0029), and charts drawn with fixed pixel geometry.

## Consequences

- One knob changes the whole app without per-component work, as long as new code keeps text in rem (`text-xs`, `text-[0.6875rem]`) and spacing on the Tailwind scale. Hard-coded `px` text does not scale and should be avoided.
- Extreme combinations (XL text with S spacing) make fixed-size controls tighter; text in them truncates rather than overflowing.

## Reconsider when

- A setting should sync across devices (move it to the backend settings).
- Finer steps or a "follow the OS text size" option are wanted.
