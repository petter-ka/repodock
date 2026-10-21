import { FolderPlus, LayoutDashboard, LayoutGrid, SquareTerminal } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { useI18n } from "@/lib/i18n"
import { modLabel, useShortcuts } from "@/lib/keyboard"
import { readPreference, writePreference } from "@/lib/preferences"
import { cn } from "@/lib/utils"
import { CommandInput } from "../components/CommandInput"
import { ConsoleView } from "../components/ConsoleView"
import { EnvSheet } from "../components/EnvSheet"
import { ProcessInput } from "../components/ProcessInput"
import { ProcessStrip } from "../components/ProcessStrip"
import { RepoHeader } from "../components/RepoHeader"
import { RepoSidebar } from "../components/RepoSidebar"
import { ScriptChips } from "../components/ScriptChips"
import { TaskChips } from "../components/TaskChips"
import { SequenceChips } from "../components/SequenceChips"
import { QuickCommands } from "../components/QuickCommands"
import { BackgroundSheet } from "../components/BackgroundSheet"
import { SequenceSheet } from "../components/SequenceSheet"
import { Dashboard } from "../components/dashboard/Dashboard"
import { displayName, isActive, type Repository } from "../domain"
import { useRepositoryActions } from "../hooks/useRepositoryActions"
import { useProcessVersion, useSelectedRepository, useWorkspaceState } from "../hooks/useStores"
import { processStore } from "../store/processStore"
import { workspaceStore } from "../store/workspaceStore"

export function RepositoryManagerView() {
  const actions = useRepositoryActions()
  const repo = useSelectedRepository()
  const filterRef = useRef<HTMLInputElement>(null)
  const commandRef = useRef<HTMLInputElement>(null)

  const step = (delta: 1 | -1) => {
    const ordered = workspaceStore.orderedRepositories()
    if (!ordered.length) return
    const index = ordered.findIndex((r) => r.id === repo?.id)
    const next = index === -1 ? (delta === 1 ? 0 : ordered.length - 1) : (index + delta + ordered.length) % ordered.length
    workspaceStore.select(ordered[next].id)
  }

  useShortcuts([
    { keys: "mod+o", handler: () => void actions.addRepository(workspaceStore.getState().workspace.groups[0]?.id), allowInInput: true },
    { keys: "mod+k", handler: () => filterRef.current?.focus(), allowInInput: true },
    { keys: "alt+arrowdown", handler: () => step(1) },
    { keys: "alt+arrowup", handler: () => step(-1) },
    { keys: "mod+j", handler: () => commandRef.current?.focus(), allowInInput: true },
    { keys: "mod+l", handler: () => processStore.clearOutput(repo?.id), allowInInput: true },
  ])

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <RepoSidebar ref={filterRef} actions={actions} />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {repo ? <RepositoryPane key={repo.id} repo={repo} actions={actions} commandRef={commandRef} /> : <OverviewPane actions={actions} />}
      </main>
    </div>
  )
}

function RepositoryPane({ repo, actions, commandRef }: {
  repo: Repository
  actions: ReturnType<typeof useRepositoryActions>
  commandRef: React.Ref<HTMLInputElement>
}) {
  const version = useProcessVersion()
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<"sequence" | "env" | "background" | null>(null)
  const [backgroundRunId, setBackgroundRunId] = useState<string | null>(null)

  const { runs, snapshots, sequence } = useMemo(() => {
    void version
    const runs = processStore.runsFor(repo.id)
    const snapshots = new Map(runs.map((run) => [run.id, processStore.snapshot(run.id)]).filter((e): e is [string, NonNullable<ReturnType<typeof processStore.snapshot>>] => !!e[1]))
    return { runs, snapshots, sequence: processStore.sequence(repo.id) }
  }, [version, repo.id])
  const backgroundRuns = useMemo(() => {
    void version
    return processStore.backgroundRuns(repo.id)
  }, [version, repo.id])
  const runningQuickIds = useMemo(() => new Set(backgroundRuns.filter((run) => isActive(run.status)).map((run) => processStore.quickCommandOf(run.id)!)), [backgroundRuns])

  const active = runs.filter((run) => isActive(run.status))
  const runningLabels = useMemo(() => new Set(active.map((run) => run.label)), [active])

  // Drop a run filter whose run has been dismissed.
  useEffect(() => {
    if (selectedRunId && !runs.some((run) => run.id === selectedRunId)) setSelectedRunId(null)
  }, [runs, selectedRunId])

  return (
    <>
      <RepoHeader
        repo={repo}
        actions={actions}
        running={active.length}
        onRefresh={() => void actions.refresh(repo)}
        onSequence={() => setSheet("sequence")}
        onEnvironment={() => setSheet("env")}
        onStopAll={() => void actions.stopRepository(repo)}
        onRelocate={() => void actions.relocate(repo)}
      />
      <ScriptChips repo={repo} runningLabels={runningLabels} onRun={(script) => void actions.runScript(repo, script).then((run) => run && setSelectedRunId(null))} />
      <TaskChips repo={repo} runningLabels={runningLabels} onRun={(task) => void actions.runTask(repo, task.tool, task.name).then((run) => run && setSelectedRunId(null))} />
      <SequenceChips
        repo={repo}
        sequence={sequence}
        runningLabels={runningLabels}
        onRunScript={(script) => void actions.runScript(repo, script).then((run) => run && setSelectedRunId(null))}
        onRunCommand={(command, label) => void actions.runCommand(repo, command, label).then((run) => run && setSelectedRunId(null))}
        onRunSequence={() => void actions.runSequence(repo)}
        onCancelSequence={(id) => void actions.cancelSequence(id)}
        onEdit={() => setSheet("sequence")}
      />
      <QuickCommands
        repo={repo}
        runningQuickIds={runningQuickIds}
        backgroundCount={backgroundRuns.length}
        backgroundActive={runningQuickIds.size}
        onRun={(quick, global) => void actions.runQuick(repo, quick, global).then((run) => {
          if (!run) return
          setBackgroundRunId(run.id)
          setSheet("background")
        })}
        onOpenBackground={() => setSheet("background")}
        onSave={(commands) => void actions.saveQuickCommands(repo, commands)}
      />
      <CommandInput ref={commandRef} repo={repo} onRun={(command) => void actions.runCommand(repo, command)} />
      <ProcessStrip
        runs={runs}
        snapshots={snapshots}
        selectedRunId={selectedRunId}
        onSelectRun={setSelectedRunId}
        onStop={(id) => void actions.stop(id)}
        onRestart={(id) => void actions.restart(id).then((run) => run && selectedRunId === id && setSelectedRunId(run.id))}
        onDismiss={(id) => processStore.dismissRun(id)}
        onClearFinished={() => processStore.clearFinished(repo.id)}
      />
      <ConsoleView repositoryId={repo.id} runs={runs} selectedRunId={selectedRunId} onSelectRun={setSelectedRunId} onClear={() => processStore.clearOutput(repo.id)} />
      <ProcessInput runs={runs} selectedRunId={selectedRunId} actions={actions} />
      <SequenceSheet repo={repo} open={sheet === "sequence"} sequence={sequence} actions={actions} onOpenChange={(open) => setSheet(open ? "sequence" : null)} />
      <BackgroundSheet
        repo={repo}
        open={sheet === "background"}
        runs={backgroundRuns}
        selectedRunId={backgroundRunId}
        onSelectRun={setBackgroundRunId}
        actions={actions}
        onOpenChange={(open) => setSheet(open ? "background" : null)}
      />
      <EnvSheet repo={repo} open={sheet === "env"} actions={actions} onOpenChange={(open) => setSheet(open ? "env" : null)} />
    </>
  )
}

type OverviewTab = "dashboard" | "console"
const TAB_KEY = "overview.tab"

/**
 * Shown when no repository is selected: the workspace dashboard (default)
 * and, in a second tab, every process with the combined console.
 */
function OverviewPane({ actions }: { actions: ReturnType<typeof useRepositoryActions> }) {
  const { t, f } = useI18n()
  const { workspace, loaded } = useWorkspaceState()
  const version = useProcessVersion()
  const [tab, setTabState] = useState<OverviewTab>(() => (readPreference(TAB_KEY) === "console" ? "console" : "dashboard"))
  const setTab = (next: OverviewTab) => {
    setTabState(next)
    writePreference(TAB_KEY, next)
  }
  const active = useMemo(() => {
    void version
    return processStore.activeCount()
  }, [version])

  const empty = loaded && workspace.repositories.length === 0
  const tabs: Array<{ id: OverviewTab; label: string; icon: React.ReactNode; badge?: number }> = [
    { id: "dashboard", label: t.dashboard.tab, icon: <LayoutDashboard className="size-4" /> },
    { id: "console", label: t.dashboard.consoleTab, icon: <SquareTerminal className="size-4" />, badge: active },
  ]
  const onTabKey = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    const next = tab === "dashboard" ? "console" : "dashboard"
    setTab(next)
    document.getElementById(`overview-tab-${next}`)?.focus()
  }

  if (empty) {
    return (
      <>
        <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
          <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-accent">
            <FolderPlus className="size-6 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{t.welcome.title}</h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">{t.welcome.body}</p>
          <Button className="mt-5" onClick={() => void actions.addRepository()}>
            <FolderPlus /> {t.welcome.add}
            <span className="ml-1 inline-flex items-center gap-0.5 opacity-80"><Kbd className="border-white/30 bg-transparent text-current">{modLabel}</Kbd><Kbd className="border-white/30 bg-transparent text-current">O</Kbd></span>
          </Button>
          <p className="mt-6 text-xs text-muted-foreground">{t.welcome.consoleHint}</p>
        </div>
        <ProcessesAndConsole actions={actions} />
      </>
    )
  }

  return (
    <>
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-4">
        <LayoutGrid className="size-5 text-muted-foreground" />
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{t.console.allRepos}</h1>
          <p className="text-xs text-muted-foreground">{t.dashboard.subtitle}</p>
        </div>
        <Badge className="tabular-nums">{f(t.sidebar.count, { count: workspace.repositories.length })}</Badge>
        {active > 0 && <Badge variant="success" className="tabular-nums">{f(t.sidebar.running, { count: active })}</Badge>}
        <div role="tablist" aria-label={t.console.allRepos} className="ml-auto inline-flex rounded-xl border border-border bg-background p-1" onKeyDown={onTabKey}>
          {tabs.map((item) => (
            <button
              key={item.id}
              id={`overview-tab-${item.id}`}
              role="tab"
              aria-selected={tab === item.id}
              aria-controls={`overview-panel-${item.id}`}
              tabIndex={tab === item.id ? 0 : -1}
              onClick={() => setTab(item.id)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
                tab === item.id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.icon}
              {item.label}
              {!!item.badge && (
                <span className={cn("rounded-full px-1.5 text-[0.6875rem] tabular-nums", tab === item.id ? "bg-primary-foreground/20" : "bg-success/15 text-success")}>{item.badge}</span>
              )}
            </button>
          ))}
        </div>
      </header>
      <div id={`overview-panel-${tab}`} role="tabpanel" aria-labelledby={`overview-tab-${tab}`} className="flex min-h-0 flex-1 flex-col">
        {tab === "dashboard" ? <Dashboard workspace={workspace} actions={actions} /> : <ProcessesAndConsole actions={actions} />}
      </div>
    </>
  )
}

/** Every process across repositories and the combined console. */
function ProcessesAndConsole({ actions }: { actions: ReturnType<typeof useRepositoryActions> }) {
  const { workspace } = useWorkspaceState()
  const version = useProcessVersion()
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  const repoNames = useMemo(() => new Map(workspace.repositories.map((r) => [r.id, displayName(r)])), [workspace.repositories])
  const { runs, snapshots } = useMemo(() => {
    void version
    const runs = processStore.runsFor()
    const snapshots = new Map(runs.map((run) => [run.id, processStore.snapshot(run.id)]).filter((e): e is [string, NonNullable<ReturnType<typeof processStore.snapshot>>] => !!e[1]))
    return { runs, snapshots }
  }, [version])

  useEffect(() => {
    if (selectedRunId && !runs.some((run) => run.id === selectedRunId)) setSelectedRunId(null)
  }, [runs, selectedRunId])

  return (
    <>
      <ProcessStrip
        runs={runs}
        snapshots={snapshots}
        repoNames={repoNames}
        selectedRunId={selectedRunId}
        onSelectRun={setSelectedRunId}
        onStop={(id) => void actions.stop(id)}
        onRestart={(id) => void actions.restart(id)}
        onDismiss={(id) => processStore.dismissRun(id)}
      />
      <ConsoleView runs={runs} repoNames={repoNames} selectedRunId={selectedRunId} onSelectRun={setSelectedRunId} onClear={() => processStore.clearOutput()} />
      <ProcessInput runs={runs} selectedRunId={selectedRunId} repoNames={repoNames} actions={actions} />
    </>
  )
}
