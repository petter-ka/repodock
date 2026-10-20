import { Loader2, Waypoints } from "lucide-react"
import { lazy, Suspense } from "react"
import type { MiniApp } from "@/lib/module"

// The graph libraries (React Flow, dagre, graphql) load with the first open.
const GraphQLMap = lazy(() => import("./GraphQLMap").then((module) => ({ default: module.GraphQLMap })))

function View() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>}>
      <GraphQLMap />
    </Suspense>
  )
}

/** "GraphQL map" mini app: a Voyager-style graph of the schema files in chosen folders (ADR-0029). */
export const graphqlMapApp: MiniApp = {
  id: "graphql-map",
  icon: Waypoints,
  label: (t) => t.graphql.title,
  View,
  width: 1180,
  height: 760,
  resizable: true,
  // A graph needs the room: it opens fullscreen; restore gives a 1180×760 window.
  openMaximized: true,
}
