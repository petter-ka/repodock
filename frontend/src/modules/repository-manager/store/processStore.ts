// Client-side mirror of backend process state. It lives outside React so a
// chatty process does not re-render the tree per line: mutations are cheap
// and subscribers are notified at most once per animation frame.
import { isActive } from "@/lib/contracts"
import type { ConsoleLine, GroupRun, ProcessExit, ProcessOutput, ProcessSnapshot, Run, SequenceRun } from "../domain"

export const RUN_LINE_LIMIT = 5_000
export const VIEW_LINE_LIMIT = 10_000

type Schedule = (callback: () => void) => void

const defaultSchedule: Schedule = (callback) =>
  typeof requestAnimationFrame === "function" ? void requestAnimationFrame(callback) : void setTimeout(callback, 16)

function push(list: ConsoleLine[], line: ConsoleLine, limit: number) {
  list.push(line)
  // Trim in chunks so the amortized cost stays O(1) per line.
  if (list.length > limit + Math.ceil(limit / 10)) list.splice(0, list.length - limit)
}

export class ProcessStore {
  private runs = new Map<string, Run>()
  private snapshots = new Map<string, ProcessSnapshot>()
  private sequences = new Map<string, SequenceRun>()
  private groupRuns = new Map<string, GroupRun>()
  private all: ConsoleLine[] = []
  private byRepo = new Map<string, ConsoleLine[]>()
  private byRun = new Map<string, ConsoleLine[]>()
  private listeners = new Set<() => void>()
  private version = 0
  private pending = false

  constructor(private schedule: Schedule = defaultSchedule) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getVersion = () => this.version

  private changed() {
    if (this.pending) return
    this.pending = true
    this.schedule(() => {
      this.pending = false
      this.version++
      this.listeners.forEach((listener) => listener())
    })
  }

  hydrate(runs: Run[], snapshots: ProcessSnapshot[], sequences: SequenceRun[], groupRuns: GroupRun[] = []) {
    runs.forEach((run) => this.mergeRun(run))
    snapshots.forEach((snapshot) => {
      if (this.runs.has(snapshot.runId)) this.snapshots.set(snapshot.runId, snapshot)
    })
    sequences.forEach((sequence) => this.mergeSequence(sequence))
    groupRuns.forEach((run) => this.mergeGroupRun(run))
    this.changed()
  }

  /** Merges a run, refusing to move a finished run back to an active state. */
  private mergeRun(run: Run) {
    const existing = this.runs.get(run.id)
    if (existing && !isActive(existing.status) && isActive(run.status)) return
    this.runs.set(run.id, { ...existing, ...run })
  }

  private mergeSequence(sequence: SequenceRun) {
    const existing = this.sequences.get(sequence.repositoryId)
    if (existing && existing.id === sequence.id && existing.status !== "running" && sequence.status === "running") return
    if (existing && existing.id !== sequence.id && existing.startedAt > sequence.startedAt) return
    this.sequences.set(sequence.repositoryId, sequence)
  }

  private mergeGroupRun(run: GroupRun) {
    const existing = this.groupRuns.get(run.groupId)
    if (existing && existing.id === run.id && existing.status !== "running" && run.status === "running") return
    if (existing && existing.id !== run.id && existing.startedAt > run.startedAt) return
    this.groupRuns.set(run.groupId, run)
  }

  applyGroupRun(run: GroupRun) {
    this.mergeGroupRun(run)
    this.changed()
  }

  groupRun(groupId: string) {
    return this.groupRuns.get(groupId)
  }

  upsertRun(run: Run) {
    this.mergeRun(run)
    this.changed()
  }

  applyExit(exit: ProcessExit) {
    const run = this.runs.get(exit.runId)
    if (!run) return
    this.runs.set(exit.runId, { ...run, status: exit.status, exitCode: exit.exitCode, endedAt: exit.endedAt })
    this.snapshots.delete(exit.runId)
    this.changed()
  }

  applyStats(snapshot: ProcessSnapshot) {
    const run = this.runs.get(snapshot.runId)
    if (run && !isActive(run.status)) return
    this.snapshots.set(snapshot.runId, snapshot)
    this.changed()
  }

  applyOutput(lines: ProcessOutput[]) {
    for (const line of lines) {
      const entry: ConsoleLine = line
      push(this.all, entry, VIEW_LINE_LIMIT)
      let repo = this.byRepo.get(line.repositoryId)
      if (!repo) this.byRepo.set(line.repositoryId, (repo = []))
      push(repo, entry, VIEW_LINE_LIMIT)
      let run = this.byRun.get(line.runId)
      if (!run) this.byRun.set(line.runId, (run = []))
      push(run, entry, RUN_LINE_LIMIT)
    }
    if (lines.length) this.changed()
  }

  applySequence(sequence: SequenceRun) {
    this.mergeSequence(sequence)
    this.changed()
  }

  /** Clears console output, for one repository or everything. */
  clearOutput(repositoryId?: string) {
    if (!repositoryId) {
      this.all = []
      this.byRepo.clear()
      this.byRun.clear()
    } else {
      this.all = this.all.filter((line) => line.repositoryId !== repositoryId)
      this.byRepo.delete(repositoryId)
      for (const run of this.runs.values()) if (run.repositoryId === repositoryId) this.byRun.delete(run.id)
    }
    this.changed()
  }

  /** Forgets finished runs (and their output) for a repository. */
  clearFinished(repositoryId: string) {
    const removed = new Set<string>()
    for (const run of this.runs.values()) {
      if (run.repositoryId === repositoryId && !isActive(run.status)) removed.add(run.id)
    }
    this.forget(removed)
  }

  dismissRun(runId: string) {
    const run = this.runs.get(runId)
    if (run && !isActive(run.status)) this.forget(new Set([runId]))
  }

  private forget(ids: Set<string>) {
    if (!ids.size) return
    ids.forEach((id) => {
      this.runs.delete(id)
      this.byRun.delete(id)
      this.snapshots.delete(id)
    })
    const keep = (line: ConsoleLine) => !ids.has(line.runId)
    this.all = this.all.filter(keep)
    for (const [repo, lines] of this.byRepo) this.byRepo.set(repo, lines.filter(keep))
    this.changed()
  }

  run(id: string) {
    return this.runs.get(id)
  }

  /** Runs in scope, oldest first. */
  runsFor(repositoryId?: string): Run[] {
    const list = [...this.runs.values()].filter((run) => !repositoryId || run.repositoryId === repositoryId)
    return list.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  }

  activeCount(repositoryId?: string) {
    let count = 0
    for (const run of this.runs.values()) {
      if ((!repositoryId || run.repositoryId === repositoryId) && isActive(run.status)) count++
    }
    return count
  }

  snapshot(runId: string) {
    return this.snapshots.get(runId)
  }

  sequence(repositoryId: string) {
    return this.sequences.get(repositoryId)
  }

  /** Console lines for a scope. The returned array must not be mutated. */
  lines(scope: { repositoryId?: string; runId?: string | null }): readonly ConsoleLine[] {
    if (scope.runId) return this.byRun.get(scope.runId) ?? []
    if (scope.repositoryId) return this.byRepo.get(scope.repositoryId) ?? []
    return this.all
  }
}

export const processStore = new ProcessStore()
