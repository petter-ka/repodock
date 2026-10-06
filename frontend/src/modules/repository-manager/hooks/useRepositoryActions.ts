import { useMemo } from "react"
import { errorMessage } from "@/lib/bridge"
import { useI18n } from "@/lib/i18n"
import { useNotifications } from "@/state/notifications"
import { repositoryApi } from "../api"
import type { CommandStep, GroupRunMode, ImportOptions, ImportPreview, Repository, Run } from "../domain"
import { processStore } from "../store/processStore"
import { workspaceStore } from "../store/workspaceStore"

/**
 * User-intent actions for the module. Every backend failure is surfaced as
 * a notification; callers receive `undefined` instead of a rejection.
 */
export function useRepositoryActions() {
  const { notify } = useNotifications()
  const { t, f } = useI18n()

  return useMemo(() => {
    async function guard<T>(work: () => Promise<T>): Promise<T | undefined> {
      try {
        return await work()
      } catch (error) {
        notify(errorMessage(error) || t.common.error, { tone: "error" })
        return undefined
      }
    }

    // Results are applied immediately as well as via events, so the UI is
    // correct even if an event is delivered late.
    const trackRun = (run: Run | undefined) => {
      if (run) processStore.upsertRun(run)
      return run
    }

    return {
      async addRepository(groupId = "") {
        const path = await guard(() => repositoryApi.browse())
        if (!path) return
        const repo = await guard(() => repositoryApi.addRepository(path, groupId))
        if (repo) {
          workspaceStore.setWorkspace(await repositoryApi.workspace())
          workspaceStore.select(repo.id)
        }
      },
      refresh: (repo: Repository) => guard(() => repositoryApi.refreshRepository(repo.id)),
      remove: (repo: Repository) => guard(() => repositoryApi.removeRepository(repo.id)),
      createGroup: (name: string) => guard(() => repositoryApi.createGroup(name)),
      renameGroup: (id: string, name: string) => guard(() => repositoryApi.renameGroup(id, name)),
      deleteGroup: (id: string) => guard(() => repositoryApi.deleteGroup(id)),
      setGroupCollapsed: (id: string, collapsed: boolean) => guard(() => repositoryApi.setGroupCollapsed(id, collapsed)),
      assign: (repoId: string, groupId: string) => guard(() => repositoryApi.assignRepository(repoId, groupId)),
      setGroupRunMode: (groupId: string, mode: GroupRunMode) => guard(() => repositoryApi.setGroupRunMode(groupId, mode)),
      async runGroup(groupId: string) {
        const run = await guard(() => repositoryApi.runGroup(groupId))
        if (run) processStore.applyGroupRun(run)
        return run
      },
      stopGroup: (groupId: string) => guard(() => repositoryApi.stopGroup(groupId)),
      async exportWorkspace(groupIds: string[] = []) {
        const path = await guard(() => repositoryApi.exportWorkspace(groupIds))
        if (path) notify(f(t.transfer.exported, { path }), { tone: "success", duration: 6000 })
      },
      /** Opens the file picker and returns a preview, or undefined if cancelled. */
      async previewImport(): Promise<ImportPreview | undefined> {
        const path = await guard(() => repositoryApi.chooseImportFile())
        if (!path) return undefined
        return guard(() => repositoryApi.previewImport(path))
      },
      async applyImport(preview: ImportPreview, options: ImportOptions) {
        const result = await guard(() => repositoryApi.applyImport(preview.path, options))
        if (result) {
          notify(f(t.transfer.imported, { groups: result.groupsCreated, added: result.repositoriesAdded, skipped: result.repositoriesSkipped }), { tone: "success", duration: 6000 })
          workspaceStore.setWorkspace(await repositoryApi.workspace())
        }
        return result
      },
      runScript: async (repo: Repository, script: string) => trackRun(await guard(() => repositoryApi.runScript(repo.id, script))),
      runCommand: async (repo: Repository, command: string) => trackRun(await guard(() => repositoryApi.runCommand(repo.id, command))),
      stop: (runId: string) => guard(() => repositoryApi.stopProcess(runId)),
      restart: async (runId: string) => trackRun(await guard(() => repositoryApi.restartProcess(runId))),
      stopRepository: (repo: Repository) => guard(() => repositoryApi.stopRepository(repo.id)),
      async saveSequence(repo: Repository, steps: CommandStep[], quiet = false) {
        const ok = await guard(async () => {
          await repositoryApi.saveCommandSequence(repo.id, steps)
          return true
        })
        if (ok && !quiet) notify(t.sequence.saved, { tone: "success" })
        return ok
      },
      async runSequence(repo: Repository) {
        const sequence = await guard(() => repositoryApi.runSequence(repo.id))
        if (sequence) processStore.applySequence(sequence)
        return sequence
      },
      cancelSequence: (sequenceId: string) => guard(() => repositoryApi.cancelSequence(sequenceId)),
      async saveEnvFile(repo: Repository, name: string, content: string) {
        const ok = await guard(async () => {
          await repositoryApi.saveEnvironmentFile(repo.id, name, content)
          return true
        })
        if (ok) notify(f(t.env.saved, { name }), { tone: "success" })
        return ok
      },
    }
  }, [notify, t, f])
}

export type RepositoryActions = ReturnType<typeof useRepositoryActions>
