import { AlarmClock, CalendarX, Loader2, Square, TimerReset } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { errorMessage } from "@/lib/bridge"
import { useI18n } from "@/lib/i18n"
import { cn, formatCountdown } from "@/lib/utils"
import { useNotifications } from "@/state/notifications"
import { scheduledStopApi, type ScheduledStop } from "./api"

/** The countdown appears this long before a stop (matches the backend). */
const LEAD_MS = 30 * 60_000
/** A hidden countdown comes back when the stop gets this close. */
const REOPEN_AT_MS = [5 * 60_000, 60_000]
const POSTPONE_MINUTES = [15, 30, 60]

const keyOf = (stop: ScheduledStop) => `${stop.groupId}@${stop.stopAt}`
const clock = (iso: string) => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(iso))

/**
 * Announces scheduled stops of running groups (ADR-0025): a countdown
 * dialog 30 minutes ahead with postpone / skip / stop-now, and a small pill
 * in the corner while it is hidden. Nothing is stopped from here except by
 * "Stop now"; the backend stops the group when the time comes.
 */
export function ScheduledStopCountdown() {
  const { t, f } = useI18n()
  const { notify } = useNotifications()
  const [pending, setPending] = useState<ScheduledStop[]>([])
  // Hidden stops by key → remaining time below which the dialog returns.
  const [hidden, setHidden] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const messages = useRef({ t, f })
  messages.current = { t, f }

  useEffect(() => {
    let alive = true
    scheduledStopApi.pending().then((list) => { if (alive) setPending(list ?? []) }).catch(() => undefined)
    const offPending = scheduledStopApi.on("schedule:pending", (list) => setPending(list ?? []))
    const offFired = scheduledStopApi.on("schedule:fired", (event) => {
      const { t, f } = messages.current
      if (event.error) {
        notify(f(event.action === "started" ? t.schedule.failedStart : t.schedule.failedStop, { name: event.groupName, error: event.error }), { tone: "error", duration: 0 })
      } else {
        notify(f(event.action === "started" ? t.schedule.started : t.schedule.stopped, { name: event.groupName }), { tone: event.action === "started" ? "success" : "info", duration: 8000 })
      }
    })
    return () => { alive = false; offPending(); offFired() }
  }, [notify])

  useEffect(() => {
    if (pending.length === 0) return
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [pending.length])

  const remaining = useCallback((stop: ScheduledStop) => new Date(stop.stopAt).getTime() - now, [now])

  // Forget hidden state for stops that are gone, and bring a hidden one back
  // once it crosses its reopen threshold.
  useEffect(() => {
    setHidden((current) => {
      const live = new Set(pending.map(keyOf))
      const next: Record<string, number> = {}
      for (const [key, below] of Object.entries(current)) {
        const stop = pending.find((p) => keyOf(p) === key)
        if (live.has(key) && stop && remaining(stop) > below) next[key] = below
      }
      return Object.keys(next).length === Object.keys(current).length ? current : next
    })
  }, [pending, remaining])

  const visible = pending.filter((stop) => !(keyOf(stop) in hidden))
  const primary = visible[0]
  const others = useMemo(() => pending.filter((stop) => stop !== primary), [pending, primary])

  const hide = () => setHidden((current) => {
    const next = { ...current }
    for (const stop of visible) next[keyOf(stop)] = REOPEN_AT_MS.find((ms) => remaining(stop) > ms) ?? -Infinity
    return next
  })
  const show = () => setHidden({})

  const act = async (stop: ScheduledStop, kind: string, work: () => Promise<void>, success?: string) => {
    setBusy(`${stop.groupId}:${kind}`)
    try {
      await work()
      if (success) notify(success, { tone: "success" })
    } catch (error) {
      notify(errorMessage(error) || t.common.error, { tone: "error" })
    } finally {
      setBusy(null)
    }
  }
  const postpone = (stop: ScheduledStop, minutes: number) =>
    act(stop, `+${minutes}`, () => scheduledStopApi.postpone(stop.groupId, minutes),
      f(t.countdown.postponed, { name: stop.groupName, time: clock(new Date(new Date(stop.stopAt).getTime() + minutes * 60_000).toISOString()) }))
  const skip = (stop: ScheduledStop) => act(stop, "skip", () => scheduledStopApi.skip(stop.groupId), f(t.countdown.skipped, { name: stop.groupName }))
  const stopNow = (stop: ScheduledStop) => act(stop, "stop", () => scheduledStopApi.stopNow(stop.groupId))

  if (pending.length === 0) return null

  return (
    <>
      {!primary && (
        <button
          onClick={show}
          aria-label={t.countdown.show}
          className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-warning/40 bg-card py-1.5 pl-2 pr-3.5 text-sm shadow-xl outline-none transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex size-6 items-center justify-center rounded-full bg-warning/15 text-warning"><AlarmClock className="size-3.5" /></span>
          <span className="font-medium">{f(t.countdown.pill, { name: pending[0].groupName, time: "" }).trim()}</span>
          <span className="font-mono tabular-nums">{formatCountdown(remaining(pending[0]))}</span>
          {pending.length > 1 && <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">+{pending.length - 1}</span>}
        </button>
      )}

      <Dialog open={!!primary} onOpenChange={(open) => { if (!open) hide() }}>
        {primary && (
          <DialogContent closeLabel={t.countdown.hide} className="max-w-md" onOpenAutoFocus={(event) => event.preventDefault()}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><AlarmClock className="size-4 text-warning" /> {t.countdown.title}</DialogTitle>
              <DialogDescription className="sr-only">{t.countdown.hint}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col items-center gap-1 pb-1 pt-2 text-center">
              <Ring fraction={remaining(primary) / LEAD_MS} urgent={remaining(primary) <= 60_000}>
                {remaining(primary) <= 0 ? (
                  <span className="flex items-center gap-1.5 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t.countdown.stopping}</span>
                ) : (
                  <>
                    <span className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{t.countdown.stopsIn}</span>
                    <span className="font-mono text-4xl font-semibold tabular-nums tracking-tight" role="timer" aria-live="off">{formatCountdown(remaining(primary))}</span>
                  </>
                )}
              </Ring>
              <p className="mt-3 text-lg font-semibold">{primary.groupName}</p>
              <p className="text-sm text-muted-foreground">
                {f(primary.postponed ? t.countdown.postponedTo : t.countdown.at, { time: clock(primary.stopAt) })}
                {" · "}
                {f(t.countdown.processes, { count: primary.running })}
              </p>
            </div>

            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <span className="flex w-24 shrink-0 items-center gap-1.5 text-xs text-muted-foreground"><TimerReset className="size-3.5" /> {t.countdown.postpone}</span>
                <div className="grid flex-1 grid-cols-3 gap-1.5">
                  {POSTPONE_MINUTES.map((minutes) => (
                    <Button key={minutes} size="sm" variant="outline" disabled={busy !== null} onClick={() => void postpone(primary, minutes)}>
                      {busy === `${primary.groupId}:+${minutes}` && <Loader2 className="animate-spin" />}
                      {f(t.countdown.postponeBy, { minutes })}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" disabled={busy !== null} onClick={() => void skip(primary)}>
                  {busy === `${primary.groupId}:skip` ? <Loader2 className="animate-spin" /> : <CalendarX />} {t.countdown.skip}
                </Button>
                <Button variant="destructive" disabled={busy !== null} onClick={() => void stopNow(primary)}>
                  {busy === `${primary.groupId}:stop` ? <Loader2 className="animate-spin" /> : <Square />} {t.countdown.stopNow}
                </Button>
              </div>
              <p className="text-center text-[11px] text-muted-foreground">{t.countdown.cancelHint}</p>
              <Button variant="ghost" className="text-muted-foreground" onClick={hide}>{t.countdown.hide}</Button>
            </div>

            {others.length > 0 && (
              <div className="border-t border-border pt-3">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{t.countdown.more}</p>
                <ul className="grid gap-1">
                  {others.map((stop) => (
                    <li key={keyOf(stop)} className="flex items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5 text-sm">
                      <span className="min-w-0 flex-1 truncate font-medium">{stop.groupName}</span>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">{formatCountdown(remaining(stop))}</span>
                      <Button size="xs" variant="ghost" disabled={busy !== null} onClick={() => void postpone(stop, 30)}>{f(t.countdown.postponeBy, { minutes: 30 })}</Button>
                      <Button size="xs" variant="ghost" disabled={busy !== null} onClick={() => void skip(stop)}>{t.countdown.skip}</Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}

/** A circular progress ring; the arc is the share of the 30-minute lead left. */
function Ring({ fraction, urgent, children }: { fraction: number; urgent: boolean; children: React.ReactNode }) {
  const size = 168
  const stroke = 8
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const clamped = Math.min(1, Math.max(0, fraction))
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          className={cn("transition-[stroke-dashoffset] duration-500 ease-linear", urgent ? "stroke-destructive" : "stroke-warning")}
        />
      </svg>
      <div className={cn("absolute inset-0 flex flex-col items-center justify-center", urgent && "animate-pulse")}>{children}</div>
    </div>
  )
}
