import { describe, expect, it } from "vitest"
import { latestRunHealth } from "./repoStatus"
import type { Run } from "./domain"

const run = (id: string, minute: number, patch: Partial<Run> = {}): Run => ({
  id, repositoryId: "repo", command: id, label: id, status: "exited", pid: 1, exitCode: 0,
  startedAt: `2026-10-06T10:${String(minute).padStart(2, "0")}:00Z`, endedAt: "", sequenceId: "", stepId: "", ...patch,
})

const at = (minute: number) => `2026-10-06T10:${String(minute).padStart(2, "0")}:30Z`

const devServer = (minute: number, patch: Partial<Run> = {}) => run("dev", minute, { status: "running", exitCode: -1, ...patch })

describe("latestRunHealth", () => {
  it("returns null before anything ran", () => {
    expect(latestRunHealth([])).toBeNull()
    expect(latestRunHealth([run("noop", 1, { status: "skipped" })])).toBeNull()
  })

  it("shows a long-running dev server as running", () => {
    expect(latestRunHealth([devServer(1)])?.health).toBe("running")
    expect(latestRunHealth([devServer(1, { status: "starting" })])?.health).toBe("running")
    expect(latestRunHealth([devServer(1, { status: "stopping" })])?.health).toBe("running")
  })

  it("keeps a live process green even if a later command failed", () => {
    const runs = [devServer(1), run("lint", 5, { status: "failed", exitCode: 2 })]
    expect(latestRunHealth(runs)).toMatchObject({ health: "running", run: { id: "dev" } })
  })

  it("maps finished commands by exit status", () => {
    expect(latestRunHealth([run("build", 1)])?.health).toBe("success")
    expect(latestRunHealth([run("lint", 1, { status: "failed", exitCode: 2 })])?.health).toBe("danger")
    // A dev server that crashed or was killed outside RepoDock is a failure.
    expect(latestRunHealth([devServer(1, { status: "failed", exitCode: 137 })])?.health).toBe("danger")
  })

  it("treats a run stopped from the UI as a warning, not red", () => {
    expect(latestRunHealth([devServer(1, { status: "stopped", exitCode: 1, endedAt: at(9) })])?.health).toBe("stopped")
    // Stopping the dev server must not resurface an older failure either.
    const runs = [run("lint", 1, { status: "failed", exitCode: 2, endedAt: at(2) }), devServer(5, { status: "stopped", exitCode: 1, endedAt: at(9) })]
    expect(latestRunHealth(runs)?.health).toBe("stopped")
  })

  it("orders finished runs by when they ended, not when they started", () => {
    // dev started first, lint started later and failed while dev was running,
    // then the user stopped dev: the stop is the most recent event → stopped.
    const stoppedLast = [devServer(1, { status: "stopped", exitCode: 1, endedAt: at(9) }), run("lint", 3, { status: "failed", exitCode: 1, endedAt: at(4) })]
    expect(latestRunHealth(stoppedLast)?.health).toBe("stopped")
    // If the failure happens after the stop, it is shown.
    const failedLast = [devServer(1, { status: "stopped", exitCode: 1, endedAt: at(4) }), run("lint", 3, { status: "failed", exitCode: 1, endedAt: at(9) })]
    expect(latestRunHealth(failedLast)?.health).toBe("danger")
  })

  it("uses the most recent finished run regardless of order and ignores no-op steps", () => {
    const runs = [run("late-fail", 9, { status: "failed", exitCode: 1 }), run("early-ok", 1), run("noop", 10, { status: "skipped" })]
    expect(latestRunHealth(runs)).toMatchObject({ health: "danger", run: { id: "late-fail" } })
    expect(latestRunHealth([...runs, run("fixed", 11)])).toMatchObject({ health: "success", run: { id: "fixed" } })
  })
})
