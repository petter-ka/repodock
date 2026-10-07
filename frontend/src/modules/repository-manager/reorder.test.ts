import { describe, expect, it } from "vitest"
import { isNoopSlot, landingIndex, moveToSlot, slotFromPointer } from "./reorder"

describe("reorder", () => {
  it("picks the slot above or below the item midpoint", () => {
    const rect = { top: 100, height: 40 }
    expect(slotFromPointer(2, 110, rect)).toBe(2)
    expect(slotFromPointer(2, 130, rect)).toBe(3)
  })

  it("adjusts the landing index for items moving down the same list", () => {
    expect(landingIndex(3, 0)).toBe(2)
    expect(landingIndex(0, 2)).toBe(0)
    expect(landingIndex(1, -1)).toBe(1)
  })

  it("treats the slots around the item itself as no-ops", () => {
    expect(isNoopSlot(1, 1)).toBe(true)
    expect(isNoopSlot(2, 1)).toBe(true)
    expect(isNoopSlot(3, 1)).toBe(false)
    expect(isNoopSlot(1, -1)).toBe(false)
  })

  it("moves an item into a slot", () => {
    const list = ["a", "b", "c", "d"]
    expect(moveToSlot(list, 0, 4)).toEqual(["b", "c", "d", "a"])
    expect(moveToSlot(list, 3, 0)).toEqual(["d", "a", "b", "c"])
    expect(moveToSlot(list, 1, 3)).toEqual(["a", "c", "b", "d"])
    expect(moveToSlot(list, 1, 2)).toEqual(list)
    expect(moveToSlot(list, 9, 0)).toEqual(list)
  })
})
