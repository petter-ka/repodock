import { describe, expect, it } from "vitest"
import { parseAnsi, stripAnsi } from "./ansi"

describe("parseAnsi", () => {
  it("returns plain text untouched", () => {
    expect(parseAnsi("hello <b>world</b>")).toEqual([{ text: "hello <b>world</b>", style: {} }])
  })

  it("applies and resets SGR colors", () => {
    const segments = parseAnsi("\u001b[32mok\u001b[0m done")
    expect(segments).toHaveLength(2)
    expect(segments[0]).toMatchObject({ text: "ok", style: { fg: "#4ade80" } })
    expect(segments[1]).toEqual({ text: " done", style: {} })
  })

  it("handles bold, bright and 256/truecolor codes", () => {
    const [a, b, c] = parseAnsi("\u001b[1;91mA\u001b[38;5;196mB\u001b[38;2;1;2;3mC")
    expect(a.style).toMatchObject({ bold: true, fg: "#fca5a5" })
    expect(b.style.fg).toBe("rgb(255, 0, 0)")
    expect(c.style.fg).toBe("rgb(1, 2, 3)")
  })

  it("strips cursor movement and OSC hyperlinks", () => {
    const text = "\u001b[2K\u001b[1Gbuilding \u001b]8;;https://example.com\u0007link\u001b]8;;\u0007"
    expect(stripAnsi(text)).toBe("building link")
    expect(parseAnsi(text).map((s) => s.text).join("")).toBe("building link")
  })
})
