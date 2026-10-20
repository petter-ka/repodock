// Which mini apps are open, their stacking order and window positions.
// Cross-module: the rail toggles them, the shell renders them. Persisted per
// device so windows reopen where they were left.
import { useSyncExternalStore } from "react"
import { readJSON, writeJSON } from "@/lib/preferences"

export type WindowPosition = { x: number; y: number }
export type WindowSize = { width: number; height: number }
type State = {
  /** open app IDs, bottom-most first (the last one is on top) */
  open: string[]
  positions: Record<string, WindowPosition>
  /** sizes of resized windows */
  sizes: Record<string, WindowSize>
  /** maximized window IDs */
  maximized: string[]
}

const KEY = "miniApps"
const empty = (): State => ({ open: [], positions: {}, sizes: {}, maximized: [] })
let state: State = { ...empty(), ...readJSON<Partial<State>>(KEY, {}) }
if (!Array.isArray(state.open) || typeof state.positions !== "object" || !state.positions) state = empty()
if (typeof state.sizes !== "object" || !state.sizes) state.sizes = {}
if (!Array.isArray(state.maximized)) state.maximized = []
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
  /** Opens or closes a window; `maximized` opens it maximized (a later restore still works). */
  toggle(id: string, options: { maximized?: boolean } = {}) {
    if (state.open.includes(id)) return miniApps.close(id)
    const maximized = options.maximized && !state.maximized.includes(id) ? [...state.maximized, id] : state.maximized
    set({ ...state, open: [...state.open, id], maximized })
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
  /** Resizes a window; `persist` is false while dragging and true on drop. */
  resize(id: string, size: WindowSize, persist = true) {
    set({ ...state, sizes: { ...state.sizes, [id]: size } }, persist)
  },
  isMaximized: (id: string) => state.maximized.includes(id),
  toggleMaximized(id: string) {
    const maximized = state.maximized.includes(id) ? state.maximized.filter((m) => m !== id) : [...state.maximized, id]
    set({ ...state, maximized })
  },
}

export function useMiniApps() {
  return useSyncExternalStore(miniApps.subscribe, miniApps.get)
}
