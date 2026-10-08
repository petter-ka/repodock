import { Loader2, Square } from "lucide-react"
import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { errorMessage } from "@/lib/bridge"
import { useI18n } from "@/lib/i18n"
import { useNotifications } from "@/state/notifications"
import { leftoverApi, type LeftoverRun } from "./api"

// Checked once per page load, even though StrictMode mounts twice in development.
let checked = false

function formatStarted(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(date)
}

/**
 * At startup, lists processes an earlier RepoDock session left running
 * (found by their marker environment variables) and lets the user stop them.
 */
export function LeftoverProcessesDialog() {
  const { t, f } = useI18n()
  const { notify } = useNotifications()
  const [runs, setRuns] = useState<LeftoverRun[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (checked) return
    checked = true
    leftoverApi.list().then((found) => {
      setRuns(found ?? [])
      setOpen((found ?? []).length > 0)
    }).catch(() => undefined)
  }, [])

  // busyKey is a run ID, or "*" for all of them.
  const stop = async (busyKey: string, runIds: string[]) => {
    setBusy(busyKey)
    try {
      const count = await leftoverApi.stop(runIds)
      notify(count > 0 ? f(t.leftover.stopped, { count }) : t.leftover.nothingStopped, { tone: count > 0 ? "success" : "info" })
      const remaining = runs.filter((run) => !runIds.includes(run.runId))
      setRuns(remaining)
      if (remaining.length === 0) setOpen(false)
    } catch (error) {
      notify(errorMessage(error) || t.common.error, { tone: "error" })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent closeLabel={t.common.close} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t.leftover.title}</DialogTitle>
          <DialogDescription>{t.leftover.description}</DialogDescription>
        </DialogHeader>
        <ul className="thin-scrollbar max-h-80 overflow-auto rounded-lg border border-border">
          {runs.map((run) => (
            <li key={run.runId} className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
              <div className="grid min-w-0 flex-1 gap-1">
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <span className="truncate font-medium">{run.repositoryName || t.leftover.unknownRepo}</span>
                  {run.ports.map((port) => <Badge key={port} variant="warning">{f(t.leftover.port, { port })}</Badge>)}
                </div>
                <code className="truncate text-xs text-muted-foreground" title={run.command}>{run.command}</code>
                <span className="text-xs text-muted-foreground">
                  PID {run.pids[0]} · {f(t.leftover.processes, { count: run.pids.length })}
                  {run.startedAt && ` · ${f(t.leftover.started, { time: formatStarted(run.startedAt) })}`}
                </span>
              </div>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void stop(run.runId, [run.runId])}>
                {busy === run.runId ? <Loader2 className="animate-spin" /> : <Square />} {t.leftover.stop}
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" disabled={busy !== null} onClick={() => setOpen(false)}>{t.leftover.keep}</Button>
          <Button autoFocus variant="destructive" disabled={busy !== null} onClick={() => void stop("*", runs.map((run) => run.runId))}>
            {busy === "*" ? <Loader2 className="animate-spin" /> : <Square />} {t.leftover.stopAll}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
