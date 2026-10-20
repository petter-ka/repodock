import { useEffect, useMemo, useRef, useState } from "react"
import type { TypeGraph } from "./graph"
import { DAGRE_LIMIT, layoutGraph, layoutInput, layoutKey, SYNC_LAYOUT_LIMIT, type Positions } from "./layout"

type Laid = { graph: TypeGraph; positions: Positions }

// Recent layouts by graph shape: switching options or files back and forth
// does not lay out again.
const cache = new Map<string, Positions>()
function remember(key: string, positions: Positions) {
  cache.delete(key)
  cache.set(key, positions)
  if (cache.size > 8) cache.delete(cache.keys().next().value!)
}

/**
 * Lays out the graph: small graphs with dagre synchronously, medium ones with
 * dagre in a worker, big ones with the instant fast layout. Returns the
 * latest finished layout (possibly of an older graph) and whether a newer
 * one is still running. A newer graph cancels a running worker layout.
 */
export function useLayout(graph: TypeGraph) {
  const [laid, setLaid] = useState<Laid | null>(null)
  const worker = useRef<Worker | null>(null)
  const busy = useRef(false)
  const seq = useRef(0)

  const { input, key } = useMemo(() => {
    const input = layoutInput(graph)
    return { input, key: layoutKey(input) }
  }, [graph])
  const inWorker = graph.nodes.length > SYNC_LAYOUT_LIMIT && graph.nodes.length <= DAGRE_LIMIT

  const sync = useMemo<Laid | null>(() => {
    const cached = cache.get(key)
    if (cached) return { graph, positions: cached }
    if (inWorker) return null
    const positions = layoutGraph(input)
    remember(key, positions)
    return { graph, positions }
  }, [graph, input, key, inWorker])

  useEffect(() => {
    if (sync) return
    const id = ++seq.current
    if (busy.current) {
      worker.current?.terminate()
      worker.current = null
    }
    worker.current ??= new Worker(new URL("./layout.worker.ts", import.meta.url), { type: "module" })
    busy.current = true
    worker.current.onmessage = (event: MessageEvent<{ id: number; positions: [string, { x: number; y: number }][] }>) => {
      if (event.data.id !== seq.current) return
      busy.current = false
      const positions = new Map(event.data.positions)
      remember(key, positions)
      setLaid({ graph, positions })
    }
    worker.current.postMessage({ id, input })
  }, [sync, graph, input, key])

  useEffect(() => () => worker.current?.terminate(), [])

  const current = sync ?? laid
  return { laid: current, pending: current?.graph !== graph }
}
