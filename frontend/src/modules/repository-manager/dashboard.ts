// Workspace-wide figures for the "All repositories" dashboard. Pure, so the
// numbers are testable apart from the charts that draw them.
import type { Group, GroupSchedule, NodeStatus, Repository, Workspace } from "./domain"
import { isScheduleActive, scheduleOf } from "./schedule"

/** Categorical slots in fixed order; a 9th group and beyond share "other". */
export const SERIES_SLOTS = 8
export const seriesColor = (index: number) => (index < SERIES_SLOTS ? `var(--series-${index + 1})` : "var(--series-other)")

/** Where a repository stands for "Run group"; one state per repository. */
export type Readiness = "ready" | "noSequence" | "skipped" | "problem"
export const READINESS_ORDER: Readiness[] = ["ready", "skipped", "noSequence", "problem"]

export const hasSequence = (repo: Repository) => (repo.commandSequence ?? []).some((step) => step.enabled)

export function readinessOf(repo: Repository, group: Group): Readiness {
  if (repo.problem) return "problem"
  if ((group.skippedRepositoryIds ?? []).includes(repo.id)) return "skipped"
  return hasSequence(repo) ? "ready" : "noSequence"
}

export type GroupStats = {
  group: Group
  index: number
  color: string
  repos: Repository[]
  readiness: Record<Readiness, number>
  scripts: number
  dependencies: number
  devDependencies: number
  schedule: GroupSchedule
  scheduled: boolean
}

/** Package managers in a fixed order; "" is a plain folder. */
export const MANAGERS = ["npm", "pnpm", "yarn", "bun", ""] as const
export const managerColor: Record<string, string> = {
  npm: "var(--series-8)", pnpm: "var(--series-4)", yarn: "var(--series-1)", bun: "var(--series-5)", "": "var(--series-other)",
}

export type DashboardData = {
  totals: { repositories: number; groups: number; scripts: number; ready: number; scheduled: number; problems: number }
  groups: GroupStats[]
  managers: Array<{ key: string; count: number }>
  /** most used frameworks first; at most `stackLimit`, the rest folded into "other" */
  stack: Array<{ name: string; count: number; other?: boolean }>
  problems: Repository[]
}

export function computeDashboard(workspace: Workspace, stackLimit = 8): DashboardData {
  const byId = new Map(workspace.repositories.map((repo) => [repo.id, repo]))
  const groups: GroupStats[] = workspace.groups.map((group, index) => {
    const repos = group.repositoryIds.map((id) => byId.get(id)).filter((repo): repo is Repository => !!repo)
    const readiness: Record<Readiness, number> = { ready: 0, noSequence: 0, skipped: 0, problem: 0 }
    for (const repo of repos) readiness[readinessOf(repo, group)]++
    const schedule = scheduleOf(group)
    return {
      group, index, color: seriesColor(index), repos, readiness, schedule, scheduled: isScheduleActive(schedule),
      scripts: repos.reduce((n, repo) => n + (repo.scripts?.length ?? 0), 0),
      dependencies: repos.reduce((n, repo) => n + (repo.dependencies ?? 0), 0),
      devDependencies: repos.reduce((n, repo) => n + (repo.devDependencies ?? 0), 0),
    }
  })

  const managers = MANAGERS.map((key) => ({ key, count: workspace.repositories.filter((repo) => (repo.packageManager || "") === key).length })).filter((m) => m.count > 0)

  const stackCounts = new Map<string, number>()
  for (const repo of workspace.repositories) for (const name of repo.stack ?? []) stackCounts.set(name, (stackCounts.get(name) ?? 0) + 1)
  const sorted = [...stackCounts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  const stack = sorted.length > stackLimit
    ? [...sorted.slice(0, stackLimit - 1), { name: "", count: sorted.slice(stackLimit - 1).reduce((n, s) => n + s.count, 0), other: true }]
    : sorted

  const problems = workspace.repositories.filter((repo) => repo.problem)
  return {
    totals: {
      repositories: workspace.repositories.length,
      groups: workspace.groups.length,
      scripts: groups.reduce((n, g) => n + g.scripts, 0),
      ready: groups.reduce((n, g) => n + g.readiness.ready, 0),
      scheduled: groups.filter((g) => g.scheduled).length,
      problems: problems.length,
    },
    groups, managers, stack, problems,
  }
}

/** Minutes of the day a schedule keeps a group running, as [from, to) spans (overnight wraps). */
export function runningSpans(schedule: GroupSchedule): Array<[number, number]> {
  const minutes = (clock: string) => {
    const [h, m] = clock.split(":").map(Number)
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null
  }
  const start = schedule.startEnabled ? minutes(schedule.startAt) : null
  const stop = schedule.stopEnabled ? minutes(schedule.stopAt) : null
  if (start === null && stop === null) return []
  if (start !== null && stop !== null && stop < start) return [[start, 1440], [0, stop]]
  return [[start ?? 0, stop ?? 1440]]
}

export type NodeLine = { major: number; count: number; eol: boolean; versions: string[] }

/**
 * Repositories per Node.js release line (newest first; major 0 = no Node.js
 * found) and the repositories whose version needs a look.
 */
export function nodeSummary(repositories: Repository[], statuses: Map<string, NodeStatus>) {
  const lines = new Map<number, NodeLine>()
  const attention: Array<{ repo: Repository; status: NodeStatus }> = []
  for (const repo of repositories) {
    const status = statuses.get(repo.id)
    if (!status) continue
    const major = Number(status.version.split(".")[0]) || 0
    const line = lines.get(major) ?? { major, count: 0, eol: status.eol, versions: [] }
    line.count++
    if (status.version && !line.versions.includes(status.version)) line.versions.push(status.version)
    lines.set(major, line)
    if (status.eol || status.missing || status.enginesMismatch || !status.version) attention.push({ repo, status })
  }
  return { lines: [...lines.values()].sort((a, b) => b.major - a.major), attention }
}
