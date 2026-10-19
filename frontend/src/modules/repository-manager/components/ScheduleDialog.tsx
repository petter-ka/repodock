import { AlarmClock, Play, Square } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { Group, GroupSchedule } from "../domain"
import type { RepositoryActions } from "../hooks/useRepositoryActions"
import {
  DAY_ORDER, DAY_PRESETS, WARNING_LEAD_MINUTES, dayPreset, emptySchedule, formatIn, formatWhen, nextEvents, parseClock, scheduleOf, weekdayName, type DayPreset,
} from "../schedule"

/** Edits when a group starts and stops by itself (ADR-0025). */
export function ScheduleDialog({ group, actions, onOpenChange }: {
  group: Group | null
  actions: RepositoryActions
  onOpenChange: (open: boolean) => void
}) {
  const { t, f, locale } = useI18n()
  const [draft, setDraft] = useState<GroupSchedule>(emptySchedule)
  const [busy, setBusy] = useState(false)
  // Re-render the "next start in …" preview every minute.
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    if (!group) return
    const current = scheduleOf(group)
    // A group that never had a schedule starts from weekday defaults.
    setDraft(current.days.length || current.startEnabled || current.stopEnabled ? current : emptySchedule())
    setNow(new Date())
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [group])

  const patch = (next: Partial<GroupSchedule>) => setDraft((d) => ({ ...d, ...next }))
  const toggleDay = (day: number) => patch({ days: draft.days.includes(day) ? draft.days.filter((d) => d !== day) : [...draft.days, day].sort() })
  const preset = dayPreset(draft.days)
  const anyOn = draft.startEnabled || draft.stopEnabled
  const error = !anyOn ? null
    : draft.days.length === 0 ? t.schedule.noDays
      : draft.startEnabled && draft.stopEnabled && draft.startAt === draft.stopAt ? t.schedule.sameTime
        : (draft.startEnabled && !parseClock(draft.startAt)) || (draft.stopEnabled && !parseClock(draft.stopAt)) ? t.schedule.pickTime
          : null
  const saved = group ? scheduleOf(group) : null
  const wasOn = !!saved && (saved.startEnabled || saved.stopEnabled)
  const next = useMemo(() => nextEvents(draft, now), [draft, now])

  const save = async (schedule: GroupSchedule) => {
    if (!group) return
    setBusy(true)
    try {
      if (await actions.saveSchedule(group, schedule)) onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  const presets: Array<{ value: DayPreset; label: string }> = [
    { value: "everyDay", label: t.schedule.everyDay },
    { value: "weekdays", label: t.schedule.weekdays },
    { value: "weekends", label: t.schedule.weekends },
    { value: "custom", label: t.schedule.custom },
  ]

  return (
    <Dialog open={!!group} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t.common.close} className="max-w-lg">
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (!error && !busy) void save(draft)
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlarmClock className="size-4 text-primary" /> {f(t.schedule.title, { name: group?.name ?? "" })}</DialogTitle>
            <DialogDescription>{t.schedule.description}</DialogDescription>
          </DialogHeader>

          <fieldset className="grid gap-2.5">
            <legend className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{t.schedule.days}</legend>
            <div role="radiogroup" aria-label={t.schedule.days} className="inline-flex w-fit rounded-xl border border-border bg-background p-1">
              {presets.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={preset === option.value}
                  // "Custom" keeps the current days and just invites editing them.
                  onClick={() => { if (option.value !== "custom") patch({ days: [...DAY_PRESETS[option.value]] }) }}
                  className={cn(
                    "rounded-lg px-3 py-1 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
                    preset === option.value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              {DAY_ORDER.map((day) => {
                const on = draft.days.includes(day)
                const weekend = day === 0 || day === 6
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={on}
                    aria-label={weekdayName(day, locale, "long")}
                    title={weekdayName(day, locale, "long")}
                    onClick={() => toggleDay(day)}
                    className={cn(
                      "flex h-9 flex-1 items-center justify-center rounded-lg border text-xs font-medium capitalize outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
                      on ? "border-primary/40 bg-primary/15 text-foreground" : "border-border text-muted-foreground hover:bg-accent",
                      weekend && !on && "border-dashed",
                    )}
                  >
                    {weekdayName(day, locale)}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <div className="grid gap-2.5">
            <TimeRow
              icon={<Play className="size-4" />}
              tone="success"
              title={t.schedule.start}
              hint={t.schedule.startHint}
              enabled={draft.startEnabled}
              time={draft.startAt}
              onEnabled={(startEnabled) => patch({ startEnabled })}
              onTime={(startAt) => patch({ startAt })}
            />
            <TimeRow
              icon={<Square className="size-4" />}
              tone="destructive"
              title={t.schedule.stop}
              hint={f(t.schedule.stopHint, { lead: WARNING_LEAD_MINUTES })}
              enabled={draft.stopEnabled}
              time={draft.stopAt}
              onEnabled={(stopEnabled) => patch({ stopEnabled })}
              onTime={(stopAt) => patch({ stopAt })}
            />
          </div>

          <DayTimeline schedule={draft} now={now} />

          <dl className="grid grid-cols-2 gap-2 text-sm">
            {([["start", t.schedule.nextStart, next.start], ["stop", t.schedule.nextStop, next.stop]] as const).map(([key, label, at]) => (
              <div key={key} className="rounded-lg bg-muted/50 px-3 py-2">
                <dt className="text-[11px] text-muted-foreground">{label}</dt>
                <dd className="font-medium tabular-nums">
                  {at && !error ? (
                    <>
                      {formatWhen(at, t, locale, now)}
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">{f(t.schedule.inTime, { time: formatIn(at.getTime() - now.getTime()) })}</span>
                    </>
                  ) : t.schedule.never}
                </dd>
              </div>
            ))}
          </dl>

          <p aria-live="polite" className={cn("-mt-2 min-h-4 text-xs", error ? "text-destructive" : "text-muted-foreground")}>{error ?? (anyOn ? "" : t.schedule.nothingOn)}</p>

          <DialogFooter className="items-center">
            {wasOn ? (
              <Button type="button" variant="ghost" className="mr-auto text-muted-foreground" disabled={busy} onClick={() => void save({ ...draft, startEnabled: false, stopEnabled: false })}>
                {t.schedule.turnOff}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t.common.cancel}</Button>
            <Button type="submit" disabled={busy || !!error}>{t.common.save}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function TimeRow({ icon, tone, title, hint, enabled, time, onEnabled, onTime }: {
  icon: React.ReactNode
  tone: "success" | "destructive"
  title: string
  hint: string
  enabled: boolean
  time: string
  onEnabled: (value: boolean) => void
  onTime: (value: string) => void
}) {
  const id = `schedule-${tone}`
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border p-3 transition", enabled ? "border-border bg-card" : "border-dashed border-border bg-muted/30")}>
      <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", enabled ? (tone === "success" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive") : "bg-muted text-muted-foreground")}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="text-sm font-medium">{title}</label>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <Switch id={id} checked={enabled} onCheckedChange={onEnabled} aria-label={title} />
        <input
          type="time"
          value={time}
          disabled={!enabled}
          required={enabled}
          aria-label={title}
          onChange={(event) => onTime(event.target.value)}
          className="h-8 w-[6.5rem] rounded-lg border border-border bg-background px-2 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        />
      </div>
    </div>
  )
}

const minutesOf = (clock: string) => {
  const parsed = parseClock(clock)
  return parsed ? parsed[0] * 60 + parsed[1] : null
}

/**
 * A 24-hour strip previewing one scheduled day: the running window between
 * start and stop, the countdown zone before the stop, and the current time.
 */
function DayTimeline({ schedule, now }: { schedule: GroupSchedule; now: Date }) {
  const { t } = useI18n()
  const start = schedule.startEnabled ? minutesOf(schedule.startAt) : null
  const stop = schedule.stopEnabled ? minutesOf(schedule.stopAt) : null
  const pct = (minutes: number) => `${(minutes / 1440) * 100}%`
  // Without a start, the window is drawn from midnight; without a stop, to midnight.
  const windows: Array<[number, number]> = start === null && stop === null ? []
    : start !== null && stop !== null && stop < start ? [[start, 1440], [0, stop]]
      : [[start ?? 0, stop ?? 1440]]
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const lead = WARNING_LEAD_MINUTES

  return (
    <div aria-hidden className="select-none">
      <div className="relative h-7 overflow-hidden rounded-lg bg-muted">
        {windows.map(([from, to], i) => (
          <div key={i} className="absolute inset-y-1.5 rounded-[4px] bg-primary/25" style={{ left: pct(from), width: pct(to - from) }} />
        ))}
        {stop !== null && (
          <div
            className="absolute inset-y-1.5 rounded-[4px] bg-[repeating-linear-gradient(135deg,var(--warning)_0_2px,transparent_2px_6px)] opacity-70"
            style={{ left: pct(Math.max(0, stop - lead)), width: pct(Math.min(lead, stop)) }}
          />
        )}
        {start !== null && <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-success ring-2 ring-muted" style={{ left: pct(start) }} />}
        {stop !== null && <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-destructive ring-2 ring-muted" style={{ left: pct(stop) }} />}
        <span className="absolute inset-y-0 w-px bg-foreground/60" style={{ left: pct(nowMinutes) }} title={t.dashboard.now} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
        {["00", "06", "12", "18", "24"].map((h) => <span key={h}>{h}</span>)}
      </div>
    </div>
  )
}
