import { describe, expect, it } from "vitest"
import { parseInline, parseMarkdown } from "./markdown"

describe("parseMarkdown", () => {
  it("reads the parts release notes use", () => {
    const blocks = parseMarkdown([
      "## What's new",
      "",
      "- **Node.js** versions",
      "- Env files in",
      "  sub-folders",
      "1. first",
      "",
      "Plain text",
      "over two lines.",
      "> note",
      "```sh",
      "curl -fsSL x | sh",
      "```",
      "<!-- hidden -->",
      "---",
    ].join("\r\n"))
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "list", "list", "paragraph", "quote", "code"])
    expect(blocks[0]).toEqual({ kind: "heading", level: 2, inline: [{ kind: "text", text: "What's new" }] })
    expect(blocks[1]).toMatchObject({ ordered: false, items: [[{ kind: "strong", text: "Node.js" }, { kind: "text", text: " versions" }], [{ kind: "text", text: "Env files in sub-folders" }]] })
    expect(blocks[2]).toMatchObject({ ordered: true })
    expect(blocks[3]).toEqual({ kind: "paragraph", inline: [{ kind: "text", text: "Plain text over two lines." }] })
    expect(blocks[5]).toEqual({ kind: "code", text: "curl -fsSL x | sh" })
  })

  it("turns tables into text rows", () => {
    expect(parseMarkdown("| a | b |\n|---|---|\n| c | d |")).toEqual([
      { kind: "paragraph", inline: [{ kind: "text", text: "a · b" }] },
      { kind: "paragraph", inline: [{ kind: "text", text: "c · d" }] },
    ])
  })
})

describe("parseInline", () => {
  it("finds code, emphasis and links, and leaves the rest as text", () => {
    expect(parseInline("Use `nvm` with [docs](https://x.dev/a) or https://github.com/o/r/pull/1. *Fast* <b>no</b>")).toEqual([
      { kind: "text", text: "Use " },
      { kind: "code", text: "nvm" },
      { kind: "text", text: " with " },
      { kind: "link", text: "docs", href: "https://x.dev/a" },
      { kind: "text", text: " or " },
      { kind: "link", text: "https://github.com/o/r/pull/1", href: "https://github.com/o/r/pull/1" },
      { kind: "text", text: ". " },
      { kind: "em", text: "Fast" },
      { kind: "text", text: " <b>no</b>" },
    ])
  })
})
