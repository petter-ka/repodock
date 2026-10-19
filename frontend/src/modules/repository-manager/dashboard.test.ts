import { describe, expect, it } from "vitest"
import type { Group, Repository, Workspace } from "./domain"
import { computeDashboard, runningSpans, seriesColor } from "./dashboard"

const repo = (id: string, patch: Partial<Repository> = {}): Repository => ({
  id, name: id, alias: "", path: `/w/${id}`, packageManager: "npm", scripts: [{ name: "dev", command: "x" }], commandSequence: [],
  quickCommands: [], envFiles: [], groupId: "", lastRefreshedAt: "", problem: "", dependencies: 2, devDependencies: 1, stack: [], continuous: false, ...patch,
})
const group = (id: string, ids: string[], patch: Partial<Group> = {}): Group => ({
  id, name: id, repositoryIds: ids, collapsed: false, runMode: "sequential", skippedRepositoryIds: [], schedule: null, ...patch,
})
const step = { id: "s", label: "dev", script: "dev", globalCommand: "", command: "", enabled: true, background: true }

describe("computeDashboard", () => {
  const workspace: Workspace = {
    version: 1, globalCommands: [],
    groups: [
      group("a", ["r1", "r2", "r3", "r4"], { skippedRepositoryIds: ["r2"], schedule: { days: [1], startEnabled: true, startAt: "09:00", stopEnabled: false, stopAt: "" } }),
      group("b", ["r5"]),
    ],
    repositories: [
      repo("r1", { commandSequence: [step], stack: ["Next.js", "TypeScript"] }),
      repo("r2", { commandSequence: [step], packageManager: "pnpm", stack: ["TypeScript"] }),
      repo("r3", { problem: "invalid package.json" }),
      repo("r4", { packageManager: "", scripts: [] }),
      repo("r5", { commandSequence: [step], packageManager: "pnpm" }),
    ],
  }
  const data = computeDashboard(workspace)

  it("classifies each member once", () => {
    expect(data.groups[0].readiness).toEqual({ ready: 1, skipped: 1, noSequence: 1, problem: 1 })
    expect(data.groups[1].readiness).toEqual({ ready: 1, skipped: 0, noSequence: 0, problem: 0 })
  })

  it("sums the totals", () => {
    expect(data.totals).toEqual({ repositories: 5, groups: 2, scripts: 4, ready: 2, scheduled: 1, problems: 1 })
    expect(data.groups[0].dependencies).toBe(8)
  })

  it("counts managers in a fixed order and ranks the stack", () => {
    expect(data.managers).toEqual([{ key: "npm", count: 2 }, { key: "pnpm", count: 2 }, { key: "", count: 1 }])
    expect(data.stack).toEqual([{ name: "TypeScript", count: 2 }, { name: "Next.js", count: 1 }])
  })

  it("folds a long stack into other", () => {
    const many = computeDashboard({ ...workspace, repositories: [repo("x", { stack: ["A", "B", "C", "D"] })] }, 3)
    expect(many.stack).toEqual([{ name: "A", count: 1 }, { name: "B", count: 1 }, { name: "", count: 2, other: true }])
  })

  it("never cycles colours", () => {
    expect(seriesColor(0)).toBe("var(--series-1)")
    expect(seriesColor(8)).toBe("var(--series-other)")
  })
})

describe("runningSpans", () => {
  const base = { days: [1], startEnabled: true, startAt: "09:00", stopEnabled: true, stopAt: "18:00" }
  it("covers start to stop, wrapping overnight", () => {
    expect(runningSpans(base)).toEqual([[540, 1080]])
    expect(runningSpans({ ...base, startAt: "22:00", stopAt: "02:00" })).toEqual([[1320, 1440], [0, 120]])
    expect(runningSpans({ ...base, stopEnabled: false })).toEqual([[540, 1440]])
    expect(runningSpans({ ...base, startEnabled: false, stopEnabled: false })).toEqual([])
  })
})
