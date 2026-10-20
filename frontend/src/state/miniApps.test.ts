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

  it("remembers sizes and maximized windows", () => {
    miniApps.resize("a", { width: 900, height: 600 })
    expect(miniApps.get().sizes.a).toEqual({ width: 900, height: 600 })
    miniApps.toggleMaximized("a")
    expect(miniApps.isMaximized("a")).toBe(true)
    miniApps.toggleMaximized("a")
    expect(miniApps.isMaximized("a")).toBe(false)
  })

  it("opens maximized when asked, every time", () => {
    miniApps.toggle("m", { maximized: true })
    expect(miniApps.isMaximized("m")).toBe(true)
    miniApps.toggleMaximized("m")
    miniApps.toggle("m")
    expect(miniApps.isMaximized("m")).toBe(false)
    miniApps.toggle("m", { maximized: true })
    expect(miniApps.isOpen("m") && miniApps.isMaximized("m")).toBe(true)
  })
})
