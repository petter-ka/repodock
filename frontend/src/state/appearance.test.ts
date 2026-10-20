import { beforeAll, describe, expect, it } from "vitest"

// Tests run in Node: stub the bits of the DOM the store touches.
const props = new Map<string, string>()
const style = { fontSize: "", setProperty: (k: string, v: string) => void props.set(k, v), getPropertyValue: (k: string) => props.get(k) ?? "" }
const storage = new Map<string, string>()
let store: typeof import("./appearance")

beforeAll(async () => {
  Object.assign(globalThis, {
    document: { documentElement: { style } },
    localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v) },
  })
  store = await import("./appearance")
})

describe("appearance", () => {
  it("defaults to M, which is the original 16px text and 4px spacing", () => {
    store.applyStoredAppearance()
    expect(store.appearance.get()).toEqual({ text: "m", spacing: "m" })
    expect(style.fontSize).toBe("16px")
    expect(props.get("--ui-spacing")).toBe("1")
  })

  it("applies and remembers text size and spacing independently", () => {
    store.appearance.set({ text: "xl" })
    expect(style.fontSize).toBe("20px")
    expect(props.get("--ui-spacing")).toBe("1")
    expect(store.appearance.textScale()).toBe(1.25)
    store.appearance.set({ spacing: "s" })
    expect(props.get("--ui-spacing")).toBe("0.85")
    expect(storage.get("repodock.appearance.text")).toBe("xl")
    expect(storage.get("repodock.appearance.spacing")).toBe("s")
  })
})
