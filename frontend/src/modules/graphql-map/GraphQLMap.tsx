import { ReactFlowProvider } from "@xyflow/react"
import { AlertTriangle, Check, ChevronDown, Crosshair, FileCode2, FolderGit2, FolderOpen, FolderSearch, ListTree, Loader2, PanelRightClose, PanelRightOpen, RefreshCw, SlidersHorizontal, Waypoints, X } from "lucide-react"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip } from "@/components/ui/tooltip"
import { errorMessage } from "@/lib/bridge"
import { displayName, type Repository } from "@/lib/contracts"
import { useI18n } from "@/lib/i18n"
import { hasMod, modLabel } from "@/lib/keyboard"
import { readJSON, writeJSON } from "@/lib/preferences"
import { cn } from "@/lib/utils"
import { useNotifications } from "@/state/notifications"
import { graphqlApi } from "./api"
import { DocsPanel, type DocsTab } from "./DocsPanel"
import { ALL_TYPES, buildGraph, defaultGraphOptions, rootChoices, type GraphOptions } from "./graph"
import { MapCanvas, type RevealRequest } from "./MapCanvas"
import { createSelectionStore, MapContext, type MapContextValue, type Selection } from "./MapContext"
import { buildModel, isComposite, type SourceFile } from "./model"
import { useFileSelection, useRepositories, useSources, type SourceState } from "./sources"
import { sameRoot, type TreeMode, type TreeRoot } from "./tree"
import { TreePanel } from "./TreePanel"

const OPTIONS_KEY = "graphqlMap.options"
type Stored = Omit<GraphOptions, "focus"> & { focusMode: boolean; panel: boolean; minimap: boolean }
const LARGE_GRAPH = 250

function loadStored(): Stored {
  const stored = readJSON<Partial<Stored>>(OPTIONS_KEY, {})
  const { focus: _, ...defaults } = defaultGraphOptions
  return { ...defaults, focusMode: false, panel: true, minimap: true, ...(typeof stored === "object" && stored ? stored : {}) }
}

/** Visualizes the GraphQL schema files of chosen folders, Voyager style (ADR-0029). */
export function GraphQLMap() {
  return (
    <ReactFlowProvider>
      <GraphQLMapView />
    </ReactFlowProvider>
  )
}

function GraphQLMapView() {
  const { t, f } = useI18n()
  const { notify } = useNotifications()
  const repositories = useRepositories()
  const { sources, paths, toggle, add, only, refresh } = useSources(repositories)
  const [stored, setStored] = useState(loadStored)
  const [selection, setSelection] = useState<Selection>(null)
  const [store] = useState(createSelectionStore)
  const [tab, setTab] = useState<DocsTab>("types")
  const [reveal, setReveal] = useState<RevealRequest>(null)
  const [tree, setTree] = useState<{ root: TreeRoot; back: TreeRoot[] } | null>(null)
  const [treeMode, setTreeMode] = useState<TreeMode>("down")
  const searchRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const update = useCallback((patch: Partial<Stored>) => {
    setStored((current) => {
      const next = { ...current, ...patch }
      writeJSON(OPTIONS_KEY, next)
      return next
    })
  }, [])

  const fileSelection = useFileSelection(sources)
  const allFiles = useMemo<SourceFile[]>(() => sources.flatMap((source) => (source.scan?.files ?? []).map((file) => ({ root: source.path, path: file.path, content: file.content }))), [sources])
  const { isIncluded } = fileSelection
  const [files, excludedFiles] = useMemo(() => {
    const included: SourceFile[] = []
    const excluded: SourceFile[] = []
    for (const file of allFiles) (isIncluded(file.root, file.path) ? included : excluded).push(file)
    return [included, excluded]
  }, [allFiles, isIncluded])
  const model = useMemo(() => buildModel(files, excludedFiles), [files, excludedFiles])
  const roots = useMemo(() => rootChoices(model), [model])

  // A remembered root that this schema lacks falls back to Query, then all types.
  const root = stored.root === ALL_TYPES || isComposite(model.types.get(stored.root)) ? stored.root : roots[0]?.name ?? ALL_TYPES
  const focus = stored.focusMode && selection && model.types.has(selection.type) ? selection.type : null
  // Only graph options rebuild the graph (not the panel or minimap toggles).
  const { collapseRelay, showLeafFields, showDeprecated, showInputs, hideRoot, sortFields, focusDepth } = stored
  const graph = useMemo(
    () => buildGraph(model, { root, focus, collapseRelay, showLeafFields, showDeprecated, showInputs, hideRoot, sortFields, focusDepth }),
    [model, root, focus, collapseRelay, showLeafFields, showDeprecated, showInputs, hideRoot, sortFields, focusDepth],
  )
  const drawn = useMemo(() => new Set(graph.nodes.map((node) => node.name)), [graph])

  const select = useCallback((type: string, field: string | null = null, show = false) => {
    setSelection(type ? { type, field } : null)
    if (type && show) setReveal((current) => ({ name: type, seq: (current?.seq ?? 0) + 1 }))
  }, [])

  const related = useMemo(() => {
    const set = new Set<string>()
    if (!selection) return set
    for (const edge of graph.edges) {
      if (selection.field !== null) {
        if (edge.source === selection.type && edge.sourceHandle === `f:${selection.field}`) set.add(edge.target)
      } else if (edge.source === selection.type) set.add(edge.target)
      else if (edge.target === selection.type) set.add(edge.source)
    }
    return set
  }, [graph, selection])

  useLayoutEffect(() => store.set(selection, related), [store, selection, related])

  // Opening the tree at a new root keeps the previous ones for its Back button.
  const openTree = useCallback((type: string, field: string | null = null) => setTree((current) => {
    const root = { type, field }
    if (!current) return { root, back: [] }
    return sameRoot(current.root, root) ? current : { root, back: [...current.back, current.root].slice(-30) }
  }), [])
  const closeTree = () => {
    setTree(null)
    rootRef.current?.focus({ preventScroll: true })
  }
  const toggleTree = () => {
    if (tree && (!selection || sameRoot(tree.root, selection))) closeTree()
    else if (selection) openTree(selection.type, selection.field)
  }
  const treeShown = tree !== null && model.types.has(tree.root.type)

  const context = useMemo<MapContextValue>(() => ({ store, select, openTree }), [store, select, openTree])

  const toggleMinimap = useCallback(() => setStored((current) => {
    const next = { ...current, minimap: !current.minimap }
    writeJSON(OPTIONS_KEY, next)
    return next
  }), [])

  const showFiles = () => {
    setSelection(null)
    setTab("files")
    if (!stored.panel) update({ panel: true })
  }

  const browse = async () => {
    try {
      const path = await graphqlApi.browse()
      if (path) add(path)
    } catch (err) {
      notify(errorMessage(err) || t.common.error, { tone: "error" })
    }
  }

  const showAll = (type: string) => {
    const kind = model.types.get(type)?.kind
    update({ root: ALL_TYPES, ...(kind === "input" ? { showInputs: true } : {}) })
    select(type, null, true)
  }

  // Take keyboard focus on open so the shortcuts work without a click.
  const hasSources = paths.length > 0
  useEffect(() => { if (hasSources) rootRef.current?.focus({ preventScroll: true }) }, [hasSources])

  const loading = sources.some((source) => source.status === "loading")
  const errors = model.files.filter((file) => file.error).length
  const typeCount = [...model.types.values()].filter((type) => !type.builtIn).length

  const onKeyDown = (event: React.KeyboardEvent) => {
    const editing = event.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(event.target.tagName)
    if ((hasMod(event) && event.key.toLowerCase() === "f") || (!editing && event.key === "/")) {
      event.preventDefault()
      if (!stored.panel) update({ panel: true })
      requestAnimationFrame(() => searchRef.current?.focus())
    } else if (event.key === "Escape" && selection && !editing) {
      // Esc clears the selection, then closes the tree, then the window.
      event.stopPropagation()
      setSelection(null)
    } else if (event.key === "Escape" && treeShown && !editing) {
      event.stopPropagation()
      closeTree()
    } else if (!editing && !hasMod(event) && !event.altKey && event.key.toLowerCase() === "t") {
      toggleTree()
    } else if (!editing && !hasMod(event) && !event.altKey && event.key.toLowerCase() === "f" && selection) {
      update({ focusMode: !stored.focusMode })
    }
  }

  if (paths.length === 0) return <Welcome repositories={repositories} onPick={only} onBrowse={browse} />

  return (
    <MapContext.Provider value={context}>
      <div ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown} className="flex h-full min-h-0 flex-col outline-none">
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-card px-2 py-1.5">
          <SourcesMenu sources={sources} repositories={repositories} paths={paths} onToggle={toggle} onBrowse={browse} />
          {roots.length > 0 && (
            <div role="radiogroup" aria-label={t.graphql.rootType} className="flex rounded-lg border border-border p-0.5 text-xs">
              {[...roots.map((r) => ({ value: r.name, label: r.name })), { value: ALL_TYPES, label: t.graphql.allTypes }].map((option) => (
                <button
                  key={option.value}
                  role="radio"
                  aria-checked={root === option.value}
                  onClick={() => update({ root: option.value })}
                  className={cn("rounded-md px-2.5 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring", root === option.value ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground")}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
          <Tooltip label={selection ? f(t.graphql.focusHint, { type: selection.type }) : t.graphql.focusDisabled}>
            <span>
              <Button
                size="xs"
                variant={stored.focusMode ? "secondary" : "ghost"}
                aria-pressed={stored.focusMode}
                onClick={() => update({ focusMode: !stored.focusMode })}
                className={cn(stored.focusMode && "text-primary")}
              >
                <Crosshair /> {t.graphql.focus}
              </Button>
            </span>
          </Tooltip>
          <Tooltip label={selection ? f(t.graphql.tree.openHint, { name: selection.field ? `${selection.type}.${selection.field}` : selection.type }) : t.graphql.tree.disabled}>
            <span>
              <Button
                size="xs"
                variant={treeShown ? "secondary" : "ghost"}
                aria-pressed={treeShown}
                disabled={!treeShown && !selection}
                onClick={toggleTree}
                className={cn(treeShown && "text-primary")}
              >
                <ListTree /> {t.graphql.tree.title}
              </Button>
            </span>
          </Tooltip>
          <OptionsMenu options={stored} onChange={update} />
          {allFiles.length > 0 && (
            <Tooltip label={t.graphql.chooseFiles}>
              <Button size="xs" variant={excludedFiles.length > 0 ? "secondary" : "ghost"} onClick={showFiles} className={cn(excludedFiles.length > 0 && "text-primary")}>
                <FileCode2 />
                {excludedFiles.length > 0 ? f(t.graphql.filesOf, { selected: files.length, total: allFiles.length }) : f(t.graphql.filesAll, { count: allFiles.length })}
              </Button>
            </Tooltip>
          )}
          <div className="ml-auto flex items-center gap-1">
            <span className="hidden items-center gap-2 px-1 text-[0.6875rem] tabular-nums text-muted-foreground md:flex">
              {f(t.graphql.stats, { types: typeCount, drawn: graph.nodes.length })}
              {errors > 0 && (
                <span className="flex items-center gap-1 text-destructive"><AlertTriangle className="size-3" />{f(t.graphql.errors, { count: errors })}</span>
              )}
            </span>
            <Tooltip label={t.common.refresh}>
              <Button size="icon-sm" variant="ghost" aria-label={t.common.refresh} onClick={refresh} disabled={loading}>
                <RefreshCw className={cn(loading && "animate-spin")} />
              </Button>
            </Tooltip>
            <Tooltip label={stored.panel ? t.graphql.hidePanel : t.graphql.showPanel}>
              <Button size="icon-sm" variant="ghost" aria-label={stored.panel ? t.graphql.hidePanel : t.graphql.showPanel} onClick={() => update({ panel: !stored.panel })}>
                {stored.panel ? <PanelRightClose /> : <PanelRightOpen />}
              </Button>
            </Tooltip>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {treeShown && (
            <TreePanel
              model={model}
              root={tree.root}
              back={tree.back}
              mode={treeMode}
              onMode={setTreeMode}
              onOpen={(root) => openTree(root.type, root.field)}
              onBack={() => setTree((current) => current && current.back.length > 0 ? { root: current.back.at(-1)!, back: current.back.slice(0, -1) } : current)}
              onClose={closeTree}
            />
          )}
          <div className="relative min-w-0 flex-1">
            {files.length === 0 && allFiles.length > 0 ? (
              <CanvasMessage>
                <FileCode2 className="size-8 text-muted-foreground" />
                <p className="text-sm font-medium">{t.graphql.noFilesChecked}</p>
                <Button size="sm" variant="outline" onClick={fileSelection.includeAll}>{t.graphql.checkAll}</Button>
              </CanvasMessage>
            ) : files.length === 0 ? (
              <CanvasMessage>
                {loading ? <Loader2 className="size-5 animate-spin text-muted-foreground" /> : (
                  <>
                    <FolderSearch className="size-8 text-muted-foreground" />
                    <p className="text-sm font-medium">{t.graphql.noFiles}</p>
                    <p className="max-w-sm text-xs text-muted-foreground">{t.graphql.noFilesHint}</p>
                    {sources.filter((s) => s.status === "error").map((s) => <p key={s.path} className="text-xs text-destructive">{s.label}: {s.error}</p>)}
                    <Button size="sm" variant="outline" onClick={browse}><FolderOpen /> {t.graphql.browse}</Button>
                  </>
                )}
              </CanvasMessage>
            ) : graph.nodes.length === 0 ? (
              <CanvasMessage>
                <Waypoints className="size-8 text-muted-foreground" />
                <p className="text-sm font-medium">{t.graphql.emptyGraph}</p>
                <p className="max-w-sm text-xs text-muted-foreground">{t.graphql.emptyGraphHint}</p>
                {root !== ALL_TYPES && <Button size="sm" variant="outline" onClick={() => update({ root: ALL_TYPES, hideRoot: false })}>{t.graphql.showAllTypes}</Button>}
              </CanvasMessage>
            ) : (
              <>
                <MapCanvas model={model} graph={graph} focus={focus} reveal={reveal} showMinimap={stored.minimap} onToggleMinimap={toggleMinimap} />
                {graph.nodes.length > LARGE_GRAPH && !focus && (
                  <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
                    <p className="pointer-events-auto rounded-full border border-border bg-card/95 px-3 py-1 text-[0.6875rem] text-muted-foreground shadow-sm backdrop-blur">
                      {f(t.graphql.largeGraph, { count: graph.nodes.length })}
                    </p>
                  </div>
                )}
                <Legend />
              </>
            )}
          </div>
          {stored.panel && (
            <aside className="w-[300px] shrink-0 border-l border-border bg-card">
              <DocsPanel
                ref={searchRef}
                model={model}
                sources={sources}
                drawn={drawn}
                selection={selection}
                tab={tab}
                onTab={setTab}
                files={fileSelection}
                onShowAll={showAll}
              />
            </aside>
          )}
        </div>
      </div>
    </MapContext.Provider>
  )
}

function CanvasMessage({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">{children}</div>
}

function Legend() {
  const { t } = useI18n()
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 hidden -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-full border border-border bg-card/90 px-3 py-1 text-[0.625rem] text-muted-foreground shadow-sm backdrop-blur lg:flex">
      <span className="flex items-center gap-1.5"><svg width="18" height="2"><line x1="0" y1="1" x2="18" y2="1" stroke="currentColor" strokeWidth="1.5" /></svg>{t.graphql.legendField}</span>
      <span className="flex items-center gap-1.5"><svg width="18" height="2"><line x1="0" y1="1" x2="18" y2="1" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" /></svg>{t.graphql.legendLink}</span>
      <span className="flex items-center gap-1"><Kbd>{modLabel}F</Kbd>{t.graphql.legendSearch}</span>
      <span className="flex items-center gap-1"><Kbd>F</Kbd>{t.graphql.focus}</span>
      <span className="flex items-center gap-1"><Kbd>T</Kbd>{t.graphql.tree.title}</span>
    </div>
  )
}

function SourcesMenu({ sources, repositories, paths, onToggle, onBrowse }: {
  sources: SourceState[]
  repositories: Repository[]
  paths: string[]
  onToggle: (path: string) => void
  onBrowse: () => void
}) {
  const { t, f } = useI18n()
  const label = sources.length === 1 ? sources[0].label : f(t.graphql.folderCount, { count: sources.length })
  const custom = paths.filter((path) => !repositories.some((repo) => repo.path === path))
  const failed = sources.some((source) => source.status === "error")
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="xs" variant="outline" className="max-w-56">
          {failed ? <AlertTriangle className="text-destructive" /> : <FolderGit2 />}
          <span className="truncate">{label}</span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 w-72 overflow-y-auto">
        {repositories.length > 0 && <DropdownMenuLabel>{t.graphql.repositories}</DropdownMenuLabel>}
        {repositories.map((repo) => (
          <DropdownMenuCheckboxItem key={repo.id} checked={paths.includes(repo.path)} onCheckedChange={() => onToggle(repo.path)} onSelect={(event) => event.preventDefault()}>
            <span className="min-w-0 truncate" title={repo.path}>{displayName(repo)}</span>
          </DropdownMenuCheckboxItem>
        ))}
        {custom.length > 0 && <><DropdownMenuSeparator /><DropdownMenuLabel>{t.graphql.folders}</DropdownMenuLabel></>}
        {custom.map((path) => {
          const source = sources.find((s) => s.path === path)
          return (
            <DropdownMenuItem key={path} onSelect={(event) => { event.preventDefault(); onToggle(path) }} title={path}>
              <Check className="text-primary" />
              <span className="min-w-0 flex-1 truncate">{source?.label ?? path}</span>
              <X className="text-muted-foreground" aria-label={t.graphql.removeFolder} />
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onBrowse}><FolderOpen /> {t.graphql.browse}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function OptionsMenu({ options, onChange }: { options: Stored; onChange: (patch: Partial<Stored>) => void }) {
  const { t } = useI18n()
  const toggles: { key: "collapseRelay" | "showLeafFields" | "showDeprecated" | "showInputs" | "hideRoot" | "sortFields"; label: string }[] = [
    { key: "collapseRelay", label: t.graphql.options.collapseRelay },
    { key: "showLeafFields", label: t.graphql.options.showLeafFields },
    { key: "showInputs", label: t.graphql.options.showInputs },
    { key: "showDeprecated", label: t.graphql.options.showDeprecated },
    { key: "sortFields", label: t.graphql.options.sortFields },
    { key: "hideRoot", label: t.graphql.options.hideRoot },
  ]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="xs" variant="ghost"><SlidersHorizontal /> {t.graphql.display}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {toggles.map((toggle) => (
          <DropdownMenuCheckboxItem key={toggle.key} checked={options[toggle.key]} onCheckedChange={(checked) => onChange({ [toggle.key]: checked === true })} onSelect={(event) => event.preventDefault()}>
            {toggle.label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t.graphql.options.focusDepth}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={String(options.focusDepth)} onValueChange={(value) => onChange({ focusDepth: Number(value) })}>
          {[1, 2, 3].map((depth) => (
            <DropdownMenuRadioItem key={depth} value={String(depth)} onSelect={(event) => event.preventDefault()}>{depth}</DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Welcome({ repositories, onPick, onBrowse }: { repositories: Repository[]; onPick: (path: string) => void; onBrowse: () => void }) {
  const { t } = useI18n()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 overflow-y-auto p-8 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-primary/12 text-primary"><Waypoints className="size-6" /></span>
      <div>
        <h3 className="text-base font-semibold">{t.graphql.welcomeTitle}</h3>
        <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">{t.graphql.welcomeHint}</p>
      </div>
      {repositories.length > 0 && (
        <div className="grid w-full max-w-xl grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2">
          {repositories.map((repo) => (
            <button
              key={repo.id}
              onClick={() => onPick(repo.path)}
              title={repo.path}
              className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left text-xs outline-none transition hover:border-primary/50 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
            >
              <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate font-medium">{displayName(repo)}</span>
            </button>
          ))}
        </div>
      )}
      <Button size="sm" variant={repositories.length > 0 ? "outline" : "default"} onClick={onBrowse}><FolderOpen /> {t.graphql.browse}</Button>
    </div>
  )
}
