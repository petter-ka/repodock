import { AlertTriangle, ArrowDownUp, CheckCircle2, ChevronDown, CircleDot, XCircle, FolderSearch, Download, Globe, Upload, Clock, Columns3, ListOrdered, Loader2, Play, Square, ChevronRight, FolderGit2, FolderInput, LayoutGrid, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react"
import { forwardRef, useMemo, useState } from "react"
import { ConfirmDialog } from "@/components/shared/ConfirmDialog"
import { PromptDialog } from "@/components/shared/PromptDialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip } from "@/components/ui/tooltip"
import { useI18n } from "@/lib/i18n"
import { modLabel } from "@/lib/keyboard"
import { cn, formatTime } from "@/lib/utils"
import { type Group, type GroupRepoState, type GroupRunMode, type ImportPreview, type Repository } from "../domain"
import type { RepositoryActions } from "../hooks/useRepositoryActions"
import { useProcessVersion, useWorkspaceState } from "../hooks/useStores"
import { processStore } from "../store/processStore"
import { workspaceStore } from "../store/workspaceStore"
import { latestRunHealth, type RepoHealth } from "../repoStatus"
import { GlobalCommandsDialog } from "./GlobalCommandsDialog"
import { ImportDialog } from "./ImportDialog"

type DialogState =
  | { kind: "createGroup" }
  | { kind: "renameGroup"; group: Group }
  | { kind: "deleteGroup"; group: Group }
  | { kind: "removeRepo"; repo: Repository }
  | null

export const RepoSidebar = forwardRef<HTMLInputElement, { actions: RepositoryActions }>(function RepoSidebar({ actions }, filterRef) {
  const { t, f } = useI18n()
  const { workspace, selectedRepoId } = useWorkspaceState()
  const version = useProcessVersion()
  const [query, setQuery] = useState("")
  const [dialog, setDialog] = useState<DialogState>(null)
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [globalsOpen, setGlobalsOpen] = useState(false)

  const { running, latest } = useMemo(() => {
    void version
    const running = new Map<string, number>()
    const latest = new Map<string, ReturnType<typeof latestRunHealth>>()
    for (const repo of workspace.repositories) {
      running.set(repo.id, processStore.activeCount(repo.id))
      latest.set(repo.id, latestRunHealth(processStore.runsFor(repo.id)))
    }
    return { running, latest }
  }, [version, workspace.repositories])

  const totalRunning = [...running.values()].reduce((sum, n) => sum + n, 0)
  const byId = useMemo(() => new Map(workspace.repositories.map((repo) => [repo.id, repo])), [workspace.repositories])
  const needle = query.trim().toLowerCase()
  const matches = (repo: Repository) => !needle || `${repo.name} ${repo.path}`.toLowerCase().includes(needle)
  const anyMatch = workspace.repositories.some(matches)

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="border-b border-border px-4 pb-3 pt-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">{t.rail.repos}</h2>
            <p className="text-xs text-muted-foreground">{f(t.sidebar.count, { count: workspace.repositories.length })}</p>
          </div>
          <div className="flex items-center gap-1.5">
          <DropdownMenu>
            <Tooltip label={t.transfer.menu}>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" aria-label={t.transfer.menu} className="text-muted-foreground"><ArrowDownUp /></Button>
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void actions.previewImport().then((preview) => preview && setImportPreview(preview))}><Upload /> {t.transfer.import}</DropdownMenuItem>
              <DropdownMenuItem disabled={workspace.repositories.length === 0 && workspace.globalCommands.length === 0} onSelect={() => void actions.exportWorkspace()}><Download /> {t.transfer.exportAll}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setGlobalsOpen(true)}><Globe /> {t.globalCommands.menu}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip label={<span className="flex items-center gap-1.5">{t.sidebar.add} <Kbd>{modLabel}</Kbd><Kbd>O</Kbd></span>}>
            <Button size="icon" variant="outline" aria-label={t.sidebar.add} onClick={() => void actions.addRepository(workspace.groups[0]?.id)}>
              <Plus />
            </Button>
          </Tooltip>
          </div>
        </div>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={filterRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") setQuery("") }}
            placeholder={t.sidebar.filter}
            aria-label={t.sidebar.filter}
            className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      <nav aria-label={t.rail.repos} className="thin-scrollbar flex-1 overflow-y-auto px-2 py-3">
        <button
          aria-current={selectedRepoId === null ? "page" : undefined}
          onClick={() => workspaceStore.select(null)}
          className={cn("mb-3 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-ring", selectedRepoId === null ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")}
        >
          <LayoutGrid className="size-4 shrink-0" />
          <span className="flex-1">{t.console.allRepos}</span>
          {totalRunning > 0 && <Badge variant="success" className="tabular-nums">{totalRunning}</Badge>}
        </button>
        {needle && !anyMatch && <p className="px-3 py-2 text-xs text-muted-foreground">{t.sidebar.noMatches}</p>}
        {workspace.groups.map((group) => {
          const repos = group.repositoryIds.map((id) => byId.get(id)).filter((repo): repo is Repository => !!repo)
          const visible = repos.filter(matches)
          if (needle && visible.length === 0) return null
          const collapsed = group.collapsed && !needle
          const groupRun = processStore.groupRun(group.id)
          const groupRunning = groupRun?.status === "running"
          const memberState = new Map<string, GroupRepoState>(groupRunning ? groupRun.repos.map((r) => [r.repositoryId, r]) : [])
          const runnable = groupRun?.repos.filter((r) => r.status !== "skipped") ?? []
          const finished = runnable.filter((r) => r.status !== "pending" && r.status !== "running").length
          const modeLabel = group.runMode === "parallel" ? t.groupRun.parallel : t.groupRun.sequential
          // Background steps (dev servers) outlive the group run, so the
          // stop control stays available while any member has processes.
          const groupActive = groupRunning || repos.some((repo) => (running.get(repo.id) ?? 0) > 0)
          return (
            <section key={group.id} className="mb-3">
              <div className="group/header flex items-center gap-1 pl-1 pr-1">
                <button
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  aria-expanded={!collapsed}
                  onClick={() => void actions.setGroupCollapsed(group.id, !group.collapsed)}
                >
                  {collapsed ? <ChevronRight className="size-3.5 shrink-0" /> : <ChevronDown className="size-3.5 shrink-0" />}
                  <span className="truncate">{group.name}</span>
                  <span className="ml-1 font-normal tabular-nums opacity-70">{repos.length}</span>
                </button>
                {groupRunning && (
                  <span className="flex items-center gap-1 text-[10px] tabular-nums text-success" aria-live="polite">
                    <Loader2 className="size-3 animate-spin" />
                    {f(t.groupRun.progress, { done: finished, total: runnable.length })}
                  </span>
                )}
                {repos.length > 0 && (groupActive ? (
                  <Tooltip label={t.groupRun.stop}>
                    <Button size="icon-sm" variant="ghost" aria-label={t.groupRun.stop} onClick={() => void actions.stopGroup(group.id)} className="text-destructive hover:text-destructive">
                      <Square />
                    </Button>
                  </Tooltip>
                ) : (
                  <Tooltip label={f(t.groupRun.runWithMode, { mode: modeLabel })}>
                    <Button size="icon-sm" variant="ghost" aria-label={t.groupRun.run} onClick={() => void actions.runGroup(group.id)} className="text-muted-foreground opacity-0 hover:text-success group-hover/header:opacity-100 focus-visible:opacity-100">
                      <Play />
                    </Button>
                  </Tooltip>
                ))}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon-sm" variant="ghost" aria-label={t.sidebar.groupActions} className="text-muted-foreground opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100">
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-72">
                    {groupActive ? (
                      <DropdownMenuItem destructive onSelect={() => void actions.stopGroup(group.id)}><Square /> {t.groupRun.stop}</DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem disabled={repos.length === 0} onSelect={() => void actions.runGroup(group.id)}><Play /> {f(t.groupRun.runWithMode, { mode: modeLabel })}</DropdownMenuItem>
                    )}
                    <DropdownMenuLabel>{t.groupRun.mode}</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={group.runMode} onValueChange={(mode) => void actions.setGroupRunMode(group.id, mode as GroupRunMode)}>
                      <DropdownMenuRadioItem value="sequential" disabled={groupRunning} className="items-start">
                        <div>
                          <div className="flex items-center gap-1.5"><ListOrdered className="size-3.5" /> {t.groupRun.sequential}</div>
                          <div className="text-[11px] text-muted-foreground">{t.groupRun.sequentialHint}</div>
                        </div>
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="parallel" disabled={groupRunning} className="items-start">
                        <div>
                          <div className="flex items-center gap-1.5"><Columns3 className="size-3.5" /> {t.groupRun.parallel}</div>
                          <div className="text-[11px] text-muted-foreground">{t.groupRun.parallelHint}</div>
                        </div>
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void actions.addRepository(group.id)}><Plus /> {t.sidebar.addHere}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setDialog({ kind: "renameGroup", group })}><Pencil /> {t.sidebar.renameGroup}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void actions.exportWorkspace([group.id])}><Download /> {t.transfer.exportGroup}</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive disabled={workspace.groups.length < 2} onSelect={() => setDialog({ kind: "deleteGroup", group })}><Trash2 /> {t.sidebar.deleteGroup}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {!collapsed && (
                <ul className="mt-0.5 space-y-0.5">
                  {visible.map((repo) => (
                    <RepoItem
                      key={repo.id}
                      repo={repo}
                      groups={workspace.groups}
                      selected={repo.id === selectedRepoId}
                      running={running.get(repo.id) ?? 0}
                      latest={latest.get(repo.id) ?? null}
                      groupState={memberState.get(repo.id)}
                      actions={actions}
                      onRemove={() => setDialog({ kind: "removeRepo", repo })}
                    />
                  ))}
                  {repos.length === 0 && <li className="px-7 py-1.5 text-xs text-muted-foreground">{t.sidebar.emptyGroup}</li>}
                </ul>
              )}
            </section>
          )
        })}
        <button
          onClick={() => setDialog({ kind: "createGroup" })}
          className="mt-1 flex w-full items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-4" /> {t.sidebar.newGroup}
        </button>
      </nav>

      <ImportDialog preview={importPreview} actions={actions} onClose={() => setImportPreview(null)} />
      <GlobalCommandsDialog open={globalsOpen} actions={actions} onOpenChange={setGlobalsOpen} />
      <PromptDialog
        open={dialog?.kind === "createGroup" || dialog?.kind === "renameGroup"}
        title={dialog?.kind === "renameGroup" ? t.groupDialog.renameTitle : t.groupDialog.createTitle}
        label={t.common.name}
        placeholder={t.groupDialog.placeholder}
        initialValue={dialog?.kind === "renameGroup" ? dialog.group.name : ""}
        submitLabel={dialog?.kind === "renameGroup" ? t.common.rename : t.common.create}
        onOpenChange={(open) => { if (!open) setDialog(null) }}
        onSubmit={async (name) => {
          if (dialog?.kind === "renameGroup") await actions.renameGroup(dialog.group.id, name)
          else await actions.createGroup(name)
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === "deleteGroup"}
        destructive
        title={dialog?.kind === "deleteGroup" ? f(t.confirm.deleteGroupTitle, { name: dialog.group.name }) : ""}
        description={dialog?.kind === "deleteGroup" ? f(t.confirm.deleteGroupBody, { target: workspace.groups.find((g) => g.id !== dialog.group.id)?.name ?? "" }) : ""}
        confirmLabel={t.common.delete}
        onOpenChange={(open) => { if (!open) setDialog(null) }}
        onConfirm={async () => { if (dialog?.kind === "deleteGroup") await actions.deleteGroup(dialog.group.id) }}
      />
      <ConfirmDialog
        open={dialog?.kind === "removeRepo"}
        destructive
        title={dialog?.kind === "removeRepo" ? f(t.confirm.removeRepoTitle, { name: dialog.repo.name }) : ""}
        description={t.confirm.removeRepoBody}
        confirmLabel={t.common.remove}
        onOpenChange={(open) => { if (!open) setDialog(null) }}
        onConfirm={async () => { if (dialog?.kind === "removeRepo") await actions.remove(dialog.repo) }}
      />
    </aside>
  )
})

const healthIcon: Record<RepoHealth, React.ReactNode> = {
  running: <CircleDot className="size-4 animate-pulse text-success" />,
  success: <CheckCircle2 className="size-4 text-success" />,
  danger: <XCircle className="size-4 text-destructive" />,
}

function RepoItem({ repo, groups, selected, running, latest, groupState, actions, onRemove }: {
  repo: Repository
  groups: Group[]
  selected: boolean
  running: number
  /** latest command of this repository and its health */
  latest: ReturnType<typeof latestRunHealth>
  /** this repository's state in a running group run */
  groupState?: GroupRepoState
  actions: RepositoryActions
  onRemove: () => void
}) {
  const { t, f } = useI18n()
  const lastRunText = !latest
    ? ""
    : latest.health === "running"
      ? f(t.sidebar.runningSince, { count: running, label: latest.run.label, time: formatTime(latest.run.startedAt) })
      : f(t.sidebar.lastRunExit, {
          label: latest.run.label,
          status: t.process.status[latest.run.status],
          code: latest.run.exitCode,
          time: formatTime(latest.run.startedAt),
        })
  return (
    <li className={cn("group/item relative flex items-center rounded-lg transition", selected ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground")}>
      <button
        aria-current={selected ? "page" : undefined}
        onClick={() => workspaceStore.select(repo.id)}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-2 pl-3 pr-9 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={latest ? `${repo.path}\n${lastRunText}` : repo.path}
      >
        {latest ? (
          <span className="shrink-0" role="img" aria-label={lastRunText}>{healthIcon[latest.health]}</span>
        ) : (
          <FolderGit2 className="size-4 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">{repo.name}</span>
        {groupState?.status === "pending" ? (
          <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-label={t.groupRun.queued} />
        ) : groupState?.status === "failed" ? (
          <AlertTriangle className="size-3.5 shrink-0 text-destructive" aria-label={`${t.groupRun.failedIn}: ${groupState.error}`} />
        ) : repo.problem ? (
          <AlertTriangle className="size-3.5 shrink-0 text-warning" aria-label={t.sidebar.problem} />
        ) : running > 0 ? (
          <Badge variant="success" className="tabular-nums">{running}</Badge>
        ) : (
          <span className="text-[10px] uppercase tracking-wide opacity-60">{repo.packageManager}</span>
        )}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={t.sidebar.repoActions} className="absolute right-1 text-muted-foreground opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right">
          <DropdownMenuLabel className="max-w-56 truncate normal-case tracking-normal">{repo.name}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => void actions.refresh(repo)}><RefreshCw /> {t.common.refresh}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void actions.relocate(repo)}><FolderSearch /> {t.relocate.action}</DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={groups.length < 2}><FolderInput /> {t.sidebar.moveTo}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {groups.map((group) => (
                <DropdownMenuItem key={group.id} disabled={group.id === repo.groupId} onSelect={() => void actions.assign(repo.id, group.id)}>
                  {group.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={onRemove}><Trash2 /> {t.common.remove}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}
