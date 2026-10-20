import "@xyflow/react/dist/base.css"
import { Background, BackgroundVariant, getNodesBounds, getViewportForBounds, MiniMap, ReactFlow, useNodesState, useReactFlow, useStore, useStoreApi } from "@xyflow/react"
import { Loader2, Map as MapIcon, Maximize, Minus, Plus } from "lucide-react"
import { memo, useEffect, useMemo, useRef } from "react"
import { Tooltip } from "@/components/ui/tooltip"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { TypeGraph } from "./graph"
import { KINDS, kindOf, type KindKey } from "./kinds"
import { useLayout } from "./useLayout"
import { EdgeLayer } from "./EdgeLayer"
import { useMap } from "./MapContext"
import type { SchemaModel } from "./model"
import { TypeNode, type TypeNodeType } from "./TypeNode"

const nodeTypes = { gqlType: TypeNode }

/** Pans to a node; set from outside (search, docs links) through `reveal`. */
export type RevealRequest = { name: string; seq: number } | null

/** Below this zoom node text is unreadable, so the first view anchors on one type instead of fitting all. */
const READABLE_ZOOM = 0.6
const ANCHOR_ZOOM = 0.8

export const MapCanvas = memo(function MapCanvas({ model, graph, focus, reveal, showMinimap, onToggleMinimap }: {
  model: SchemaModel
  graph: TypeGraph
  /** the focused type, centred in the first view */
  focus: string | null
  reveal: RevealRequest
  showMinimap: boolean
  onToggleMinimap: () => void
}) {
  const { t, f } = useI18n()
  const { store: selection, select } = useMap()
  const flow = useReactFlow()
  const store = useStoreApi()
  const wrapper = useRef<HTMLDivElement>(null)

  // Dimming unrelated nodes is one attribute on the wrapper (see className),
  // set outside React so selecting never re-renders the whole canvas.
  useEffect(() => selection.subscribe(() => {
    wrapper.current?.toggleAttribute("data-selecting", selection.get() !== null)
  }), [selection])

  const { laid, pending } = useLayout(graph)
  // Until a big graph's layout arrives, the previous one stays on screen.
  const shown = laid?.graph

  const laidOut = useMemo<TypeNodeType[]>(() => {
    if (!laid) return []
    const { graph, positions } = laid
    const targetKinds: Record<string, KindKey> = {}
    for (const node of graph.nodes) targetKinds[node.name] = kindOf(node.type)
    return graph.nodes.map((node) => ({
      id: node.name,
      type: "gqlType",
      position: positions.get(node.name) ?? { x: 0, y: 0 },
      data: { node, targetKinds },
      width: node.width,
      height: node.height,
    }))
  }, [laid])

  // A new graph (options, sources, files) re-lays the nodes out.
  const [nodes, setNodes, onNodesChange] = useNodesState<TypeNodeType>(laidOut)
  useEffect(() => {
    setNodes(laidOut)
    // Fit everything when it stays readable; otherwise start at the focused
    // type (centred), or the root / leftmost type (left edge), like Voyager.
    const frame = requestAnimationFrame(() => {
      const { width, height } = store.getState()
      if (!width || !height || laidOut.length === 0) return
      const fit = getViewportForBounds(getNodesBounds(laidOut), width, height, 0.05, 1, 0.12)
      if (fit.zoom >= READABLE_ZOOM) return void flow.setViewport(fit, { duration: 300 })
      const focused = laidOut.find((node) => node.id === focus)
      const anchor = focused ?? laidOut.find((node) => node.data.node.isRoot) ?? laidOut.reduce((left, node) => (node.position.x < left.position.x ? node : left))
      const zoom = ANCHOR_ZOOM
      const { x, y } = anchor.position
      const w = anchor.width ?? 0
      const h = anchor.height ?? 0
      void flow.setViewport({
        zoom,
        x: focused ? width / 2 - (x + w / 2) * zoom : 32 - x * zoom,
        y: h * zoom > height - 48 ? 24 - y * zoom : height / 2 - (y + h / 2) * zoom,
      }, { duration: 300 })
    })
    return () => cancelAnimationFrame(frame)
  }, [laidOut, setNodes, flow, store, focus])


  // Reveal requests (from search or docs links) pan to the node.
  const lastReveal = useRef(0)
  useEffect(() => {
    if (!reveal || reveal.seq === lastReveal.current) return
    lastReveal.current = reveal.seq
    const node = flow.getNode(reveal.name)
    if (!node) return
    const zoom = Math.max(flow.getZoom(), 0.85)
    void flow.setCenter(node.position.x + (node.width ?? 0) / 2, node.position.y + Math.min(node.height ?? 0, 400) / 2, { zoom, duration: 450 })
  }, [reveal, flow, nodes])

  const button = "grid size-7 place-items-center rounded-md text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"

  return (
    <div
      ref={wrapper}
      className="h-full w-full [&[data-selecting]_.gql-node:not([data-hot])]:opacity-35"
    >
    <ReactFlow
      nodes={nodes}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onPaneClick={() => select("", null)}
      // Types stay where the layout put them; clicking selects them.
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      onlyRenderVisibleElements
      minZoom={0.02}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      className="bg-background"
    >
      <ZoomVariable target={wrapper} />
      {pending && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/40 backdrop-blur-[1px]">
          <p className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
            <Loader2 className="size-3.5 animate-spin" /> {f(t.graphql.layingOut, { count: graph.nodes.length })}
          </p>
        </div>
      )}
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--border)" />
      <EdgeLayer edges={shown?.edges ?? []} />
      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-0.5 rounded-lg border border-border bg-card/95 p-0.5 shadow-sm backdrop-blur">
        <Tooltip label={t.graphql.zoomIn}><button aria-label={t.graphql.zoomIn} className={button} onClick={() => void flow.zoomIn({ duration: 200 })}><Plus className="size-3.5" /></button></Tooltip>
        <Tooltip label={t.graphql.zoomOut}><button aria-label={t.graphql.zoomOut} className={button} onClick={() => void flow.zoomOut({ duration: 200 })}><Minus className="size-3.5" /></button></Tooltip>
        <Tooltip label={t.graphql.fit}><button aria-label={t.graphql.fit} className={button} onClick={() => void flow.fitView({ padding: 0.12, duration: 300 })}><Maximize className="size-3.5" /></button></Tooltip>
        <Tooltip label={t.graphql.minimap}>
          <button aria-label={t.graphql.minimap} aria-pressed={showMinimap} className={cn(button, showMinimap && "bg-accent text-foreground")} onClick={onToggleMinimap}><MapIcon className="size-3.5" /></button>
        </Tooltip>
      </div>
      {showMinimap && (
        <MiniMap
          pannable
          zoomable
          className="!m-3 overflow-hidden rounded-lg border border-border !bg-card shadow-sm"
          maskColor="color-mix(in oklab, var(--background) 70%, transparent)"
          nodeColor={(node) => KINDS[kindOf(model.types.get(node.id))].color}
          nodeBorderRadius={6}
          style={{ width: 168, height: 112 }}
        />
      )}
    </ReactFlow>
    </div>
  )
})

/** Mirrors the zoom into --gql-zoom, which scales the zoomed-out node labels. */
function ZoomVariable({ target }: { target: React.RefObject<HTMLDivElement | null> }) {
  const zoom = useStore((s) => s.transform[2])
  useEffect(() => { target.current?.style.setProperty("--gql-zoom", String(zoom)) }, [zoom, target])
  return null
}
