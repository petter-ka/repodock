// Interface text size and spacing (S/M/L/XL), a per-device preference.
// Settings writes it; the document root applies it, and views with fixed
// pixel metrics (the console's virtualized lines) read it. M is the original
// design: 16px root text and Tailwind's default 4px spacing unit.
import { useSyncExternalStore } from "react"
import { readPreference, writePreference } from "@/lib/preferences"

export const SIZES = ["s", "m", "l", "xl"] as const
export type Size = (typeof SIZES)[number]
export const DEFAULT_SIZE: Size = "m"

/** Root font size in px; every rem-based text size follows it. */
export const TEXT_PX: Record<Size, number> = { s: 14, m: 16, l: 18, xl: 20 }
/** Multiplier of Tailwind's spacing unit (paddings, gaps, sizes). */
export const SPACING: Record<Size, number> = { s: 0.85, m: 1, l: 1.15, xl: 1.3 }

export type Appearance = { text: Size; spacing: Size }

const KEYS = { text: "appearance.text", spacing: "appearance.spacing" } as const
const parse = (value: string | null): Size => ((SIZES as readonly string[]).includes(value ?? "") ? (value as Size) : DEFAULT_SIZE)

let current: Appearance = { text: parse(readPreference(KEYS.text)), spacing: parse(readPreference(KEYS.spacing)) }
const listeners = new Set<() => void>()

function apply({ text, spacing }: Appearance) {
  const root = document.documentElement
  root.style.fontSize = `${TEXT_PX[text]}px`
  // index.css defines --spacing as 4px × --ui-spacing.
  root.style.setProperty("--ui-spacing", String(SPACING[spacing]))
}

export const appearance = {
  get: () => current,
  set(patch: Partial<Appearance>) {
    const next = { ...current, ...patch }
    if (next.text === current.text && next.spacing === current.spacing) return
    current = next
    writePreference(KEYS.text, next.text)
    writePreference(KEYS.spacing, next.spacing)
    apply(next)
    listeners.forEach((listener) => listener())
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  /** Text scale relative to M (1 = 16px), for pixel metrics that must follow the text. */
  textScale: () => TEXT_PX[current.text] / TEXT_PX.m,
}

/** Applies the stored appearance before React renders, to avoid a flash. */
export function applyStoredAppearance() {
  apply(current)
}

export function useAppearance() {
  return useSyncExternalStore(appearance.subscribe, appearance.get)
}
