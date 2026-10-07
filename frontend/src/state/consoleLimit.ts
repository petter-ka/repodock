// Console scrollback size, shared by the settings page (writes) and the
// repository manager's process store (reads). A per-device preference.
import { useSyncExternalStore } from "react"
import { readPreference, writePreference } from "@/lib/preferences"

export const CONSOLE_LIMITS = [1_000, 2_000, 5_000, 10_000, 20_000] as const
export type ConsoleLimit = (typeof CONSOLE_LIMITS)[number]
export const DEFAULT_CONSOLE_LIMIT: ConsoleLimit = 2_000

const KEY = "console.limit"
const listeners = new Set<(limit: ConsoleLimit) => void>()

function parse(value: string | null): ConsoleLimit {
  const n = Number(value)
  return (CONSOLE_LIMITS as readonly number[]).includes(n) ? (n as ConsoleLimit) : DEFAULT_CONSOLE_LIMIT
}

let current = parse(readPreference(KEY))

export const consoleLimit = {
  get: () => current,
  set(limit: ConsoleLimit) {
    if (limit === current) return
    current = limit
    writePreference(KEY, String(limit))
    listeners.forEach((listener) => listener(limit))
  },
  subscribe(listener: (limit: ConsoleLimit) => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
}

export function useConsoleLimit() {
  return useSyncExternalStore(consoleLimit.subscribe, consoleLimit.get)
}
