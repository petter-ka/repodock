// A small Markdown reader for release notes (Settings → About). It covers
// what GitHub release notes use — headings, lists, paragraphs, code,
// quotes, emphasis, links — and produces plain data that React renders as
// text, so nothing from the notes is ever injected as HTML.

export type Inline =
  | { kind: "text" | "code" | "strong" | "em"; text: string }
  | { kind: "link"; text: string; href: string }

export type Block =
  | { kind: "heading"; level: number; inline: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "paragraph"; inline: Inline[] }
  | { kind: "quote"; inline: Inline[] }
  | { kind: "code"; text: string }

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/
const FENCE = /^\s*(```|~~~)/
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = []
  const lines = source.replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, "").split("\n")
  let paragraph: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", inline: parseInline(paragraph.join(" ")) })
    if (list) blocks.push({ kind: "list", ordered: list.ordered, items: list.items.map(parseInline) })
    paragraph = []
    list = null
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (FENCE.test(line)) {
      flush()
      const fence = line.trim().slice(0, 3)
      const code: string[] = []
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence); i++) code.push(lines[i])
      blocks.push({ kind: "code", text: code.join("\n") })
      continue
    }
    if (!line.trim() || RULE.test(line) || TABLE_SEPARATOR.test(line)) {
      flush()
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      flush()
      blocks.push({ kind: "heading", level: heading[1].length, inline: parseInline(heading[2]) })
      continue
    }
    const item = ITEM.exec(line)
    if (item) {
      const ordered = /\d/.test(item[1])
      if (paragraph.length || (list && list.ordered !== ordered)) flush()
      list ??= { ordered, items: [] }
      list.items.push(item[2])
      continue
    }
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`
      continue
    }
    if (line.trimStart().startsWith(">")) {
      flush()
      blocks.push({ kind: "quote", inline: parseInline(line.trimStart().replace(/^>\s?/, "")) })
      continue
    }
    if (list) flush()
    // A table row reads as its own line of text: "| a | b |" → "a · b".
    if (line.trimStart().startsWith("|")) {
      flush()
      paragraph.push(line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()).join(" · "))
      flush()
      continue
    }
    paragraph.push(line.trim())
  }
  flush()
  return blocks
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*|__[^_]+__)|(\[([^\]]+)\]\(([^)\s]+)\))|(\*[^*\s][^*]*\*|\b_[^_\s][^_]*_\b)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let last = 0
  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0
    if (index > last) out.push({ kind: "text", text: text.slice(last, index) })
    const [whole, code, strong, , label, href, em, url] = match
    if (code) out.push({ kind: "code", text: code.slice(1, -1) })
    else if (strong) out.push({ kind: "strong", text: strong.slice(2, -2) })
    else if (label !== undefined) out.push({ kind: "link", text: label, href: href ?? "" })
    else if (em) out.push({ kind: "em", text: em.slice(1, -1) })
    else if (url) out.push({ kind: "link", text: url, href: url })
    else out.push({ kind: "text", text: whole })
    last = index + whole.length
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) })
  return out
}
