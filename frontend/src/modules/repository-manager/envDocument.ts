/**
 * Line-preserving dotenv editing for the Environment form view. Edits rewrite
 * only the affected line, so comments, blank lines, ordering, quoting and line
 * endings of the file text are preserved (see "Environment rules").
 */

const assignment = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_.-]*)(\s*=\s*)(.*)$/
export const envKeyPattern = /^[A-Za-z_][A-Za-z0-9_.-]*$/

export type EnvQuote = "" | "\"" | "'"

export type EnvEntry = {
  /** line number (0-based) in the file text */
  line: number
  key: string
  /** value without quotes */
  value: string
  quote: EnvQuote
}

type ParsedLine = EnvEntry & { prefix: string; separator: string; suffix: string }

/** Splits text into lines and the line endings after them. */
function split(content: string) {
  const parts = content.split(/(\r?\n)/)
  const lines: string[] = []
  const endings: string[] = []
  for (let i = 0; i < parts.length; i += 2) {
    lines.push(parts[i])
    endings.push(parts[i + 1] ?? "")
  }
  return { lines, endings }
}

function join(lines: string[], endings: string[]) {
  return lines.map((line, i) => line + (endings[i] ?? "")).join("")
}

function parseLine(text: string, line: number): ParsedLine | null {
  if (text.trimStart().startsWith("#")) return null
  const match = assignment.exec(text)
  if (!match) return null
  const [, prefix, key, separator, rest] = match
  const quote = rest[0]
  if (quote === "\"" || quote === "'") {
    let close = rest.indexOf(quote, 1)
    // A double-quoted value may contain escaped quotes.
    while (quote === "\"" && close > 0 && rest[close - 1] === "\\") close = rest.indexOf(quote, close + 1)
    if (close > 0) {
      const inner = rest.slice(1, close)
      return { line, key, prefix, separator, quote, suffix: rest.slice(close + 1), value: quote === "\"" ? inner.replace(/\\"/g, "\"") : inner }
    }
  }
  // Unquoted: an inline comment starts at " #".
  const comment = rest.search(/\s+#/)
  const raw = comment >= 0 ? rest.slice(0, comment) : rest
  const value = raw.trimEnd()
  return { line, key, prefix, separator, quote: "", suffix: rest.slice(value.length), value }
}

/** Assignments of the file in line order (comments and blank lines are skipped). */
export function parseEnv(content: string): EnvEntry[] {
  const { lines } = split(content)
  return lines.flatMap((text, i) => {
    const parsed = parseLine(text, i)
    return parsed ? [{ line: parsed.line, key: parsed.key, value: parsed.value, quote: parsed.quote }] : []
  })
}

function needsQuotes(value: string) {
  return value !== value.trim() || /[#"'`\\]/.test(value)
}

function render(entry: ParsedLine, key: string, value: string) {
  let quote: EnvQuote = entry.quote
  if (quote === "" && needsQuotes(value)) quote = "\""
  if (quote === "'" && value.includes("'")) quote = "\""
  const body = quote === "\"" ? value.replace(/"/g, "\\\"") : value
  // An unquoted inline comment needs whitespace before it to stay a comment.
  const suffix = quote === "" && entry.suffix && !/^\s/.test(entry.suffix) ? ` ${entry.suffix}` : entry.suffix
  return `${entry.prefix}${key}${entry.separator}${quote}${body}${quote}${suffix}`
}

function rewrite(content: string, line: number, edit: (entry: ParsedLine) => string) {
  const { lines, endings } = split(content)
  const entry = parseLine(lines[line] ?? "", line)
  if (!entry) return content
  lines[line] = edit(entry)
  return join(lines, endings)
}

export function setEnvValue(content: string, line: number, value: string) {
  return rewrite(content, line, (entry) => render(entry, entry.key, value))
}

export function renameEnvKey(content: string, line: number, key: string) {
  if (!envKeyPattern.test(key)) return content
  return rewrite(content, line, (entry) => render(entry, key, entry.value))
}

export function removeEnvLine(content: string, line: number) {
  const { lines, endings } = split(content)
  if (line < 0 || line >= lines.length) return content
  // Removing the last line drops the ending of the line before it instead.
  if (line === lines.length - 1 && line > 0) endings[line - 1] = endings[line]
  lines.splice(line, 1)
  endings.splice(line, 1)
  return join(lines, endings)
}

export function addEnvEntry(content: string, key: string, value: string) {
  const eol = content.includes("\r\n") ? "\r\n" : "\n"
  const text = render({ line: 0, key, value, quote: "", prefix: "", separator: "=", suffix: "" }, key, value)
  if (content === "") return text + eol
  return content.endsWith("\n") ? content + text + eol : content + eol + text
}

export type EnvChange =
  | { kind: "added"; key: string; value: string }
  | { kind: "removed"; key: string; before: string }
  | { kind: "changed"; key: string; before: string; value: string }

/** Key-level changes between two versions of a file (the last assignment of a key wins). */
export function diffEnv(before: string, after: string): EnvChange[] {
  const toMap = (content: string) => new Map(parseEnv(content).map((entry) => [entry.key, entry.value]))
  const old = toMap(before)
  const next = toMap(after)
  const changes: EnvChange[] = []
  for (const [key, value] of next) {
    if (!old.has(key)) changes.push({ kind: "added", key, value })
    else if (old.get(key) !== value) changes.push({ kind: "changed", key, before: old.get(key) ?? "", value })
  }
  for (const [key, value] of old) if (!next.has(key)) changes.push({ kind: "removed", key, before: value })
  return changes
}

/** Local "YYYY-MM-DD HH:mm" stamp for comments written into env files. */
export function envTimestamp(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Keeps the saved line of every changed or removed variable as a comment so
 * the old value stays in the file: a dated note plus the commented-out
 * original line, placed above the new assignment (removed ones at the end).
 */
export function keepPreviousAsComments(saved: string, draft: string, stamp: string) {
  const changes = diffEnv(saved, draft).filter((change) => change.kind !== "added")
  if (changes.length === 0) return draft
  const savedLines = split(saved).lines
  const lastLine = (content: string, key: string) => parseEnv(content).filter((entry) => entry.key === key).at(-1)?.line ?? -1
  const note = `# RepoDock: previous value, replaced ${stamp}`
  const commented = (key: string) => [note, `# ${savedLines[lastLine(saved, key)].trimStart()}`]

  const { lines, endings } = split(draft)
  // A draft without line breaks takes the saved file's line ending.
  const eol = (draft.includes("\n") ? draft : saved).includes("\r\n") ? "\r\n" : "\n"
  // Insert bottom-up so earlier line numbers stay valid.
  const inserts = changes
    .filter((change) => change.kind === "changed")
    .map((change) => ({ at: lastLine(draft, change.key), text: commented(change.key) }))
    .sort((a, b) => b.at - a.at)
  for (const { at, text } of inserts) {
    lines.splice(at, 0, ...text)
    endings.splice(at, 0, eol, eol)
  }
  const removed = changes.filter((change) => change.kind === "removed").flatMap((change) => commented(change.key))
  if (removed.length) {
    // Append after the last line, keeping the file's trailing newline if it had one.
    const last = lines.length - 1
    if (lines[last] === "" && last > 0) {
      lines.splice(last, 0, ...removed)
      endings.splice(last, 0, ...removed.map(() => eol))
    } else {
      endings[last] = eol
      lines.push(...removed)
      endings.push(...removed.map((_, i) => (i === removed.length - 1 ? "" : eol)))
    }
  }
  return join(lines, endings)
}
