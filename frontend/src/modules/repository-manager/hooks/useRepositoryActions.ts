import { useMemo } from "react"
import { errorMessage } from "@/lib/bridge"
import { useI18n } from "@/lib/i18n"
import { useNotifications } from "@/state/notifications"
import { repositoryApi } from "../api"
import { displayName, type CommandStep, type GlobalCommand, type GroupRunMode, type QuickCommand, type ImportOptions, type ImportPreview, type Repository, type Run } from "../domain"
import { processStore } from "../store/processStore"
import { refreshWorkspaceAfterMutation, workspaceStore } from "../store/workspaceStore"

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

    const mutateWorkspace = <T,>(work: () => Promise<T>) =>
      guard(() => refreshWorkspaceAfterMutation(work, repositoryApi.workspace))

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
      openInVSCode: (repoId: string) => guard(() => repositoryApi.openRepositoryInVSCode(repoId)),
      /** Native folder picker; "" when cancelled. */
      browseFolder: async () => (await guard(() => repositoryApi.browse())) ?? "",
      checkFolder: (path: string) => repositoryApi.checkFolder(path),
      async relocate(repo: Repository) {
        const path = await guard(() => repositoryApi.browse())
        if (!path) return undefined
        const updated = await guard(() => repositoryApi.relocateRepository(repo.id, path))
        if (updated) notify(f(t.relocate.done, { name: displayName(updated), path: updated.path }), { tone: "success" })
        return updated
      },
      remove: (repo: Repository) => mutateWorkspace(() => repositoryApi.removeRepository(repo.id)),
      createGroup: (name: string) => mutateWorkspace(() => repositoryApi.createGroup(name)),
      renameGroup: (id: string, name: string) => guard(() => repositoryApi.renameGroup(id, name)),
      deleteGroup: (id: string) => mutateWorkspace(() => repositoryApi.deleteGroup(id)),
      setGroupCollapsed: (id: string, collapsed: boolean) => guard(() => repositoryApi.setGroupCollapsed(id, collapsed)),
      /** Set a repository's alias; blank restores the discovered name. */
      renameRepository: (repoId: string, alias: string) => guard(() => repositoryApi.renameRepository(repoId, alias)),
      /** Place a group at `index` in the sidebar (index excludes the group itself). */
      moveGroup: (groupId: string, index: number) => guard(() => repositoryApi.moveGroup(groupId, index)),
      assign: (repoId: string, groupId: string) => mutateWorkspace(() => repositoryApi.assignRepository(repoId, groupId)),
      /** Place a repository at `index` in a group (index excludes the repository itself). */
      move: (repoId: string, groupId: string, index: number) => mutateWorkspace(() => repositoryApi.moveRepository(repoId, groupId, index)),
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
          notify(f(t.transfer.imported, { groups: result.groupsCreated, added: result.repositoriesAdded, skipped: result.repositoriesSkipped, globals: result.globalCommandsAdded }), { tone: "success", duration: 6000 })
          workspaceStore.setWorkspace(await repositoryApi.workspace())
        }
        return result
      },
      runScript: async (repo: Repository, script: string) => trackRun(await guard(() => repositoryApi.runScript(repo.id, script))),
      runCommand: async (repo: Repository, command: string, label = "") => trackRun(await guard(() => repositoryApi.runCommand(repo.id, command, label))),
      stop: (runId: string) => guard(() => repositoryApi.stopProcess(runId)),
      /** Sends one line to a running process's stdin; true when delivered. */
      sendInput: async (runId: string, text: string, secret = false) =>
        (await guard(async () => { await repositoryApi.sendInput(runId, text, secret); return true })) ?? false,
      /** Closes a running process's stdin (EOF). */
      closeInput: (runId: string) => guard(() => repositoryApi.closeInput(runId)),
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
      /** Replaces a repository's pinned quick commands; true when saved. */
      saveQuickCommands: async (repo: Repository, commands: QuickCommand[]) =>
        (await guard(async () => { await repositoryApi.saveQuickCommands(repo.id, commands); return true })) ?? false,
      /** Starts a pinned command in the background; the run is listed in the Background drawer. */
      async runQuick(repo: Repository, quick: QuickCommand, global?: GlobalCommand) {
        const run = await guard(() => quick.script
          ? repositoryApi.runScript(repo.id, quick.script)
          : repositoryApi.runCommand(repo.id, global ? global.command : quick.command, quick.label))
        if (run) processStore.markBackground(run.id, quick.id)
        return trackRun(run)
      },
      /** Replaces the workspace's global commands; true when saved. */
      async saveGlobalCommands(commands: GlobalCommand[]) {
        const saved = await guard(() => repositoryApi.saveGlobalCommands(commands))
        if (!saved) return false
        workspaceStore.setWorkspace(await repositoryApi.workspace())
        notify(t.globalCommands.saved, { tone: "success" })
        return true
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
