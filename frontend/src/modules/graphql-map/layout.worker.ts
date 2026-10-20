// Runs dagre off the main thread: a schema with hundreds of types takes
// seconds to lay out and must not freeze the app.
import { layoutGraph, type LayoutInput } from "./layout"

const scope = self as unknown as { onmessage: ((event: MessageEvent<{ id: number; input: LayoutInput }>) => void) | null; postMessage: (message: unknown) => void }

scope.onmessage = (event) => {
  const { id, input } = event.data
  scope.postMessage({ id, positions: [...layoutGraph(input)] })
}
