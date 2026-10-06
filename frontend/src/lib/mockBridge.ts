// In-memory stand-in for the Go backend so the UI can be developed with
// `npm run dev` in a plain browser. It simulates processes, output and
// sequences; it never touches the real filesystem.
import type { Backend } from "./bridge"
import type {
  AppBinding, CommandStep, GroupRun, ImportPreview, EnvFile, EventMap, Group, ProcessOutput, ProcessSnapshot, Repository, Run, SequenceRun, Workspace,
} from "./contracts"

const ZERO = "0001-01-01T00:00:00Z"
const now = () => new Date().toISOString()
const uid = () => crypto.randomUUID()

function seedWorkspace(): Workspace {
  const repo = (id: string, name: string, pm: string, groupId: string, scripts: [string, string][], envFiles: string[]): Repository => ({
    id, name, path: `C:/work/${name}`, packageManager: pm, groupId, envFiles, lastRefreshedAt: now(), problem: "",
    scripts: scripts.map(([n, command]) => ({ name: n, command })),
    commandSequence: scripts.map(([n], i) => ({ id: `${id}-s${i}`, label: n, script: n, command: "", enabled: n === "dev", background: n === "dev" })),
  })
  return {
    version: 1,
    groups: [
      { id: "g-frontend", name: "Frontend", repositoryIds: ["r-web", "r-docs"], collapsed: false, runMode: "parallel" },
      { id: "g-services", name: "Services", repositoryIds: ["r-api"], collapsed: false, runMode: "sequential" },
    ],
    repositories: [
      repo("r-web", "dashboard-web", "pnpm", "g-frontend", [["dev", "next dev --turbo"], ["build", "next build"], ["lint", "next lint"], ["test", "vitest run"]], [".env", ".env.local"]),
      repo("r-docs", "docs-site", "npm", "g-frontend", [["dev", "astro dev"], ["build", "astro build"]], []),
      repo("r-api", "identity-api", "yarn", "g-services", [["start:dev", "nest start --watch"], ["test", "jest"], ["migrate", "prisma migrate deploy"]], [".env", ".env.test"]),
    ],
  }
}

const envContents: Record<string, string> = {
  ".env": "# Shared defaults\nPORT=3000\nAPI_URL=http://localhost:4000\nDATABASE_URL=postgres://dev:dev@localhost:5432/app\n",
  ".env.local": "# Local overrides\nSESSION_SECRET=super-secret-value\nFEATURE_FLAGS=beta,preview\n",
  ".env.test": "DATABASE_URL=postgres://test:test@localhost:5432/test\n",
}

const sampleOutput = [
  "\u001b[36mready\u001b[0m - started server on 0.0.0.0:3000, url: http://localhost:3000",
  "\u001b[32m✓\u001b[0m Compiled in \u001b[1m412ms\u001b[0m (1203 modules)",
  "\u001b[90m[watch]\u001b[0m change detected in src/app/page.tsx",
  "GET /api/health \u001b[32m200\u001b[0m in 4ms",
  "\u001b[33mwarn\u001b[0m - Fast Refresh had to perform a full reload",
]

export function createMockBackend(): Backend {
  const workspace = seedWorkspace()
  const listeners = new Map<string, Set<(payload: unknown) => void>>()
  type MockRun = Run & { timer?: number; resolve: Array<(run: Run) => void>; spec: { repoId: string; command: string; label: string; sequenceId: string; stepId: string } }
  const runs = new Map<string, MockRun>()
  const sequences = new Map<string, SequenceRun>()
  const sequenceDone = new Map<string, Promise<void>>()
  const groupRuns = new Map<string, GroupRun & { cancelled?: boolean }>()
  const importFiles = new Map<string, string>()

  type ExportDoc = {
    format: string
    version: number
    exportedAt: string
    groups: Array<{ name: string; runMode: Group["runMode"]; collapsed: boolean; repositories: Array<{ name: string; path: string; commandSequence: CommandStep[] | null }> }>
  }
  const parseExport = (path: string): ExportDoc => {
    const text = importFiles.get(path)
    if (text === undefined) throw `file not found: ${path}`
    let doc: ExportDoc
    try { doc = JSON.parse(text) } catch (error) { throw `not a valid RepoDock export: ${error}` }
    if (doc.format !== "repodock.workspace-export") throw `not a RepoDock export (format "${doc.format}")`
    if (doc.version !== 1) throw `export version ${doc.version} is not supported`
    return doc
  }
  const findGroupByName = (name: string) => workspace.groups.find((g) => g.name.trim().toLowerCase() === name.trim().toLowerCase())
  const findRepoByPath = (path: string) => workspace.repositories.find((r) => r.path.toLowerCase() === path.toLowerCase())
  let seq = 0

  const emit = <K extends keyof EventMap>(event: K, payload: EventMap[K]) => {
    listeners.get(event)?.forEach((cb) => cb(structuredClone(payload)))
  }
  const snapshot = () => structuredClone(workspace)
  const changed = () => emit("workspace:changed", snapshot())
  const findRepo = (id: string) => {
    const repo = workspace.repositories.find((r) => r.id === id)
    if (!repo) throw `repository not found: ${id}`
    return repo
  }
  const plain = (run: Run): Run => {
    const { id, repositoryId, command, label, status, pid, exitCode, startedAt, endedAt, sequenceId, stepId } = run
    return { id, repositoryId, command, label, status, pid, exitCode, startedAt, endedAt, sequenceId, stepId }
  }
  const line = (run: Run, text: string, stream: "stdout" | "stderr" = "stdout"): ProcessOutput =>
    ({ runId: run.id, repositoryId: run.repositoryId, pid: run.pid, stream, text, seq: ++seq, timestamp: now() })

  const finish = (id: string, status: Run["status"], exitCode: number) => {
    const run = runs.get(id)
    if (!run || !["running", "stopping"].includes(run.status)) return
    window.clearInterval(run.timer)
    Object.assign(run, { status, exitCode, endedAt: now() })
    emit("process:exited", { runId: id, repositoryId: run.repositoryId, exitCode, status, endedAt: run.endedAt })
    run.resolve.splice(0).forEach((r) => r(plain(run)))
  }

  const start = (repoId: string, command: string, label: string, sequenceId = "", stepId = ""): Run => {
    const repo = findRepo(repoId)
    const base: Run = {
      id: uid(), repositoryId: repo.id, command: command.trim(), label: label || command.trim(), status: "running",
      pid: 1000 + Math.floor(Math.random() * 60000), exitCode: -1, startedAt: now(), endedAt: ZERO, sequenceId, stepId,
    }
    const run: MockRun = { ...base, resolve: [], spec: { repoId, command, label, sequenceId, stepId } }
    runs.set(run.id, run)
    if (!base.command) {
      Object.assign(run, { status: "skipped", exitCode: 0, endedAt: now() })
      emit("process:started", plain(run))
      emit("process:exited", { runId: run.id, repositoryId: repo.id, exitCode: 0, status: "skipped", endedAt: run.endedAt })
      return plain(run)
    }
    emit("process:started", plain(run))
    const longRunning = /\b(dev|start|watch|serve)\b/.test(command)
    const failing = /\b(fail|exit [1-9])\b/.test(command)
    let tick = 0
    emit("process:output-batch", [line(run, `\u001b[2m$ ${base.command}\u001b[0m`), line(run, `\u001b[90m${repo.path}\u001b[0m`)])
    run.timer = window.setInterval(() => {
      tick++
      const batch = [line(run, sampleOutput[tick % sampleOutput.length])]
      if (tick % 7 === 0) batch.push(line(run, "DeprecationWarning: punycode is deprecated", "stderr"))
      emit("process:output-batch", batch)
      const stats: ProcessSnapshot = {
        runId: run.id, repositoryId: run.repositoryId, pid: run.pid, status: "running",
        memoryBytes: (80 + Math.random() * 300) * 1024 * 1024, cpuPercent: Math.random() * 40, processCount: 3, observedAt: now(),
      }
      emit("process:stats", stats)
      if (!longRunning && tick >= 4) {
        if (failing) emit("process:output-batch", [line(run, "Error: command failed", "stderr")])
        finish(run.id, failing ? "failed" : "exited", failing ? 1 : 0)
      }
    }, 700)
    return plain(run)
  }

  const waitFor = (id: string) => new Promise<Run>((resolve) => {
    const run = runs.get(id)
    if (!run) throw `run not found: ${id}`
    if (!["running", "stopping", "starting"].includes(run.status)) resolve(plain(run))
    else run.resolve.push(resolve)
  })

  const stop = (id: string) => {
    const run = runs.get(id)
    if (!run || run.status !== "running") return
    run.status = "stopping"
    emit("process:started", plain(run))
    window.setTimeout(() => finish(id, "stopped", 1), 300)
  }

  const runSequence = async (repo: Repository) => {
    const steps = (repo.commandSequence ?? []).filter((s) => s.enabled)
    if (!steps.length) throw "the sequence has no enabled steps"
    const active = [...sequences.values()].find((s) => s.repositoryId === repo.id && s.status === "running")
    if (active) throw "a sequence is already running for this repository"
    const state: SequenceRun = {
      id: uid(), repositoryId: repo.id, status: "running", startedAt: now(), endedAt: ZERO,
      steps: steps.map((s) => ({ stepId: s.id, label: s.label, runId: "", status: "pending", error: "" })),
    }
    sequences.set(state.id, state)
    const update = () => emit("sequence:updated", structuredClone(state))
    update()
    const done = (async () => {
      for (const [i, step] of steps.entries()) {
        if (state.status !== "running") break
        state.steps[i].status = "running"
        update()
        const command = step.script ? `${repo.packageManager} run ${step.script}` : step.command
        const run = start(repo.id, command, step.label, state.id, step.id)
        state.steps[i].runId = run.id
        if (run.status === "skipped") { state.steps[i].status = "skipped"; update(); continue }
        if (step.background) { state.steps[i].status = "started"; update(); continue }
        const final = await waitFor(run.id)
        if (state.status !== "running") { state.steps[i].status = "cancelled"; break }
        if (final.status !== "exited") {
          state.steps[i].status = "failed"
          state.steps[i].error = `exit code ${final.exitCode}`
          state.status = "failed"
          break
        }
        state.steps[i].status = "completed"
        update()
      }
      state.steps.forEach((s) => { if (s.status === "pending") s.status = "cancelled" })
      if (state.status === "running") state.status = "completed"
      state.endedAt = now()
      update()
    })()
    sequenceDone.set(state.id, done)
    return structuredClone(state)
  }

  const api: AppBinding = {
    async StartupReport() { return { workspacePath: "(browser mock)", recoveredBackup: "", warnings: [] } },
    async Workspace() { return snapshot() },
    async BrowseRepository() { return window.prompt("Mock folder path", "C:/work/new-service") ?? "" },
    async AddRepository(path, groupID) {
      const existing = workspace.repositories.find((r) => r.path.toLowerCase() === path.toLowerCase())
      if (existing) return structuredClone(existing)
      const name = path.split(/[\\/]/).filter(Boolean).pop() || "repository"
      const group = workspace.groups.find((g) => g.id === groupID) ?? workspace.groups[0]
      const repo: Repository = {
        id: uid(), name, path, packageManager: "npm", groupId: group.id, envFiles: [], lastRefreshedAt: now(), problem: "",
        scripts: [{ name: "dev", command: "node server.js" }, { name: "test", command: "node --test" }],
        commandSequence: [{ id: uid(), label: "dev", script: "dev", command: "", enabled: false, background: true }],
      }
      workspace.repositories.push(repo)
      group.repositoryIds.push(repo.id)
      changed()
      return structuredClone(repo)
    },
    async RefreshRepository(id) { const repo = findRepo(id); repo.lastRefreshedAt = now(); changed(); return structuredClone(repo) },
    async RefreshAll() { workspace.repositories.forEach((r) => { r.lastRefreshedAt = now() }); changed() },
    async RemoveRepository(id) {
      runs.forEach((r) => { if (r.repositoryId === id) stop(r.id) })
      workspace.repositories = workspace.repositories.filter((r) => r.id !== id)
      workspace.groups.forEach((g) => { g.repositoryIds = g.repositoryIds.filter((r) => r !== id) })
      changed()
    },
    async CreateGroup(name) {
      if (!name.trim()) throw "group name cannot be empty"
      const group: Group = { id: uid(), name: name.trim(), repositoryIds: [], collapsed: false, runMode: "sequential" }
      workspace.groups.push(group)
      changed()
      return structuredClone(group)
    },
    async RenameGroup(id, name) {
      const group = workspace.groups.find((g) => g.id === id)
      if (!group) throw "group not found"
      if (!name.trim()) throw "group name cannot be empty"
      group.name = name.trim()
      changed()
    },
    async DeleteGroup(id) {
      if (workspace.groups.length === 1) throw "the last group cannot be deleted"
      const group = workspace.groups.find((g) => g.id === id)
      if (!group) throw "group not found"
      workspace.groups = workspace.groups.filter((g) => g.id !== id)
      const target = workspace.groups[0]
      group.repositoryIds.forEach((rid) => { findRepo(rid).groupId = target.id; target.repositoryIds.push(rid) })
      changed()
    },
    async ExportWorkspace(groupIDs) {
      const groups = workspace.groups.filter((g) => !groupIDs.length || groupIDs.includes(g.id))
      const doc: ExportDoc = {
        format: "repodock.workspace-export", version: 1, exportedAt: now(),
        groups: groups.map((g) => ({
          name: g.name, runMode: g.runMode, collapsed: g.collapsed,
          repositories: g.repositoryIds.map(findRepo).map((r) => ({ name: r.name, path: r.path, commandSequence: r.commandSequence })),
        })),
      }
      const name = groupIDs.length === 1 ? `repodock-${groups[0]?.name ?? "group"}.json` : "repodock-workspace.json"
      const link = document.createElement("a")
      link.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2) + "\n"], { type: "application/json" }))
      link.download = name
      link.click()
      URL.revokeObjectURL(link.href)
      return `Downloads/${name}`
    },
    ChooseImportFile() {
      return new Promise<string>((resolve) => {
        const input = document.createElement("input")
        input.type = "file"
        input.accept = ".json,application/json"
        input.addEventListener("cancel", () => resolve(""))
        input.addEventListener("change", async () => {
          const file = input.files?.[0]
          if (!file) return resolve("")
          const path = `browser://${file.name}`
          importFiles.set(path, await file.text())
          resolve(path)
        })
        input.click()
      })
    },
    async PreviewImport(path) {
      const doc = parseExport(path)
      const preview: ImportPreview = { path, exportedAt: doc.exportedAt, groups: [], groupsToCreate: 0, new: 0, existing: 0, missing: 0, shellCommands: 0 }
      const seen = new Set<string>()
      for (const group of doc.groups) {
        const exists = !!findGroupByName(group.name)
        if (!exists) preview.groupsToCreate++
        preview.groups.push({
          name: group.name, exists,
          repositories: group.repositories.map((repo) => {
            const status = seen.has(repo.path.toLowerCase()) ? "duplicate" : findRepoByPath(repo.path) ? "existing" : "new"
            seen.add(repo.path.toLowerCase())
            if (status === "existing") preview.existing++
            if (status === "new") {
              preview.new++
              preview.shellCommands += (repo.commandSequence ?? []).filter((s) => !s.script && s.command).length
            }
            return { name: repo.name, path: repo.path, status, steps: repo.commandSequence }
          }),
        })
      }
      return preview
    },
    async ApplyImport(path, options) {
      const doc = parseExport(path)
      const result = { groupsCreated: 0, repositoriesAdded: 0, repositoriesSkipped: 0 }
      for (const entry of doc.groups) {
        let group = findGroupByName(entry.name)
        if (!group) {
          group = { id: uid(), name: entry.name.trim(), repositoryIds: [], collapsed: entry.collapsed, runMode: entry.runMode ?? "sequential" }
          workspace.groups.push(group)
          result.groupsCreated++
        }
        for (const repo of entry.repositories) {
          if (findRepoByPath(repo.path)) { result.repositoriesSkipped++; continue }
          const record: Repository = {
            id: uid(), name: repo.name, path: repo.path, packageManager: "npm", groupId: group.id, envFiles: [], lastRefreshedAt: now(),
            problem: "", scripts: (repo.commandSequence ?? []).filter((s) => s.script).map((s) => ({ name: s.script, command: "(simulated)" })),
            commandSequence: repo.commandSequence?.map((s) => ({ ...s, id: uid(), enabled: options.keepStepsEnabled && s.enabled })) ?? null,
          }
          workspace.repositories.push(record)
          group.repositoryIds.push(record.id)
          result.repositoriesAdded++
        }
      }
      changed()
      return result
    },
    async SetGroupRunMode(id, mode) {
      const group = workspace.groups.find((g) => g.id === id)
      if (!group) throw "group not found"
      group.runMode = mode
      changed()
    },
    async RunGroup(groupID) {
      const group = workspace.groups.find((g) => g.id === groupID)
      if (!group) throw `group not found: ${groupID}`
      if (groupRuns.get(groupID)?.status === "running") throw "this group is already running"
      const repos = group.repositoryIds.map(findRepo)
      const enabled = (repo: Repository) => (repo.commandSequence ?? []).some((s) => s.enabled)
      if (!repos.some(enabled)) throw "no repository in this group has enabled sequence steps"
      const run: GroupRun & { cancelled?: boolean } = {
        id: uid(), groupId: groupID, mode: group.runMode, status: "running", startedAt: now(), endedAt: ZERO,
        repos: repos.map((repo) => ({ repositoryId: repo.id, name: repo.name, sequenceId: "", status: enabled(repo) ? "pending" : "skipped", error: "" })),
      }
      groupRuns.set(groupID, run)
      const update = () => { const { cancelled: _c, ...plainRun } = run; emit("group:updated", structuredClone(plainRun)) }
      const member = async (i: number) => {
        try {
          const seq = await runSequence(repos[i])
          run.repos[i] = { ...run.repos[i], status: "running", sequenceId: seq.id }
          update()
          await sequenceDone.get(seq.id)
          const final = sequences.get(seq.id)!
          run.repos[i].status = final.status === "completed" ? "completed" : final.status === "cancelled" ? "cancelled" : "failed"
          run.repos[i].error = final.steps.find((s) => s.status === "failed")?.error ?? ""
        } catch (error) {
          run.repos[i] = { ...run.repos[i], status: "failed", error: String(error) }
        }
        update()
        return run.repos[i].status
      }
      update()
      void (async () => {
        const indexes = repos.map((_, i) => i).filter((i) => run.repos[i].status === "pending")
        if (run.mode === "parallel") await Promise.all(indexes.map(member))
        else for (const i of indexes) { if (run.cancelled || (await member(i)) !== "completed") break }
        run.repos.forEach((r) => { if (r.status === "pending") r.status = "cancelled" })
        run.status = run.cancelled ? "cancelled" : run.repos.some((r) => r.status === "failed") ? "failed" : "completed"
        run.endedAt = now()
        update()
      })()
      const { cancelled: _c, ...plainRun } = run
      return structuredClone(plainRun)
    },
    async StopGroup(groupID) {
      const run = groupRuns.get(groupID)
      if (run?.status === "running") run.cancelled = true
      const group = workspace.groups.find((g) => g.id === groupID)
      for (const id of group?.repositoryIds ?? []) await api.StopRepository(id)
    },
    async GroupRuns() { return [...groupRuns.values()].map(({ cancelled: _c, ...r }) => structuredClone(r)) },
    async SetGroupCollapsed(id, collapsed) {
      const group = workspace.groups.find((g) => g.id === id)
      if (group) group.collapsed = collapsed
      changed()
    },
    async AssignRepository(id, groupID) {
      const repo = findRepo(id)
      workspace.groups.forEach((g) => { g.repositoryIds = g.repositoryIds.filter((r) => r !== id) })
      workspace.groups.find((g) => g.id === groupID)?.repositoryIds.push(id)
      repo.groupId = groupID
      changed()
    },
    async SaveCommandSequence(repoID, steps: CommandStep[]) { findRepo(repoID).commandSequence = structuredClone(steps); changed() },
    async RunScript(repoID, scriptName, label) {
      const repo = findRepo(repoID)
      if (!repo.scripts.some((s) => s.name === scriptName)) throw `script not found: ${scriptName}`
      return start(repoID, `${repo.packageManager} run ${scriptName}`, label)
    },
    async RunCommand(repoID, command, label) { return start(repoID, command, label) },
    async WaitForRun(runID) { return waitFor(runID) },
    async StopProcess(runID) { stop(runID) },
    async RestartProcess(runID) {
      const run = runs.get(runID)
      if (!run) throw `run not found: ${runID}`
      if (run.status === "running") { stop(runID); await waitFor(runID) }
      return start(run.spec.repoId, run.spec.command, run.spec.label, run.spec.sequenceId, run.spec.stepId)
    },
    async StopRepository(repoID) {
      sequences.forEach((s) => { if (s.repositoryId === repoID && s.status === "running") s.status = "cancelled" })
      runs.forEach((r) => { if (r.repositoryId === repoID) stop(r.id) })
    },
    async ActiveRuns() { return [...runs.values()].filter((r) => r.status === "running" || r.status === "stopping").map(plain) },
    async Runs() { return [...runs.values()].map(plain) },
    async ProcessSnapshots() { return [] },
    async RunSequence(repoID) { return runSequence(findRepo(repoID)) },
    async CancelSequence(id) {
      const state = sequences.get(id)
      if (!state || state.status !== "running") return
      state.status = "cancelled"
      const current = state.steps.find((s) => s.status === "running")
      if (current?.runId) stop(current.runId)
    },
    async Sequences() { return [...sequences.values()].map((s) => structuredClone(s)) },
    async EnvironmentFiles(repoID): Promise<EnvFile[]> {
      return findRepo(repoID).envFiles.map((name) => ({ name, path: `${findRepo(repoID).path}/${name}`, content: "", size: envContents[name]?.length ?? 0, modifiedAt: now() }))
    },
    async ReadEnvironmentFile(repoID, name) {
      const repo = findRepo(repoID)
      if (!repo.envFiles.includes(name)) throw `unsupported env file: ${name}`
      const content = envContents[name] ?? ""
      return { name, path: `${repo.path}/${name}`, content, size: content.length, modifiedAt: now() }
    },
    async SaveEnvironmentFile(_repoID, name, content) { envContents[name] = content },
  }

  return {
    api,
    native: false,
    on(event, callback) {
      const set = listeners.get(event) ?? new Set()
      set.add(callback as (payload: unknown) => void)
      listeners.set(event, set)
      return () => set.delete(callback as (payload: unknown) => void)
    },
  }
}
