// Mirror of the backend workspace plus the current selection. Kept outside
// React so selection and data survive switching between rail modules.
import { readPreference, writePreference } from "@/lib/preferences"
import type { Repository, Workspace } from "../domain"

type State = { workspace: Workspace; selectedRepoId: string | null; loaded: boolean }

class WorkspaceStore {
  private state: State = {
    workspace: { version: 1, groups: [], repositories: [], globalCommands: [] },
    selectedRepoId: readPreference("selectedRepo") || null,
    loaded: false,
  }
  private listeners = new Set<() => void>()

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getState = () => this.state

  private set(patch: Partial<State>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => listener())
  }

  setWorkspace(workspace: Workspace) {
    const normalized: Workspace = {
      ...workspace,
      groups: workspace.groups ?? [],
      globalCommands: workspace.globalCommands ?? [],
      repositories: (workspace.repositories ?? []).map((repo) => ({ ...repo, scripts: repo.scripts ?? [], envFiles: repo.envFiles ?? [] })),
    }
    let selected = this.state.selectedRepoId
    if (selected && !normalized.repositories.some((repo) => repo.id === selected)) selected = null
    this.set({ workspace: normalized, selectedRepoId: selected, loaded: true })
  }

  select(id: string | null) {
    writePreference("selectedRepo", id ?? "")
    this.set({ selectedRepoId: id })
  }

  /** Repositories in sidebar order (group order, then member order). */
  orderedRepositories(): Repository[] {
    const { groups, repositories } = this.state.workspace
    const byId = new Map(repositories.map((repo) => [repo.id, repo]))
    return groups.flatMap((group) => (group.collapsed ? [] : group.repositoryIds.map((id) => byId.get(id)).filter((repo): repo is Repository => !!repo)))
  }
}

export const workspaceStore = new WorkspaceStore()
