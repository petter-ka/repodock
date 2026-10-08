import { getBackend } from "@/lib/bridge"

const api = () => getBackend().api

/** Leftover-process view of the backend contract (ADR-0021). */
export const leftoverApi = {
  list: () => api().LeftoverProcesses(),
  stop: (runIds: string[]) => api().StopLeftoverProcesses(runIds),
}
export type { LeftoverRun } from "@/lib/contracts"
