import { AlertTriangle, FileCode2, FolderGit2, FolderX, ShieldAlert, Terminal } from "lucide-react"
import { useEffect, useState } from "react"
import { Badge, type BadgeVariant } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { isZeroTime, type ImportPreview, type ImportRepositoryPreview } from "../domain"
import type { RepositoryActions } from "../hooks/useRepositoryActions"

const statusVariant: Record<ImportRepositoryPreview["status"], BadgeVariant> = {
  new: "success", missing: "warning", existing: "outline", duplicate: "outline",
}

/** Shows what an import will change and asks for confirmation. */
export function ImportDialog({ preview, actions, onClose }: { preview: ImportPreview | null; actions: RepositoryActions; onClose: () => void }) {
  const { t, f } = useI18n()
  const [keepEnabled, setKeepEnabled] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (preview) setKeepEnabled(false)
  }, [preview])

  const apply = async () => {
    if (!preview) return
    setBusy(true)
    try {
      if (await actions.applyImport(preview, { keepStepsEnabled: keepEnabled })) onClose()
    } finally {
      setBusy(false)
    }
  }

  const fileName = preview?.path.split(/[\\/]/).pop() ?? ""
  const nothingToDo = preview ? preview.new === 0 && preview.groupsToCreate === 0 : true

  return (
    <Dialog open={preview !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent closeLabel={t.common.close} className="max-w-2xl">
        {preview && (
          <>
            <DialogHeader>
              <DialogTitle>{t.transfer.title}</DialogTitle>
              <DialogDescription>
                <span title={preview.path}>{f(t.transfer.from, { path: fileName })}</span>
                {!isZeroTime(preview.exportedAt) && <> · {f(t.transfer.exportedAt, { time: new Date(preview.exportedAt).toLocaleString() })}</>}
              </DialogDescription>
            </DialogHeader>

            <p className="text-sm">
              {nothingToDo ? t.transfer.nothing : f(t.transfer.summary, { create: preview.groupsToCreate, new: preview.new, existing: preview.existing })}
            </p>

            <div className="thin-scrollbar max-h-[42vh] space-y-3 overflow-y-auto rounded-xl border border-border bg-background p-3">
              {preview.groups.map((group, gi) => (
                <section key={gi}>
                  <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    {group.name}
                    <Badge variant={group.exists ? "outline" : "info"} className="normal-case tracking-normal">{group.exists ? t.transfer.existingGroup : t.transfer.newGroup}</Badge>
                  </div>
                  <ul className="space-y-1">
                    {group.repositories.map((repo, ri) => {
                      const active = repo.status === "new" || repo.status === "missing"
                      return (
                        <li key={ri} className={cn("rounded-lg px-2 py-1.5", active ? "bg-card" : "opacity-60")}>
                          <div className="flex items-center gap-2 text-sm">
                            {repo.status === "missing" ? <FolderX className="size-4 shrink-0 text-warning" /> : <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />}
                            <span className="font-medium">{repo.name}</span>
                            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground" title={repo.path}>{repo.path}</span>
                            {repo.steps && repo.steps.length > 0 && <span className="shrink-0 text-[11px] text-muted-foreground">{f(t.transfer.steps, { count: repo.steps.length })}</span>}
                            <Badge variant={statusVariant[repo.status]}>{t.transfer.status[repo.status]}</Badge>
                          </div>
                          {active && (repo.steps ?? []).length > 0 && (
                            <ul className="mt-1 space-y-0.5 pl-6">
                              {(repo.steps ?? []).map((step, si) => (
                                <li key={si} className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                                  {step.script ? <FileCode2 className="size-3 shrink-0" /> : <Terminal className={cn("size-3 shrink-0", step.command && "text-warning")} />}
                                  <span className="truncate">{step.script ? `${step.label || step.script} → run ${step.script}` : step.command || t.sequence.noop}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>

            {preview.missing > 0 && (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" /> {t.transfer.missingHint}
              </p>
            )}
            {preview.shellCommands > 0 && (
              <p role="alert" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-warning" /> {f(t.transfer.commandsWarning, { count: preview.shellCommands })}
              </p>
            )}

            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" checked={keepEnabled} onChange={(event) => setKeepEnabled(event.target.checked)} className="mt-1 size-4 accent-[var(--primary)]" />
              <span>
                {t.transfer.keepEnabled}
                <span className="block text-xs text-muted-foreground">{t.transfer.keepEnabledHint}</span>
              </span>
            </label>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>{t.common.cancel}</Button>
              <Button disabled={busy || nothingToDo} onClick={() => void apply()}>{t.transfer.confirm}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
