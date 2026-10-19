// Next scheduled start/stop of every group, as reported by the backend
// scheduler (ADR-0025). Kept outside React like the other stores.
import { useSyncExternalStore } from "react"
import type { GroupScheduleStatus } from "../domain"

class ScheduleStore {
  private byGroup = new Map<string, GroupScheduleStatus>()
  private listeners = new Set<() => void>()
  private version = 0

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getVersion = () => this.version

  set(statuses: GroupScheduleStatus[]) {
    this.byGroup = new Map((statuses ?? []).map((status) => [status.groupId, status]))
    this.version++
    this.listeners.forEach((listener) => listener())
  }

  status(groupId: string) {
    return this.byGroup.get(groupId)
  }
}

export const scheduleStore = new ScheduleStore()

/** Re-renders when the backend reports new schedule statuses; read them with `scheduleStore.status`. */
export function useScheduleVersion() {
  return useSyncExternalStore(scheduleStore.subscribe, scheduleStore.getVersion)
}

/** A group's next start/stop; re-renders when the backend reports changes. */
export function useScheduleStatus(groupId: string) {
  useScheduleVersion()
  return scheduleStore.status(groupId)
}
