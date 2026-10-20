import { graphlib, layout } from "@dagrejs/dagre"
import type { TypeGraph } from "./graph"

export type LayoutInput = {
  nodes: { name: string; width: number; height: number }[]
  edges: { source: string; target: string }[]
  /** placed in the first column (the root type) */
  root: string | null
}
export type Positions = Map<string, { x: number; y: number }>

/** Graphs up to this size are laid out synchronously with dagre. */
export const SYNC_LAYOUT_LIMIT = 80
/** Above this, dagre takes seconds to minutes; the fast layered layout is used instead. */
export const DAGRE_LIMIT = 250

const NODE_GAP = 28
const RANK_GAP = 110
/** Ranks with more nodes are split into side-by-side columns of this many. */
const COLUMN_SIZE = 30

export function layoutInput(graph: TypeGraph): LayoutInput {
  return {
    nodes: graph.nodes.map(({ name, width, height }) => ({ name, width, height })),
    edges: graph.edges.map(({ source, target }) => ({ source, target })),
    root: graph.nodes.find((node) => node.isRoot)?.name ?? null,
  }
}

/** Identifies a graph's shape, so an identical graph reuses its layout. */
export function layoutKey(input: LayoutInput) {
  return `${input.root}|${input.nodes.map((n) => `${n.name}:${n.width}x${n.height}`).join(",")}|${input.edges.map((e) => `${e.source}>${e.target}`).join(",")}`
}

export function layoutGraph(input: LayoutInput): Positions {
  return input.nodes.length > DAGRE_LIMIT ? fastLayout(input) : dagreLayout(input)
}

/** Layered left-to-right layout (dagre); positions are node top-left corners. */
export function dagreLayout(input: LayoutInput): Positions {
  const g = new graphlib.Graph({ multigraph: false })
  g.setGraph({ rankdir: "LR", nodesep: NODE_GAP, ranksep: RANK_GAP, edgesep: 12, marginx: 24, marginy: 24, ranker: "network-simplex" })
  g.setDefaultEdgeLabel(() => ({}))
  for (const node of input.nodes) g.setNode(node.name, { width: node.width, height: node.height })
  for (const edge of input.edges) if (edge.source !== edge.target) g.setEdge(edge.source, edge.target)
  layout(g)
  const positions: Positions = new Map()
  for (const node of input.nodes) {
    const placed = g.node(node.name)
    positions.set(node.name, { x: placed.x - node.width / 2, y: placed.y - node.height / 2 })
  }
  return positions
}

/**
 * A linear-time layered layout for big graphs: ranks are BFS distances from
 * the root (or from types nothing points to), each rank is ordered by the
 * average position of its parents and placed near them, and crowded ranks
 * wrap into several columns. Less tidy than dagre, but instant.
 */
export function fastLayout(input: LayoutInput): Positions {
  const size = new Map(input.nodes.map((node) => [node.name, node]))
  const out = new Map<string, string[]>()
  const into = new Map<string, string[]>()
  for (const name of size.keys()) { out.set(name, []); into.set(name, []) }
  const seen = new Set<string>()
  for (const { source, target } of input.edges) {
    const key = `${source}>${target}`
    if (source === target || seen.has(key) || !size.has(source) || !size.has(target)) continue
    seen.add(key)
    out.get(source)!.push(target)
    into.get(target)!.push(source)
  }

  // Ranks: BFS from the root, then from unreached types nothing points to,
  // then from whatever is left (cycles), most connected first.
  const rank = new Map<string, number>()
  const order: string[] = []
  const bfs = (start: string) => {
    if (rank.has(start)) return
    rank.set(start, 0)
    const queue = [start]
    for (let i = 0; i < queue.length; i++) {
      const name = queue[i]
      order.push(name)
      for (const next of out.get(name)!) {
        if (!rank.has(next)) { rank.set(next, rank.get(name)! + 1); queue.push(next) }
      }
    }
  }
  if (input.root && size.has(input.root)) bfs(input.root)
  const byDegree = [...size.keys()].sort((a, b) => out.get(b)!.length - out.get(a)!.length)
  for (const name of byDegree) if (into.get(name)!.length === 0) bfs(name)
  for (const name of byDegree) bfs(name)

  const ranks: string[][] = []
  for (const name of order) (ranks[rank.get(name)!] ??= []).push(name)

  const positions: Positions = new Map()
  const centerY = new Map<string, number>()
  let x = 0
  for (const members of ranks) {
    if (!members) continue
    // Order by the average centre of already placed parents.
    const bary = new Map<string, number>()
    members.forEach((name, index) => {
      const parents = into.get(name)!.filter((p) => centerY.has(p))
      bary.set(name, parents.length ? parents.reduce((sum, p) => sum + centerY.get(p)!, 0) / parents.length : index * 1e-6 + 1e9)
    })
    const sorted = [...members].sort((a, b) => bary.get(a)! - bary.get(b)!)
    for (let start = 0; start < sorted.length; start += COLUMN_SIZE) {
      const column = sorted.slice(start, start + COLUMN_SIZE)
      // Place each node at its parents' centre, pushing down to avoid overlap,
      // then shift the column back up by the average push.
      let bottom = -Infinity
      const ys: number[] = []
      for (const name of column) {
        const node = size.get(name)!
        const want = bary.get(name)! >= 1e9 ? bottom + NODE_GAP : bary.get(name)! - node.height / 2
        const y = Number.isFinite(bottom) ? Math.max(want, bottom + NODE_GAP) : (Number.isFinite(want) ? want : 0)
        ys.push(y)
        bottom = y + node.height
      }
      const drift = column.reduce((sum, name, i) => {
        const b = bary.get(name)!
        return b >= 1e9 ? sum : sum + (ys[i] + size.get(name)!.height / 2 - b)
      }, 0) / Math.max(1, column.filter((name) => bary.get(name)! < 1e9).length)
      const width = Math.max(...column.map((name) => size.get(name)!.width))
      column.forEach((name, i) => {
        const y = ys[i] - drift
        positions.set(name, { x, y })
        centerY.set(name, y + size.get(name)!.height / 2)
      })
      x += width + (start + COLUMN_SIZE < sorted.length ? NODE_GAP * 2 : RANK_GAP)
    }
  }
  return positions
}
