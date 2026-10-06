import { AlertTriangle, Copy, FileKey2, FolderOpen, ListOrdered, RefreshCcw, Square } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"
import { useI18n } from "@/lib/i18n"
import { useNotifications } from "@/state/notifications"
import { formatTime } from "@/lib/utils"
import type { Repository } from "../domain"

export function RepoHeader({ repo, running, onRefresh, onSequence, onEnvironment, onStopAll }: {
  repo: Repository
  running: number
  onRefresh: () => void
  onSequence: () => void
  onEnvironment: () => void
  onStopAll: () => void
}) {
  const { t, f } = useI18n()
  const { notify } = useNotifications()
  const copyPath = () => {
    void navigator.clipboard?.writeText(repo.path).then(() => notify(t.header.copied, { tone: "success", duration: 1500 }))
  }
  const enabledSteps = (repo.commandSequence ?? []).filter((step) => step.enabled).length

  return (
    <header className="border-b border-border px-6 pb-4 pt-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight">{repo.name}</h1>
            <Badge>{repo.packageManager}</Badge>
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <FolderOpen className="size-3.5 shrink-0" />
            <span className="truncate font-mono">{repo.path}</span>
            <Tooltip label={t.header.copyPath}>
              <button aria-label={t.header.copyPath} onClick={copyPath} className="rounded p-0.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                <Copy className="size-3" />
              </button>
            </Tooltip>
            <span aria-hidden>·</span>
            <span className="shrink-0">{f(t.header.refreshed, { time: formatTime(repo.lastRefreshedAt) })}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {running > 0 && (
            <Button variant="outline" size="sm" onClick={onStopAll} className="text-destructive hover:text-destructive">
              <Square /> {t.header.stopAll}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onRefresh}><RefreshCcw /> {t.common.refresh}</Button>
          <Button variant="outline" size="sm" onClick={onSequence}>
            <ListOrdered /> {t.header.sequence}
            {enabledSteps > 0 && <Badge variant="info" className="tabular-nums">{enabledSteps}</Badge>}
          </Button>
          <Button variant="outline" size="sm" onClick={onEnvironment}>
            <FileKey2 /> {t.header.environment}
            {repo.envFiles.length > 0 && <Badge className="tabular-nums">{repo.envFiles.length}</Badge>}
          </Button>
        </div>
      </div>
      {repo.problem && (
        <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <div className="min-w-0">
            <div className="font-medium">{t.header.problemTitle}</div>
            <div className="break-words text-muted-foreground">{repo.problem} — {t.header.problemHint}</div>
          </div>
        </div>
      )}
    </header>
  )
}
