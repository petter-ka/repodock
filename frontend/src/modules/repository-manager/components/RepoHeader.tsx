import { AlertTriangle, Boxes, Copy, FileKey2, FolderOpen, FolderSearch, ListOrdered, RefreshCcw, Square } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"
import { useI18n } from "@/lib/i18n"
import { useNotifications } from "@/state/notifications"
import { formatTime } from "@/lib/utils"
import { displayName, type Repository } from "../domain"
import type { RepositoryActions } from "../hooks/useRepositoryActions"
import { NodeVersionMenu } from "./NodeVersionMenu"
import { TOOL_NAMES } from "./TaskChips"

export function RepoHeader({ repo, actions, running, onRefresh, onSequence, onEnvironment, onStopAll, onRelocate }: {
  repo: Repository
  actions: RepositoryActions
  running: number
  onRefresh: () => void
  onSequence: () => void
  onEnvironment: () => void
  onStopAll: () => void
  onRelocate: () => void
}) {
  const { t, f } = useI18n()
  const { notify } = useNotifications()
  const copyPath = () => {
    void navigator.clipboard?.writeText(repo.path).then(() => notify(t.header.copied, { tone: "success", duration: 1500 }))
  }
  const enabledSteps = (repo.commandSequence ?? []).filter((step) => step.enabled).length
  const tools = repo.monorepo.tools ?? []
  const rootName = repo.monorepo.root.split(/[\\/]/).filter(Boolean).pop() ?? ""

  return (
    <header className="border-b border-border px-6 pb-4 pt-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight">{displayName(repo)}</h1>
            {repo.alias && repo.alias !== repo.name && <span className="shrink-0 truncate text-sm text-muted-foreground" title={t.header.discoveredName}>{repo.name}</span>}
            <Badge title={repo.packageManagerVersion ? f(t.header.pinnedManager, { name: repo.packageManager, version: repo.packageManagerVersion }) : undefined}>
              {repo.packageManager || t.header.plainFolder}
              {repo.packageManagerVersion && <span className="tabular-nums opacity-70">{repo.packageManagerVersion}</span>}
            </Badge>
            {tools.map((tool) => <Badge key={tool} variant="info">{TOOL_NAMES[tool] ?? tool}</Badge>)}
            {repo.monorepo.workspaces && <Badge variant="outline" title={t.header.workspacesHint}><Boxes className="size-3" /> {t.header.workspaces}</Badge>}
            {repo.monorepo.root && (
              <Badge variant="outline" title={f(t.header.memberHint, { root: repo.monorepo.root })}><Boxes className="size-3" /> {f(t.header.member, { root: rootName })}</Badge>
            )}
            <NodeVersionMenu repo={repo} actions={actions} />
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
          <div className="min-w-0 flex-1">
            <div className="font-medium">{t.header.problemTitle}</div>
            <div className="break-words text-muted-foreground">{repo.problem} — {t.header.problemHint}</div>
          </div>
          <Button size="xs" variant="outline" className="shrink-0" onClick={onRelocate}><FolderSearch /> {t.relocate.action}</Button>
        </div>
      )}
    </header>
  )
}
