// Installed Node.js versions and the version every repository runs with,
// as resolved by the backend (ADR-0031). Kept outside React like the other
// stores; refreshed whenever the workspace changes.
import { useSyncExternalStore } from "react"
import { errorMessage } from "@/lib/bridge"
import { repositoryApi } from "../api"
import type { NodeOverview, NodeStatus } from "../domain"

const EMPTY: NodeOverview = { managers: [], installs: [], default: "", repositories: [], scannedAt: "" }

class NodeStore {
  private overview: NodeOverview = EMPTY
  private byRepo = new Map<string, NodeStatus>()
  private listeners = new Set<() => void>()
  private version = 0
  private timer: number | undefined
  private requested = 0
  loaded = false
  error = ""

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getVersion = () => this.version

  set(overview: NodeOverview) {
    this.overview = { ...overview, managers: overview.managers ?? [], installs: overview.installs ?? [], repositories: overview.repositories ?? [] }
    this.byRepo = new Map(this.overview.repositories.map((status) => [status.repositoryId, status]))
    this.loaded = true
    this.error = ""
    this.notify()
  }

  private notify() {
    this.version++
    this.listeners.forEach((listener) => listener())
  }

  get() {
    return this.overview
  }

  status(repositoryId: string) {
    return this.byRepo.get(repositoryId)
  }

  /** Fetches the overview; overlapping requests keep only the newest answer. */
  async load(rescan = false) {
    const ticket = ++this.requested
    try {
      const overview = await (rescan ? repositoryApi.rescanNodeVersions() : repositoryApi.nodeVersions())
      if (ticket === this.requested) this.set(overview)
    } catch (error) {
      if (ticket !== this.requested) return
      this.error = errorMessage(error)
      this.notify()
    }
  }

  /** Coalesces bursts of workspace changes into one request. */
  scheduleLoad() {
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => void this.load(), 250)
  }
}

export const nodeStore = new NodeStore()

/** Re-renders when Node.js versions or statuses change; read them from `nodeStore`. */
export function useNodeVersion() {
  return useSyncExternalStore(nodeStore.subscribe, nodeStore.getVersion)
}

/** The major release line of a version ("22.19.0" → 22). */
export const nodeMajor = (version: string) => Number(version.replace(/^v/, "").split(".")[0]) || 0

/** Whether a status deserves a warning: end of life, an unmet request, or engines not satisfied. */
export const nodeNeedsAttention = (status: NodeStatus | undefined) => !!status && (status.eol || !!status.missing || status.enginesMismatch || !status.version)
