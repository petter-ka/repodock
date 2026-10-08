import { isActive, isZeroTime, type Run } from "./domain"

export type RepoHealth = "running" | "success" | "stopped" | "danger"

/** When a finished run reached its terminal state (falls back to its start). */
function finishedAt(run: Run) {
  return isZeroTime(run.endedAt) ? run.startedAt : run.endedAt
}

/**
 * Sidebar status of a repository, derived from its runs:
 *
 * - running: any run is still active. Dev servers and watchers (`npm start`,
 *   `npm run dev`) never finish, so a live process wins over other results.
 * - otherwise the run that finished most recently decides: exit code 0 →
 *   success, failure or crash → danger.
 * - a run the user stopped from RepoDock is a warning (stopped), not a failure.
 * - skipped no-op steps are ignored.
 *
 * `run` is the run the status refers to (the newest active run while
 * running). Returns null when there is nothing to show.
 */
export function latestRunHealth(runs: readonly Run[]): { run: Run; health: RepoHealth } | null {
  let latestActive: Run | undefined
  let latestFinished: Run | undefined
  for (const run of runs) {
    if (run.status === "skipped") continue
    if (isActive(run.status)) {
      if (!latestActive || run.startedAt >= latestActive.startedAt) latestActive = run
    } else if (!latestFinished || finishedAt(run) >= finishedAt(latestFinished)) {
      latestFinished = run
    }
  }
  if (latestActive) return { run: latestActive, health: "running" }
  if (!latestFinished) return null
  if (latestFinished.status === "stopped") return { run: latestFinished, health: "stopped" }
  if (latestFinished.status === "exited" && latestFinished.exitCode === 0) return { run: latestFinished, health: "success" }
  return { run: latestFinished, health: "danger" }
}
