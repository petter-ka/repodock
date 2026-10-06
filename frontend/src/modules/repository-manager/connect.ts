import { errorMessage } from "@/lib/bridge"
import type { ModuleContext } from "@/lib/module"
import { repositoryApi } from "./api"
import { processStore } from "./store/processStore"
import { workspaceStore } from "./store/workspaceStore"

/** Subscribes to backend events and hydrates the stores. */
// Startup notices are shown once per page load even though React StrictMode
// runs module init twice in development.
let announced = false

export function connectRepositoryManager({ notify, t, f }: ModuleContext) {
  const offs = [
    repositoryApi.on("workspace:changed", (workspace) => workspaceStore.setWorkspace(workspace)),
    repositoryApi.on("process:started", (run) => processStore.upsertRun(run)),
    repositoryApi.on("process:output-batch", (lines) => processStore.applyOutput(lines)),
    repositoryApi.on("process:stats", (snapshot) => processStore.applyStats(snapshot)),
    repositoryApi.on("process:exited", (exit) => processStore.applyExit(exit)),
    repositoryApi.on("sequence:updated", (sequence) => processStore.applySequence(sequence)),
    repositoryApi.on("group:updated", (run) => {
      const previous = processStore.groupRun(run.groupId)
      processStore.applyGroupRun(run)
      // Announce the transition into a terminal state once.
      if (run.status === "running" || previous?.status !== "running" || previous.id !== run.id) return
      const name = workspaceStore.getState().workspace.groups.find((g) => g.id === run.groupId)?.name ?? ""
      const failed = run.repos.find((repo) => repo.status === "failed")
      if (run.status === "completed") notify(f(t.groupRun.completed, { name }), { tone: "success" })
      else if (run.status === "cancelled") notify(f(t.groupRun.cancelled, { name }), { tone: "info" })
      else notify(f(t.groupRun.failed, { name, repo: failed?.name ?? "", error: failed?.error ?? "" }), { tone: "error" })
    }),
  ]

  void (async () => {
    try {
      const [workspace, runs, snapshots, sequences, groupRuns, report] = await Promise.all([
        repositoryApi.workspace(), repositoryApi.runs(), repositoryApi.snapshots(), repositoryApi.sequences(), repositoryApi.groupRuns(), repositoryApi.startupReport(),
      ])
      workspaceStore.setWorkspace(workspace)
      processStore.hydrate(runs, snapshots, sequences, groupRuns)
      if (announced) return
      announced = true
      if (report.recoveredBackup) notify(f(t.notices.recovered, { path: report.recoveredBackup }), { tone: "warning", duration: 0 })
      report.warnings?.forEach((message) => notify(f(t.notices.warning, { message }), { tone: "warning", duration: 0 }))
      if (!repositoryApi.isNative()) notify(t.notices.mockMode, { tone: "info" })
    } catch (error) {
      notify(errorMessage(error), { tone: "error", duration: 0 })
    }
  })()

  return () => offs.forEach((off) => off())
}
