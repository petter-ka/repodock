import { describe, expect, it } from "vitest"
import { miniApps } from "./miniApps"

describe("miniApps store", () => {
  it("toggles, stacks and remembers positions", () => {
    miniApps.toggle("a")
    miniApps.toggle("b")
    expect(miniApps.get().open).toEqual(["a", "b"])
    miniApps.focus("a")
    expect(miniApps.get().open).toEqual(["b", "a"])
    miniApps.move("a", { x: 10, y: 20 })
    miniApps.toggle("a")
    expect(miniApps.isOpen("a")).toBe(false)
    expect(miniApps.get().positions.a).toEqual({ x: 10, y: 20 })
    miniApps.close("b")
    expect(miniApps.get().open).toEqual([])
  })
})
