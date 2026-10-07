// Client-side mirror of backend process state. It lives outside React so a
// chatty process does not re-render the tree per line: mutations are cheap
// and subscribers are notified at most once per animation frame.
//
// Memory stays constant for long-running processes: output lives in
// fixed-size ring buffers (one for everything, one per repository, sized by
// the console scrollback setting), line objects are shared between them, a
// run's view is derived from its repository's buffer, and only the newest
// finished runs are remembered (mirroring the backend's retention).
import { isActive } from "@/lib/contracts"
import { RingBuffer } from "@/lib/ringBuffer"
import { consoleLimit } from "@/state/consoleLimit"
import type { ConsoleLine, GroupRun, ProcessExit, ProcessOutput, ProcessSnapshot, Run, SequenceRun } from "../domain"

/** Finished runs kept for the process strip and run filter (backend keeps 200 too). */
export const RETAIN_FINISHED_RUNS = 200

type Schedule = (callback: () => void) => void

const defaultSchedule: Schedule = (callback) =>
  typeof requestAnimationFrame === "function" ? void requestAnimationFrame(callback) : void setTimeout(callback, 16)

/** Read-only, index-addressable console lines; no copy is made for whole buffers. */
export type LineView = {
  readonly length: number
  at(index: number): ConsoleLine | undefined
  /** lines dropped from the front so far, when the view is a live buffer */
  readonly evicted?: number
}

const EMPTY: LineView = { length: 0, at: () => undefined, evicted: 0 }

export class ProcessStore {
  private runs = new Map<string, Run>()
  private snapshots = new Map<string, ProcessSnapshot>()
  private sequences = new Map<string, SequenceRun>()
  private groupRuns = new Map<string, GroupRun>()
  private all: RingBuffer<ConsoleLine>
  private byRepo = new Map<string, RingBuffer<ConsoleLine>>()
  /** one cached run view, rebuilt when output changes */
  private runView: { runId: string; stamp: number; lines: ConsoleLine[] } | null = null
  private outputStamp = 0
  /** runId → quick command ID, for runs started from a quick command chip */
  private background = new Map<string, string>()
  /** runId → prompt text while the run's latest output is an unanswered prompt */
  private prompts = new Map<string, string>()
  private listeners = new Set<() => void>()
  private version = 0
  private pending = false

  constructor(private schedule: Schedule = defaultSchedule, private limit: number = consoleLimit.get()) {
    this.all = new RingBuffer(limit)
  }

  /** Scrollback per view (all repositories, and each repository). */
  getLimit = () => this.limit

  setLimit(limit: number) {
    if (limit === this.limit) return
    this.limit = limit
    this.all.resize(limit)
    this.byRepo.forEach((buffer) => buffer.resize(limit))
    this.outputStamp++
    this.changed()
  }

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
    this.pruneFinished()
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
    this.pruneFinished()
    this.changed()
  }

  applyExit(exit: ProcessExit) {
    const run = this.runs.get(exit.runId)
    if (!run) return
    this.runs.set(exit.runId, { ...run, status: exit.status, exitCode: exit.exitCode, endedAt: exit.endedAt })
    this.snapshots.delete(exit.runId)
    this.prompts.delete(exit.runId)
    this.pruneFinished()
    this.changed()
  }

  /** Forgets the oldest finished runs beyond the retention limit. Their lines stay until they scroll out. */
  private pruneFinished() {
    const finished = [...this.runs.values()].filter((run) => !isActive(run.status))
    if (finished.length <= RETAIN_FINISHED_RUNS) return
    finished.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    for (const run of finished.slice(0, finished.length - RETAIN_FINISHED_RUNS)) {
      this.runs.delete(run.id)
      this.background.delete(run.id)
      this.snapshots.delete(run.id)
      this.prompts.delete(run.id)
    }
  }

  applyStats(snapshot: ProcessSnapshot) {
    const run = this.runs.get(snapshot.runId)
    if (run && !isActive(run.status)) return
    this.snapshots.set(snapshot.runId, snapshot)
    this.changed()
  }

  applyOutput(lines: ProcessOutput[]) {
    for (const line of lines) {
      this.all.push(line)
      let repo = this.byRepo.get(line.repositoryId)
      if (!repo) this.byRepo.set(line.repositoryId, (repo = new RingBuffer(this.limit)))
      repo.push(line)
      if (line.partial && line.stream !== "stdin") this.prompts.set(line.runId, line.text)
      else this.prompts.delete(line.runId)
    }
    if (lines.length) {
      this.outputStamp++
      this.changed()
    }
  }

  applySequence(sequence: SequenceRun) {
    this.mergeSequence(sequence)
    this.changed()
  }

  /** Clears console output, for one repository or everything. */
  clearOutput(repositoryId?: string) {
    if (!repositoryId) {
      this.all.clear()
      this.byRepo.clear()
    } else {
      this.all.retain((line) => line.repositoryId !== repositoryId)
      this.byRepo.delete(repositoryId)
    }
    this.outputStamp++
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
      this.background.delete(id)
      this.snapshots.delete(id)
      this.prompts.delete(id)
    })
    const keep = (line: ConsoleLine) => !ids.has(line.runId)
    this.all.retain(keep)
    this.byRepo.forEach((buffer) => buffer.retain(keep))
    this.outputStamp++
    this.changed()
  }

  /** Marks a run as started from a quick command (shown in the Background drawer). */
  markBackground(runId: string, quickId: string) {
    this.background.set(runId, quickId)
    this.changed()
  }

  /** Quick-command runs of a repository, oldest first. */
  backgroundRuns(repositoryId: string): Run[] {
    return this.runsFor(repositoryId).filter((run) => this.background.has(run.id))
  }

  /** The quick command a run was started from, if any. */
  quickCommandOf(runId: string) {
    return this.background.get(runId)
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

  /** The prompt a running process is waiting on, if its latest output is one. */
  prompt(runId: string): string | undefined {
    const run = this.runs.get(runId)
    return run && isActive(run.status) ? this.prompts.get(runId) : undefined
  }

  snapshot(runId: string) {
    return this.snapshots.get(runId)
  }

  sequence(repositoryId: string) {
    return this.sequences.get(repositoryId)
  }

  /**
   * Console lines for a scope, oldest first. Repository and global scopes
   * are the live buffers (no copy); a run's lines are filtered from its
   * repository's buffer and cached until output changes.
   */
  lines(scope: { repositoryId?: string; runId?: string | null }): LineView {
    if (scope.runId) {
      const cached = this.runView
      if (cached?.runId === scope.runId && cached.stamp === this.outputStamp) return cached.lines
      const repoId = this.runs.get(scope.runId)?.repositoryId ?? scope.repositoryId
      const source = (repoId && this.byRepo.get(repoId)) || this.all
      const lines = source.filter((line) => line.runId === scope.runId)
      this.runView = { runId: scope.runId, stamp: this.outputStamp, lines }
      return lines
    }
    if (scope.repositoryId) return this.byRepo.get(scope.repositoryId) ?? EMPTY
    return this.all
  }

  /** Changes whenever any console output is added or removed. */
  getOutputStamp = () => this.outputStamp
}

export const processStore = new ProcessStore()
consoleLimit.subscribe((limit) => processStore.setLimit(limit))
