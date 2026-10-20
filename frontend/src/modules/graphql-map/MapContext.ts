import { createContext, useCallback, useContext, useSyncExternalStore } from "react"

export type Selection = { type: string; field: string | null } | null

/**
 * Selection shared with the canvas. Nodes subscribe to their own state only
 * (`nodeState`), so selecting a type re-renders the nodes whose state
 * changed instead of every node on a large map.
 */
export function createSelectionStore() {
  let selection: Selection = null
  let related = new Set<string>()
  const listeners = new Set<() => void>()
  return {
    get: () => selection,
    related: () => related,
    set(next: Selection, nextRelated: Set<string>) {
      if (next === selection && nextRelated === related) return
      selection = next
      related = nextRelated
      listeners.forEach((listener) => listener())
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    /**
     * "selected", "selected:<field>", "related" or "". Dimming the rest is a
     * single CSS rule on the canvas, so unrelated nodes never re-render.
     */
    nodeState(name: string) {
      if (!selection) return ""
      if (selection.type === name) return selection.field ? `selected:${selection.field}` : "selected"
      return related.has(name) ? "related" : ""
    },
  }
}
export type SelectionStore = ReturnType<typeof createSelectionStore>

export type MapContextValue = {
  store: SelectionStore
  select: (type: string, field?: string | null, reveal?: boolean) => void
  /** Opens the tree panel at a type, or at one of its fields. */
  openTree: (type: string, field?: string | null) => void
}

export const MapContext = createContext<MapContextValue>({ store: createSelectionStore(), select: () => {}, openTree: () => {} })
export const useMap = () => useContext(MapContext)

/** The whole selection (re-renders on every change; for panels, not nodes). */
export function useSelection() {
  const { store } = useMap()
  return useSyncExternalStore(store.subscribe, store.get)
}

/** One node's selection state; re-renders only when it changes. */
export function useNodeState(name: string) {
  const { store } = useMap()
  const get = useCallback(() => store.nodeState(name), [store, name])
  return useSyncExternalStore(store.subscribe, get)
}
