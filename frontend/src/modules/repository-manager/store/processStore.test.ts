import { describe, expect, it } from "vitest"
import { ProcessStore, RUN_LINE_LIMIT } from "./processStore"
import type { ProcessOutput, Run } from "../domain"

const immediate = (callback: () => void) => callback()

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

  it("bounds per-run history", () => {
    const store = new ProcessStore(immediate)
    const batch = Array.from({ length: RUN_LINE_LIMIT * 2 }, (_, i) => line(i + 1))
    store.applyOutput(batch)
    const lines = store.lines({ runId: "r1" })
    expect(lines.length).toBeLessThanOrEqual(RUN_LINE_LIMIT * 1.1)
    expect(lines[lines.length - 1].seq).toBe(RUN_LINE_LIMIT * 2)
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
    expect(store.lines({ repositoryId: "repo" }).map((l) => l.runId)).toEqual(["r1"])
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
