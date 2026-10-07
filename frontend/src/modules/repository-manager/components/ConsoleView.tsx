import { ArrowDownToLine, Copy, Search, TerminalSquare, Trash2 } from "lucide-react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"
import { parseAnsi, stripAnsi, styleToCSS, type AnsiSegment } from "@/lib/ansi"
import { useI18n } from "@/lib/i18n"
import { useNotifications } from "@/state/notifications"
import { cn } from "@/lib/utils"
import type { ConsoleLine, Run } from "../domain"
import { useProcessVersion } from "../hooks/useStores"
import { processStore, type LineView } from "../store/processStore"
import { useConsoleLimit } from "@/state/consoleLimit"

const LINE_HEIGHT = 20
const OVERSCAN = 20
const PADDING = 8

/**
 * Parsed ANSI segments, cached per line object. A WeakMap lets a line's
 * segments be collected together with the line once it leaves the ring
 * buffer, and only rows that were actually rendered are ever parsed.
 */
const segmentCache = new WeakMap<ConsoleLine, AnsiSegment[]>()
const segmentsOf = (line: ConsoleLine) => {
  let segments = segmentCache.get(line)
  if (!segments) segmentCache.set(line, (segments = parseAnsi(line.text)))
  return segments
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })

export function ConsoleView({ repositoryId, runs, repoNames, selectedRunId, onSelectRun, onClear }: {
  /** undefined shows output from every repository */
  repositoryId?: string
  runs: Run[]
  repoNames?: Map<string, string>
  selectedRunId: string | null
  onSelectRun: (runId: string | null) => void
  onClear: () => void
}) {
  const { t, f } = useI18n()
  const { notify } = useNotifications()
  const version = useProcessVersion()
  const [query, setQuery] = useState("")
  const [follow, setFollow] = useState(true)
  const limit = useConsoleLimit()
  const scrollRef = useRef<HTMLDivElement>(null)
  // Ring-buffer evictions seen so far, to keep the view anchored while
  // scrolled up (the oldest lines disappear from above).
  const evictedRef = useRef<number | undefined>(undefined)

  const runLabels = useMemo(() => new Map(runs.map((run) => [run.id, run.label])), [runs])
  const showRunColumn = !selectedRunId && runs.length > 1

  // The store's live buffers are mutated in place, so `stamp` (not the
  // view object) tells when the content changed.
  const stamp = processStore.getOutputStamp()
  const lines: LineView = useMemo(() => {
    void version
    const source = processStore.lines({ repositoryId, runId: selectedRunId })
    const needle = query.trim().toLowerCase()
    if (!needle) return source
    const matches: ConsoleLine[] = []
    for (let i = 0; i < source.length; i++) {
      const line = source.at(i)!
      if (stripAnsi(line.text).toLowerCase().includes(needle)) matches.push(line)
    }
    return matches
  }, [version, stamp, repositoryId, selectedRunId, query]) // eslint-disable-line react-hooks/exhaustive-deps

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => LINE_HEIGHT,
    overscan: OVERSCAN,
    paddingStart: PADDING,
    paddingEnd: PADDING,
    getItemKey: (index) => lines.at(index)?.seq ?? index,
  })

  // Stick to the bottom while following; otherwise compensate for lines
  // evicted from the top so the visible text does not move.
  useLayoutEffect(() => {
    const node = scrollRef.current
    const evicted = lines.evicted
    const previous = evictedRef.current
    evictedRef.current = evicted
    if (!node) return
    if (follow) node.scrollTop = node.scrollHeight
    else if (evicted !== undefined && previous !== undefined && evicted > previous) {
      node.scrollTop = Math.max(0, node.scrollTop - (evicted - previous) * LINE_HEIGHT)
    }
  }, [lines, stamp, follow])

  // Reset follow when switching scope.
  useEffect(() => {
    setFollow(true)
    evictedRef.current = undefined
  }, [repositoryId, selectedRunId, query])

  const onScroll = () => {
    const node = scrollRef.current
    if (!node) return
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < LINE_HEIGHT * 1.5
    if (atBottom !== follow) setFollow(atBottom)
  }

  const jump = () => {
    setFollow(true)
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }

  const copy = () => {
    const text: string[] = []
    for (let i = 0; i < lines.length; i++) text.push(stripAnsi(lines.at(i)!.text))
    void navigator.clipboard?.writeText(text.join("\n")).then(() => notify(t.console.copied, { tone: "success", duration: 1500 }))
  }

  const items = virtualizer.getVirtualItems()

  return (
    <section aria-label={t.console.title} className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-t border-border px-6 py-2">
        <TerminalSquare className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{t.console.title}</h2>
        <select
          aria-label={t.console.allRuns}
          value={selectedRunId ?? ""}
          onChange={(event) => onSelectRun(event.target.value || null)}
          className="ml-2 h-7 max-w-[240px] rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">{t.console.allRuns}</option>
          {[...runs].reverse().map((run) => (
            <option key={run.id} value={run.id}>
              {repoNames ? `${repoNames.get(run.repositoryId) ?? ""} · ` : ""}{run.label} — {t.process.status[run.status]}
            </option>
          ))}
        </select>
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") setQuery("") }}
            placeholder={t.console.filter}
            aria-label={t.console.filter}
            className="h-7 w-48 rounded-md border border-border bg-background pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <Tooltip label={t.console.limitHint}>
          <span className="w-28 text-right text-[11px] tabular-nums text-muted-foreground">{f(t.console.linesOf, { count: lines.length.toLocaleString(), limit: limit.toLocaleString() })}</span>
        </Tooltip>
        <Tooltip label={t.console.copy}>
          <Button size="icon-sm" variant="ghost" aria-label={t.console.copy} disabled={!lines.length} onClick={copy}><Copy /></Button>
        </Tooltip>
        <Tooltip label={t.console.clear}>
          <Button size="icon-sm" variant="ghost" aria-label={t.console.clear} onClick={onClear}><Trash2 /></Button>
        </Tooltip>
      </div>

      <div className="relative min-h-0 flex-1 bg-console">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          role="log"
          aria-live="off"
          tabIndex={0}
          className="console-scrollbar absolute inset-0 overflow-auto font-mono text-[12px] text-console-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {lines.length === 0 ? (
            <div className="flex h-full items-center justify-center text-console-muted">
              <div className="text-center font-sans">
                <TerminalSquare className="mx-auto mb-3 size-8 opacity-50" />
                <div className="text-sm">{t.console.noOutput}</div>
                <div className="mt-1 text-xs">{t.console.noOutputHint}</div>
              </div>
            </div>
          ) : (
            <div style={{ height: virtualizer.getTotalSize() }} className="relative min-w-full">
              {/* Rows stay in normal flow inside one translated wrapper, so long
                  lines widen the scroll area for horizontal scrolling. */}
              <div className="absolute left-0 top-0 min-w-full" style={{ transform: `translateY(${items[0]?.start ?? 0}px)` }}>
                {items.map((item) => {
                  const line = lines.at(item.index)!
                  return (
                    <LineRow
                      key={item.key}
                      line={line}
                      repoName={repoNames?.get(line.repositoryId)}
                      runLabel={showRunColumn ? runLabels.get(line.runId) : undefined}
                    />
                  )
                })}
              </div>
            </div>
          )}
        </div>
        {!follow && lines.length > 0 && (
          <Button size="xs" onClick={jump} className="absolute bottom-3 right-5 shadow-lg">
            <ArrowDownToLine /> {t.console.jump}
          </Button>
        )}
      </div>
    </section>
  )
}

const LineRow = memo(function LineRow({ line, repoName, runLabel }: { line: ConsoleLine; repoName?: string; runLabel?: string }) {
  const segments = segmentsOf(line)
  const stderr = line.stream === "stderr"
  const stdin = line.stream === "stdin"
  return (
    <div className={cn("flex w-max min-w-full gap-3 whitespace-pre px-6 hover:bg-white/[0.03]", stderr && "bg-red-500/[0.06]", stdin && "bg-emerald-500/[0.07]")} style={{ height: LINE_HEIGHT, lineHeight: `${LINE_HEIGHT}px` }}>
      <span className="w-16 shrink-0 select-none text-console-muted">{line.timestamp ? timeFormat.format(new Date(line.timestamp)) : ""}</span>
      {repoName !== undefined && <span className="w-28 shrink-0 select-none truncate text-sky-300/80">{repoName}</span>}
      {runLabel !== undefined && <span className="w-20 shrink-0 select-none truncate text-violet-300/80">{runLabel}</span>}
      <span className={cn("w-1 shrink-0 select-none", stderr ? "bg-red-400/70" : stdin ? "bg-emerald-400/70" : line.partial ? "bg-amber-400/70" : "bg-transparent")} aria-hidden />
      {stdin && <span className="select-none text-emerald-300">›</span>}
      <span className={cn(stderr && "text-red-200", stdin && "text-emerald-200")}>
        {segments.map((segment, i) => (
          <span key={i} style={styleToCSS(segment.style)}>{segment.text}</span>
        ))}
      </span>
    </div>
  )
})
