// Pure helpers for group schedules (ADR-0025). The backend decides when a
// schedule fires; these only describe and preview it.
import type { Messages } from "@/lib/locales/en"
export { formatCountdown } from "@/lib/utils"
import type { Group, GroupSchedule } from "./domain"

export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]
export const WEEKDAYS = [1, 2, 3, 4, 5]
export const WEEKENDS = [0, 6]
/** Display order of weekdays: Monday first. */
export const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

export type DayPreset = "everyDay" | "weekdays" | "weekends" | "custom"
export const DAY_PRESETS: Record<Exclude<DayPreset, "custom">, number[]> = { everyDay: EVERY_DAY, weekdays: WEEKDAYS, weekends: WEEKENDS }

/** Minutes before a scheduled stop when the countdown appears. */
export const WARNING_LEAD_MINUTES = 30

export function emptySchedule(): GroupSchedule {
  return { days: [...WEEKDAYS], startEnabled: false, startAt: "09:00", stopEnabled: false, stopAt: "18:00" }
}

/** A group's schedule with defaults filled in (older files have none). */
export function scheduleOf(group: Pick<Group, "schedule">): GroupSchedule {
  const s = group.schedule
  return { ...emptySchedule(), ...s, days: s?.days ?? [] }
}

export function isScheduleActive(s: GroupSchedule) {
  return (s.startEnabled || s.stopEnabled) && s.days.length > 0
}

const sameDays = (a: number[], b: number[]) => a.length === b.length && [...a].sort().every((d, i) => d === [...b].sort()[i])

export function dayPreset(days: number[]): DayPreset {
  for (const [preset, value] of Object.entries(DAY_PRESETS)) if (sameDays(days, value)) return preset as DayPreset
  return "custom"
}

export function parseClock(clock: string): [number, number] | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim())
  if (!match) return null
  const [h, m] = [Number(match[1]), Number(match[2])]
  return h < 24 && m < 60 ? [h, m] : null
}

/** The first time after `from` at which `clock` falls on one of `days`. */
export function nextOccurrence(days: number[], clock: string, from: Date): Date | null {
  const parsed = parseClock(clock)
  if (!parsed || days.length === 0) return null
  for (let offset = 0; offset <= 7; offset++) {
    const at = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset, parsed[0], parsed[1], 0, 0)
    if (at > from && days.includes(at.getDay())) return at
  }
  return null
}

/** The next start and stop of a schedule (null when that part is off). */
export function nextEvents(s: GroupSchedule, from = new Date()) {
  return {
    start: s.startEnabled ? nextOccurrence(s.days, s.startAt, from) : null,
    stop: s.stopEnabled ? nextOccurrence(s.days, s.stopAt, from) : null,
  }
}

/** Locale-aware weekday name; day 0 is Sunday. */
export function weekdayName(day: number, locale: string, style: "short" | "long" | "narrow" = "short") {
  return new Intl.DateTimeFormat(locale, { weekday: style }).format(new Date(2026, 9, 18 + day))
}

export function describeDays(days: number[], t: Messages, locale: string) {
  const preset = dayPreset(days)
  if (preset !== "custom") return t.schedule[preset]
  return DAY_ORDER.filter((d) => days.includes(d)).map((d) => weekdayName(d, locale)).join(", ")
}

/** "Today 18:00", "Tomorrow 09:00" or "Wed 09:00". */
export function formatWhen(at: Date, t: Messages, locale: string, now = new Date()) {
  const clock = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`
  const days = Math.round((new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000)
  const day = days === 0 ? t.schedule.today : days === 1 ? t.schedule.tomorrow : weekdayName(at.getDay(), locale)
  return `${day} ${clock}`
}

/** "in 2h 05m" style relative duration, minute precision. */
export function formatIn(ms: number) {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  if (h < 48) return `${h}h ${String(minutes % 60).padStart(2, "0")}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}
