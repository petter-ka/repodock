import { AlarmClock, Play, RotateCcw, Square, X } from "lucide-react"
import { Fragment, useState } from "react"
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import { Tooltip } from "@/components/ui/tooltip"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { isZeroTime, type Group, type GroupScheduleStatus, type ScheduleKind } from "../domain"
import type { RepositoryActions } from "../hooks/useRepositoryActions"
import { formatWhen } from "../schedule"

/** The next start and stop of a group that will (or would) happen. */
export function upcomingEvents(status: GroupScheduleStatus | undefined) {
  if (!status) return []
  const events: Array<{ kind: ScheduleKind; at: Date; skipped: boolean; postponed: boolean }> = []
  if (!isZeroTime(status.nextStart)) events.push({ kind: "start", at: new Date(status.nextStart), skipped: status.startSkipped, postponed: false })
  if (!isZeroTime(status.nextStop)) events.push({ kind: "stop", at: new Date(status.nextStop), skipped: status.stopSkipped, postponed: status.stopPostponed })
  return events.sort((a, b) => a.at.getTime() - b.at.getTime())
}

/**
 * "▶ Today 09:00 ×" — a group's next scheduled start or stop with a small
 * button that cancels just this one (the schedule continues next time), or
 * "Undo" once cancelled.
 */
export function NextEventChip({ group, kind, at, skipped, postponed, actions }: {
  group: Group
  kind: ScheduleKind
  at: Date
  skipped: boolean
  postponed: boolean
  actions: RepositoryActions
}) {
  const { t, f, locale } = useI18n()
  const [busy, setBusy] = useState(false)
  const when = formatWhen(at, t, locale)
  const run = async (work: () => Promise<boolean>) => {
    setBusy(true)
    try { await work() } finally { setBusy(false) }
  }
  const label = kind === "start" ? t.schedule.nextStart : t.schedule.nextStop
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border py-0.5 pl-1.5 pr-0.5 text-xs tabular-nums transition",
        skipped ? "border-dashed border-border text-muted-foreground" : "border-border bg-background",
      )}
    >
      {kind === "start" ? <Play className={cn("size-3", skipped ? "" : "text-success")} aria-label={label} /> : <Square className={cn("size-3", skipped ? "" : "text-destructive")} aria-label={label} />}
      <span className={cn(skipped && "line-through")}>{postponed ? f(t.schedule.postponedNote, { when }) : when}</span>
      {skipped ? (
        <button
          disabled={busy}
          onClick={() => void run(() => actions.resumeScheduled(group, kind, when))}
          className="rounded px-1.5 py-0.5 font-medium text-primary outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          {t.schedule.undo}
        </button>
      ) : (
        <Tooltip label={kind === "start" ? t.schedule.cancelThisStart : t.schedule.cancelThisStop}>
          <button
            disabled={busy}
            aria-label={kind === "start" ? t.schedule.cancelThisStart : t.schedule.cancelThisStop}
            onClick={() => void run(() => actions.skipScheduled(group, kind, when))}
            className="flex size-5 items-center justify-center rounded text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <X className="size-3" />
          </button>
        </Tooltip>
      )}
    </span>
  )
}

/**
 * The next start and stop across several groups (they share the workspace
 * schedule): the earliest time of each, and whether it is cancelled for
 * some or all of them.
 */
export function combinedEvents(statuses: GroupScheduleStatus[]) {
  return (["start", "stop"] as const).flatMap((kind) => {
    const upcoming = statuses.flatMap((status) => upcomingEvents(status)).filter((event) => event.kind === kind)
    if (upcoming.length === 0) return []
    const at = new Date(Math.min(...upcoming.map((event) => event.at.getTime())))
    return [{
      kind, at,
      anySkipped: upcoming.some((event) => event.skipped),
      allSkipped: upcoming.every((event) => event.skipped),
      postponed: upcoming.some((event) => event.postponed),
    }]
  }).sort((a, b) => a.at.getTime() - b.at.getTime())
}

/**
 * Dropdown items: cancel or restore the next start/stop — of one group, or
 * (group null) of every scheduled group — then edit the schedule.
 */
export function ScheduleMenuItems({ group, statuses, actions, onEdit, editLabel }: {
  group: Group | null
  statuses: GroupScheduleStatus[]
  actions: RepositoryActions
  onEdit: () => void
  /** defaults to "Edit schedule…" */
  editLabel?: string
}) {
  const { t, f, locale } = useI18n()
  const events = combinedEvents(statuses)
  return (
    <>
      {events.length === 0 && <DropdownMenuItem disabled>{t.schedule.nextNothing}</DropdownMenuItem>}
      {events.map((event) => {
        const when = formatWhen(event.at, t, locale)
        const shown = event.postponed ? f(t.schedule.postponedNote, { when }) : when
        return (
          <Fragment key={event.kind}>
            {!event.allSkipped && (
              <DropdownMenuItem onSelect={() => void actions.skipScheduled(group, event.kind, when)}>
                {event.kind === "start" ? <Play /> : <Square />}
                <span className="flex-1">{event.kind === "start" ? t.schedule.skipStart : t.schedule.skipStop}</span>
                <span className="pl-3 text-[11px] tabular-nums text-muted-foreground">{shown}</span>
              </DropdownMenuItem>
            )}
            {event.anySkipped && (
              <DropdownMenuItem onSelect={() => void actions.resumeScheduled(group, event.kind, when)}>
                <RotateCcw />
                <span className="flex-1">{event.kind === "start" ? t.schedule.restoreStart : t.schedule.restoreStop}</span>
                <span className="pl-3 text-[11px] tabular-nums text-muted-foreground line-through">{shown}</span>
              </DropdownMenuItem>
            )}
          </Fragment>
        )
      })}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onEdit}><AlarmClock /> {editLabel ?? t.schedule.editSchedule}</DropdownMenuItem>
    </>
  )
}
