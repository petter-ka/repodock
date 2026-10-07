import { AlertTriangle, CheckCircle2, CheckSquare, FileCode2, FolderGit2, FolderOpen, FolderX, Globe, Loader2, ShieldAlert, Square as SquareIcon, Terminal, XCircle } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Badge, type BadgeVariant } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { isZeroTime, type FolderCheck, type ImportGlobalCommandPreview, type ImportPreview, type ImportRepositoryPreview } from "../domain"
import type { RepositoryActions } from "../hooks/useRepositoryActions"

const statusVariant: Record<ImportRepositoryPreview["status"], BadgeVariant> = {
  new: "success", missing: "warning", existing: "outline", duplicate: "outline",
}

const globalVariant: Record<ImportGlobalCommandPreview["status"], BadgeVariant> = {
  new: "success", existing: "outline", renamed: "warning",
}

/** Shows what an import will change and asks for confirmation. */
export function ImportDialog({ preview, actions, onClose }: { preview: ImportPreview | null; actions: RepositoryActions; onClose: () => void }) {
  const { t, f } = useI18n()
  // The exported step selection is kept by default; untick to import every
  // step disabled for review (ADR-0011, amended by ADR-0015).
  const [keepEnabled, setKeepEnabled] = useState(true)
  const [busy, setBusy] = useState(false)
  // Replacement folders for repositories whose path is missing on this
  // machine, keyed by the path shown in the preview.
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  const latest = useRef<Record<string, string>>({})

  useEffect(() => {
    if (preview) {
      setKeepEnabled(true)
      setOverrides({})
      latest.current = {}
    }
  }, [preview])

  const setValue = (key: string, value: string) =>
    setOverrides((all) => ({ ...all, [key]: { value, check: undefined, checking: false } }))

  const check = async (key: string, value: string) => {
    const trimmed = value.trim()
    latest.current[key] = trimmed
    if (!trimmed) {
      setOverrides((all) => ({ ...all, [key]: { value, check: undefined, checking: false } }))
      return
    }
    setOverrides((all) => ({ ...all, [key]: { value, check: undefined, checking: true } }))
    const result = await actions.checkFolder(trimmed).catch(() => undefined)
    if (latest.current[key] !== trimmed) return // a newer value was entered meanwhile
    setOverrides((all) => ({ ...all, [key]: { value, check: result, checking: false } }))
  }

  const browse = async (key: string) => {
    const path = await actions.browseFolder()
    if (path) await check(key, path)
  }

  const entered = Object.entries(overrides).filter(([, o]) => o.value.trim())
  const blocked = entered.some(([, o]) => o.checking || !o.check?.valid)

  const apply = async () => {
    if (!preview) return
    setBusy(true)
    try {
      const pathOverrides = Object.fromEntries(entered.map(([key, o]) => [key, o.check!.path]))
      if (await actions.applyImport(preview, { keepStepsEnabled: keepEnabled, pathOverrides })) onClose()
    } finally {
      setBusy(false)
    }
  }

  const fileName = preview?.path.split(/[\\/]/).pop() ?? ""
  const globals = preview?.globalCommands ?? []
  const globalById = new Map(globals.map((g) => [g.id, g]))
  const newGlobals = globals.filter((g) => g.status !== "existing").length
  const nothingToDo = preview ? preview.new === 0 && preview.groupsToCreate === 0 && newGlobals === 0 : true

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
              {globals.length > 0 && (
                <section>
                  <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    <Globe className="size-3.5" /> {t.transfer.globalCommands}
                  </div>
                  <ul className="space-y-1">
                    {globals.map((g) => (
                      <li key={g.id} className={cn("flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm", g.status === "existing" ? "opacity-60" : "bg-card")}>
                        <span className="font-medium">{g.name}</span>
                        <span className={cn("min-w-0 flex-1 truncate font-mono text-[11px]", g.status === "existing" ? "text-muted-foreground" : "text-warning")} title={g.command}>{g.command}</span>
                        <Badge variant={globalVariant[g.status]}>{f(t.transfer.globalStatus[g.status], { name: g.importName })}</Badge>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {preview.groups.map((group, gi) => (
                <section key={gi}>
                  <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    {group.name}
                    <Badge variant={group.exists ? "outline" : "info"} className="normal-case tracking-normal">{group.exists ? t.transfer.existingGroup : t.transfer.newGroup}</Badge>
                  </div>
                  <ul className="space-y-1">
                    {group.repositories.map((repo, ri) => {
                      const active = repo.status === "new" || repo.status === "missing"
                      const override = overrides[repo.path]
                      const fixed = repo.status === "missing" && !!override?.check?.valid
                      return (
                        <li key={ri} className={cn("rounded-lg px-2 py-1.5", active ? "bg-card" : "opacity-60")}>
                          <div className="flex items-center gap-2 text-sm">
                            {repo.status === "missing" && !fixed ? <FolderX className="size-4 shrink-0 text-warning" /> : <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />}
                            <span className="font-medium">{repo.name}</span>
                            <span className={cn("min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground", fixed && "line-through opacity-60")} title={repo.path}>{repo.path}</span>
                            {repo.steps && repo.steps.length > 0 && <span className="shrink-0 text-[11px] text-muted-foreground">{f(t.transfer.steps, { count: repo.steps.length, enabled: repo.steps.filter((s) => s.enabled).length })}</span>}
                            <Badge variant={fixed ? "success" : statusVariant[repo.status]}>{t.transfer.status[fixed ? "new" : repo.status]}</Badge>
                          </div>
                          {repo.status === "missing" && (
                            <PathOverrideField
                              value={override?.value ?? ""}
                              check={override?.check}
                              checking={override?.checking ?? false}
                              onChange={(value) => setValue(repo.path, value)}
                              onCommit={(value) => void check(repo.path, value)}
                              onBrowse={() => void browse(repo.path)}
                            />
                          )}
                          {active && (repo.steps ?? []).length > 0 && (
                            <ul className="mt-1 space-y-0.5 pl-6">
                              {(repo.steps ?? []).map((step, si) => (
                                <li key={si} className={cn("flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground", !(keepEnabled && step.enabled) && "opacity-50")}>
                                  <span className="w-4 shrink-0 text-right tabular-nums">{si + 1}.</span>
                                  {keepEnabled && step.enabled
                                    ? <CheckSquare className="size-3 shrink-0 text-primary" aria-label={t.sequence.enabled} />
                                    : <SquareIcon className="size-3 shrink-0" aria-label={t.transfer.stepDisabled} />}
                                  {step.script ? <FileCode2 className="size-3 shrink-0" /> : step.globalCommand ? <Globe className="size-3 shrink-0" /> : <Terminal className={cn("size-3 shrink-0", step.command && "text-warning")} />}
                                  <span className="truncate">{step.script
                                    ? `${step.label || step.script} → run ${step.script}`
                                    : step.globalCommand
                                      ? `${step.label || globalById.get(step.globalCommand)?.name || ""} → ${globalById.get(step.globalCommand)?.command ?? t.transfer.missingGlobal}`
                                      : step.command || t.sequence.noop}</span>
                                  {step.background && <span className="shrink-0 font-sans text-[9px] uppercase tracking-wide">bg</span>}
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

            {blocked && (
              <p role="alert" className="flex items-center gap-2 text-xs text-destructive">
                <XCircle className="size-3.5 shrink-0" /> {t.relocate.invalidBlocking}
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
              <Button disabled={busy || nothingToDo || blocked} onClick={() => void apply()}>{t.transfer.confirm}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

type Override = { value: string; check: FolderCheck | undefined; checking: boolean }

/** Lets the user point a missing repository at a folder on this machine. */
function PathOverrideField({ value, check, checking, onChange, onCommit, onBrowse }: {
  value: string
  check: FolderCheck | undefined
  checking: boolean
  onChange: (value: string) => void
  onCommit: (value: string) => void
  onBrowse: () => void
}) {
  const { t, f } = useI18n()
  const invalid = !!value.trim() && !checking && check && !check.valid
  let status: React.ReactNode = <span className="text-muted-foreground">{t.relocate.keep}</span>
  if (checking) status = <span className="flex items-center gap-1 text-muted-foreground"><Loader2 className="size-3 animate-spin" /> {t.relocate.checking}</span>
  else if (check?.valid && check.registeredId) status = <span className="flex items-center gap-1 text-warning"><AlertTriangle className="size-3" /> {f(t.relocate.registered, { name: check.registeredName })}</span>
  else if (check?.valid) status = <span className="flex items-center gap-1 text-success"><CheckCircle2 className="size-3" /> {f(t.relocate.ok, { name: check.name })}</span>
  else if (check && !check.exists) status = <span className="flex items-center gap-1 text-destructive"><XCircle className="size-3" /> {t.relocate.notFound}</span>
  else if (check) status = <span className="flex items-center gap-1 text-destructive"><XCircle className="size-3" /> {t.relocate.noPackage}</span>

  return (
    <div className="mt-1.5 pl-6">
      <div className="flex items-center gap-1.5">
        <input
          value={value}
          spellCheck={false}
          placeholder={t.relocate.placeholder}
          aria-label={t.relocate.placeholder}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => onCommit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              onCommit(event.currentTarget.value)
            }
          }}
          className={cn(
            "h-7 min-w-0 flex-1 rounded-md border bg-background px-2 font-mono text-[11px] outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring",
            invalid ? "border-destructive" : "border-border",
          )}
        />
        <Button size="xs" variant="outline" onClick={onBrowse}><FolderOpen /> {t.relocate.browse}</Button>
      </div>
      <div className="mt-1 text-[11px]">{status}</div>
    </div>
  )
}
