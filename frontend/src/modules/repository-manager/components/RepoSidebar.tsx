import { AlarmClock, AlarmClockOff, AlertTriangle, Infinity as InfinityIcon, ArrowDown, ListChecks, SkipForward, ArrowDownUp, ArrowUp, CheckCircle2, ChevronDown, CircleDot, CircleStop, XCircle, FolderSearch, Download, Globe, Upload, Clock, Columns3, ListOrdered, Loader2, Play, Square, ChevronRight, Code2, FolderGit2, FolderInput, LayoutGrid, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react"
import { forwardRef, useMemo, useState, type DragEvent } from "react"
import { ConfirmDialog } from "@/components/shared/ConfirmDialog"
import { PromptDialog } from "@/components/shared/PromptDialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip } from "@/components/ui/tooltip"
import { useI18n } from "@/lib/i18n"
import { modLabel } from "@/lib/keyboard"
import { readPreference, writePreference } from "@/lib/preferences"
import { cn, formatTime } from "@/lib/utils"
import { displayName, type Group, type GroupRepoState, type GroupRunMode, type ImportPreview, type Repository } from "../domain"
import type { RepositoryActions } from "../hooks/useRepositoryActions"
import { useProcessVersion, useWorkspaceState } from "../hooks/useStores"
import { processStore } from "../store/processStore"
import { workspaceStore } from "../store/workspaceStore"
import { latestRunHealth, type RepoHealth } from "../repoStatus"
import { isNoopSlot, landingIndex, slotFromPointer } from "../reorder"
import { describeSchedule, isScheduleActive, scheduleOf } from "../schedule"
import { GlobalCommandsDialog } from "./GlobalCommandsDialog"
import { ScheduleDialog } from "./ScheduleDialog"
import { ScheduleMenuItems } from "./ScheduleNext"
import { scheduleStore, useScheduleVersion } from "../store/scheduleStore"
import { ImportDialog } from "./ImportDialog"

type DialogState =
  | { kind: "createGroup" }
  | { kind: "renameGroup"; group: Group }
  | { kind: "deleteGroup"; group: Group }
  | { kind: "removeRepo"; repo: Repository }
  | { kind: "renameRepo"; repo: Repository }
  | null

/** MIME types of in-app drags; other drags (files, text) are ignored. */
const REPO_DRAG_TYPE = "application/x-repodock-repo"
const GROUP_DRAG_TYPE = "application/x-repodock-group"

/** What is being dragged and its index (within its group, or among groups). */
type DragState = { kind: "repo"; repoId: string; groupId: string; from: number } | { kind: "group"; groupId: string; from: number }
/**
 * Insertion slot, counted before the dragged item is removed: within a
 * group's members for a repository, among the groups for a group.
 */
type DropState = { kind: "repo"; groupId: string; slot: number } | { kind: "group"; slot: number }

const WIDTH_KEY = "sidebar.width"
const DEFAULT_WIDTH = 300
const MIN_WIDTH = 220
const MAX_WIDTH = 560
const clampWidth = (width: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)))

export const RepoSidebar = forwardRef<HTMLInputElement, { actions: RepositoryActions }>(function RepoSidebar({ actions }, filterRef) {
  const { t, f, locale } = useI18n()
  const { workspace, selectedRepoId } = useWorkspaceState()
  const version = useProcessVersion()
  const [query, setQuery] = useState("")
  // Groups ticked when the schedule dialog opens; null = closed.
  const [scheduleFor, setScheduleFor] = useState<string[] | null>(null)
  useScheduleVersion()
  const [dialog, setDialog] = useState<DialogState>(null)
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [globalsOpen, setGlobalsOpen] = useState(false)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [drop, setDrop] = useState<DropState | null>(null)
  const [width, setWidth] = useState(() => clampWidth(Number(readPreference(WIDTH_KEY)) || DEFAULT_WIDTH))
  const saveWidth = (next: number) => {
    const value = clampWidth(next)
    setWidth(value)
    writePreference(WIDTH_KEY, String(value))
  }

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
  // Every group has its own schedule; the header button covers them all.
  const scheduledGroups = workspace.groups.filter((g) => isScheduleActive(scheduleOf(g)))
  const scheduleActive = scheduledGroups.length > 0
  const scheduleText = f(t.schedule.scheduledCount, { count: scheduledGroups.length, total: workspace.groups.length })
  const scheduledStatuses = scheduledGroups.flatMap((g) => scheduleStore.status(g.id) ?? [])
  const anyCancelledAll = scheduledStatuses.some((status) => status.startSkipped || status.stopSkipped)
  const allGroupIds = workspace.groups.map((g) => g.id)
  const byId = useMemo(() => new Map(workspace.repositories.map((repo) => [repo.id, repo])), [workspace.repositories])
  const needle = query.trim().toLowerCase()
  const matches = (repo: Repository) => !needle || `${repo.alias} ${repo.name} ${repo.path}`.toLowerCase().includes(needle)
  const anyMatch = workspace.repositories.some(matches)
  // Positions are ambiguous while filtering, so drag-and-drop needs the full list.
  const canDrag = !needle

  const endDrag = () => { setDrag(null); setDrop(null) }
  const moveTo = (groupId: string, slot: number) => {
    if (drag?.kind !== "repo") return
    const from = drag.groupId === groupId ? drag.from : -1
    if (!isNoopSlot(slot, from)) void actions.move(drag.repoId, groupId, landingIndex(slot, from))
  }
  const accept = (event: DragEvent, next: DropState) => {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = "move"
    if (JSON.stringify(drop) !== JSON.stringify(next)) setDrop(next)
  }
  /** Repository drag over a group (slot = members.length appends). Group drags pass through to the section. */
  const overGroup = (event: DragEvent, groupId: string, slot: number) => {
    if (drag?.kind === "repo") accept(event, { kind: "repo", groupId, slot })
  }
  const overSection = (event: DragEvent<HTMLElement>, groupIndex: number, groupId: string, size: number) => {
    if (drag?.kind === "group") accept(event, { kind: "group", slot: slotFromPointer(groupIndex, event.clientY, event.currentTarget.getBoundingClientRect()) })
    else overGroup(event, groupId, size)
  }
  const dropOnSection = (event: DragEvent, groupId: string, size: number) => {
    if (!drag) return
    event.preventDefault()
    if (drag.kind === "group") {
      if (drop?.kind === "group" && !isNoopSlot(drop.slot, drag.from)) void actions.moveGroup(drag.groupId, landingIndex(drop.slot, drag.from))
    } else {
      moveTo(groupId, drop?.kind === "repo" && drop.groupId === groupId ? drop.slot : size)
    }
    endDrag()
  }
  const groupDropSlot = drag?.kind === "group" && drop?.kind === "group" && !isNoopSlot(drop.slot, drag.from) ? drop.slot : null

  return (
    <aside style={{ width }} className="relative flex shrink-0 flex-col border-r border-border bg-sidebar">
      {/* Resize handle on the right edge: drag, ←/→ (Shift = larger steps), double-click resets. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t.sidebar.resize}
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        tabIndex={0}
        title={t.sidebar.resizeHint}
        onPointerDown={(event) => {
          event.preventDefault()
          const handle = event.currentTarget
          handle.setPointerCapture(event.pointerId)
          const startX = event.clientX
          const startWidth = width
          let latest = startWidth
          const move = (e: PointerEvent) => { latest = clampWidth(startWidth + e.clientX - startX); setWidth(latest) }
          const up = () => {
            handle.removeEventListener("pointermove", move)
            handle.removeEventListener("pointerup", up)
            handle.removeEventListener("pointercancel", up)
            saveWidth(latest)
          }
          handle.addEventListener("pointermove", move)
          handle.addEventListener("pointerup", up)
          handle.addEventListener("pointercancel", up)
        }}
        onDoubleClick={() => saveWidth(DEFAULT_WIDTH)}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 64 : 16
          if (event.key === "ArrowLeft") { event.preventDefault(); saveWidth(width - step) }
          if (event.key === "ArrowRight") { event.preventDefault(); saveWidth(width + step) }
          if (event.key === "Home") { event.preventDefault(); saveWidth(DEFAULT_WIDTH) }
        }}
        className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition hover:after:bg-primary/60 focus-visible:after:bg-primary"
      />
      <div className="border-b border-border px-4 pb-3 pt-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">{t.rail.repos}</h2>
            <p className="text-xs text-muted-foreground">{f(t.sidebar.count, { count: workspace.repositories.length })}</p>
          </div>
          <div className="flex items-center gap-1.5">
          {scheduleActive ? (
            <DropdownMenu>
              <Tooltip label={`${t.schedule.button} · ${scheduleText}`}>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" aria-label={`${t.schedule.button}: ${scheduleText}`} className={cn(anyCancelledAll ? "text-warning" : "text-primary")}>
                    {anyCancelledAll ? <AlarmClockOff /> : <AlarmClock />}
                  </Button>
                </DropdownMenuTrigger>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-80">
                <DropdownMenuLabel>{scheduleText}</DropdownMenuLabel>
                <ScheduleMenuItems group={null} statuses={scheduledStatuses} actions={actions} onEdit={() => setScheduleFor(allGroupIds)} editLabel={t.schedule.setSchedule} />
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Tooltip label={t.schedule.button}>
              <Button size="icon" variant="ghost" aria-label={t.schedule.button} className="text-muted-foreground" onClick={() => setScheduleFor(allGroupIds)}><AlarmClock /></Button>
            </Tooltip>
          )}
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

      <nav
        aria-label={t.rail.repos}
        className="thin-scrollbar flex-1 overflow-y-auto px-2 py-3"
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null) }}
      >
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
        {workspace.groups.map((group, groupIndex) => {
          const repos = group.repositoryIds.map((id) => byId.get(id)).filter((repo): repo is Repository => !!repo)
          const visible = repos.filter(matches)
          if (needle && visible.length === 0) return null
          const collapsed = group.collapsed && !needle
          const groupRun = processStore.groupRun(group.id)
          const groupRunning = groupRun?.status === "running"
          const memberState = new Map<string, GroupRepoState>(groupRunning ? groupRun.repos.map((r) => [r.repositoryId, r]) : [])
          // Long-running members (dev servers) never finish, so the counter
          // leaves them out; they show as "up" instead (ADR-0028).
          const members = groupRun?.repos.filter((r) => r.status !== "skipped") ?? []
          const runnable = members.filter((r) => !r.continuous)
          const finished = runnable.filter((r) => r.status !== "pending" && r.status !== "running").length
          const up = members.filter((r) => r.continuous && r.status === "started").length
          const modeLabel = group.runMode === "parallel" ? t.groupRun.parallel : t.groupRun.sequential
          // Background steps (dev servers) outlive the group run, so the
          // stop control stays available while any member has processes.
          const groupActive = groupRunning || repos.some((repo) => (running.get(repo.id) ?? 0) > 0)
          const dropSlot = drag?.kind === "repo" && drop?.kind === "repo" && drop.groupId === group.id && !isNoopSlot(drop.slot, drag.groupId === group.id ? drag.from : -1) ? drop.slot : null
          const lastGroup = groupIndex === workspace.groups.length - 1
          const skipped = new Set(group.skippedRepositoryIds ?? [])
          const groupSchedule = scheduleOf(group)
          const scheduled = isScheduleActive(groupSchedule)
          const groupScheduleText = describeSchedule(groupSchedule, t, locale)
          const scheduleStatus = scheduleStore.status(group.id)
          const anyCancelled = !!scheduleStatus && (scheduleStatus.startSkipped || scheduleStatus.stopSkipped)
          // Dropping a repository anywhere on the section but an item (header,
          // empty list, collapsed group) appends to the group. A group drag
          // over a section inserts above or below it.
          return (
            <section
              key={group.id}
              className={cn("relative mb-3 rounded-md transition", drag?.kind === "group" && drag.groupId === group.id && "opacity-40")}
              onDragOver={(event) => overSection(event, groupIndex, group.id, repos.length)}
              onDrop={(event) => dropOnSection(event, group.id, repos.length)}
            >
              {(groupDropSlot === groupIndex || (lastGroup && groupDropSlot === groupIndex + 1)) && (
                <span aria-hidden className={cn("pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-primary", groupDropSlot === groupIndex ? "-top-1.5" : "-bottom-1.5")} />
              )}
              <div
                draggable={canDrag}
                onDragStart={(event) => {
                  // Repository rows are inside the section; only start a group
                  // drag from the header itself.
                  const section = event.currentTarget.closest("section")
                  if (section) event.dataTransfer.setDragImage(section, event.clientX - section.getBoundingClientRect().left, event.clientY - section.getBoundingClientRect().top)
                  event.dataTransfer.effectAllowed = "move"
                  event.dataTransfer.setData(GROUP_DRAG_TYPE, group.id)
                  setDrag({ kind: "group", groupId: group.id, from: groupIndex })
                }}
                onDragEnd={endDrag}
                title={canDrag ? t.sidebar.dragGroup : undefined}
                className={cn("group/header flex items-center gap-1 rounded-md pl-1 pr-1 transition", canDrag && "cursor-grab active:cursor-grabbing", dropSlot !== null && (collapsed || repos.length === 0) && "bg-primary/10 ring-1 ring-primary/40")}
              >
                <button
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  aria-expanded={!collapsed}
                  onClick={() => void actions.setGroupCollapsed(group.id, !group.collapsed)}
                >
                  {collapsed ? <ChevronRight className="size-3.5 shrink-0" /> : <ChevronDown className="size-3.5 shrink-0" />}
                  <span className="truncate">{group.name}</span>
                  <span className="ml-1 font-normal tabular-nums opacity-70">{repos.length}</span>
                </button>
                {scheduled && (
                  <DropdownMenu>
                    <Tooltip label={groupScheduleText}>
                      <DropdownMenuTrigger asChild>
                        <button
                          aria-label={`${t.schedule.menu} ${groupScheduleText}`}
                          className={cn(
                            "flex size-6 shrink-0 items-center justify-center rounded-md outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent",
                            anyCancelled ? "text-warning" : "text-primary/80 hover:text-primary",
                          )}
                        >
                          {anyCancelled ? <AlarmClockOff className="size-3.5" /> : <AlarmClock className="size-3.5" />}
                        </button>
                      </DropdownMenuTrigger>
                    </Tooltip>
                    <DropdownMenuContent align="start" className="w-72">
                      <DropdownMenuLabel>{groupScheduleText}</DropdownMenuLabel>
                      <ScheduleMenuItems group={group} statuses={scheduleStatus ? [scheduleStatus] : []} actions={actions} onEdit={() => setScheduleFor([group.id])} />
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {groupRunning && (
                  <span className="flex items-center gap-1 text-[0.625rem] tabular-nums text-success" aria-live="polite">
                    <Loader2 className="size-3 animate-spin" />
                    {runnable.length > 0 && f(t.groupRun.progress, { done: finished, total: runnable.length })}
                    {up > 0 && <span className="inline-flex items-center gap-0.5"><InfinityIcon className="size-3" />{f(t.continuous.up, { count: up })}</span>}
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
                          <div className="text-[0.6875rem] text-muted-foreground">{t.groupRun.sequentialHint}</div>
                        </div>
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="parallel" disabled={groupRunning} className="items-start">
                        <div>
                          <div className="flex items-center gap-1.5"><Columns3 className="size-3.5" /> {t.groupRun.parallel}</div>
                          <div className="text-[0.6875rem] text-muted-foreground">{t.groupRun.parallelHint}</div>
                        </div>
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger disabled={repos.length === 0}>
                        <ListChecks /> {t.skip.members}
                        {skipped.size > 0 && <span className="ml-auto whitespace-nowrap pl-2 text-[0.6875rem] tabular-nums text-muted-foreground">{f(t.skip.count, { count: skipped.size })}</span>}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-72">
                        <p className="px-2.5 pb-1.5 pt-1 text-[0.6875rem] leading-snug text-muted-foreground">{t.skip.membersHint}</p>
                        {repos.map((repo) => (
                          <DropdownMenuCheckboxItem
                            key={repo.id}
                            checked={!skipped.has(repo.id)}
                            disabled={groupRunning}
                            // Keep the menu open so several members can be toggled in a row.
                            onSelect={(event) => event.preventDefault()}
                            onCheckedChange={(checked) => void actions.setSkipped(repo.id, !checked)}
                          >
                            <span className="truncate">{displayName(repo)}</span>
                          </DropdownMenuCheckboxItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    <DropdownMenuItem onSelect={() => setScheduleFor([group.id])}>
                      <AlarmClock /> {t.schedule.menu}
                      <span className="ml-auto max-w-36 truncate pl-2 text-[0.6875rem] text-muted-foreground">{groupScheduleText}</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void actions.addRepository(group.id)}><Plus /> {t.sidebar.addHere}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setDialog({ kind: "renameGroup", group })}><Pencil /> {t.sidebar.renameGroup}</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void actions.exportWorkspace([group.id])}><Download /> {t.transfer.exportGroup}</DropdownMenuItem>
                    <DropdownMenuItem disabled={groupIndex === 0} onSelect={() => void actions.moveGroup(group.id, groupIndex - 1)}><ArrowUp /> {t.sidebar.moveGroupUp}</DropdownMenuItem>
                    <DropdownMenuItem disabled={lastGroup} onSelect={() => void actions.moveGroup(group.id, groupIndex + 1)}><ArrowDown /> {t.sidebar.moveGroupDown}</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive disabled={workspace.groups.length < 2} onSelect={() => setDialog({ kind: "deleteGroup", group })}><Trash2 /> {t.sidebar.deleteGroup}</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {!collapsed && (
                <ul className="mt-0.5 space-y-0.5">
                  {visible.map((repo) => { const index = repos.indexOf(repo); return (
                    <RepoItem
                      key={repo.id}
                      repo={repo}
                      index={index}
                      groupSize={repos.length}
                      groups={workspace.groups}
                      selected={repo.id === selectedRepoId}
                      running={running.get(repo.id) ?? 0}
                      latest={latest.get(repo.id) ?? null}
                      groupState={memberState.get(repo.id)}
                      skipped={skipped.has(repo.id)}
                      groupRunning={groupRunning}
                      actions={actions}
                      onRemove={() => setDialog({ kind: "removeRepo", repo })}
                      onRename={() => setDialog({ kind: "renameRepo", repo })}
                      dragging={drag?.kind === "repo" && drag.repoId === repo.id}
                      dropEdge={dropSlot === index ? "before" : dropSlot === index + 1 && index === repos.length - 1 ? "after" : null}
                      onDragStart={canDrag ? (event) => {
                        event.dataTransfer.effectAllowed = "move"
                        event.dataTransfer.setData(REPO_DRAG_TYPE, repo.id)
                        event.stopPropagation()
                        setDrag({ kind: "repo", repoId: repo.id, groupId: group.id, from: index })
                      } : undefined}
                      onDragOver={(event) => overGroup(event, group.id, slotFromPointer(index, event.clientY, event.currentTarget.getBoundingClientRect()))}
                      onDragEnd={endDrag}
                    />
                  ) })}
                  {repos.length === 0 && (
                    <li className={cn("rounded-lg px-7 py-1.5 text-xs text-muted-foreground transition", dropSlot !== null && "bg-primary/10 text-foreground ring-1 ring-primary/40")}>
                      {drag?.kind === "repo" ? t.sidebar.dropHere : t.sidebar.emptyGroup}
                    </li>
                  )}
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
      <ScheduleDialog groupIds={scheduleFor} actions={actions} onOpenChange={(open) => { if (!open) setScheduleFor(null) }} />
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
      <PromptDialog
        open={dialog?.kind === "renameRepo"}
        title={t.aliasDialog.title}
        description={dialog?.kind === "renameRepo" ? f(t.aliasDialog.description, { name: dialog.repo.name, path: dialog.repo.path }) : undefined}
        label={t.aliasDialog.label}
        placeholder={dialog?.kind === "renameRepo" ? dialog.repo.name : ""}
        initialValue={dialog?.kind === "renameRepo" ? dialog.repo.alias : ""}
        submitLabel={t.common.rename}
        allowEmpty
        onOpenChange={(open) => { if (!open) setDialog(null) }}
        onSubmit={async (alias) => { if (dialog?.kind === "renameRepo") await actions.renameRepository(dialog.repo.id, alias) }}
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
        title={dialog?.kind === "removeRepo" ? f(t.confirm.removeRepoTitle, { name: displayName(dialog.repo) }) : ""}
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
  stopped: <CircleStop className="size-4 text-warning" />,
  danger: <XCircle className="size-4 text-destructive" />,
}

function RepoItem({ repo, index, groupSize, groups, selected, running, latest, groupState, skipped, groupRunning, actions, onRemove, onRename, dragging, dropEdge, onDragStart, onDragOver, onDragEnd }: {
  repo: Repository
  /** position within its group */
  index: number
  groupSize: number
  groups: Group[]
  selected: boolean
  running: number
  /** latest command of this repository and its health */
  latest: ReturnType<typeof latestRunHealth>
  /** this repository's state in a running group run */
  groupState?: GroupRepoState
  /** "Run group" leaves this repository out (ADR-0024) */
  skipped: boolean
  groupRunning: boolean
  actions: RepositoryActions
  onRemove: () => void
  onRename: () => void
  dragging: boolean
  /** where the drop indicator is drawn, if this item is the drop target */
  dropEdge: "before" | "after" | null
  /** undefined while dragging is unavailable (e.g. the list is filtered) */
  onDragStart?: (event: DragEvent<HTMLLIElement>) => void
  onDragOver: (event: DragEvent<HTMLLIElement>) => void
  onDragEnd: () => void
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
    <li
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      className={cn("group/item relative flex items-center rounded-lg transition", selected ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground", dragging && "opacity-40")}
    >
      {dropEdge && <span aria-hidden className={cn("pointer-events-none absolute inset-x-2 h-0.5 rounded-full bg-primary", dropEdge === "before" ? "-top-px" : "-bottom-px")} />}
      <button
        aria-current={selected ? "page" : undefined}
        onClick={() => workspaceStore.select(repo.id)}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-2 pl-3 pr-9 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={[repo.alias && repo.alias !== repo.name ? repo.name : "", repo.path, lastRunText, skipped ? t.skip.skipped : "", repo.continuous ? t.continuous.marker : ""].filter(Boolean).join("\n")}
      >
        {latest ? (
          <span className="shrink-0" role="img" aria-label={lastRunText}>{healthIcon[latest.health]}</span>
        ) : (
          <FolderGit2 className="size-4 shrink-0" />
        )}
        <span className={cn("min-w-0 flex-1 truncate font-medium", skipped && "opacity-60")}>{displayName(repo)}</span>
        {repo.continuous && <InfinityIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label={t.continuous.marker} />}
        {skipped && <SkipForward className="size-3.5 shrink-0 text-muted-foreground" aria-label={t.skip.skipped} />}
        {groupState?.status === "pending" ? (
          <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-label={t.groupRun.queued} />
        ) : groupState?.status === "failed" ? (
          <AlertTriangle className="size-3.5 shrink-0 text-destructive" aria-label={`${t.groupRun.failedIn}: ${groupState.error}`} />
        ) : repo.problem ? (
          <AlertTriangle className="size-3.5 shrink-0 text-warning" aria-label={t.sidebar.problem} />
        ) : running > 0 ? (
          <Badge variant="success" className="tabular-nums">{running}</Badge>
        ) : (
          <span className="text-[0.625rem] uppercase tracking-wide opacity-60">{repo.packageManager || t.sidebar.folder}</span>
        )}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label={t.sidebar.repoActions} className="absolute right-1 text-muted-foreground opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right">
          <DropdownMenuLabel className="max-w-56 truncate normal-case tracking-normal">{displayName(repo)}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => void actions.openInVSCode(repo.id)}><Code2 /> {t.sidebar.openInVSCode}</DropdownMenuItem>
          <DropdownMenuItem onSelect={onRename}><Pencil /> {t.sidebar.renameRepo}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void actions.refresh(repo)}><RefreshCw /> {t.common.refresh}</DropdownMenuItem>
          <DropdownMenuCheckboxItem checked={skipped} disabled={groupRunning} onCheckedChange={(checked) => void actions.setSkipped(repo.id, checked)}>
            {t.skip.toggle}
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={repo.continuous} disabled={groupRunning} onCheckedChange={(checked) => void actions.setContinuous(repo.id, checked)}>
            {t.continuous.toggle}
          </DropdownMenuCheckboxItem>
          <DropdownMenuItem onSelect={() => void actions.relocate(repo)}><FolderSearch /> {t.relocate.action}</DropdownMenuItem>
          <DropdownMenuItem disabled={index === 0} onSelect={() => void actions.move(repo.id, repo.groupId, index - 1)}><ArrowUp /> {t.sidebar.moveUp}</DropdownMenuItem>
          <DropdownMenuItem disabled={index >= groupSize - 1} onSelect={() => void actions.move(repo.id, repo.groupId, index + 1)}><ArrowDown /> {t.sidebar.moveDown}</DropdownMenuItem>
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
