/**
 * Helpers for drag-and-drop reordering. A drop target is described by an
 * insertion slot in the list *before* the dragged item is removed:
 * slot 0 is above the first item, slot `length` is below the last.
 */

/** Insertion slot for a drag over item `index`: above or below its midpoint. */
export function slotFromPointer(index: number, clientY: number, rect: { top: number; height: number }): number {
  return clientY < rect.top + rect.height / 2 ? index : index + 1
}

/**
 * Convert a slot into the index the item lands at once it has been removed
 * from its old position. `from` is the item's current index in the same
 * list, or -1 when it comes from another list.
 */
export function landingIndex(slot: number, from: number): number {
  return from >= 0 && from < slot ? slot - 1 : slot
}

/** True when dropping into `slot` would leave the item where it already is. */
export function isNoopSlot(slot: number, from: number): boolean {
  return from >= 0 && (slot === from || slot === from + 1)
}

/** Return a copy of `list` with the item at `from` moved into `slot`. */
export function moveToSlot<T>(list: readonly T[], from: number, slot: number): T[] {
  if (from < 0 || from >= list.length || isNoopSlot(slot, from)) return [...list]
  const copy = [...list]
  const [item] = copy.splice(from, 1)
  copy.splice(Math.min(landingIndex(slot, from), copy.length), 0, item)
  return copy
}
