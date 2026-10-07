import { describe, expect, it } from "vitest"
import { ProcessStore, RETAIN_FINISHED_RUNS, type LineView } from "./processStore"
import type { ProcessOutput, Run } from "../domain"

const immediate = (callback: () => void) => callback()
const toArray = (view: LineView) => Array.from({ length: view.length }, (_, i) => view.at(i)!)

const run = (patch: Partial<Run> = {}): Run => ({
  id: "r1", repositoryId: "repo", command: "npm run dev", label: "dev", status: "running", pid: 10, exitCode: -1,
  startedAt: "2026-10-06T10:00:00Z", endedAt: "0001-01-01T00:00:00Z", sequenceId: "", stepId: "", ...patch,
})

const line = (seq: number, patch: Partial<ProcessOutput> = {}): ProcessOutput => ({
  runId: "r1", repositoryId: "repo", pid: 10, stream: "stdout", text: `line ${seq}`, partial: false, seq, timestamp: "", ...patch,
})

describe("ProcessStore", () => {
  it("tracks the prompt a running process waits on until it is answered", () => {
    const store = new ProcessStore(immediate)
    store.upsertRun(run())
    store.applyOutput([line(1), line(2, { text: "Continue? (y/n) ", partial: true })])
    expect(store.prompt("r1")).toBe("Continue? (y/n) ")
    store.applyOutput([line(3, { stream: "stdin", text: "y" })])
    expect(store.prompt("r1")).toBeUndefined()

    store.applyOutput([line(4, { text: "Name: ", partial: true })])
    store.applyOutput([line(5, { text: "more output" })])
    expect(store.prompt("r1")).toBeUndefined()

    store.applyOutput([line(6, { text: "Again? ", partial: true })])
    store.applyExit({ runId: "r1", repositoryId: "repo", exitCode: 0, status: "exited", endedAt: "2026-10-06T10:01:00Z" })
    expect(store.prompt("r1")).toBeUndefined()
  })

  it("does not resurrect a finished run from a late event", () => {
    const store = new ProcessStore(immediate)
    store.upsertRun(run())
    store.applyExit({ runId: "r1", repositoryId: "repo", exitCode: 0, status: "exited", endedAt: "2026-10-06T10:01:00Z" })
    store.upsertRun(run({ status: "stopping" }))
    expect(store.run("r1")?.status).toBe("exited")
    expect(store.activeCount("repo")).toBe(0)
  })

  it("indexes output by run, repository and globally", () => {
    const store = new ProcessStore(immediate)
    store.upsertRun(run())
    store.applyOutput([line(1), line(2, { runId: "r2", repositoryId: "other" })])
    expect(store.lines({ runId: "r1" })).toHaveLength(1)
    expect(store.lines({ repositoryId: "other" })).toHaveLength(1)
    expect(store.lines({})).toHaveLength(2)
  })

  it("keeps memory constant: every view is capped at the scrollback limit", () => {
    const store = new ProcessStore(immediate, 1_000)
    store.upsertRun(run())
    for (let batch = 0; batch < 50; batch++) {
      store.applyOutput(Array.from({ length: 500 }, (_, i) => line(batch * 500 + i + 1)))
    }
    for (const view of [store.lines({}), store.lines({ repositoryId: "repo" }), store.lines({ runId: "r1" })]) {
      expect(view.length).toBe(1_000)
      expect(view.at(view.length - 1)!.seq).toBe(25_000)
      expect(view.at(0)!.seq).toBe(24_001)
    }
    expect(store.lines({}).evicted).toBe(24_000)
  })

  it("resizes the scrollback, keeping the newest lines", () => {
    const store = new ProcessStore(immediate, 5_000)
    store.applyOutput(Array.from({ length: 3_000 }, (_, i) => line(i + 1)))
    store.setLimit(2_000)
    const view = store.lines({ repositoryId: "repo" })
    expect([view.length, view.at(0)!.seq]).toEqual([2_000, 1_001])
    expect(store.getLimit()).toBe(2_000)
  })

  it("remembers only the newest finished runs", () => {
    const store = new ProcessStore(immediate)
    for (let i = 0; i < RETAIN_FINISHED_RUNS + 50; i++) {
      const startedAt = new Date(Date.UTC(2026, 9, 6, 10, 0, i)).toISOString()
      store.upsertRun(run({ id: `run-${i}`, status: "exited", startedAt }))
    }
    store.upsertRun(run({ id: "live", startedAt: "2026-10-06T09:00:00Z" }))
    const kept = store.runsFor("repo")
    expect(kept).toHaveLength(RETAIN_FINISHED_RUNS + 1)
    expect(kept.some((r) => r.id === "run-0")).toBe(false)
    expect(kept.some((r) => r.id === "live")).toBe(true)
  })

  it("coalesces notifications until the scheduled frame", () => {
    const queued: Array<() => void> = []
    const store = new ProcessStore((callback) => queued.push(callback))
    let calls = 0
    store.subscribe(() => calls++)
    store.applyOutput([line(1)])
    store.applyOutput([line(2)])
    store.upsertRun(run())
    expect(queued).toHaveLength(1)
    queued[0]()
    expect(calls).toBe(1)
    expect(store.getVersion()).toBe(1)
  })

  it("clears finished runs but keeps active ones", () => {
    const store = new ProcessStore(immediate)
    store.upsertRun(run())
    store.upsertRun(run({ id: "r2", status: "failed" }))
    store.applyOutput([line(1), line(2, { runId: "r2" })])
    store.clearFinished("repo")
    expect(store.runsFor("repo").map((r) => r.id)).toEqual(["r1"])
    expect(toArray(store.lines({ repositoryId: "repo" })).map((l) => l.runId)).toEqual(["r1"])
  })

  it("keeps the newest group run and ignores stale running updates", () => {
    const store = new ProcessStore(immediate)
    const base = { groupId: "g", mode: "parallel" as const, repos: [], endedAt: "" }
    store.applyGroupRun({ ...base, id: "a", status: "completed", startedAt: "2026-10-06T10:00:00Z" })
    store.applyGroupRun({ ...base, id: "a", status: "running", startedAt: "2026-10-06T10:00:00Z" })
    expect(store.groupRun("g")?.status).toBe("completed")
    store.applyGroupRun({ ...base, id: "b", status: "running", startedAt: "2026-10-06T11:00:00Z" })
    store.applyGroupRun({ ...base, id: "a", status: "completed", startedAt: "2026-10-06T10:00:00Z" })
    expect(store.groupRun("g")?.id).toBe("b")
  })
})
