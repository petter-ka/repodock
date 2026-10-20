import { ArrowLeft, Check, ChevronRight, Copy, EyeOff, FileCode2, FileWarning, ListTree, Search, X } from "lucide-react"
import { forwardRef, useEffect, useMemo, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Tooltip } from "@/components/ui/tooltip"
import { useI18n } from "@/lib/i18n"
import { modLabel } from "@/lib/keyboard"
import { cn } from "@/lib/utils"
import { useNotifications } from "@/state/notifications"
import { KIND_ORDER, KINDS, kindOf } from "./kinds"
import { useMap, type Selection } from "./MapContext"
import type { SchemaField, SchemaModel, SchemaType, TypeRef } from "./model"
import type { SourceState, useFileSelection } from "./sources"

export type DocsTab = "types" | "files"
type FileSelection = ReturnType<typeof useFileSelection>

type Result = { type: string; field: string | null; key: string }

/** Ranks names: exact, prefix, word start, substring. */
function score(name: string, query: string) {
  const lower = name.toLowerCase()
  if (lower === query) return 0
  if (lower.startsWith(query)) return 1
  if (new RegExp(`(^|[_A-Z.])${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(name)) return 2
  return lower.includes(query) ? 3 : -1
}

export function search(model: SchemaModel, query: string, limit = 60): Result[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const types: (Result & { rank: number })[] = []
  const fields: (Result & { rank: number })[] = []
  for (const type of model.types.values()) {
    if (type.builtIn) continue
    const rank = score(type.name, q)
    if (rank >= 0) types.push({ type: type.name, field: null, key: type.name, rank })
    for (const f of [...type.fields, ...type.values]) {
      const fieldRank = score(f.name, q)
      if (fieldRank >= 0) fields.push({ type: type.name, field: f.name, key: `${type.name}.${f.name}`, rank: fieldRank })
    }
  }
  const order = (a: { rank: number; key: string }, b: { rank: number; key: string }) => a.rank - b.rank || a.key.length - b.key.length || a.key.localeCompare(b.key)
  return [...types.sort(order), ...fields.sort(order)].slice(0, limit)
}

export function KindIcon({ type, className }: { type: SchemaType | undefined; className?: string }) {
  const kind = KINDS[kindOf(type)]
  const Icon = kind.icon
  return <Icon className={cn("size-3.5 shrink-0", className)} style={{ color: kind.color }} />
}

/** A clickable type reference, keeping list/non-null wrappers. */
function TypeLink({ model, type, onOpen }: { model: SchemaModel; type: TypeRef; onOpen: (name: string) => void }) {
  const target = model.types.get(type.name)
  const [before, after] = type.label.split(type.name)
  return (
    <span className="font-mono">
      {before}
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); onOpen(type.name) }}
        className="rounded underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        style={{ color: KINDS[kindOf(target)].color }}
      >
        {type.name}
      </button>
      {after}
    </span>
  )
}

export const DocsPanel = forwardRef<HTMLInputElement, {
  model: SchemaModel
  sources: SourceState[]
  drawn: Set<string>
  selection: Selection
  tab: DocsTab
  onTab: (tab: DocsTab) => void
  files: FileSelection
  onShowAll: (type: string) => void
}>(function DocsPanel({ model, sources, drawn, selection, tab, onTab: setTab, files, onShowAll }, searchRef) {
  const { t, f } = useI18n()
  const { select } = useMap()
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const visited = useRef<string[]>([])
  const errors = model.files.filter((file) => file.error).length

  const results = useMemo(() => search(model, query), [model, query])
  useEffect(() => setActive(0), [query])

  const open = (type: string, field: string | null = null) => select(type, field, true)
  const selected = selection ? model.types.get(selection.type) : undefined

  const onSearchKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((i) => Math.min(results.length - 1, i + 1)) }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
    else if (event.key === "Enter" && results[active]) { event.preventDefault(); open(results[active].type, results[active].field); setQuery("") }
    else if (event.key === "Escape" && query) { event.stopPropagation(); setQuery("") }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-border p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKey}
            placeholder={f(t.graphql.search, { mod: modLabel })}
            aria-label={t.graphql.searchLabel}
            spellCheck={false}
            className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-7 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
          {query && (
            <button aria-label={t.graphql.clearSearch} onClick={() => setQuery("")} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        {!query && !selected && (
          <div role="tablist" className="flex rounded-lg border border-border p-0.5 text-xs">
            {(["types", "files"] as const).map((option) => (
              <button
                key={option}
                role="tab"
                aria-selected={tab === option}
                onClick={() => setTab(option)}
                className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring", tab === option ? "bg-accent font-medium" : "text-muted-foreground")}
              >
                {option === "types" ? t.graphql.types : t.graphql.files}
                {option === "files" && errors > 0 && <span className="rounded-full bg-destructive/15 px-1.5 text-[0.625rem] text-destructive">{errors}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
        {query ? (
          <SearchResults model={model} results={results} active={active} drawn={drawn} onOpen={(r) => { open(r.type, r.field); setQuery("") }} />
        ) : selected ? (
          <TypeDetails key={selected.name} visited={visited.current} files={files} model={model} type={selected} field={selection?.field ?? null} drawn={drawn.has(selected.name)} onOpen={open} onShowAll={onShowAll} />
        ) : tab === "types" ? (
          <TypeBrowser model={model} drawn={drawn} onOpen={open} />
        ) : (
          <FileList model={model} sources={sources} files={files} />
        )}
      </div>
    </div>
  )
})

function SearchResults({ model, results, active, drawn, onOpen }: { model: SchemaModel; results: Result[]; active: number; drawn: Set<string>; onOpen: (result: Result) => void }) {
  const { t } = useI18n()
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => { list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" }) }, [active])
  if (results.length === 0) return <p className="p-4 text-center text-xs text-muted-foreground">{t.graphql.noResults}</p>
  return (
    <div ref={list} role="listbox" aria-label={t.graphql.searchLabel} className="p-1">
      {results.map((result, index) => {
        const type = model.types.get(result.type)
        return (
          <button
            key={result.key}
            data-index={index}
            role="option"
            aria-selected={index === active}
            onClick={() => onOpen(result)}
            className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs outline-none hover:bg-accent", index === active && "bg-accent")}
          >
            <KindIcon type={type} />
            {result.field ? (
              <span className="min-w-0 truncate font-mono"><span className="text-muted-foreground">{result.type}.</span>{result.field}</span>
            ) : (
              <span className="min-w-0 truncate font-medium">{result.type}</span>
            )}
            {!drawn.has(result.type) && <EyeOff aria-label={t.graphql.notDrawn} className="ml-auto size-3 shrink-0 text-muted-foreground" />}
          </button>
        )
      })}
    </div>
  )
}

function TypeBrowser({ model, drawn, onOpen }: { model: SchemaModel; drawn: Set<string>; onOpen: (type: string) => void }) {
  const { t, f } = useI18n()
  const roots = (["query", "mutation", "subscription"] as const).flatMap((key) => (model.roots[key] ? [model.types.get(model.roots[key])!] : []))
  const groups = KIND_ORDER.map((kind) => ({
    kind,
    types: [...model.types.values()].filter((type) => !type.builtIn && kindOf(type) === kind && !roots.includes(type)).sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((group) => group.types.length > 0)

  const item = (type: SchemaType) => {
    const count = type.fields.length || type.values.length || type.members.length
    return (
      <button key={type.name} onClick={() => onOpen(type.name)} className="group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs outline-none hover:bg-accent focus-visible:bg-accent">
        <KindIcon type={type} />
        <span className={cn("min-w-0 truncate", type.missing && "text-destructive")}>{type.name}</span>
        {!drawn.has(type.name) && (type.kind === "object" || type.kind === "interface" || type.kind === "union" || type.kind === "input") && !type.missing && (
          <EyeOff aria-label={t.graphql.notDrawn} className="size-3 shrink-0 text-muted-foreground/70" />
        )}
        {count > 0 && <span className="ml-auto shrink-0 tabular-nums text-[0.625rem] text-muted-foreground">{count}</span>}
      </button>
    )
  }

  if (model.types.size === 0 || groups.length === 0 && roots.length === 0) return <p className="p-4 text-center text-xs text-muted-foreground">{t.graphql.noTypes}</p>
  return (
    <div className="space-y-1 p-1">
      {roots.length > 0 && <Group title={t.graphql.rootTypes} count={roots.length} defaultOpen>{() => roots.map(item)}</Group>}
      {groups.map((group) => (
        <Group key={group.kind} title={group.kind === "external" ? t.graphql.externalGroup : f(t.graphql.kindPlural, { kind: KINDS[group.kind].label(t) })} count={group.types.length} defaultOpen={group.kind !== "scalar" && group.kind !== "external" && group.types.length <= 40}>
          {() => group.types.map(item)}
        </Group>
      ))}
    </div>
  )
}

function Group({ title, count, defaultOpen, children }: { title: string; count: number; defaultOpen?: boolean; children: () => React.ReactNode }) {
  // Closed groups render no items: a big schema has thousands of types.
  const [open, setOpen] = useState(defaultOpen ?? false)
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="group/g">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md px-2 py-1.5 text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3 transition group-open/g:rotate-90" />
        {title}
        <span className="ml-auto font-normal tabular-nums tracking-normal">{count}</span>
      </summary>
      {open && <div className="pb-1">{children()}</div>}
    </details>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border px-3 py-2.5">
      <h4 className="mb-1.5 text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</h4>
      {children}
    </section>
  )
}

function TypeDetails({ visited, files, model, type, field, drawn, onOpen, onShowAll }: {
  visited: string[]
  files: FileSelection
  model: SchemaModel
  type: SchemaType
  field: string | null
  drawn: boolean
  onOpen: (type: string, field?: string | null) => void
  onShowAll: (type: string) => void
}) {
  const { t, f } = useI18n()
  const { notify } = useNotifications()
  const { select, openTree } = useMap()
  const [copied, setCopied] = useState(false)
  const kind = KINDS[kindOf(type)]
  const fieldRef = useRef<HTMLDivElement>(null)
  // Navigation history inside the panel, like Voyager's doc explorer.
  const history = useHistory(type.name, visited)

  useEffect(() => { if (field) fieldRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }) }, [field])

  const referencedBy = useMemo(() => {
    const seen = new Set<string>()
    return (model.referencedBy.get(type.name) ?? []).filter((ref) => {
      const key = `${ref.type}.${ref.field ?? ""}`
      if (seen.has(key) || ref.type === type.name) return false
      seen.add(key)
      return true
    })
  }, [model, type.name])

  const sdl = type.sources.map((source) => source.sdl).join("\n\n")
  const copy = () => void navigator.clipboard?.writeText(sdl).then(() => {
    setCopied(true)
    notify(t.graphql.copied, { tone: "success", duration: 1500 })
  })

  const fieldRow = (item: SchemaField) => {
    const open = field === item.name
    return (
      <div key={item.name} ref={open ? fieldRef : undefined} className={cn("rounded-md px-2 py-1.5", open && "bg-primary/8 ring-1 ring-primary/30")}>
        <div className="text-xs">
          <button type="button" aria-expanded={open} onClick={() => select(type.name, open ? null : item.name)} className="rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className={cn("font-mono font-medium", item.deprecated && "text-muted-foreground line-through")}>{item.name}</span>
            {item.args.length > 0 && <span className="font-mono text-muted-foreground">{open ? "(" : "(…)"}</span>}
          </button>
          {!(open && item.args.length > 0) && <><span className="font-mono text-muted-foreground">: </span><TypeLink model={model} type={item.type} onOpen={onOpen} /></>}
        </div>
        {open && item.args.length > 0 && (
          <div className="my-1 space-y-1 border-l-2 border-border pl-3">
            {item.args.map((arg) => (
              <div key={arg.name} className="text-xs">
                <span className="font-mono">{arg.name}</span><span className="font-mono text-muted-foreground">: </span>
                <TypeLink model={model} type={arg.type} onOpen={onOpen} />
                {arg.defaultValue !== null && <span className="font-mono text-muted-foreground"> = {arg.defaultValue}</span>}
                {arg.description && <p className="text-[0.6875rem] text-muted-foreground">{arg.description}</p>}
              </div>
            ))}
          </div>
        )}
        {open && item.args.length > 0 && <span className="font-mono text-xs text-muted-foreground">): <TypeLink model={model} type={item.type} onOpen={onOpen} /></span>}
        {item.description && <p className={cn("mt-0.5 text-[0.6875rem] leading-4 text-muted-foreground", !open && "line-clamp-2")}>{item.description}</p>}
        {item.deprecated && <p className="mt-0.5 text-[0.6875rem] text-warning">{f(t.graphql.deprecated, { reason: item.deprecated })}</p>}
      </div>
    )
  }

  return (
    <div className="pb-4">
      <div className="flex items-center gap-1 px-2 pt-2">
        <button
          onClick={() => { const previous = history.back(); select(previous ?? "", null, previous !== null) }}
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[0.6875rem] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-3.5" /> {history.previous ?? t.graphql.allTypes}
        </button>
      </div>
      <header className="px-3 pb-3 pt-1">
        <div className="flex items-center gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-md" style={{ background: `color-mix(in oklab, ${kind.color} 18%, transparent)` }}>
            <KindIcon type={type} />
          </span>
          <h3 className="min-w-0 truncate text-sm font-semibold">{type.name}</h3>
          <Badge variant="outline" className="ml-auto">{kind.label(t)}</Badge>
          <Tooltip label={f(t.graphql.tree.openHint, { name: field ? `${type.name}.${field}` : type.name })}>
            <button
              aria-label={f(t.graphql.tree.openHint, { name: field ? `${type.name}.${field}` : type.name })}
              onClick={() => openTree(type.name, field)}
              className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ListTree className="size-3.5" />
            </button>
          </Tooltip>
        </div>
        {type.description && <p className="mt-2 whitespace-pre-line text-xs leading-5 text-muted-foreground">{type.description}</p>}
        {type.missing && <p className="mt-2 text-xs text-destructive">{t.graphql.missingHint}</p>}
        {type.external && (
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-[0.6875rem] text-muted-foreground">
            <span className="min-w-0 flex-1">{f(t.graphql.externalHint, { path: type.external.path })}</span>
            <button onClick={() => files.setIncluded(type.external!.root, [type.external!.path], true)} className="shrink-0 font-medium text-primary hover:underline">{t.graphql.checkFile}</button>
          </div>
        )}
        {!drawn && !type.builtIn && !type.missing && type.kind !== "scalar" && type.kind !== "enum" && (
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-[0.6875rem] text-muted-foreground">
            <EyeOff className="size-3.5 shrink-0" />
            <span className="flex-1">{t.graphql.notDrawnHint}</span>
            <button onClick={() => onShowAll(type.name)} className="shrink-0 font-medium text-primary hover:underline">{t.graphql.showOnMap}</button>
          </div>
        )}
        {type.interfaces.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1 text-[0.6875rem] text-muted-foreground">
            {t.graphql.implements}
            {type.interfaces.map((name) => <TypeLink key={name} model={model} type={{ name, label: name, list: false }} onOpen={onOpen} />)}
          </div>
        )}
      </header>

      {type.fields.length > 0 && <Section title={f(t.graphql.fieldsCount, { count: type.fields.length })}><div className="-mx-2 space-y-0.5">{type.fields.map(fieldRow)}</div></Section>}
      {type.values.length > 0 && (
        <Section title={f(t.graphql.valuesCount, { count: type.values.length })}>
          <div className="space-y-1.5">
            {type.values.map((value) => (
              <div key={value.name} className="text-xs">
                <span className={cn("font-mono", value.deprecated && "text-muted-foreground line-through")}>{value.name}</span>
                {value.description && <p className="text-[0.6875rem] text-muted-foreground">{value.description}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}
      {type.members.length > 0 && (
        <Section title={t.graphql.members}>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">{type.members.map((name) => <TypeLink key={name} model={model} type={{ name, label: name, list: false }} onOpen={onOpen} />)}</div>
        </Section>
      )}
      {(model.implementations.get(type.name)?.length ?? 0) > 0 && (
        <Section title={t.graphql.implementedBy}>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">{model.implementations.get(type.name)!.map((name) => <TypeLink key={name} model={model} type={{ name, label: name, list: false }} onOpen={onOpen} />)}</div>
        </Section>
      )}
      {referencedBy.length > 0 && (
        <Section title={f(t.graphql.referencedBy, { count: referencedBy.length })}>
          <div className="space-y-0.5">
            {referencedBy.slice(0, 50).map((ref) => (
              <button key={`${ref.type}.${ref.field}`} onClick={() => onOpen(ref.type, ref.field)} className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left font-mono text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                <KindIcon type={model.types.get(ref.type)} className="size-3" />
                <span>{ref.type}</span>{ref.field && <span className="text-muted-foreground">.{ref.field}</span>}
              </button>
            ))}
            {referencedBy.length > 50 && <p className="px-1 text-[0.6875rem] text-muted-foreground">{f(t.graphql.more, { count: referencedBy.length - 50 })}</p>}
          </div>
        </Section>
      )}
      {type.sources.length > 0 && (
        <Section title={t.graphql.definedIn}>
          <div className="space-y-0.5">
            {type.sources.map((source, index) => (
              <div key={index} className="group/src flex items-center gap-1">
                <Tooltip label={source.root}>
                  <p className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-muted-foreground"><FileCode2 className="mr-1 inline size-3" />{source.path}:{source.line}</p>
                </Tooltip>
                <button
                  onClick={() => files.only([{ root: source.root, path: source.path }])}
                  className="shrink-0 rounded px-1 text-[0.625rem] font-medium text-primary opacity-0 outline-none hover:underline focus-visible:opacity-100 group-hover/src:opacity-100"
                >
                  {t.graphql.onlyThisFile}
                </button>
              </div>
            ))}
          </div>
          <details className="group/sdl mt-2">
            <summary className="flex cursor-pointer list-none items-center gap-1 text-[0.6875rem] font-medium text-muted-foreground outline-none hover:text-foreground [&::-webkit-details-marker]:hidden">
              <ChevronRight className="size-3 transition group-open/sdl:rotate-90" /> {t.graphql.sdl}
              <button onClick={(event) => { event.preventDefault(); copy() }} className="ml-auto flex items-center gap-1 rounded px-1 hover:text-foreground">
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />} {t.graphql.copySdl}
              </button>
            </summary>
            <pre className="thin-scrollbar mt-1.5 max-h-72 overflow-auto rounded-lg bg-muted p-2 font-mono text-[0.6875rem] leading-4">{sdl}</pre>
          </details>
        </Section>
      )}
    </div>
  )
}

/** Remembers visited types so the panel's Back returns to the previous one. */
function useHistory(current: string, visited: string[]) {
  useEffect(() => {
    if (visited.at(-1) !== current) visited.push(current)
    if (visited.length > 50) visited.splice(0, visited.length - 50)
  }, [current, visited])
  const index = visited.at(-1) === current ? visited.length - 2 : visited.length - 1
  return {
    previous: index >= 0 ? visited[index] : null,
    back() {
      if (visited.at(-1) === current) visited.pop()
      return visited.pop() ?? null
    },
  }
}

function Checkbox({ checked, label, onChange }: { checked: boolean | "mixed"; label: string; onChange: (checked: boolean) => void }) {
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={(event) => { event.stopPropagation(); onChange(checked !== true) }}
      className={cn(
        "grid size-3.5 shrink-0 place-items-center rounded-[4px] border outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
        checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50 bg-background",
      )}
    >
      {checked === true && <Check className="size-2.5" strokeWidth={3} />}
      {checked === "mixed" && <span className="h-0.5 w-2 rounded bg-current" />}
    </button>
  )
}

function FileList({ model, sources, files }: { model: SchemaModel; sources: SourceState[]; files: FileSelection }) {
  const { t, f } = useI18n()
  const [filter, setFilter] = useState("")
  const reports = useMemo(() => new Map(model.files.map((file) => [`${file.root}\0${file.path}`, file])), [model])
  const q = filter.trim().toLowerCase()
  const total = sources.reduce((sum, s) => sum + (s.scan?.files.length ?? 0), 0)
  const checked = sources.reduce((sum, s) => sum + (s.scan?.files.filter((file) => files.isIncluded(s.path, file.path)).length ?? 0), 0)
  return (
    <div className="space-y-3 p-2">
      <div className="space-y-1.5">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t.graphql.filterFiles}
          aria-label={t.graphql.filterFiles}
          spellCheck={false}
          className="h-7 w-full rounded-md border border-border bg-background px-2 text-[0.6875rem] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
        <div className="flex items-center gap-1 px-1 text-[0.6875rem] text-muted-foreground">
          <span className="tabular-nums">{f(t.graphql.filesOf, { selected: checked, total })}</span>
          <button onClick={() => sources.forEach((s) => files.setIncluded(s.path, visible(s, q).map((file) => file.path), true))} className="ml-auto rounded px-1.5 py-0.5 font-medium hover:bg-accent hover:text-foreground">{t.graphql.allFiles}</button>
          <button onClick={() => sources.forEach((s) => files.setIncluded(s.path, visible(s, q).map((file) => file.path), false))} className="rounded px-1.5 py-0.5 font-medium hover:bg-accent hover:text-foreground">{t.graphql.noFiles2}</button>
        </div>
      </div>
      {model.warnings.length > 0 && (
        <div className="space-y-1 rounded-lg bg-warning/10 p-2 text-[0.6875rem] text-warning">
          {model.warnings.slice(0, 20).map((warning, index) => <p key={index}>{warning}</p>)}
        </div>
      )}
      {sources.map((source) => {
        const shown = visible(source, q)
        const inFolder = source.scan?.files ?? []
        const on = inFolder.filter((file) => files.isIncluded(source.path, file.path)).length
        const state = on === 0 ? false : on === inFolder.length ? true : "mixed"
        return (
          <section key={source.path}>
            <div className="flex items-center gap-2 px-1">
              {inFolder.length > 0 && <Checkbox checked={state} label={f(t.graphql.toggleFolder, { name: source.label })} onChange={(value) => files.setIncluded(source.path, inFolder.map((file) => file.path), value)} />}
              <h4 className="min-w-0 flex-1 truncate text-[0.6875rem] font-semibold" title={source.path}>{source.label}</h4>
              {inFolder.length > 0 && <span className="shrink-0 text-[0.625rem] tabular-nums text-muted-foreground">{f(t.graphql.folderFiles, { selected: on, total: inFolder.length })}</span>}
            </div>
            <p className="truncate px-1 pb-1 font-mono text-[0.625rem] text-muted-foreground">{source.path}</p>
            {source.status === "error" && <p className="px-1 text-[0.6875rem] text-destructive">{source.error}</p>}
            {source.scan?.truncated && <p className="px-1 text-[0.6875rem] text-warning">{t.graphql.truncated}</p>}
            {(source.scan?.skipped ?? 0) > 0 && <p className="px-1 text-[0.6875rem] text-warning">{f(t.graphql.skipped, { count: source.scan!.skipped })}</p>}
            {source.status === "ready" && inFolder.length === 0 && <p className="px-1 text-[0.6875rem] text-muted-foreground">{t.graphql.noFilesHere}</p>}
            {inFolder.length > 0 && shown.length === 0 && <p className="px-1 text-[0.6875rem] text-muted-foreground">{t.graphql.noFileMatch}</p>}
            {shown.map((file) => {
              const included = files.isIncluded(source.path, file.path)
              const report = included ? reports.get(`${source.path}\0${file.path}`) : undefined
              return (
                <div
                  key={file.path}
                  onClick={() => files.setIncluded(source.path, [file.path], !included)}
                  className="group/file cursor-pointer rounded-md px-1 py-1 text-xs hover:bg-accent/60"
                >
                  <div className="flex items-center gap-2">
                    <Checkbox checked={included} label={file.path} onChange={(value) => files.setIncluded(source.path, [file.path], value)} />
                    {report?.error && <FileWarning className="size-3.5 shrink-0 text-destructive" />}
                    <span className={cn("min-w-0 truncate font-mono text-[0.6875rem]", !included && "text-muted-foreground")} title={file.path}>{file.path}</span>
                    <button
                      onClick={(event) => { event.stopPropagation(); files.only([{ root: source.path, path: file.path }]) }}
                      title={t.graphql.onlyFileHint}
                      className="ml-auto hidden shrink-0 rounded px-1 text-[0.625rem] font-medium text-primary hover:underline group-hover/file:block"
                    >
                      {t.graphql.onlyFile}
                    </button>
                    {report && !report.error && <span className="shrink-0 text-[0.625rem] tabular-nums text-muted-foreground group-hover/file:hidden">{f(t.graphql.typeCount, { count: report.types })}</span>}
                  </div>
                  {report?.error && <p className="ml-5 mt-0.5 text-[0.6875rem] text-destructive">{f(t.graphql.parseError, { line: report.error.line, column: report.error.column, message: report.error.message })}</p>}
                </div>
              )
            })}
          </section>
        )
      })}
    </div>
  )
}

function visible(source: SourceState, query: string) {
  const files = source.scan?.files ?? []
  return query ? files.filter((file) => file.path.toLowerCase().includes(query)) : files
}
