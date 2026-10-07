import { AlertTriangle, CheckCircle2, ChevronRight, CircleDot, CircleSlash, Clock, Loader2, Pencil, Play, Square, XCircle } from "lucide-react"
import { Fragment, useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { CommandStep, Repository, SequenceRun, StepStatus } from "../domain"
import { useWorkspaceState } from "../hooks/useStores"

const stepIcon: Partial<Record<StepStatus, React.ReactNode>> = {
  pending: <Clock className="size-3 shrink-0 text-muted-foreground" />,
  running: <Loader2 className="size-3 shrink-0 animate-spin text-primary" />,
  started: <CircleDot className="size-3 shrink-0 text-success" />,
  completed: <CheckCircle2 className="size-3 shrink-0 text-success" />,
  failed: <XCircle className="size-3 shrink-0 text-destructive" />,
  skipped: <CircleSlash className="size-3 shrink-0 text-muted-foreground" />,
  cancelled: <CircleSlash className="size-3 shrink-0 text-muted-foreground" />,
}

/**
 * The repository's enabled sequence steps on one line, in run order, with
 * the latest sequence run's per-step status. A chip runs that single step;
 * the trailing controls run/cancel the whole sequence or open the editor.
 */
export function SequenceChips({ repo, sequence, runningLabels, onRunScript, onRunCommand, onRunSequence, onCancelSequence, onEdit }: {
  repo: Repository
  sequence: SequenceRun | undefined
  runningLabels: Set<string>
  onRunScript: (script: string) => void
  onRunCommand: (command: string, label: string) => void
  onRunSequence: () => void
  onCancelSequence: (sequenceId: string) => void
  onEdit: () => void
}) {
  const { t, f } = useI18n()
  const { workspace } = useWorkspaceState()
  const steps = (repo.commandSequence ?? []).filter((step) => step.enabled)
  const scriptNames = useMemo(() => new Set(repo.scripts.map((s) => s.name)), [repo.scripts])
  const globalById = useMemo(() => new Map(workspace.globalCommands.map((g) => [g.id, g])), [workspace.globalCommands])
  const stepState = useMemo(() => new Map(sequence?.steps.map((s) => [s.stepId, s]) ?? []), [sequence])
  const running = sequence?.status === "running"

  /** What a single click runs, or why it cannot run. */
  const resolve = (step: CommandStep): { run?: () => void; text: string; problem?: string } => {
    if (step.script) {
      if (!scriptNames.has(step.script)) return { text: step.script, problem: t.sequence.scriptMissing }
      return { run: () => onRunScript(step.script), text: repo.scripts.find((s) => s.name === step.script)?.command ?? step.script }
    }
    if (step.globalCommand) {
      const global = globalById.get(step.globalCommand)
      if (!global) return { text: "", problem: t.sequence.globalMissing }
      return { run: () => onRunCommand(global.command, step.label || global.name), text: global.command }
    }
    if (step.command.trim()) return { run: () => onRunCommand(step.command, step.label || step.command), text: step.command }
    return { text: t.sequence.noop }
  }

  return (
    <section aria-label={t.sequence.title} className="flex items-start gap-2 px-6 pt-3">
      <h2 className="flex h-6 shrink-0 items-center text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t.quickSequence.title}</h2>
      <ol className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {steps.length === 0 && (
          <li>
            <button onClick={onEdit} className="h-6 rounded-md px-1 text-xs text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring">
              {t.quickSequence.empty}
            </button>
          </li>
        )}
        {steps.map((step, index) => {
          const { run, text, problem } = resolve(step)
          const state = stepState.get(step.id)?.status
          const live = runningLabels.has(step.label)
          const icon = state ? stepIcon[state] : live ? stepIcon.running : null
          const name = step.label || step.script || text
          return (
            <Fragment key={step.id}>
              {index > 0 && <ChevronRight aria-hidden className="size-3 shrink-0 text-muted-foreground/50" />}
              <li>
                <Tooltip label={
                  <span className="flex flex-col gap-0.5">
                    {text && <span className="font-mono">{text}</span>}
                    {problem && <span className="text-warning">{problem}</span>}
                    {step.background && <span className="text-muted-foreground">{t.sequence.background}</span>}
                    {state && <span className="text-muted-foreground">{t.sequence.status[state]}</span>}
                  </span>
                }>
                  <button
                    disabled={!run}
                    onClick={run}
                    aria-label={run ? f(t.quickSequence.runStep, { name }) : name}
                    className={cn(
                      "group/chip inline-flex h-6 max-w-[220px] items-center gap-1.5 rounded-full border px-2.5 text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
                      state === "failed" ? "border-destructive/50 bg-destructive/10"
                        : state === "running" || live ? "border-primary/50 bg-primary/10"
                          : "border-border bg-card enabled:hover:border-primary/50 enabled:hover:bg-accent",
                      !run && !problem && "border-dashed text-muted-foreground",
                    )}
                  >
                    {problem ? <AlertTriangle className="size-3 shrink-0 text-warning" />
                      : icon ?? <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground group-hover/chip:hidden">{index + 1}</span>}
                    {!problem && !icon && run && <Play className="hidden size-3 shrink-0 text-primary group-hover/chip:block" />}
                    <span className="truncate font-medium">{name}</span>
                    {step.background && <span className="shrink-0 text-[9px] uppercase tracking-wide text-muted-foreground">bg</span>}
                  </button>
                </Tooltip>
              </li>
            </Fragment>
          )
        })}
      </ol>
      <div className="flex shrink-0 items-center gap-1">
        {sequence && !running && sequence.status !== "completed" && (
          <Badge variant={sequence.status === "failed" ? "destructive" : "outline"}>{t.sequence.sequenceStatus[sequence.status]}</Badge>
        )}
        {running && sequence ? (
          <Tooltip label={t.sequence.cancelRun}>
            <Button size="icon-sm" variant="ghost" aria-label={t.sequence.cancelRun} onClick={() => onCancelSequence(sequence.id)} className="text-destructive hover:text-destructive"><Square /></Button>
          </Tooltip>
        ) : (
          <Tooltip label={t.sequence.run}>
            <Button size="icon-sm" variant="ghost" aria-label={t.sequence.run} disabled={steps.length === 0} onClick={onRunSequence} className="text-muted-foreground hover:text-success"><Play /></Button>
          </Tooltip>
        )}
        <Tooltip label={t.quickSequence.edit}>
          <Button size="icon-sm" variant="ghost" aria-label={t.quickSequence.edit} onClick={onEdit} className="text-muted-foreground"><Pencil /></Button>
        </Tooltip>
      </div>
    </section>
  )
}
