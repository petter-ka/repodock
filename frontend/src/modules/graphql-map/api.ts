import { getBackend } from "@/lib/bridge"
import type { Workspace } from "@/lib/contracts"

const backend = () => getBackend()

/** GraphQL map view of the backend contract (ADR-0029). */
export const graphqlApi = {
  scan: (folder: string) => backend().api.ScanGraphQLFiles(folder),
  browse: () => backend().api.BrowseGraphQLFolder(),
  workspace: () => backend().api.Workspace(),
  onWorkspace: (callback: (workspace: Workspace) => void) => backend().on("workspace:changed", callback),
}
export type { GraphQLScan } from "@/lib/contracts"
