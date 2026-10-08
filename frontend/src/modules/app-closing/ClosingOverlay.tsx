import { AlertTriangle, CheckCircle2, Loader2, Power } from "lucide-react"
import { useEffect, useState } from "react"
import { getBackend } from "@/lib/bridge"
import type { ClosingProgress } from "@/lib/contracts"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

type Row = ClosingProgress["runs"][number] & { stopped: boolean }

/**
 * Full-window overlay shown while RepoDock stops its processes before
 * quitting (ADR-0023), so closing never looks like a frozen window. Every
 * run seen since the close began stays listed and is ticked off as it exits.
 */
export function ClosingOverlay() {
  const { t, f } = useI18n()
  const [progress, setProgress] = useState<ClosingProgress | null>(null)
  const [rows, setRows] = useState<Row[]>([])

  useEffect(() => getBackend().on("app:closing", (next) => {
    setProgress(next)
    setRows((previous) => {
      const alive = new Set(next.runs.map((run) => run.runId))
      const known = new Set(previous.map((row) => row.runId))
      return [
        ...previous.map((row) => ({ ...row, stopped: !alive.has(row.runId) })),
        ...next.runs.filter((run) => !known.has(run.runId)).map((run) => ({ ...run, stopped: false })),
      ]
    })
  }), [])

  if (!progress) return null
  const total = rows.length
  const stopped = rows.filter((row) => row.stopped).length
  const remaining = total - stopped
  const message = progress.done ? t.closing.done
    : remaining > 0 ? f(t.closing.stopping, { count: remaining })
      : t.closing.cleanup
  const percent = progress.done ? 100 : total === 0 ? 0 : Math.round((stopped / total) * 100)

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="closing-title"
      aria-describedby="closing-message"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="relative flex size-12 shrink-0 items-center justify-center">
            {progress.done ? (
              <CheckCircle2 className="size-10 text-success" />
            ) : (
              <>
                <span className="absolute inset-0 rounded-full border-2 border-primary/15" />
                <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-primary" />
                <Power className="size-5 text-primary" />
              </>
            )}
          </div>
          <div className="min-w-0">
            <h2 id="closing-title" className="text-base font-semibold">{t.closing.title}</h2>
            <p id="closing-message" aria-live="polite" className="text-sm text-muted-foreground">{message}</p>
          </div>
        </div>

        {total > 0 && (
          <>
            <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full transition-all duration-300", progress.forcing ? "bg-warning" : "bg-primary")} style={{ width: `${percent}%` }} />
            </div>
            <p className="mt-1.5 text-right text-[11px] tabular-nums text-muted-foreground">{f(t.closing.progress, { done: stopped, total })}</p>
            <ul className="thin-scrollbar mt-3 max-h-56 space-y-1 overflow-y-auto">
              {rows.map((row) => (
                <li key={row.runId} className={cn("flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition", row.stopped ? "text-muted-foreground" : "bg-muted/50")}>
                  {row.stopped
                    ? <CheckCircle2 aria-label={t.closing.stopped} className="size-4 shrink-0 text-success" />
                    : <Loader2 className="size-4 shrink-0 animate-spin text-primary" />}
                  <span className="min-w-0 flex-1 truncate">
                    {row.repositoryName && <span className="font-medium">{row.repositoryName} · </span>}
                    <span className="font-mono text-xs">{row.label}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">PID {row.pid}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        {progress.forcing && !progress.done && (
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {t.closing.forcing}
          </p>
        )}
      </div>
    </div>
  )
}
