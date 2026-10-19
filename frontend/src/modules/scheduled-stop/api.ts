import { getBackend } from "@/lib/bridge"
import type { EventMap } from "@/lib/contracts"

const api = () => getBackend().api

/** Scheduled-stop view of the backend contract (ADR-0025). */
export const scheduledStopApi = {
  pending: () => api().ScheduledStops(),
  postpone: (groupId: string, minutes: number) => api().PostponeScheduledStop(groupId, minutes),
  skip: (groupId: string) => api().SkipScheduledStop(groupId),
  stopNow: (groupId: string) => api().StopScheduledNow(groupId),
  on: <K extends keyof EventMap>(event: K, callback: (payload: EventMap[K]) => void) => getBackend().on(event, callback),
}
export type { ScheduledStop, ScheduleEvent } from "@/lib/contracts"
