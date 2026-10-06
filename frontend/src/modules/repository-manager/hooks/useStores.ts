import { useSyncExternalStore } from "react"
import { processStore } from "../store/processStore"
import { workspaceStore } from "../store/workspaceStore"

export function useWorkspaceState() {
  return useSyncExternalStore(workspaceStore.subscribe, workspaceStore.getState)
}

export function useSelectedRepository() {
  const { workspace, selectedRepoId } = useWorkspaceState()
  return workspace.repositories.find((repo) => repo.id === selectedRepoId) ?? null
}

/**
 * Re-renders when process state changes (at most once per frame). Derive
 * data from `processStore` inside `useMemo` keyed on the returned version.
 */
export function useProcessVersion() {
  return useSyncExternalStore(processStore.subscribe, processStore.getVersion)
}
