// Which mini apps are open, their stacking order and window positions.
// Cross-module: the rail toggles them, the shell renders them. Persisted per
// device so windows reopen where they were left.
import { useSyncExternalStore } from "react"
import { readJSON, writeJSON } from "@/lib/preferences"

export type WindowPosition = { x: number; y: number }
type State = {
  /** open app IDs, bottom-most first (the last one is on top) */
  open: string[]
  positions: Record<string, WindowPosition>
}

const KEY = "miniApps"
let state: State = readJSON<State>(KEY, { open: [], positions: {} })
if (!Array.isArray(state.open) || typeof state.positions !== "object" || !state.positions) state = { open: [], positions: {} }
const listeners = new Set<() => void>()

function set(next: State, persist = true) {
  state = next
  if (persist) writeJSON(KEY, state)
  listeners.forEach((listener) => listener())
}

export const miniApps = {
  get: () => state,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
  isOpen: (id: string) => state.open.includes(id),
  toggle(id: string) {
    if (state.open.includes(id)) miniApps.close(id)
    else set({ ...state, open: [...state.open, id] })
  },
  close(id: string) {
    set({ ...state, open: state.open.filter((open) => open !== id) })
  },
  /** Brings a window to the front. */
  focus(id: string) {
    if (state.open.at(-1) === id || !state.open.includes(id)) return
    set({ ...state, open: [...state.open.filter((open) => open !== id), id] }, false)
  },
  /** Moves a window; `persist` is false while dragging and true on drop. */
  move(id: string, position: WindowPosition, persist = true) {
    set({ ...state, positions: { ...state.positions, [id]: position } }, persist)
  },
}

export function useMiniApps() {
  return useSyncExternalStore(miniApps.subscribe, miniApps.get)
}
