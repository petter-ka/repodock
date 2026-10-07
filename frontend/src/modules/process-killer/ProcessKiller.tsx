import { AlertTriangle, Hash, Loader2, Network, RefreshCw, Search, ShieldOff, Skull } from "lucide-react"
import { useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { errorMessage } from "@/lib/bridge"
import { useI18n } from "@/lib/i18n"
import { cn, formatTime } from "@/lib/utils"
import { useNotifications } from "@/state/notifications"
import { killerApi, type HostProcess } from "./api"

type Mode = "port" | "pid"
type Search = { mode: Mode; value: number }

/**
 * Find processes by the port they listen on, or by PID, and terminate one
 * (SIGTERM, then SIGKILL after a grace period). Every kill needs an inline
 * confirmation; protected processes (system, RepoDock itself and its
 * parents) cannot be killed.
 */
export function ProcessKiller() {
  const { t, f } = useI18n()
  const { notify } = useNotifications()
  const [mode, setMode] = useState<Mode>("port")
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [results, setResults] = useState<HostProcess[] | null>(null)
  const [last, setLast] = useState<Search | null>(null)
  const [confirming, setConfirming] = useState<number | null>(null)
  const [children, setChildren] = useState(false)
  const [killing, setKilling] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const value = Number(text.trim())
  const valid = /^\d+$/.test(text.trim()) && value > 0 && (mode === "pid" || value <= 65535)

  const search = async (query: Search) => {
    setBusy(true)
    setError("")
    setConfirming(null)
    try {
      const found = query.mode === "port" ? await killerApi.byPort(query.value) : [await killerApi.byPID(query.value)]
      setResults(found)
      setLast(query)
    } catch (err) {
      setResults(null)
      setError(errorMessage(err) || t.common.error)
    } finally {
      setBusy(false)
    }
  }

  const kill = async (process: HostProcess) => {
    setKilling(process.pid)
    try {
      const result = await killerApi.kill(process.pid, children)
      notify(
        result.runId ? f(t.killer.stoppedRun, { pid: process.pid })
          : result.forced ? f(t.killer.killedForced, { pid: process.pid, count: result.signalled.length })
            : f(t.killer.killed, { pid: process.pid, count: result.signalled.length }),
        { tone: "success" },
      )
      setConfirming(null)
      if (last) {
        // A process that was found by PID is gone now; a port search shows what is left.
        if (last.mode === "pid") setResults([])
        else await search(last)
      }
    } catch (err) {
      notify(errorMessage(err) || t.common.error, { tone: "error" })
    } finally {
      setKilling(null)
    }
  }

  return (
    <div className="grid gap-3 p-3">
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => { event.preventDefault(); if (valid) void search({ mode, value }) }}
      >
        <div role="radiogroup" aria-label={t.killer.mode} className="flex shrink-0 rounded-lg border border-border p-0.5 text-xs">
          {(["port", "pid"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={mode === option}
              onClick={() => { setMode(option); setResults(null); setError(""); inputRef.current?.focus() }}
              className={cn("flex items-center gap-1 rounded-md px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring", mode === option ? "bg-accent font-medium" : "text-muted-foreground")}
            >
              {option === "port" ? <Network className="size-3" /> : <Hash className="size-3" />}
              {option === "port" ? t.killer.port : t.killer.pid}
            </button>
          ))}
        </div>
        <Input
          ref={inputRef}
          autoFocus
          inputMode="numeric"
          value={text}
          onChange={(event) => setText(event.target.value.replace(/[^\d]/g, ""))}
          placeholder={mode === "port" ? "3000" : "12345"}
          aria-label={mode === "port" ? t.killer.port : t.killer.pid}
          aria-invalid={!!text && !valid}
          className="h-8 min-w-0 flex-1 font-mono text-sm"
        />
        <Button type="submit" size="sm" disabled={!valid || busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Search />} {t.killer.find}
        </Button>
      </form>

      {error && <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {error}</p>}

      {results && (
        <div className="grid gap-2" aria-live="polite">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{last?.mode === "port" ? f(t.killer.onPort, { port: last.value, count: results.length }) : t.killer.result}</span>
            {last && (
              <button onClick={() => void search(last)} className="flex items-center gap-1 rounded px-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                <RefreshCw className="size-3" /> {t.common.refresh}
              </button>
            )}
          </div>
          {results.length === 0 && (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              {last?.mode === "port" ? f(t.killer.nothingOnPort, { port: last.value }) : t.killer.gone}
            </p>
          )}
          {results.map((process, index) => (
            <article key={process.pid || `unknown-${index}`} className="rounded-lg border border-border bg-background p-2.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 truncate text-sm font-semibold">{process.name || t.killer.unknown}</span>
                {process.pid > 0 && <Badge className="font-mono tabular-nums">PID {process.pid}</Badge>}
                {process.runId && <Badge variant="info">{t.killer.repodockRun}</Badge>}
                <span className="ml-auto flex shrink-0 gap-1">
                  {process.ports.map((port) => <Badge key={port} variant="outline" className="font-mono">:{port}</Badge>)}
                </span>
              </div>
              {process.command && (
                <p title={process.command} className="mt-1 line-clamp-2 break-all font-mono text-[11px] text-muted-foreground">{process.command}</p>
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">
                {[process.user && f(t.killer.user, { user: process.user }), process.ppid > 0 && f(t.killer.parent, { pid: process.ppid }), process.startedAt && f(t.killer.started, { time: formatTime(process.startedAt) })].filter(Boolean).join(" · ")}
              </p>

              {process.protected ? (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-warning"><ShieldOff className="size-3.5" /> {process.protected}</p>
              ) : confirming === process.pid ? (
                <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2">
                  <p className="text-xs font-medium">{f(t.killer.confirm, { pid: process.pid, name: process.name })}</p>
                  {process.runId ? (
                    <p className="mt-1 text-[11px] text-muted-foreground">{t.killer.runHint}</p>
                  ) : (
                    <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-[11px]">
                      <input type="checkbox" checked={children} onChange={(event) => setChildren(event.target.checked)} className="size-3.5 accent-[var(--primary)]" />
                      {t.killer.children}
                    </label>
                  )}
                  <div className="mt-2 flex justify-end gap-2">
                    <Button size="xs" variant="outline" onClick={() => setConfirming(null)}>{t.common.cancel}</Button>
                    <Button size="xs" variant="destructive" autoFocus disabled={killing !== null} onClick={() => void kill(process)}>
                      {killing === process.pid ? <Loader2 className="animate-spin" /> : <Skull />} {process.runId ? t.killer.stopRun : t.killer.kill}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex justify-end">
                  <Button size="xs" variant="outline" className="text-destructive hover:text-destructive" onClick={() => { setChildren(false); setConfirming(process.pid) }}>
                    <Skull /> {process.runId ? t.killer.stopRun : t.killer.kill}
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {!results && !error && <p className="text-[11px] text-muted-foreground">{t.killer.hint}</p>}
    </div>
  )
}
