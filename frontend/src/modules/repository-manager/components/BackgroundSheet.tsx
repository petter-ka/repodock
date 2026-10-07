import { Layers } from "lucide-react"
import { useEffect, useMemo } from "react"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useI18n } from "@/lib/i18n"
import { displayName, type Repository, type Run } from "../domain"
import type { RepositoryActions } from "../hooks/useRepositoryActions"
import { useProcessVersion } from "../hooks/useStores"
import { processStore } from "../store/processStore"
import { ConsoleView } from "./ConsoleView"
import { ProcessStrip } from "./ProcessStrip"

/**
 * Runs started from quick command chips, with their own process strip and
 * console. Closing the drawer leaves the processes running.
 */
export function BackgroundSheet({ repo, open, runs, selectedRunId, onSelectRun, actions, onOpenChange }: {
  repo: Repository
  open: boolean
  /** this repository's background runs, oldest first */
  runs: Run[]
  selectedRunId: string | null
  onSelectRun: (runId: string | null) => void
  actions: RepositoryActions
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()
  const version = useProcessVersion()
  const snapshots = useMemo(() => {
    void version
    return new Map(runs.flatMap((run) => {
      const snapshot = processStore.snapshot(run.id)
      return snapshot ? [[run.id, snapshot] as const] : []
    }))
  }, [version, runs])

  // Always show one run: the selected one, else the newest.
  const shown = runs.some((run) => run.id === selectedRunId) ? selectedRunId : runs.at(-1)?.id ?? null
  useEffect(() => {
    if (shown !== selectedRunId) onSelectRun(shown)
  }, [shown, selectedRunId, onSelectRun])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent closeLabel={t.common.close} className="max-w-3xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><Layers className="size-4" /> {t.quick.backgroundTitle} · {displayName(repo)}</SheetTitle>
          <SheetDescription>{t.quick.backgroundHint}</SheetDescription>
        </SheetHeader>
        {runs.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">{t.quick.backgroundEmpty}</p>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <ProcessStrip
              runs={runs}
              snapshots={snapshots}
              selectedRunId={shown}
              onSelectRun={(id) => onSelectRun(id)}
              onStop={(id) => void actions.stop(id)}
              onRestart={(id) => {
                const quickId = processStore.quickCommandOf(id)
                void actions.restart(id).then((run) => {
                  if (!run) return
                  if (quickId) processStore.markBackground(run.id, quickId)
                  onSelectRun(run.id)
                })
              }}
              onDismiss={(id) => processStore.dismissRun(id)}
              onClearFinished={() => runs.forEach((run) => processStore.dismissRun(run.id))}
            />
            <ConsoleView repositoryId={repo.id} runs={runs} selectedRunId={shown} onSelectRun={onSelectRun} runsOnly />
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
