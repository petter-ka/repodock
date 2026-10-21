import { AlertTriangle, ChevronDown, Hexagon, Info, RefreshCw } from "lucide-react"
import { useMemo } from "react"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { displayName, type NodeInstall, type NodeStatus, type Repository } from "../domain"
import type { RepositoryActions } from "../hooks/useRepositoryActions"
import { nodeMajor, nodeNeedsAttention, nodeStore, useNodeVersion } from "../store/nodeStore"

/** Display names of version managers the overview does not name itself. */
const MANAGER_NAMES: Record<string, string> = { system: "system", homebrew: "Homebrew", "nvm-windows": "nvm for Windows", volta: "Volta" }

export function managerName(id: string) {
  return nodeStore.get().managers.find((m) => m.id === id)?.name ?? MANAGER_NAMES[id] ?? id
}

/** One line per reason a repository's Node.js version needs a look. */
export function useNodeNotes(repo: Repository, status: NodeStatus | undefined) {
  const { t, f } = useI18n()
  if (!status) return []
  const notes: Array<{ tone: "warning" | "info"; text: string }> = []
  if (!status.version) notes.push({ tone: "warning", text: t.node.noneFound })
  if (status.missing) {
    const source = repo.nodeVersion && status.source !== "selected" ? t.node.yourChoice : repo.nodeRequest.source
    notes.push({ tone: "warning", text: f(t.node.missing, { spec: status.missing, source, version: status.version || "—" }) })
  }
  if (status.enginesMismatch) notes.push({ tone: "warning", text: f(t.node.engines, { range: repo.nodeRequest.engines, version: status.version }) })
  if (status.eol) notes.push({ tone: "warning", text: f(t.node.eol, { major: nodeMajor(status.version) }) })
  if (status.newer) notes.push({ tone: "info", text: f(t.node.newer, { version: status.newer }) })
  return notes
}

/** Why this version is used, in a few words. */
export function useNodeSource(repo: Repository, status: NodeStatus | undefined) {
  const { t, f } = useI18n()
  if (!status?.version) return ""
  if (status.source === "selected") return t.node.sourceSelected
  if (status.source === "request") return f(t.node.sourceRequest, { source: repo.nodeRequest.source, spec: repo.nodeRequest.spec })
  return t.node.sourceDefault
}

/**
 * The Node.js version the repository's commands run with, and a menu to
 * pick another installed one or go back to automatic (ADR-0031).
 */
export function NodeVersionMenu({ repo, actions }: { repo: Repository; actions: RepositoryActions }) {
  const { t, f } = useI18n()
  useNodeVersion()
  const overview = nodeStore.get()
  const status = nodeStore.status(repo.id)
  const notes = useNodeNotes(repo, status)
  const source = useNodeSource(repo, status)
  const attention = nodeNeedsAttention(status)

  // One row per version; several managers may provide the same one.
  const versions = useMemo(() => {
    const rows = new Map<string, { install: NodeInstall; managers: string[]; isDefault: boolean }>()
    for (const install of overview.installs) {
      const row = rows.get(install.version)
      if (row) {
        if (!row.managers.includes(install.manager)) row.managers.push(install.manager)
        row.isDefault ||= install.default
      } else rows.set(install.version, { install, managers: [install.manager], isDefault: install.default })
    }
    return [...rows.values()]
  }, [overview.installs])

  if (!nodeStore.loaded) {
    return <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border px-2 text-[0.6875rem] text-muted-foreground"><Hexagon className="size-3" /> {t.node.loading}</span>
  }

  const label = status?.version ? f(t.node.label, { version: status.version }) : t.node.none
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={f(t.node.menuLabel, { name: displayName(repo), version: label })}
          title={[label, source, ...notes.map((note) => note.text)].filter(Boolean).join("\n")}
          className={cn(
            "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-[0.6875rem] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
            attention ? "border-warning/50 bg-warning/10 text-warning hover:bg-warning/15" : "border-border bg-muted text-muted-foreground hover:text-foreground",
          )}
        >
          {attention ? <AlertTriangle className="size-3" /> : <Hexagon className="size-3" />}
          <span className="tabular-nums">{label}</span>
          {status?.source === "selected" && <span className="rounded bg-primary/15 px-1 text-[0.625rem] text-primary">{t.node.pinned}</span>}
          <ChevronDown className="size-3 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel className="normal-case tracking-normal">{t.node.title}</DropdownMenuLabel>
        <div className="space-y-1.5 px-2.5 pb-2 text-xs">
          {source && <p className="text-muted-foreground">{source}</p>}
          {notes.map((note) => (
            <p key={note.text} className={cn("flex gap-1.5", note.tone === "warning" ? "text-warning" : "text-muted-foreground")}>
              {note.tone === "warning" ? <AlertTriangle className="mt-0.5 size-3 shrink-0" /> : <Info className="mt-0.5 size-3 shrink-0" />}
              <span>{note.text}</span>
            </p>
          ))}
        </div>
        <DropdownMenuSeparator />
        {versions.length === 0 ? (
          <p className="px-2.5 py-2 text-xs text-muted-foreground">{t.node.noInstalls}</p>
        ) : (
          <DropdownMenuRadioGroup value={repo.nodeVersion} onValueChange={(value) => void actions.setNodeVersion(repo, value)}>
            <DropdownMenuRadioItem value="">
              <span className="flex min-w-0 flex-col">
                <span>{t.node.automatic}</span>
                <span className="text-[0.6875rem] text-muted-foreground">{t.node.automaticHint}</span>
              </span>
            </DropdownMenuRadioItem>
            <div className="thin-scrollbar max-h-64 overflow-y-auto">
              {versions.map(({ install, managers, isDefault }) => (
                <DropdownMenuRadioItem key={install.version} value={install.version}>
                  <span className="font-mono text-xs tabular-nums">{install.version}</span>
                  <span className="truncate text-[0.6875rem] text-muted-foreground">{managers.map(managerName).join(", ")}</span>
                  <span className="ml-auto flex shrink-0 gap-1 pl-2">
                    {isDefault && <span className="rounded bg-muted px-1 text-[0.625rem] text-muted-foreground">{t.node.default}</span>}
                    {install.eol && <span className="rounded bg-warning/15 px-1 text-[0.625rem] text-warning">{t.node.eolTag}</span>}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </div>
          </DropdownMenuRadioGroup>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={(event) => { event.preventDefault(); void actions.rescanNodeVersions() }}>
          <RefreshCw /> {t.node.rescan}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
