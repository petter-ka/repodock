import { ArrowDown, ArrowLeft, ArrowUp, ChevronRight, ListTree, Repeat, X } from "lucide-react"
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { KindIcon } from "./DocsPanel"
import { KINDS, kindOf } from "./kinds"
import { useMap } from "./MapContext"
import type { SchemaModel } from "./model"
import { flattenTree, ROOT_PATH, rootItem, TREE_PAGE, treeChildren, type TreeItem, type TreeMode, type TreeRoot, type TreeRow } from "./tree"

const rootName = (root: TreeRoot) => (root.field ? `${root.type}.${root.field}` : root.type)

/**
 * The selected type or field as a tree: "Fields" goes down into what it
 * contains, "Used by" goes up to where it is used (ADR-0029). Clicking a row
 * selects it on the map; double-click (or Shift+Enter) makes it the root.
 */
export function TreePanel({ model, root, back, mode, onMode, onOpen, onBack, onClose }: {
  model: SchemaModel
  root: TreeRoot
  /** previous roots, newest last */
  back: TreeRoot[]
  mode: TreeMode
  onMode: (mode: TreeMode) => void
  onOpen: (root: TreeRoot) => void
  onBack: () => void
  onClose: () => void
}) {
  const { t, f } = useI18n()
  const item = useMemo(() => rootItem(model, root, mode), [model, root, mode])
  const previous = back.at(-1)
  if (!item) return null

  return (
    <aside
      onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose() } }}
      className="flex w-[320px] shrink-0 flex-col border-r border-border bg-card"
    >
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border py-1.5 pl-3 pr-1.5">
        <ListTree className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-semibold">{t.graphql.tree.title}</span>
        <div className="ml-auto flex items-center">
          {previous && (
            <Tooltip label={f(t.graphql.tree.back, { name: rootName(previous) })}>
              <Button size="icon-sm" variant="ghost" aria-label={f(t.graphql.tree.back, { name: rootName(previous) })} onClick={onBack}><ArrowLeft /></Button>
            </Tooltip>
          )}
          <Tooltip label={t.graphql.tree.close}>
            <Button size="icon-sm" variant="ghost" aria-label={t.graphql.tree.close} onClick={onClose}><X /></Button>
          </Tooltip>
        </div>
      </div>
      <div className="shrink-0 border-b border-border p-2">
        <div role="radiogroup" aria-label={t.graphql.tree.title} className="flex rounded-lg border border-border p-0.5 text-xs">
          {(["down", "up"] as const).map((option) => (
            <Tooltip key={option} label={option === "down" ? t.graphql.tree.downHint : t.graphql.tree.upHint}>
              <button
                role="radio"
                aria-checked={mode === option}
                onClick={() => onMode(option)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  mode === option ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option === "down" ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />}
                {option === "down" ? t.graphql.tree.down : t.graphql.tree.up}
              </button>
            </Tooltip>
          ))}
        </div>
      </div>
      {/* A new root or direction starts a fresh tree (expansion, cursor). */}
      <TreeBody key={`${mode}|${item.type}|${item.field ?? ""}`} model={model} mode={mode} root={item} onOpen={onOpen} />
      <p className="shrink-0 border-t border-border px-3 py-1.5 text-[0.625rem] leading-4 text-muted-foreground">{t.graphql.tree.hint}</p>
    </aside>
  )
}

function TreeBody({ model, mode, root, onOpen }: { model: SchemaModel; mode: TreeMode; root: TreeItem; onOpen: (root: TreeRoot) => void }) {
  const { t, f } = useI18n()
  const { select } = useMap()
  const id = useId()
  const list = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([ROOT_PATH]))
  const [shown, setShown] = useState<ReadonlyMap<string, number>>(() => new Map())
  const [active, setActive] = useState(ROOT_PATH)

  // Children are computed once per type while the tree is open.
  const children = useMemo(() => {
    const cache = new Map<string, TreeItem[]>()
    return (name: string) => {
      let items = cache.get(name)
      if (!items) cache.set(name, items = treeChildren(model, mode, name))
      return items
    }
  }, [model, mode])
  const rows = useMemo(() => flattenTree(root, children, expanded, shown), [root, children, expanded, shown])
  const roots = useMemo(() => new Set(Object.values(model.roots).filter((name): name is string => name !== null)), [model])
  const activeIndex = Math.max(0, rows.findIndex((row) => row.path === active))

  useEffect(() => { list.current?.focus({ preventScroll: true }) }, [])
  useEffect(() => { list.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" }) }, [activeIndex])

  const toggle = useCallback((path: string, open?: boolean) => setExpanded((current) => {
    const next = new Set(current)
    if (open ?? !current.has(path)) next.add(path)
    else next.delete(path)
    return next
  }), [])
  const more = (parent: string) => setShown((current) => new Map(current).set(parent, (current.get(parent) ?? TREE_PAGE) + TREE_PAGE))
  const show = (item: TreeItem) => select(item.type, item.field, true)
  const reroot = (item: TreeItem) => {
    if (item.next !== null) onOpen({ type: item.type, field: item.relation === "field" || item.relation === "argument" ? item.field : null })
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    const row = rows[activeIndex]
    const move = (index: number) => setActive(rows[Math.max(0, Math.min(rows.length - 1, index))].path)
    switch (event.key) {
      case "ArrowDown": move(activeIndex + 1); break
      case "ArrowUp": move(activeIndex - 1); break
      case "Home": move(0); break
      case "End": move(rows.length - 1); break
      case "ArrowRight":
        if (row.kind === "item" && row.expandable) {
          if (row.expanded) move(activeIndex + 1)
          else toggle(row.path, true)
        }
        break
      case "ArrowLeft":
        if (row.kind === "item" && row.expanded) toggle(row.path, false)
        else if (row.parent !== null) setActive(row.parent)
        break
      case "Enter":
        if (row.kind === "more") more(row.parent)
        else if (event.shiftKey) reroot(row.item)
        else show(row.item)
        break
      default:
        return
    }
    event.preventDefault()
    event.stopPropagation()
  }

  const empty = rows.length === 1
    ? mode === "down" ? t.graphql.tree.noChildren : roots.has(root.next ?? "") ? t.graphql.tree.rootTypeHint : t.graphql.tree.noParents
    : null

  return (
    <div
      ref={list}
      role="tree"
      aria-label={f(t.graphql.tree.label, { name: root.field ? `${root.type}.${root.field}` : root.type })}
      aria-activedescendant={`${id}-${activeIndex}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="group/tree thin-scrollbar min-h-0 flex-1 overflow-y-auto py-1 outline-none"
    >
      {rows.map((row, index) => (
        <div
          key={row.path}
          id={`${id}-${index}`}
          data-index={index}
          role="treeitem"
          aria-level={row.level + 1}
          aria-expanded={row.kind === "item" && row.expandable ? row.expanded : undefined}
          aria-selected={index === activeIndex}
          onClick={() => {
            setActive(row.path)
            if (row.kind === "more") more(row.parent)
            else show(row.item)
          }}
          onDoubleClick={() => { if (row.kind === "item" && row.parent !== null) reroot(row.item) }}
          className={cn(
            "group/row flex h-6 cursor-pointer items-center gap-1 pr-1.5 text-xs",
            index === activeIndex ? "bg-accent group-focus-visible/tree:ring-1 group-focus-visible/tree:ring-inset group-focus-visible/tree:ring-ring" : "hover:bg-accent/60",
          )}
          style={{ paddingLeft: 6 + row.level * 14 }}
        >
          {row.kind === "more" ? (
            <span className="pl-5 text-[0.6875rem] font-medium text-primary">{f(t.graphql.tree.more, { count: Math.min(TREE_PAGE, row.hidden) })}</span>
          ) : (
            <>
              {row.expandable ? (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden
                  onClick={(event) => { event.stopPropagation(); setActive(row.path); toggle(row.path) }}
                  onDoubleClick={(event) => event.stopPropagation()}
                  className="grid size-4 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground"
                >
                  <ChevronRight className={cn("size-3 transition-transform", row.expanded && "rotate-90")} />
                </button>
              ) : (
                <span className="size-4 shrink-0" />
              )}
              <RowLabel model={model} mode={mode} row={row} isRoot={roots.has(row.item.next ?? "")} />
              {row.parent !== null && row.item.next !== null && (
                <button
                  type="button"
                  tabIndex={-1}
                  title={t.graphql.tree.reroot}
                  aria-label={t.graphql.tree.reroot}
                  onClick={(event) => { event.stopPropagation(); reroot(row.item) }}
                  onDoubleClick={(event) => event.stopPropagation()}
                  className="grid size-4 shrink-0 place-items-center rounded text-muted-foreground opacity-0 hover:text-foreground group-hover/row:opacity-100"
                >
                  <ListTree className="size-3" />
                </button>
              )}
            </>
          )}
        </div>
      ))}
      {empty && <p className="px-3 py-2 text-[0.6875rem] text-muted-foreground">{empty}</p>}
    </div>
  )
}

function RowLabel({ model, mode, row, isRoot }: { model: SchemaModel; mode: TreeMode; row: Extract<TreeRow, { kind: "item" }>; isRoot: boolean }) {
  const { t } = useI18n()
  const { item } = row
  const hints: Partial<Record<TreeItem["relation"], string>> = {
    type: KINDS[kindOf(model.types.get(item.type))].label(t),
    member: t.graphql.tree.member, implementation: t.graphql.tree.implementation, memberOf: t.graphql.tree.memberOf, implements: t.graphql.tree.implements,
  }
  const hint = hints[item.relation]
  // Going down a field reads "name: Type" under its owner; going up (and at
  // the root) the owner is spelled out, since it is the row's own type.
  const qualified = mode === "up" || row.parent === null
  const labelColor = mode === "down" && item.next ? KINDS[kindOf(model.types.get(item.next))].color : "var(--muted-foreground)"

  return (
    <>
      {(item.relation !== "field" || qualified) && item.relation !== "value" && (
        <KindIcon type={model.types.get(item.relation === "field" || item.relation === "argument" ? item.type : item.next ?? item.type)} className="size-3" />
      )}
      {item.relation === "value" && <span className="size-1 shrink-0 rounded-full bg-muted-foreground/60" />}
      <span
        className={cn(
          "max-w-full shrink-0 truncate",
          item.relation === "field" || item.relation === "argument" || item.relation === "value" ? "font-mono text-[0.6875rem]" : "font-medium",
          row.parent === null && "font-semibold",
          item.deprecated && "text-muted-foreground line-through",
        )}
      >
        {item.relation === "field" || item.relation === "argument" ? (
          <>
            {qualified && <span className="font-sans font-medium">{item.type}</span>}
            {qualified ? <span className="text-muted-foreground">.{item.field}</span> : item.field}
            {item.relation === "argument" ? <span className="text-muted-foreground">({item.arg})</span> : item.args > 0 && <span className="text-muted-foreground">(…)</span>}
          </>
        ) : item.relation === "value" ? item.field : item.type}
      </span>
      {row.recursive && (
        <span title={t.graphql.tree.recursive} className="shrink-0 text-muted-foreground"><Repeat aria-label={t.graphql.tree.recursive} className="size-3" /></span>
      )}
      {mode === "up" && isRoot && <span className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[0.625rem] font-medium text-primary">{t.graphql.root}</span>}
      <span className="ml-auto min-w-0 truncate pl-1 font-mono text-[0.6875rem]" style={{ color: labelColor }}>
        {hint !== undefined ? <span className="font-sans text-muted-foreground">{hint}</span> : item.label}
      </span>
    </>
  )
}
