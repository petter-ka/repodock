import { Cpu, Eraser, Keyboard, Layers, MemoryStick, RotateCcw, Square, X } from "lucide-react"
import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"
import { useI18n } from "@/lib/i18n"
import { cn, formatBytes, formatDuration } from "@/lib/utils"
import { isActive, isZeroTime, type ProcessSnapshot, type Run } from "../domain"
import { processStore } from "../store/processStore"
import { runStatusDot, runStatusVariant } from "./status"

/** Re-renders every second while any run is active so durations tick. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [active])
  return now
}

export function ProcessStrip({ runs, snapshots, repoNames, selectedRunId, onSelectRun, onStop, onRestart, onDismiss, onClearFinished }: {
  runs: Run[]
  snapshots: Map<string, ProcessSnapshot>
  /** shown when the strip spans several repositories */
  repoNames?: Map<string, string>
  selectedRunId: string | null
  onSelectRun: (runId: string | null) => void
  onStop: (runId: string) => void
  onRestart: (runId: string) => void
  onDismiss: (runId: string) => void
  onClearFinished?: () => void
}) {
  const { t, f } = useI18n()
  const anyActive = runs.some((run) => isActive(run.status))
  const now = useNow(anyActive)
  if (!runs.length) return null

  // Active runs first (oldest first), then finished runs (newest first).
  const ordered = [...runs.filter((r) => isActive(r.status)), ...runs.filter((r) => !isActive(r.status)).reverse()]
  const finished = runs.length - runs.filter((r) => isActive(r.status)).length

  return (
    <section aria-label={t.process.title} className="border-t border-border bg-card/40 px-6 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t.process.title}</h2>
        {onClearFinished && finished > 0 && (
          <Button size="xs" variant="ghost" onClick={onClearFinished} className="text-muted-foreground"><Eraser /> {t.process.clearFinished}</Button>
        )}
      </div>
      <div className="thin-scrollbar flex gap-2 overflow-x-auto pb-1">
        {ordered.map((run) => {
          const snapshot = snapshots.get(run.id)
          const active = isActive(run.status)
          const end = active || isZeroTime(run.endedAt) ? now : new Date(run.endedAt).getTime()
          const selected = selectedRunId === run.id
          const waiting = processStore.prompt(run.id) !== undefined
          return (
            <div
              key={run.id}
              className={cn(
                "group/card relative w-[290px] shrink-0 rounded-xl border bg-background p-3 transition",
                selected ? "border-primary ring-1 ring-primary/40" : waiting ? "border-warning/70" : "border-border hover:border-primary/40",
                !active && "opacity-80",
              )}
            >
              <button
                onClick={() => onSelectRun(selected ? null : run.id)}
                aria-pressed={selected}
                aria-label={`${t.process.showOutput}: ${run.label}`}
                className="absolute inset-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="pointer-events-none relative flex items-start gap-2">
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", runStatusDot[run.status])} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{run.label}</span>
                    {waiting && <Badge variant="warning" className="px-1.5 text-[10px]"><Keyboard className="size-2.5" />{t.input.waiting}</Badge>}
                    {run.sequenceId && <Badge variant="outline" className="px-1.5 text-[10px]"><Layers className="size-2.5" />{t.process.fromSequence}</Badge>}
                  </div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground" title={run.command}>
                    {repoNames ? <span className="font-sans font-medium text-foreground/70">{repoNames.get(run.repositoryId)} · </span> : null}
                    {run.command || t.sequence.noop}
                  </div>
                </div>
                <div className="pointer-events-auto flex items-center">
                  {active ? (
                    <>
                      <Tooltip label={t.common.restart}>
                        <Button size="icon-sm" variant="ghost" aria-label={t.common.restart} onClick={() => onRestart(run.id)}><RotateCcw /></Button>
                      </Tooltip>
                      <Tooltip label={t.common.stop}>
                        <Button size="icon-sm" variant="ghost" aria-label={t.common.stop} disabled={run.status === "stopping"} onClick={() => onStop(run.id)} className="text-destructive hover:text-destructive">
                          <Square />
                        </Button>
                      </Tooltip>
                    </>
                  ) : (
                    <>
                      {run.command && (
                        <Tooltip label={t.common.restart}>
                          <Button size="icon-sm" variant="ghost" aria-label={t.common.restart} onClick={() => onRestart(run.id)}><RotateCcw /></Button>
                        </Tooltip>
                      )}
                      <Tooltip label={t.common.dismiss}>
                        <Button size="icon-sm" variant="ghost" aria-label={t.common.dismiss} onClick={() => onDismiss(run.id)}><X /></Button>
                      </Tooltip>
                    </>
                  )}
                </div>
              </div>
              <div className="pointer-events-none relative mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground tabular-nums">
                <Badge variant={runStatusVariant[run.status]}>{t.process.status[run.status]}</Badge>
                {!active && run.status !== "skipped" && run.exitCode >= 0 && <span>{f(t.process.exit, { code: run.exitCode })}</span>}
                {run.pid > 0 && <span>{t.process.pid} {run.pid}</span>}
                {active && snapshot && (
                  <>
                    <span className="inline-flex items-center gap-1" title={t.process.memory}><MemoryStick className="size-3" />{formatBytes(snapshot.memoryBytes)}</span>
                    <span className="inline-flex items-center gap-1" title={t.process.cpu}><Cpu className="size-3" />{snapshot.cpuPercent.toFixed(0)}%</span>
                    {snapshot.processCount > 1 && <span>{f(t.process.procs, { count: snapshot.processCount })}</span>}
                  </>
                )}
                <span className="ml-auto">{formatDuration(end - new Date(run.startedAt).getTime())}</span>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
