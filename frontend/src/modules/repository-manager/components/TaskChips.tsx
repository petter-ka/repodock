import { ChevronDown, ChevronRight, Loader2, Workflow } from "lucide-react"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Tooltip } from "@/components/ui/tooltip"
import { useI18n } from "@/lib/i18n"
import { readPreference, writePreference } from "@/lib/preferences"
import { cn } from "@/lib/utils"
import type { MonorepoTask, Repository } from "../domain"

const EXPANDED_KEY = "tasks.expanded"

export const TOOL_NAMES: Record<string, string> = { turbo: "Turborepo", nx: "Nx", lerna: "Lerna", rush: "Rush" }

/** The shell command a task chip runs, for its tooltip (the backend builds the real argv). */
function taskCommand(repo: Repository, task: MonorepoTask) {
  const exec = ({ pnpm: "pnpm exec", yarn: "yarn", bun: "bun x" } as Record<string, string>)[repo.packageManager] ?? "npm exec --"
  return `${exec} ${task.tool === "nx" ? `nx run-many -t ${task.name}` : `turbo run ${task.name}`}`
}

/**
 * Turborepo tasks and Nx targets of a monorepo, one chip each; a click runs
 * it through the package manager (ADR-0032). Hidden when there are none.
 */
export function TaskChips({ repo, runningLabels, onRun }: { repo: Repository; runningLabels: Set<string>; onRun: (task: MonorepoTask) => void }) {
  const { t, f } = useI18n()
  const [expanded, setExpanded] = useState(() => readPreference(EXPANDED_KEY) !== "false")
  const tasks = repo.monorepo.tasks ?? []
  if (tasks.length === 0) return null
  const tools = [...new Set(tasks.map((task) => task.tool))]
  const labelOf = (task: MonorepoTask) => `${task.tool} ${task.name}`
  const runningCount = tasks.filter((task) => runningLabels.has(labelOf(task))).length
  const toggle = () => setExpanded((open) => {
    writePreference(EXPANDED_KEY, String(!open))
    return !open
  })

  return (
    <section aria-label={t.tasks.title} className="px-6 pt-3">
      <button
        aria-expanded={expanded}
        aria-controls="task-chips"
        onClick={toggle}
        className={cn("-ml-1 flex items-center gap-1.5 rounded-md px-1 py-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", expanded && "mb-2")}
      >
        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <h2 className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em]">{t.tasks.title}</h2>
        <span className="text-[0.6875rem]">{tools.map((tool) => TOOL_NAMES[tool] ?? tool).join(" · ")}</span>
        <Badge className="tabular-nums">{tasks.length}</Badge>
        {!expanded && runningCount > 0 && (
          <Badge variant="success" className="gap-1 tabular-nums"><Loader2 className="size-3 animate-spin" />{f(t.scripts.runningCount, { count: runningCount })}</Badge>
        )}
      </button>
      {expanded && (
        <div id="task-chips" className="flex flex-wrap gap-1.5">
          {repo.monorepo.root && (
            <p className="mb-1 w-full text-[0.6875rem] text-muted-foreground" title={repo.monorepo.root}>
              {f(t.tasks.scoped, { root: repo.monorepo.root.split(/[\\/]/).filter(Boolean).pop() ?? repo.monorepo.root })}
            </p>
          )}
          {tasks.map((task) => {
            const running = runningLabels.has(labelOf(task))
            return (
              <Tooltip key={labelOf(task)} label={<span className="font-mono">{taskCommand(repo, task)}</span>}>
                <button
                  onClick={() => onRun(task)}
                  aria-label={f(t.tasks.run, { name: task.name, tool: TOOL_NAMES[task.tool] ?? task.tool })}
                  className={cn(
                    "group/chip inline-flex max-w-[320px] items-center gap-1.5 rounded-full border px-3 py-1 text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
                    running ? "border-success/50 bg-success/10 text-foreground" : "border-border bg-card hover:border-primary/50 hover:bg-accent",
                  )}
                >
                  {running ? (
                    <Loader2 className="size-3 shrink-0 animate-spin text-success" aria-label={t.scripts.runningHint} />
                  ) : (
                    <Workflow className="size-3 shrink-0 text-muted-foreground group-hover/chip:text-primary" />
                  )}
                  <span className="truncate font-semibold">{task.name}</span>
                  {tools.length > 1 && <span className="text-[0.6875rem] text-muted-foreground">{task.tool}</span>}
                </button>
              </Tooltip>
            )
          })}
        </div>
      )}
    </section>
  )
}
