import { AlarmClock, AlertTriangle, Check, Play, Square } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { seriesColor } from "../dashboard"
import type { GroupSchedule } from "../domain"
import type { RepositoryActions } from "../hooks/useRepositoryActions"
import { useWorkspaceState } from "../hooks/useStores"
import {
  DAY_ORDER, DAY_PRESETS, WARNING_LEAD_MINUTES, dayPreset, describeSchedule, emptySchedule, formatIn, formatWhen, isScheduleActive, nextEvents, parseClock,
  sameSchedule, scheduleOf, weekdayName, type DayPreset,
} from "../schedule"

/**
 * Sets the start/stop schedule of the ticked groups (ADR-0025). Every group
 * keeps its own schedule: saving copies these settings to the ticked groups
 * only. `groupIds` are ticked when the dialog opens (null = closed).
 */
export function ScheduleDialog({ groupIds, actions, onOpenChange }: {
  groupIds: string[] | null
  actions: RepositoryActions
  onOpenChange: (open: boolean) => void
}) {
  const { t, f, locale } = useI18n()
  const { workspace } = useWorkspaceState()
  const [draft, setDraft] = useState<GroupSchedule>(emptySchedule)
  const [ticked, setTicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  // Re-render the "next start in …" preview every minute.
  const [now, setNow] = useState(() => new Date())
  const open = groupIds !== null

  useEffect(() => {
    if (!groupIds) return
    setTicked(groupIds)
    // Start from the ticked groups' schedule when they share one, else from
    // weekday defaults.
    const active = workspace.groups.filter((g) => groupIds.includes(g.id)).map(scheduleOf).filter(isScheduleActive)
    // A new schedule starts with both parts on (weekdays 09:00–18:00), so
    // setting one up is just picking groups and saving.
    setDraft(active.length > 0 && active.every((s) => sameSchedule(s, active[0])) ? active[0] : { ...emptySchedule(), startEnabled: true, stopEnabled: true })
    setNow(new Date())
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
    // The draft is taken when the dialog opens, not on every workspace change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupIds])

  const patch = (next: Partial<GroupSchedule>) => setDraft((d) => ({ ...d, ...next }))
  const chosen = workspace.groups.filter((g) => ticked.includes(g.id))
  const toggleGroup = (id: string) => setTicked((current) => (current.includes(id) ? current.filter((g) => g !== id) : [...current, id]))
  // Ticked groups whose own, different schedule would be overwritten.
  const replaced = chosen.filter((g) => isScheduleActive(scheduleOf(g)) && !sameSchedule(scheduleOf(g), draft))
  const toggleDay = (day: number) => patch({ days: draft.days.includes(day) ? draft.days.filter((d) => d !== day) : [...draft.days, day].sort() })
  const preset = dayPreset(draft.days)
  const anyOn = draft.startEnabled || draft.stopEnabled
  const error = chosen.length === 0 ? t.schedule.pickGroup
    : !anyOn ? null
    : draft.days.length === 0 ? t.schedule.noDays
      : draft.startEnabled && draft.stopEnabled && draft.startAt === draft.stopAt ? t.schedule.sameTime
        : (draft.startEnabled && !parseClock(draft.startAt)) || (draft.stopEnabled && !parseClock(draft.stopAt)) ? t.schedule.pickTime
          : null
  const anyChosenOn = chosen.some((g) => isScheduleActive(scheduleOf(g)))
  const next = useMemo(() => nextEvents(draft, now), [draft, now])

  const save = async (schedule: GroupSchedule) => {
    setBusy(true)
    try {
      if (await actions.saveSchedule(chosen.map((g) => g.id), schedule)) onOpenChange(false)
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t.common.close} className="thin-scrollbar max-h-[92vh] max-w-lg overflow-y-auto">
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (!error && !busy) void save(draft)
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlarmClock className="size-4 text-primary" /> {t.schedule.title}</DialogTitle>
            <DialogDescription>{t.schedule.description}</DialogDescription>
          </DialogHeader>

          <fieldset className="grid gap-2">
            <div className="flex items-center gap-2">
              <legend className="flex-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{t.schedule.applyTo}</legend>
              <Button type="button" size="xs" variant="ghost" onClick={() => setTicked(workspace.groups.map((g) => g.id))}>{t.schedule.selectAll}</Button>
              <Button type="button" size="xs" variant="ghost" onClick={() => setTicked([])}>{t.schedule.selectNone}</Button>
            </div>
            <ul className="thin-scrollbar grid max-h-48 gap-1 overflow-y-auto">
              {workspace.groups.map((group, index) => {
                const on = ticked.includes(group.id)
                const own = scheduleOf(group)
                return (
                  <li key={group.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggleGroup(group.id)}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-left text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
                        on ? "border-primary/40 bg-primary/10" : "border-border hover:bg-accent/60",
                      )}
                    >
                      <span className={cn("flex size-4 shrink-0 items-center justify-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")}>
                        {on && <Check className="size-3" />}
                      </span>
                      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: seriesColor(index) }} />
                      <span className="min-w-0 flex-1 truncate font-medium">{group.name}</span>
                      <span className={cn("shrink-0 truncate text-[11px]", isScheduleActive(own) ? "text-muted-foreground" : "text-muted-foreground/60")}>{describeSchedule(own, t, locale)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <p className="text-[11px] text-muted-foreground">{t.schedule.groupsHint}</p>
            {replaced.length > 0 && (
              <p className="flex items-start gap-1.5 rounded-lg bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {f(t.schedule.replaces, { names: replaced.map((g) => g.name).join(", ") })}
              </p>
            )}
          </fieldset>

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
            {anyChosenOn ? (
              <Button type="button" variant="ghost" className="mr-auto text-muted-foreground" disabled={busy} onClick={() => void save({ ...draft, startEnabled: false, stopEnabled: false })}>
                {t.schedule.turnOffFor}
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t.common.cancel}</Button>
            <Button type="submit" disabled={busy || !!error}>{f(t.schedule.saveFor, { count: chosen.length })}</Button>
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
