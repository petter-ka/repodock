import { AlertTriangle, ArrowDown, ArrowUp, CircleSlash, FileCode2, Play, Plus, Save, Square, Terminal, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { ConfirmDialog } from "@/components/shared/ConfirmDialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tooltip } from "@/components/ui/tooltip"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { CommandStep, Repository, SequenceRun } from "../domain"
import type { RepositoryActions } from "../hooks/useRepositoryActions"
import { stepStatusVariant } from "./status"

function initialSteps(repo: Repository): CommandStep[] {
  return structuredClone(repo.commandSequence ?? [])
}

const newStep = (patch: Partial<CommandStep>): CommandStep => ({
  id: crypto.randomUUID(), label: "", script: "", command: "", enabled: true, background: false, ...patch,
})

export function SequenceSheet({ repo, open, sequence, actions, onOpenChange }: {
  repo: Repository
  open: boolean
  sequence: SequenceRun | undefined
  actions: RepositoryActions
  onOpenChange: (open: boolean) => void
}) {
  const { t, f } = useI18n()
  const [steps, setSteps] = useState<CommandStep[]>(() => initialSteps(repo))
  const [confirmClose, setConfirmClose] = useState(false)
  const [busy, setBusy] = useState(false)

  const saved = useMemo(() => JSON.stringify(repo.commandSequence ?? []), [repo.commandSequence])
  const dirty = JSON.stringify(steps) !== saved
  const running = sequence?.status === "running"
  const stepState = useMemo(() => new Map(sequence?.steps.map((s) => [s.stepId, s]) ?? []), [sequence])
  const scriptNames = useMemo(() => new Set(repo.scripts.map((s) => s.name)), [repo.scripts])

  // Reload the draft when opening, switching repository, or after a save
  // (the backend normalizes labels and IDs, so the saved copy is canonical).
  useEffect(() => {
    if (open) setSteps(initialSteps(repo))
  }, [open, repo.id, saved]) // eslint-disable-line react-hooks/exhaustive-deps

  const update = (id: string, patch: Partial<CommandStep>) => setSteps((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  const remove = (id: string) => setSteps((list) => list.filter((s) => s.id !== id))
  const move = (index: number, delta: -1 | 1) => setSteps((list) => {
    const target = index + delta
    if (target < 0 || target >= list.length) return list
    const copy = [...list]
    ;[copy[index], copy[target]] = [copy[target], copy[index]]
    return copy
  })

  const requestClose = (next: boolean) => {
    if (!next && dirty) setConfirmClose(true)
    else onOpenChange(next)
  }

  const save = async () => {
    setBusy(true)
    try {
      await actions.saveSequence(repo, steps)
    } finally {
      setBusy(false)
    }
  }

  const saveAndRun = async () => {
    setBusy(true)
    try {
      if (dirty && !(await actions.saveSequence(repo, steps, true))) return
      await actions.runSequence(repo)
    } finally {
      setBusy(false)
    }
  }

  const enabledCount = steps.filter((s) => s.enabled).length

  return (
    <Sheet open={open} onOpenChange={requestClose}>
      <SheetContent closeLabel={t.common.close} className="max-w-2xl">
        <SheetHeader>
          <SheetTitle>{t.sequence.title} · {repo.name}</SheetTitle>
          <SheetDescription>{t.sequence.hint}</SheetDescription>
          {sequence && (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <Badge variant={sequence.status === "running" ? "info" : sequence.status === "completed" ? "success" : sequence.status === "failed" ? "destructive" : "outline"}>
                {t.sequence.sequenceStatus[sequence.status]}
              </Badge>
            </div>
          )}
        </SheetHeader>

        <ol className="thin-scrollbar flex-1 space-y-2 overflow-y-auto p-4">
          {steps.length === 0 && (
            <li className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">{t.sequence.noSteps}</li>
          )}
          {steps.map((step, index) => {
            const kind = step.script ? "script" : "command"
            const state = stepState.get(step.id)
            const missing = !!step.script && !scriptNames.has(step.script)
            const noop = !step.script && !step.command.trim()
            return (
              <li
                key={step.id}
                className={cn("rounded-xl border p-3 transition", step.enabled ? "border-border bg-card" : "border-dashed border-border bg-transparent opacity-70")}
                onKeyDown={(event) => {
                  if (!event.altKey) return
                  if (event.key === "ArrowUp") { event.preventDefault(); move(index, -1) }
                  if (event.key === "ArrowDown") { event.preventDefault(); move(index, 1) }
                }}
              >
                <div className="flex items-center gap-2">
                  <span className="w-5 text-right text-xs tabular-nums text-muted-foreground">{index + 1}.</span>
                  <input
                    type="checkbox"
                    checked={step.enabled}
                    onChange={(event) => update(step.id, { enabled: event.target.checked })}
                    aria-label={t.sequence.enabled}
                    className="size-4 accent-[var(--primary)]"
                  />
                  <Input
                    value={step.label}
                    placeholder={step.script || step.command || t.sequence.emptyStep}
                    onChange={(event) => update(step.id, { label: event.target.value })}
                    aria-label={t.sequence.label}
                    className="h-8 flex-1 text-sm font-medium"
                  />
                  {state && <Badge variant={stepStatusVariant[state.status]}>{t.sequence.status[state.status]}</Badge>}
                  <div className="flex items-center">
                    <Tooltip label={t.sequence.moveUp}>
                      <Button size="icon-sm" variant="ghost" aria-label={t.sequence.moveUp} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp /></Button>
                    </Tooltip>
                    <Tooltip label={t.sequence.moveDown}>
                      <Button size="icon-sm" variant="ghost" aria-label={t.sequence.moveDown} disabled={index === steps.length - 1} onClick={() => move(index, 1)}><ArrowDown /></Button>
                    </Tooltip>
                    <Tooltip label={t.sequence.removeStep}>
                      <Button size="icon-sm" variant="ghost" aria-label={t.sequence.removeStep} onClick={() => remove(step.id)}><Trash2 /></Button>
                    </Tooltip>
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-2 pl-7">
                  <div role="radiogroup" aria-label={t.sequence.kindScript} className="flex shrink-0 rounded-lg border border-border p-0.5 text-xs">
                    {(["script", "command"] as const).map((value) => (
                      <button
                        key={value}
                        role="radio"
                        aria-checked={kind === value}
                        onClick={() => update(step.id, value === "script"
                          ? { script: step.script || repo.scripts[0]?.name || "", command: "" }
                          : { script: "", command: step.command })}
                        disabled={value === "script" && repo.scripts.length === 0}
                        className={cn("flex items-center gap-1 rounded-md px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40", kind === value ? "bg-accent font-medium" : "text-muted-foreground")}
                      >
                        {value === "script" ? <FileCode2 className="size-3" /> : <Terminal className="size-3" />}
                        {value === "script" ? t.sequence.kindScript : t.sequence.kindCommand}
                      </button>
                    ))}
                  </div>
                  {kind === "script" ? (
                    <select
                      value={step.script}
                      onChange={(event) => update(step.id, { script: event.target.value })}
                      aria-label={t.sequence.kindScript}
                      className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {missing && <option value={step.script}>{step.script}</option>}
                      {repo.scripts.map((script) => <option key={script.name} value={script.name}>{script.name}</option>)}
                    </select>
                  ) : (
                    <Input
                      value={step.command}
                      onChange={(event) => update(step.id, { command: event.target.value })}
                      placeholder={t.sequence.commandPlaceholder}
                      aria-label={t.sequence.kindCommand}
                      spellCheck={false}
                      className="h-8 flex-1 font-mono text-xs"
                    />
                  )}
                  <Tooltip label={t.sequence.backgroundHint}>
                    <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                      <input type="checkbox" checked={step.background} onChange={(event) => update(step.id, { background: event.target.checked })} className="size-3.5 accent-[var(--primary)]" />
                      {t.sequence.background}
                    </label>
                  </Tooltip>
                </div>
                {(missing || noop || state?.error) && (
                  <div className="mt-1.5 flex items-center gap-1.5 pl-7 text-[11px] text-muted-foreground">
                    {missing ? <><AlertTriangle className="size-3 text-warning" /> {t.sequence.scriptMissing}</>
                      : noop ? <><CircleSlash className="size-3" /> {t.sequence.noop}</> : null}
                    {state?.error && <span className="text-destructive">{state.error}</span>}
                  </div>
                )}
              </li>
            )
          })}
        </ol>

        <div className="border-t border-border p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!repo.scripts.length} onClick={() => setSteps((list) => [...list, newStep({ script: repo.scripts[0]?.name ?? "" })])}>
              <Plus /> {t.sequence.addScript}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setSteps((list) => [...list, newStep({ command: "" , label: "" })])}>
              <Plus /> {t.sequence.addCommand}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setSteps((list) => [...list, newStep({ label: t.sequence.emptyStep })])}>
              <CircleSlash /> {t.sequence.addEmpty}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{f(t.sequence.enabledCount, { count: enabledCount })}</span>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" disabled={!dirty || busy} onClick={() => void save()}><Save /> {t.common.save}</Button>
              {running && sequence ? (
                <Button variant="destructive" onClick={() => void actions.cancelSequence(sequence.id)}><Square /> {t.sequence.cancelRun}</Button>
              ) : (
                <Button disabled={busy || enabledCount === 0} onClick={() => void saveAndRun()}><Play /> {dirty ? t.sequence.runSaved : t.sequence.run}</Button>
              )}
            </div>
          </div>
        </div>
      </SheetContent>
      <ConfirmDialog
        open={confirmClose}
        title={t.sequence.unsavedTitle}
        description={t.sequence.unsavedBody}
        confirmLabel={t.common.discard}
        destructive
        onOpenChange={setConfirmClose}
        onConfirm={() => {
          setSteps(initialSteps(repo))
          onOpenChange(false)
        }}
      />
    </Sheet>
  )
}
