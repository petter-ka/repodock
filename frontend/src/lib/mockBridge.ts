// In-memory stand-in for the Go backend so the UI can be developed with
// `npm run dev` in a plain browser. It simulates processes, output and
// sequences; it never touches the real filesystem.
import type { Backend } from "./bridge"
import type {
  AppBinding, CommandStep, HostProcess, JwtSettings, QuickCommand, GlobalCommand, GroupRun, ImportPreview, EnvFile, EventMap, Group, ProcessOutput, ProcessSnapshot, Repository, Run, SequenceRun, Workspace,
} from "./contracts"
import { displayName } from "./contracts"

const ZERO = "0001-01-01T00:00:00Z"
const now = () => new Date().toISOString()
const uid = () => crypto.randomUUID()

function seedWorkspace(): Workspace {
  const repo = (id: string, name: string, pm: string, groupId: string, scripts: [string, string][], envFiles: string[]): Repository => ({
    id, name, alias: "", quickCommands: [], path: `C:/work/${name}`, packageManager: pm, groupId, envFiles, lastRefreshedAt: now(), problem: "",
    scripts: scripts.map(([n, command]) => ({ name: n, command })),
    commandSequence: scripts.map(([n], i) => ({ id: `${id}-s${i}`, label: n, script: n, globalCommand: "", command: "", enabled: n === "dev", background: n === "dev" })),
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
    globalCommands: [
      { id: "gc-clean", name: "Clean install", command: "npx rimraf node_modules && npm ci" },
      { id: "gc-outdated", name: "Outdated", command: "npm outdated" },
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
  let jwtSettings: JwtSettings = {
    algorithm: "RS256", id: "", email: "", expiresInDays: 7, issuer: "bms", subject: "bms", realm: "customer-service", channel: "bms",
    deviceId: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36",
    roles: ["admin", "customer-service:read", "customer-service:write"], selectedRoles: ["admin"], extraClaims: "", privateKey: "", publicKey: "", secret: "",
  }
  const killedHost = new Set<number>()
  // A few fake machine processes plus RepoDock's own running runs.
  const hostProcesses = (): HostProcess[] => {
    const base = { ppid: 1, user: "dev", startedAt: now(), runId: "", repositoryId: "", protected: "" }
    const fixed: HostProcess[] = [
      { ...base, pid: 4242, name: "node", command: "node /Users/dev/old-app/server.js", ports: [3000] },
      { ...base, pid: 5150, name: "postgres", command: "/opt/homebrew/opt/postgresql@16/bin/postgres -D /opt/homebrew/var/postgresql@16", ports: [5432] },
      { ...base, pid: 1, name: "launchd", command: "/sbin/launchd", ports: [], user: "root", protected: "system process" },
    ].filter((p) => !killedHost.has(p.pid))
    const managed = [...runs.values()].filter((r) => r.status === "running").map((r) => ({
      ...base, pid: r.pid, name: "node", command: r.command, ports: [], runId: r.id, repositoryId: r.repositoryId,
    }))
    return [...fixed, ...managed]
  }

  type ExportDoc = {
    format: string
    version: number
    exportedAt: string
    globalCommands?: GlobalCommand[]
    groups: Array<{ name: string; runMode: Group["runMode"]; collapsed: boolean; repositories: Array<{ name: string; alias?: string; plainFolder?: boolean; quickCommands?: QuickCommand[]; path: string; commandSequence: CommandStep[] | null }> }>
  }
  const parseExport = (path: string): ExportDoc => {
    const text = importFiles.get(path)
    if (text === undefined) throw `file not found: ${path}`
    let doc: ExportDoc
    try { doc = JSON.parse(text) } catch (error) { throw `not a valid RepoDock export: ${error}` }
    if (doc.format !== "repodock.workspace-export") throw `not a RepoDock export (format "${doc.format}")`
    if (![1, 2, 3].includes(doc.version)) throw `export version ${doc.version} is not supported`
    return doc
  }
  // Simulated filesystem: folders under C:/work/ exist unless the path says "missing".
  const folderExists = (path: string) => /^[A-Za-z]:[\\/]work[\\/]/.test(path) && !/missing/i.test(path)
  const findGroupByName = (name: string) => workspace.groups.find((g) => g.name.trim().toLowerCase() === name.trim().toLowerCase())
  const findRepoByPath = (path: string) => workspace.repositories.find((r) => r.path.toLowerCase() === path.toLowerCase())
  // Mirrors transfer.planGlobals: reuse identical commands, rename on name clashes.
  const planGlobals = (doc: ExportDoc) => {
    const taken = new Set(workspace.globalCommands.map((g) => g.name.trim().toLowerCase()))
    return (doc.globalCommands ?? []).map((cmd) => {
      const name = cmd.name.trim()
      const same = workspace.globalCommands.find((g) => g.name.trim().toLowerCase() === name.toLowerCase() && g.command.trim() === cmd.command.trim())
      if (same) return { doc: cmd, status: "existing" as const, name: same.name, localId: same.id }
      let local = name
      if (taken.has(name.toLowerCase())) {
        for (let n = 1; ; n++) {
          local = n === 1 ? `${name} (imported)` : `${name} (imported ${n})`
          if (!taken.has(local.toLowerCase())) break
        }
      }
      taken.add(local.toLowerCase())
      return { doc: cmd, status: local === name ? "new" as const : "renamed" as const, name: local, localId: "" }
    })
  }
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
  const line = (run: Run, text: string, stream: "stdout" | "stderr" = "stdout", partial = false): ProcessOutput =>
    ({ runId: run.id, repositoryId: run.repositoryId, pid: run.pid, stream, text, partial, seq: ++seq, timestamp: now() })

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
    if (/\b(prompt|init)\b/.test(command)) {
      emit("process:output-batch", [line(run, "Ok to proceed? (y/n) ", "stdout", true)])
      return plain(run)
    }
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
        const global = step.globalCommand ? workspace.globalCommands.find((g) => g.id === step.globalCommand) : undefined
        if (!step.script && step.globalCommand && !global) {
          state.steps[i].status = "failed"
          state.steps[i].error = `global command for step "${step.label}" no longer exists`
          state.status = "failed"
          break
        }
        const command = step.script ? `${repo.packageManager} run ${step.script}` : global ? global.command : step.command
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
      const name = path.split(/[\\/]/).filter(Boolean).pop() || "repository"
      const group = workspace.groups.find((g) => g.id === groupID) ?? workspace.groups[0]
      // Mirrors App.duplicateAlias: extra records of one folder get "name (n)".
      let alias = ""
      if (findRepoByPath(path)) {
        const taken = new Set(workspace.repositories.map((r) => displayName(r).toLowerCase()))
        for (let n = 2; !alias; n++) if (!taken.has(`${name} (${n})`.toLowerCase())) alias = `${name} (${n})`
      }
      const repo: Repository = {
        id: uid(), name, alias, path, packageManager: "npm", groupId: group.id, envFiles: [], quickCommands: [], lastRefreshedAt: now(), problem: "",
        scripts: [{ name: "dev", command: "node server.js" }, { name: "test", command: "node --test" }],
        commandSequence: [{ id: uid(), label: "dev", script: "dev", globalCommand: "", command: "", enabled: false, background: true }],
      }
      workspace.repositories.push(repo)
      group.repositoryIds.push(repo.id)
      changed()
      return structuredClone(repo)
    },
    async RefreshRepository(id) { const repo = findRepo(id); repo.lastRefreshedAt = now(); changed(); return structuredClone(repo) },
    async CheckRepositoryFolder(path) {
      const exists = folderExists(path)
      const registered = findRepoByPath(path)
      return {
        path, exists, valid: exists, name: path.split(/[\\/]/).filter(Boolean).pop() ?? "",
        problem: exists ? "" : `folder not found: ${path}`, registeredId: registered?.id ?? "", registeredName: registered ? displayName(registered) : "",
      }
    },
    async RelocateRepository(id, path) {
      const repo = findRepo(id)
      if (!folderExists(path)) throw `cannot use ${path}: folder not found`
      Object.assign(repo, { path, problem: "", lastRefreshedAt: now() })
      changed()
      return structuredClone(repo)
    },
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
      const used = new Set(groups.flatMap((g) => g.repositoryIds.map(findRepo).flatMap((r) => (r.commandSequence ?? []).map((s) => s.globalCommand))))
      const globals = workspace.globalCommands.filter((g) => !groupIDs.length || used.has(g.id))
      const doc: ExportDoc = {
        format: "repodock.workspace-export", version: 3, exportedAt: now(), ...(globals.length ? { globalCommands: globals } : {}),
        groups: groups.map((g) => ({
          name: g.name, runMode: g.runMode, collapsed: g.collapsed,
          repositories: g.repositoryIds.map(findRepo).map((r) => ({ name: r.name, ...(r.alias ? { alias: r.alias } : {}), ...(r.packageManager ? {} : { plainFolder: true }), ...(r.quickCommands.length ? { quickCommands: r.quickCommands } : {}), path: r.path, commandSequence: r.commandSequence })),
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
      const preview: ImportPreview = { path, exportedAt: doc.exportedAt, groups: [], globalCommands: [], groupsToCreate: 0, new: 0, existing: 0, missing: 0, shellCommands: 0 }
      for (const plan of planGlobals(doc)) {
        preview.globalCommands!.push({ id: plan.doc.id, name: plan.doc.name, command: plan.doc.command, status: plan.status, importName: plan.name })
        if (plan.status !== "existing") preview.shellCommands++
      }
      for (const group of doc.groups) {
        const exists = !!findGroupByName(group.name)
        if (!exists) preview.groupsToCreate++
        preview.groups.push({
          name: group.name, exists,
          repositories: group.repositories.map((repo) => {
            const status = findRepoByPath(repo.path) ? "existing" : folderExists(repo.path) ? "new" : "missing"
            if (status === "existing") preview.existing++
            if (status === "missing") preview.missing++
            if (status === "new" || status === "missing") {
              preview.new++
              preview.shellCommands += (repo.commandSequence ?? []).filter((s) => !s.script && !s.globalCommand && s.command).length
            }
            if (status === "new" || status === "missing") preview.shellCommands += (repo.quickCommands ?? []).filter((q) => !q.script && !q.globalCommand && q.command).length
            return { name: repo.alias || repo.name, path: repo.path, status, steps: repo.commandSequence, quickCommands: repo.quickCommands ?? [] }
          }),
        })
      }
      return preview
    },
    async ApplyImport(path, options) {
      const doc = parseExport(path)
      const result = { groupsCreated: 0, globalCommandsAdded: 0, repositoriesAdded: 0, repositoriesSkipped: 0 }
      const globalIds = new Map<string, string>()
      for (const plan of planGlobals(doc)) {
        if (plan.localId) { globalIds.set(plan.doc.id, plan.localId); continue }
        const local = { id: uid(), name: plan.name, command: plan.doc.command.trim() }
        workspace.globalCommands.push(local)
        globalIds.set(plan.doc.id, local.id)
        result.globalCommandsAdded++
      }
      // Only folders registered before the import are skipped; a folder
      // repeated inside the file is imported once per entry.
      const before = new Set(workspace.repositories.map((r) => r.path.toLowerCase()))
      // Mirrors transfer.Merge: a new group follows its predecessor in the
      // file, or, before any, goes ahead of the first file group present.
      let anchor = -1
      const position = (name: string) => workspace.groups.findIndex((g) => g.name.trim().toLowerCase() === name.trim().toLowerCase())
      for (const [index, entry] of doc.groups.entries()) {
        let group = findGroupByName(entry.name)
        if (group) anchor = position(entry.name) + 1
        if (!group) {
          group = { id: uid(), name: entry.name.trim(), repositoryIds: [], collapsed: entry.collapsed, runMode: entry.runMode ?? "sequential" }
          if (anchor < 0) {
            const later = doc.groups.slice(index + 1).map((g) => position(g.name)).find((at) => at >= 0)
            anchor = later ?? workspace.groups.length
          }
          workspace.groups.splice(anchor++, 0, group)
          result.groupsCreated++
        }
        for (const entryRepo of entry.repositories) {
          const override = options.pathOverrides?.[entryRepo.path]?.trim()
          const repo = override ? { ...entryRepo, path: override } : entryRepo
          if (before.has(repo.path.toLowerCase())) { result.repositoriesSkipped++; continue }
          const record: Repository = {
            id: uid(), name: repo.name, alias: repo.alias?.trim() ?? "", path: repo.path, packageManager: repo.plainFolder ? "" : "npm", groupId: group.id, envFiles: [], lastRefreshedAt: now(),
            problem: folderExists(repo.path) ? "" : `folder not found: ${repo.path}`, scripts: (repo.commandSequence ?? []).filter((s) => s.script).map((s) => ({ name: s.script, command: "(simulated)" })),
            quickCommands: (repo.quickCommands ?? []).map((q) => ({ ...q, id: uid(), globalCommand: q.globalCommand ? globalIds.get(q.globalCommand) ?? "" : "" })),
            commandSequence: repo.commandSequence?.map((s) => ({
              ...s, id: uid(), enabled: options.keepStepsEnabled && s.enabled,
              globalCommand: s.globalCommand ? globalIds.get(s.globalCommand) ?? "" : "",
            })) ?? null,
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
        repos: repos.map((repo) => ({ repositoryId: repo.id, name: displayName(repo), sequenceId: "", status: enabled(repo) ? "pending" : "skipped", error: "" })),
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
    async RenameRepository(id, alias) {
      const trimmed = alias.trim()
      if (trimmed.length > 200) throw "alias is longer than 200 characters"
      findRepo(id).alias = trimmed
      changed()
    },
    async MoveGroup(id, index) {
      const from = workspace.groups.findIndex((g) => g.id === id)
      if (from < 0) throw `group ${id}: not found`
      const [group] = workspace.groups.splice(from, 1)
      workspace.groups.splice(index < 0 || index > workspace.groups.length ? workspace.groups.length : index, 0, group)
      changed()
    },
    async AssignRepository(id, groupID) {
      await api.MoveRepository(id, groupID, -1)
    },
    async MoveRepository(id, groupID, index) {
      const repo = findRepo(id)
      const target = workspace.groups.find((g) => g.id === groupID)
      if (!target) throw `group ${groupID}: not found`
      workspace.groups.forEach((g) => { g.repositoryIds = g.repositoryIds.filter((r) => r !== id) })
      const at = index < 0 || index > target.repositoryIds.length ? target.repositoryIds.length : index
      target.repositoryIds.splice(at, 0, id)
      repo.groupId = groupID
      changed()
    },
    // Simulated host processes for the Kill process mini app.
    async FindProcessByPID(pid) {
      const found = hostProcesses().find((p) => p.pid === pid)
      if (!found) throw `no process with PID ${pid}: process not found`
      return found
    },
    async FindProcessesByPort(port) {
      if (port < 1 || port > 65535) throw "port must be between 1 and 65535"
      return hostProcesses().filter((p) => p.ports.includes(port))
    },
    async KillHostProcess(pid, includeChildren) {
      const found = hostProcesses().find((p) => p.pid === pid)
      if (!found) throw `no process with PID ${pid}: process not found`
      if (found.protected) throw `refusing to kill PID ${pid}: ${found.protected}`
      if (found.runId) { await api.StopProcess(found.runId); return { pid, signalled: [pid], forced: false, runId: found.runId } }
      killedHost.add(pid)
      return { pid, signalled: includeChildren ? [pid + 1, pid] : [pid], forced: false, runId: "" }
    },
    // JWT tool: tokens are not really signed in the browser mock.
    async JWTSettings() {
      return structuredClone(jwtSettings)
    },
    async SaveJWTSettings(settings) {
      const roles = [...new Set(settings.roles.map((r) => r.trim()).filter(Boolean))]
      jwtSettings = { ...structuredClone(settings), roles, selectedRoles: roles.filter((r) => settings.selectedRoles.includes(r)) }
      return structuredClone(jwtSettings)
    },
    async GenerateJWT(settings) {
      if (!settings.id.trim()) throw "ID is required"
      if (!settings.email.trim()) throw "email is required"
      if (!(settings.expiresInDays > 0)) throw "expiry must be more than 0 days"
      const iat = Math.floor(Date.now() / 1000)
      const exp = iat + Math.floor(settings.expiresInDays * 86400)
      const extra = settings.extraClaims.trim() ? JSON.parse(settings.extraClaims) as Record<string, unknown> : {}
      const payload = {
        id: settings.id, userId: settings.email, userName: settings.email, name: settings.email, deviceId: settings.deviceId, realm: settings.realm,
        resource_access: { roles: settings.selectedRoles }, channel: settings.channel, iat, exp, iss: settings.issuer, sub: settings.subject, ...extra,
      }
      const segment = (value: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")
      return { token: `${segment({ alg: settings.algorithm, typ: "JWT" })}.${segment(payload)}.bW9jay1zaWduYXR1cmU`, payload: JSON.stringify(payload, null, 2), expiresAt: new Date(exp * 1000).toISOString() }
    },
    async DecodeJWT(token) {
      const parts = token.trim().replace(/^Bearer\s+/, "").split(".")
      if (parts.length !== 3) throw "a JWT has three dot-separated parts"
      const read = (segment: string, name: string) => {
        try {
          const bytes = Uint8Array.from(atob(segment.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))
          return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
        } catch {
          throw `the ${name} is not base64url JSON`
        }
      }
      const header = read(parts[0], "header")
      const payload = read(parts[1], "payload")
      const time = (value: unknown) => (typeof value === "number" ? new Date(value * 1000).toISOString() : "")
      const roles = (payload.resource_access as { roles?: string[] } | undefined)?.roles ?? []
      return {
        header: JSON.stringify(header, null, 2), payload: JSON.stringify(payload, null, 2), algorithm: String(header.alg ?? ""),
        issuedAt: time(payload.iat), expiresAt: time(payload.exp), expired: typeof payload.exp === "number" && Date.now() / 1000 >= payload.exp,
        roles, signature: "unverified" as const, signatureError: "signatures are not checked in the browser mock",
      }
    },
    async SaveQuickCommands(repoID, commands) {
      const clean = commands
        .map((q) => ({ ...q, label: q.label.trim(), script: q.script.trim(), globalCommand: q.script ? "" : q.globalCommand, command: q.script || q.globalCommand ? "" : q.command.trim() }))
        .filter((q) => q.script || q.globalCommand || q.command)
        .map((q) => ({ ...q, id: q.id || uid(), label: q.label || q.script || workspace.globalCommands.find((g) => g.id === q.globalCommand)?.name || q.command }))
      findRepo(repoID).quickCommands = clean
      changed()
      return structuredClone(clean)
    },
    async SaveCommandSequence(repoID, steps: CommandStep[]) {
      findRepo(repoID).commandSequence = steps.map((s) => ({
        ...s,
        globalCommand: s.script ? "" : s.globalCommand,
        command: s.script || s.globalCommand ? "" : s.command,
        label: s.label.trim() || s.script || workspace.globalCommands.find((g) => g.id === s.globalCommand)?.name || s.command.trim(),
      }))
      changed()
    },
    async SaveGlobalCommands(commands) {
      const names = new Set<string>()
      const clean = commands.map((c) => ({ id: c.id || uid(), name: c.name.trim(), command: c.command.trim() }))
      for (const c of clean) {
        if (!c.name || !c.command) throw "global command name and command cannot be empty"
        if (names.has(c.name.toLowerCase())) throw `global command name "${c.name}" is used more than once`
        names.add(c.name.toLowerCase())
      }
      workspace.globalCommands = clean
      changed()
      return structuredClone(clean)
    },
    async RunScript(repoID, scriptName, label) {
      const repo = findRepo(repoID)
      if (!repo.scripts.some((s) => s.name === scriptName)) throw `script not found: ${scriptName}`
      return start(repoID, `${repo.packageManager} run ${scriptName}`, label)
    },
    async RunCommand(repoID, command, label) { return start(repoID, command, label) },
    async WaitForRun(runID) { return waitFor(runID) },
    async StopProcess(runID) { stop(runID) },
    async SendInput(runID, text, secret) {
      const run = runs.get(runID)
      if (!run || run.status !== "running") throw "the process is not running"
      if (/[\r\n\0]/.test(text)) throw "input must be a single line"
      emit("process:output-batch", [{ ...line(run, secret ? "•".repeat(Math.min(text.length, 12)) : text), stream: "stdin" }])
      emit("process:output-batch", [line(run, `received: ${secret ? "(hidden)" : JSON.stringify(text)}`)])
      if (!run.timer) window.setTimeout(() => finish(runID, "exited", 0), 300) // simulated prompt answered
    },
    async CloseInput(runID) {
      const run = runs.get(runID)
      if (!run || run.status !== "running") throw "the process is not running"
      emit("process:output-batch", [{ ...line(run, "^D"), stream: "stdin" }])
    },
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
