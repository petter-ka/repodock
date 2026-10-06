// Minimal ANSI parser for console output. It understands SGR (colors and
// text attributes) and strips every other escape sequence (cursor movement,
// OSC hyperlinks, title changes). Output is plain data rendered as text, so
// log content can never inject markup.

export type AnsiStyle = {
  fg?: string
  bg?: string
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
  inverse?: boolean
}

export type AnsiSegment = { text: string; style: AnsiStyle }

// Palette tuned for the always-dark console surface.
const basic = ["#3b4252", "#f87171", "#4ade80", "#facc15", "#60a5fa", "#e879f9", "#22d3ee", "#e5e7eb"]
const bright = ["#6b7280", "#fca5a5", "#86efac", "#fde68a", "#93c5fd", "#f0abfc", "#67e8f9", "#ffffff"]

function color256(n: number): string | undefined {
  if (n < 0 || n > 255) return undefined
  if (n < 8) return basic[n]
  if (n < 16) return bright[n - 8]
  if (n < 232) {
    const i = n - 16
    const level = (v: number) => (v === 0 ? 0 : 55 + v * 40)
    return `rgb(${level(Math.floor(i / 36))}, ${level(Math.floor(i / 6) % 6)}, ${level(i % 6)})`
  }
  const gray = 8 + (n - 232) * 10
  return `rgb(${gray}, ${gray}, ${gray})`
}

// CSI ... final byte | OSC ... (BEL | ESC \) | single-char escapes.
// eslint-disable-next-line no-control-regex
const escape = /\u001b\[([0-9;:?]*)([@-~])|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g

function applySGR(style: AnsiStyle, params: string): AnsiStyle {
  const codes = params === "" ? [0] : params.split(/[;:]/).map((p) => (p === "" ? 0 : Number(p)))
  let next = { ...style }
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]
    if (code === 0) next = {}
    else if (code === 1) next.bold = true
    else if (code === 2) next.dim = true
    else if (code === 3) next.italic = true
    else if (code === 4) next.underline = true
    else if (code === 7) next.inverse = true
    else if (code === 22) { next.bold = false; next.dim = false }
    else if (code === 23) next.italic = false
    else if (code === 24) next.underline = false
    else if (code === 27) next.inverse = false
    else if (code >= 30 && code <= 37) next.fg = basic[code - 30]
    else if (code === 39) next.fg = undefined
    else if (code >= 40 && code <= 47) next.bg = basic[code - 40]
    else if (code === 49) next.bg = undefined
    else if (code >= 90 && code <= 97) next.fg = bright[code - 90]
    else if (code >= 100 && code <= 107) next.bg = bright[code - 100]
    else if (code === 38 || code === 48) {
      const key = code === 38 ? "fg" : "bg"
      if (codes[i + 1] === 5) {
        next[key] = color256(codes[i + 2])
        i += 2
      } else if (codes[i + 1] === 2) {
        const [r, g, b] = codes.slice(i + 2, i + 5)
        if ([r, g, b].every((v) => Number.isFinite(v))) next[key] = `rgb(${r}, ${g}, ${b})`
        i += 4
      }
    }
  }
  return next
}

/** Splits a line into styled segments, dropping non-SGR escapes. */
export function parseAnsi(input: string): AnsiSegment[] {
  if (!input.includes("\u001b")) return [{ text: input, style: {} }]
  const segments: AnsiSegment[] = []
  let style: AnsiStyle = {}
  let last = 0
  for (const match of input.matchAll(escape)) {
    const index = match.index ?? 0
    if (index > last) segments.push({ text: input.slice(last, index), style })
    if (match[2] === "m") style = applySGR(style, match[1] ?? "")
    last = index + match[0].length
  }
  if (last < input.length) segments.push({ text: input.slice(last), style })
  return segments.filter((s) => s.text.length > 0)
}

/** Plain text without any escape sequences. */
export function stripAnsi(input: string) {
  return input.includes("\u001b") ? input.replace(escape, "") : input
}

export function styleToCSS(style: AnsiStyle): React.CSSProperties | undefined {
  if (!style.fg && !style.bg && !style.bold && !style.dim && !style.italic && !style.underline && !style.inverse) return undefined
  const fg = style.inverse ? (style.bg ?? "#0b0d12") : style.fg
  const bg = style.inverse ? (style.fg ?? "#e5e7eb") : style.bg
  return {
    color: fg,
    backgroundColor: bg,
    fontWeight: style.bold ? 600 : undefined,
    opacity: style.dim ? 0.65 : undefined,
    fontStyle: style.italic ? "italic" : undefined,
    textDecoration: style.underline ? "underline" : undefined,
  }
}
