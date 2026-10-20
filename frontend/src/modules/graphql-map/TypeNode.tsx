import { useStore, type Node, type NodeProps } from "@xyflow/react"
import { Link2, ListTree } from "lucide-react"
import { memo } from "react"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { METRICS, type GraphNode } from "./graph"
import { KINDS, kindOf, type KindKey } from "./kinds"
import { useMap, useNodeState } from "./MapContext"

export type TypeNodeType = Node<{ node: GraphNode; targetKinds: Record<string, KindKey> }, "gqlType">

/** Below this zoom, field rows are unreadable: nodes draw a label instead (level of detail). */
export const DETAIL_ZOOM = 0.45

/**
 * A type card: header plus one row per field / member / implementation.
 * There are no React Flow handles (edges are drawn by EdgeLayer from the
 * known row metrics) and rows share one click handler, so a big map stays
 * cheap to render.
 */
export const TypeNode = memo(function TypeNode({ data }: NodeProps<TypeNodeType>) {
  const { node } = data
  const detailed = useStore((s) => s.transform[2] >= DETAIL_ZOOM)
  const state = useNodeState(node.name)
  const { select } = useMap()
  const kind = KINDS[kindOf(node.type)]
  const selected = state.startsWith("selected")

  const rowOf = (event: React.MouseEvent) => (event.target as HTMLElement).closest<HTMLElement>("[data-row]")?.dataset.row ?? null

  return (
    <div
      data-hot={state ? "" : undefined}
      onClick={(event) => {
        const row = detailed ? rowOf(event) : null
        select(node.name, row)
      }}
      onDoubleClick={(event) => {
        const row = node.rows.find((r) => r.name === rowOf(event))
        if (row?.target) select(row.target, null, true)
      }}
      className={cn(
        // React Flow turns pointer events off on nodes that are neither draggable
        // nor selectable; the card takes them back for its own click handling.
        // nopan: pressing on a type never pans the map, so a click always selects.
        "gql-node nopan pointer-events-auto cursor-default overflow-hidden rounded-xl border bg-card text-card-foreground",
        selected ? "border-primary shadow-lg ring-2 ring-primary/30" : "border-border",
      )}
      style={{ width: node.width, height: node.height }}
    >
      {detailed ? <Detailed data={data} selected={selected} field={selected ? state.slice("selected:".length) || null : null} /> : <Overview node={node} color={kind.color} />}
    </div>
  )
})

function Header({ node, selected }: { node: GraphNode; selected: boolean }) {
  const { t } = useI18n()
  const { openTree } = useMap()
  const kind = KINDS[kindOf(node.type)]
  const Icon = kind.icon
  return (
    <div className="relative flex items-center gap-2 border-b border-border px-3" style={{ height: METRICS.header }}>
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: kind.color }} />
      <span className="grid size-5 shrink-0 place-items-center rounded-md" style={{ background: `color-mix(in oklab, ${kind.color} 18%, transparent)`, color: kind.color }}>
        <Icon className="size-3" />
      </span>
      <span className="min-w-0 truncate text-[13px] font-semibold">{node.name}</span>
      {node.isRoot && <span className="ml-auto rounded-full bg-primary/15 px-1.5 text-[10px] font-medium text-primary">{t.graphql.root}</span>}
      {selected && <TreeButton name={node.name} className={cn(!node.isRoot && "ml-auto")} onOpen={() => openTree(node.name)} />}
    </div>
  )
}

function Detailed({ data, selected, field }: { data: TypeNodeType["data"]; selected: boolean; field: string | null }) {
  const { t, f } = useI18n()
  const { openTree } = useMap()
  const { node, targetKinds } = data
  const firstImplementation = node.rows.findIndex((row) => row.role === "implementation")
  return (
    <>
      <Header node={node} selected={selected} />
      <div style={{ paddingBottom: METRICS.padding }}>
        {node.rows.map((row, index) => (
          <div key={row.id}>
            {index === firstImplementation && (
              <div className="flex items-center px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground" style={{ height: METRICS.section }}>
                {t.graphql.implementedBy}
              </div>
            )}
            <div
              data-row={row.name}
              title={row.target ? f(t.graphql.rowHint, { type: row.target }) : undefined}
              className={cn("flex cursor-pointer items-center gap-2 px-3 font-mono text-[11px] hover:bg-accent/70", field === row.name && "bg-primary/12 hover:bg-primary/15")}
              style={{ height: METRICS.row }}
            >
              {/* The field name keeps its width; the type label gives way and truncates first. */}
              <span className={cn("max-w-full shrink-0 truncate", row.deprecated ? "text-muted-foreground line-through" : "text-foreground", row.role !== "field" && "font-sans font-medium")}>
                {row.name}
                {row.args > 0 && <span className="text-muted-foreground">(…)</span>}
              </span>
              {row.relay && <Link2 aria-label={t.graphql.relayRow} className="size-3 shrink-0 text-muted-foreground" />}
              <span className="ml-auto min-w-0 truncate" style={{ color: row.target ? KINDS[targetKinds[row.target] ?? "object"].color : "var(--muted-foreground)" }}>
                {row.label}
              </span>
              {field === row.name && <TreeButton name={`${node.name}.${row.name}`} className="-mr-1.5" onOpen={() => openTree(node.name, row.name)} />}
            </div>
          </div>
        ))}
        {node.hiddenLeaves > 0 && (
          <div className="flex items-center px-3 text-[10px] text-muted-foreground" style={{ height: METRICS.footer }}>
            {f(t.graphql.hiddenLeaves, { count: node.hiddenLeaves })}
          </div>
        )}
      </div>
    </>
  )
}

/** Opens the tree panel; on the selected card's header and selected row. */
function TreeButton({ name, className, onOpen }: { name: string; className?: string; onOpen: () => void }) {
  const { t, f } = useI18n()
  const label = f(t.graphql.tree.openHint, { name })
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(event) => { event.stopPropagation(); onOpen() }}
      onDoubleClick={(event) => event.stopPropagation()}
      className={cn("grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground", className)}
    >
      <ListTree className="size-3.5" />
    </button>
  )
}

/**
 * Zoomed-out card: a coloured strip and the type name, scaled up as the map
 * zooms out (via --gql-zoom on the canvas) so it stays legible, capped to
 * fit the card.
 */
function Overview({ node, color }: { node: GraphNode; color: string }) {
  const max = Math.max(13, Math.min((node.width - 24) / (node.name.length * 0.62), node.height * 0.6))
  return (
    <div className="relative flex h-full items-center justify-center px-3" style={{ background: `color-mix(in oklab, ${color} 7%, var(--card))` }}>
      <span className="absolute inset-x-0 top-0 h-2" style={{ background: color }} />
      <span className="truncate font-semibold leading-none" style={{ fontSize: `clamp(13px, calc(12px / var(--gql-zoom, 1)), ${max}px)` }}>{node.name}</span>
    </div>
  )
}
