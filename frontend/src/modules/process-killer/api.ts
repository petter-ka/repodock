import { getBackend } from "@/lib/bridge"

const api = () => getBackend().api

/** Process-killer view of the backend contract (ADR-0018). */
export const killerApi = {
  byPID: (pid: number) => api().FindProcessByPID(pid),
  byPort: (port: number) => api().FindProcessesByPort(port),
  kill: (pid: number, includeChildren: boolean) => api().KillHostProcess(pid, includeChildren),
}
export type { HostProcess, KillResult } from "@/lib/contracts"
