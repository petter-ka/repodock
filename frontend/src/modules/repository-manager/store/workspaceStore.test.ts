import { describe, expect, it } from "vitest"
import type { Workspace } from "../domain"
import { refreshWorkspaceAfterMutation, workspaceStore } from "./workspaceStore"

describe("refreshWorkspaceAfterMutation", () => {
  it("updates both group counters after a repository move", async () => {
    const workspace = (source: string, target: string): Workspace => ({
      version: 1,
      groups: [
        { id: "source", name: "Source", repositoryIds: source ? ["repo"] : [], collapsed: false, runMode: "sequential", skippedRepositoryIds: [], schedule: null },
        { id: "target", name: "Target", repositoryIds: target ? ["repo"] : [], collapsed: false, runMode: "sequential", skippedRepositoryIds: [], schedule: null },
      ],
      repositories: [{
        id: "repo", name: "Repo", alias: "", path: "/repo", packageManager: "npm", scripts: [], commandSequence: [],
        quickCommands: [], envFiles: [], groupId: source ? "source" : "target", lastRefreshedAt: "", problem: "", dependencies: 0, devDependencies: 0, stack: [], continuous: false,
      }],
      globalCommands: [],
    })
    workspaceStore.setWorkspace(workspace("source", ""))
    let mutated = false

    await refreshWorkspaceAfterMutation(
      async () => { mutated = true },
      async () => {
        expect(mutated).toBe(true)
        return workspace("", "target")
      },
    )

    expect(workspaceStore.getState().workspace.groups.map((group) => group.repositoryIds.length)).toEqual([0, 1])
  })
})
