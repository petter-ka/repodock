import { useNodes, useStore } from "@xyflow/react"
import { memo, useLayoutEffect, useMemo, useRef } from "react"
import { METRICS, type GraphEdge } from "./graph"
import { useSelection } from "./MapContext"
import type { TypeNodeType } from "./TypeNode"

type Segment = { sx: number; sy: number; tx: number; ty: number; dx: number; minX: number; maxX: number; minY: number; maxY: number; style: 0 | 1 | 2; active: boolean }

/** Reads a CSS colour token as a string the canvas understands. */
function color(probe: HTMLElement, token: string) {
  probe.style.color = `var(${token})`
  return getComputedStyle(probe).color
}

/**
 * Draws every edge on one <canvas> under the nodes, in screen space, and
 * only the edges that cross the visible area. This replaces thousands of
 * SVG/React edge elements, so panning and zooming a big map stays smooth.
 * Endpoints come from node positions and the known row metrics, so nodes
 * need no handles.
 */
export const EdgeLayer = memo(function EdgeLayer({ edges }: { edges: GraphEdge[] }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const nodes = useNodes<TypeNodeType>()
  const selection = useSelection()
  const [x, y, zoom] = useStore((s) => s.transform)
  const width = useStore((s) => s.width)
  const height = useStore((s) => s.height)

  // Edge geometry in flow coordinates; recomputed when nodes move or the
  // selection changes, not on every pan/zoom frame.
  const segments = useMemo<Segment[]>(() => {
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const out: Segment[] = []
    for (const edge of edges) {
      const source = byId.get(edge.source)
      const target = byId.get(edge.target)
      if (!source || !target) continue
      const sx = source.position.x + (source.width ?? 0)
      const sy = source.position.y + edge.sourceY
      const tx = target.position.x
      const ty = target.position.y + METRICS.header / 2
      const dx = Math.max(40, Math.abs(tx - sx) / 2)
      const active = selection !== null && (
        selection.field !== null
          ? edge.source === selection.type && edge.sourceHandle === `f:${selection.field}`
          : edge.source === selection.type || edge.target === selection.type
      )
      out.push({
        sx, sy, tx, ty, dx, active,
        style: edge.role === "field" ? 0 : edge.role === "input" ? 2 : 1,
        minX: Math.min(sx, tx - dx - 6), maxX: Math.max(sx + dx, tx), minY: Math.min(sy, ty), maxY: Math.max(sy, ty),
      })
    }
    // Active edges last, so they are drawn on top.
    return out.sort((a, b) => Number(a.active) - Number(b.active))
  }, [nodes, edges, selection])

  useLayoutEffect(() => {
    const element = canvas.current
    const context = element?.getContext("2d")
    if (!element || !context || !width || !height) return
    const ratio = window.devicePixelRatio || 1
    if (element.width !== Math.round(width * ratio) || element.height !== Math.round(height * ratio)) {
      element.width = Math.round(width * ratio)
      element.height = Math.round(height * ratio)
    }
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, element.width, element.height)
    context.setTransform(ratio * zoom, 0, 0, ratio * zoom, ratio * x, ratio * y)

    const colors = {
      muted: color(element, "--muted-foreground"),
      input: color(element, "--series-3"),
      active: color(element, "--primary"),
    }
    // Visible area in flow coordinates, with a margin.
    const margin = 40 / zoom
    const left = -x / zoom - margin
    const top = -y / zoom - margin
    const right = left + width / zoom + 2 * margin
    const bottom = top + height / zoom + 2 * margin
    const arrows = zoom > 0.15
    const dimmed = selection !== null
    // Fade edges as the map zooms out, where hundreds overlap.
    const idle = 0.55 * Math.min(1, Math.max(0.3, zoom * 1.6))

    let current = -1
    for (const s of segments) {
      if (s.maxX < left || s.minX > right || s.maxY < top || s.minY > bottom) continue
      const key = s.active ? 3 : s.style
      if (key !== current) {
        current = key
        const stroke = s.active ? colors.active : s.style === 2 ? colors.input : colors.muted
        context.strokeStyle = stroke
        context.fillStyle = stroke
        context.globalAlpha = s.active ? 1 : dimmed ? 0.12 : idle
        context.lineWidth = (s.active ? 2.25 : 1.25) / zoom
        context.setLineDash(s.style === 0 || s.active ? [] : [5 / zoom, 4 / zoom])
      }
      context.beginPath()
      context.moveTo(s.sx, s.sy)
      context.bezierCurveTo(s.sx + s.dx, s.sy, s.tx - s.dx - 6, s.ty, s.tx - 6, s.ty)
      context.stroke()
      if (arrows) {
        context.beginPath()
        context.moveTo(s.tx, s.ty)
        context.lineTo(s.tx - 8, s.ty - 4)
        context.lineTo(s.tx - 8, s.ty + 4)
        context.closePath()
        context.fill()
      }
    }
  })

  return <canvas ref={canvas} aria-hidden className="pointer-events-none absolute inset-0 -z-[1] size-full" />
})
