import { Globe, Plus, Save, Terminal, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { ConfirmDialog } from "@/components/shared/ConfirmDialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tooltip } from "@/components/ui/tooltip"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { GlobalCommand } from "../domain"
import type { RepositoryActions } from "../hooks/useRepositoryActions"
import { useWorkspaceState } from "../hooks/useStores"

/** Edits the workspace's reusable global commands as one draft list. */
export function GlobalCommandsDialog({ open, actions, onOpenChange }: {
  open: boolean
  actions: RepositoryActions
  onOpenChange: (open: boolean) => void
}) {
  const { t, f } = useI18n()
  const { workspace } = useWorkspaceState()
  const [draft, setDraft] = useState<GlobalCommand[]>([])
  const [focusId, setFocusId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)

  const saved = useMemo(() => JSON.stringify(workspace.globalCommands), [workspace.globalCommands])
  const dirty = JSON.stringify(draft) !== saved

  useEffect(() => {
    if (open) setDraft(structuredClone(workspace.globalCommands))
  }, [open, saved]) // eslint-disable-line react-hooks/exhaustive-deps

  // How many saved sequence steps and quick commands reference each command.
  const usage = useMemo(() => {
    const counts = new Map<string, number>()
    for (const repo of workspace.repositories) {
      for (const step of [...(repo.commandSequence ?? []), ...repo.quickCommands]) {
        if (!step.script && step.globalCommand) counts.set(step.globalCommand, (counts.get(step.globalCommand) ?? 0) + 1)
      }
    }
    return counts
  }, [workspace.repositories])

  const errors = useMemo(() => {
    const names = new Map<string, number>()
    draft.forEach((cmd) => {
      const key = cmd.name.trim().toLowerCase()
      if (key) names.set(key, (names.get(key) ?? 0) + 1)
    })
    return new Map(draft.map((cmd) => {
      const name = !cmd.name.trim() ? t.globalCommands.nameRequired : (names.get(cmd.name.trim().toLowerCase()) ?? 0) > 1 ? t.globalCommands.duplicateName : ""
      const command = !cmd.command.trim() ? t.globalCommands.commandRequired : ""
      return [cmd.id, { name, command }]
    }))
  }, [draft, t])
  const invalid = [...errors.values()].some((e) => e.name || e.command)
  const removedInUse = workspace.globalCommands.some((cmd) => usage.get(cmd.id) && !draft.some((d) => d.id === cmd.id))

  const update = (id: string, patch: Partial<GlobalCommand>) => setDraft((list) => list.map((cmd) => (cmd.id === id ? { ...cmd, ...patch } : cmd)))

  const add = () => {
    const cmd: GlobalCommand = { id: crypto.randomUUID(), name: "", command: "" }
    setFocusId(cmd.id)
    setDraft((list) => [...list, cmd])
  }

  const save = async () => {
    setBusy(true)
    try {
      await actions.saveGlobalCommands(draft)
    } finally {
      setBusy(false)
    }
  }

  const requestClose = (next: boolean) => {
    if (!next && dirty) setConfirmClose(true)
    else onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent closeLabel={t.common.close} className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Globe className="size-4" /> {t.globalCommands.title}</DialogTitle>
          <DialogDescription>{t.globalCommands.hint}</DialogDescription>
        </DialogHeader>

        <ul className="thin-scrollbar max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {draft.length === 0 && (
            <li className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{t.globalCommands.empty}</li>
          )}
          {draft.map((cmd) => {
            const error = errors.get(cmd.id)
            const uses = usage.get(cmd.id) ?? 0
            return (
              <li key={cmd.id} className="space-y-3 rounded-xl border border-border bg-card p-4">
                <div className="flex items-end gap-3">
                  <label className="min-w-0 flex-1 space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">{t.globalCommands.name}</span>
                    <Input
                      value={cmd.name}
                      autoFocus={cmd.id === focusId}
                      onChange={(event) => update(cmd.id, { name: event.target.value })}
                      placeholder={t.globalCommands.namePlaceholder}
                      aria-invalid={!!error?.name || undefined}
                      className={cn("h-9 text-sm", error?.name && "border-destructive")}
                    />
                  </label>
                  <span className="shrink-0 pb-2 text-[11px] text-muted-foreground">{uses ? f(t.globalCommands.usedBy, { count: uses }) : t.globalCommands.unused}</span>
                  <Tooltip label={t.globalCommands.remove}>
                    <Button size="icon" variant="ghost" aria-label={t.globalCommands.remove} className="shrink-0 text-muted-foreground hover:text-destructive" onClick={() => setDraft((list) => list.filter((c) => c.id !== cmd.id))}><Trash2 /></Button>
                  </Tooltip>
                </div>
                {error?.name && <p className="-mt-2 text-[11px] text-destructive">{error.name}</p>}
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">{t.globalCommands.command}</span>
                  <div className={cn("flex items-center rounded-lg border bg-background focus-within:ring-2 focus-within:ring-ring", error?.command ? "border-destructive" : "border-border")}>
                    <Terminal className="ml-3 size-4 shrink-0 text-muted-foreground" />
                    <input
                      value={cmd.command}
                      onChange={(event) => update(cmd.id, { command: event.target.value })}
                      placeholder={t.globalCommands.commandPlaceholder}
                      aria-invalid={!!error?.command || undefined}
                      spellCheck={false}
                      autoComplete="off"
                      className="h-10 min-w-0 flex-1 bg-transparent px-3 font-mono text-sm outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                </label>
                {error?.command && <p className="-mt-2 text-[11px] text-destructive">{error.command}</p>}
              </li>
            )
          })}
        </ul>

        {removedInUse && <p role="alert" className="text-xs text-warning">{t.globalCommands.removeUsedWarning}</p>}

        <DialogFooter className="sm:justify-between">
          <Button size="sm" variant="outline" onClick={add}><Plus /> {t.globalCommands.add}</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => requestClose(false)}>{t.common.close}</Button>
            <Button disabled={!dirty || invalid || busy} onClick={() => void save()}><Save /> {t.common.save}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
      <ConfirmDialog
        open={confirmClose}
        title={t.globalCommands.unsavedTitle}
        description={t.globalCommands.unsavedBody}
        confirmLabel={t.common.discard}
        destructive
        onOpenChange={setConfirmClose}
        onConfirm={() => onOpenChange(false)}
      />
    </Dialog>
  )
}
