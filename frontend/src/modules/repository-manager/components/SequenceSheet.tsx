import { AlertTriangle, ArrowDown, ArrowUp, CircleSlash, FileCode2, Globe, GripVertical, Play, Plus, Save, Settings2, Square, Terminal, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState, type DragEvent } from "react"
import { ConfirmDialog } from "@/components/shared/ConfirmDialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tooltip } from "@/components/ui/tooltip"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { displayName, type CommandStep, type Repository, type SequenceRun } from "../domain"
import type { RepositoryActions } from "../hooks/useRepositoryActions"
import { useWorkspaceState } from "../hooks/useStores"
import { GlobalCommandsDialog } from "./GlobalCommandsDialog"
import { isNoopSlot, moveToSlot, slotFromPointer } from "../reorder"
import { stepStatusVariant } from "./status"

/** MIME type of an in-app step drag; other drags (files, text) are ignored. */
const STEP_DRAG_TYPE = "application/x-repodock-step"

function initialSteps(repo: Repository): CommandStep[] {
  return structuredClone(repo.commandSequence ?? [])
}

const newStep = (patch: Partial<CommandStep>): CommandStep => ({
  id: crypto.randomUUID(), label: "", script: "", globalCommand: "", command: "", enabled: true, background: false, ...patch,
})

export function SequenceSheet({ repo, open, sequence, actions, onOpenChange }: {
  repo: Repository
  open: boolean
  sequence: SequenceRun | undefined
  actions: RepositoryActions
  onOpenChange: (open: boolean) => void
}) {
  const { t, f } = useI18n()
  const { workspace } = useWorkspaceState()
  const [manageGlobals, setManageGlobals] = useState(false)
  const [steps, setSteps] = useState<CommandStep[]>(() => initialSteps(repo))
  const [confirmClose, setConfirmClose] = useState(false)
  const [busy, setBusy] = useState(false)
  // Step whose command field should receive focus (a just-added command step).
  const [focusId, setFocusId] = useState<string | null>(null)
  // Index of the step being dragged, and the insertion slot under the pointer.
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropSlot, setDropSlot] = useState<number | null>(null)

  const saved = useMemo(() => JSON.stringify(repo.commandSequence ?? []), [repo.commandSequence])
  const dirty = JSON.stringify(steps) !== saved
  const running = sequence?.status === "running"
  const stepState = useMemo(() => new Map(sequence?.steps.map((s) => [s.stepId, s]) ?? []), [sequence])
  const scriptNames = useMemo(() => new Set(repo.scripts.map((s) => s.name)), [repo.scripts])
  const globals = workspace.globalCommands
  const globalById = useMemo(() => new Map(globals.map((g) => [g.id, g])), [globals])

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

  const endDrag = () => { setDragFrom(null); setDropSlot(null) }
  const overSlot = (event: DragEvent, slot: number) => {
    if (dragFrom === null) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = "move"
    if (slot !== dropSlot) setDropSlot(slot)
  }
  const indicatorSlot = dragFrom !== null && dropSlot !== null && !isNoopSlot(dropSlot, dragFrom) ? dropSlot : null

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
          <SheetTitle>{t.sequence.title} · {displayName(repo)}</SheetTitle>
          <SheetDescription>{t.sequence.hint}</SheetDescription>
          {sequence && (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <Badge variant={sequence.status === "running" ? "info" : sequence.status === "completed" ? "success" : sequence.status === "failed" ? "destructive" : "outline"}>
                {t.sequence.sequenceStatus[sequence.status]}
              </Badge>
            </div>
          )}
        </SheetHeader>

        <ol
          className="thin-scrollbar flex-1 space-y-2 overflow-y-auto p-4"
          // The empty area below the last step drops at the end.
          onDragOver={(event) => overSlot(event, steps.length)}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropSlot(null) }}
          onDrop={(event) => {
            if (dragFrom === null) return
            event.preventDefault()
            if (dropSlot !== null) setSteps((list) => moveToSlot(list, dragFrom, dropSlot))
            endDrag()
          }}
        >
          {steps.length === 0 && (
            <li className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">{t.sequence.noSteps}</li>
          )}
          {steps.map((step, index) => {
            const kind = step.script ? "script" : step.globalCommand ? "global" : "command"
            const state = stepState.get(step.id)
            const missing = !!step.script && !scriptNames.has(step.script)
            const global = step.globalCommand ? globalById.get(step.globalCommand) : undefined
            const globalMissing = !!step.globalCommand && !global
            const noop = !step.script && !step.globalCommand && !step.command.trim()
            return (
              <li
                key={step.id}
                className={cn("relative rounded-xl border p-3 transition", step.enabled ? "border-border bg-card" : "border-dashed border-border bg-transparent opacity-70", dragFrom === index && "opacity-40")}
                onDragOver={(event) => overSlot(event, slotFromPointer(index, event.clientY, event.currentTarget.getBoundingClientRect()))}
                onKeyDown={(event) => {
                  if (!event.altKey) return
                  if (event.key === "ArrowUp") { event.preventDefault(); move(index, -1) }
                  if (event.key === "ArrowDown") { event.preventDefault(); move(index, 1) }
                }}
              >
                {(indicatorSlot === index || (indicatorSlot === index + 1 && index === steps.length - 1)) && (
                  <span aria-hidden className={cn("pointer-events-none absolute inset-x-3 h-0.5 rounded-full bg-primary", indicatorSlot === index ? "-top-[5px]" : "-bottom-[5px]")} />
                )}
                <div className="flex items-center gap-2">
                  <span
                    draggable
                    title={t.sequence.dragHandle}
                    aria-hidden
                    onDragStart={(event) => {
                      const item = event.currentTarget.closest("li")
                      if (item) {
                        const rect = item.getBoundingClientRect()
                        event.dataTransfer.setDragImage(item, event.clientX - rect.left, event.clientY - rect.top)
                      }
                      event.dataTransfer.effectAllowed = "move"
                      event.dataTransfer.setData(STEP_DRAG_TYPE, step.id)
                      setDragFrom(index)
                    }}
                    onDragEnd={endDrag}
                    className="-ml-1 flex h-8 shrink-0 cursor-grab items-center rounded text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
                  >
                    <GripVertical className="size-4" />
                  </span>
                  <span className="w-5 text-right text-xs tabular-nums text-muted-foreground">{index + 1}.</span>
                  <input
                    type="checkbox"
                    checked={step.enabled}
                    onChange={(event) => update(step.id, { enabled: event.target.checked })}
                    aria-label={t.sequence.enabled}
                    className="size-4 shrink-0 accent-[var(--primary)]"
                  />
                  <div role="radiogroup" aria-label={t.sequence.kind} className="flex shrink-0 rounded-lg border border-border p-0.5 text-xs">
                    {(["script", "global", "command"] as const).map((value) => (
                      <button
                        key={value}
                        role="radio"
                        aria-checked={kind === value}
                        onClick={() => update(step.id, value === "script"
                          ? { script: step.script || repo.scripts[0]?.name || "", globalCommand: "", command: "" }
                          : value === "global"
                            ? { script: "", globalCommand: step.globalCommand || globals[0]?.id || "", command: "" }
                            : { script: "", globalCommand: "", command: step.command })}
                        disabled={(value === "script" && repo.scripts.length === 0) || (value === "global" && globals.length === 0 && kind !== "global")}
                        title={value === "global" && globals.length === 0 ? t.sequence.noGlobals : undefined}
                        className={cn("flex items-center gap-1 rounded-md px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40", kind === value ? "bg-accent font-medium" : "text-muted-foreground")}
                      >
                        {value === "script" ? <FileCode2 className="size-3" /> : value === "global" ? <Globe className="size-3" /> : <Terminal className="size-3" />}
                        {value === "script" ? t.sequence.kindScript : value === "global" ? t.sequence.kindGlobal : t.sequence.kindCommand}
                      </button>
                    ))}
                  </div>
                  {kind === "script" ? (
                    <select
                      value={step.script}
                      onChange={(event) => update(step.id, { script: event.target.value })}
                      aria-label={t.sequence.kindScript}
                      className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {missing && <option value={step.script}>{step.script}</option>}
                      {repo.scripts.map((script) => <option key={script.name} value={script.name}>{script.name}</option>)}
                    </select>
                  ) : kind === "global" ? (
                    <>
                      <select
                        value={step.globalCommand}
                        onChange={(event) => update(step.id, { globalCommand: event.target.value })}
                        aria-label={t.sequence.kindGlobal}
                        title={global?.command}
                        className={cn("h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", globalMissing && "border-warning/60")}
                      >
                        {globalMissing && <option value={step.globalCommand}>{t.transfer.missingGlobal}</option>}
                        {globals.map((g) => <option key={g.id} value={g.id}>{g.name} — {g.command}</option>)}
                      </select>
                      <Tooltip label={t.sequence.manageGlobal}>
                        <Button size="icon-sm" variant="ghost" aria-label={t.sequence.manageGlobal} onClick={() => setManageGlobals(true)}><Settings2 /></Button>
                      </Tooltip>
                    </>
                  ) : (
                    <Input
                      value={step.command}
                      autoFocus={step.id === focusId}
                      onChange={(event) => update(step.id, { command: event.target.value })}
                      placeholder={t.sequence.commandPlaceholder}
                      aria-label={t.sequence.kindCommand}
                      aria-invalid={noop || undefined}
                      spellCheck={false}
                      className={cn("h-8 min-w-0 flex-1 font-mono text-sm", noop && "border-warning/60")}
                    />
                  )}
                  {state && <Badge variant={stepStatusVariant[state.status]}>{t.sequence.status[state.status]}</Badge>}
                  <div className="flex shrink-0 items-center">
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

                <div className="mt-2 flex items-center gap-2 pl-[4.5rem]">
                  <Input
                    value={step.label}
                    placeholder={step.script || global?.name || step.command || t.sequence.namePlaceholder}
                    onChange={(event) => update(step.id, { label: event.target.value })}
                    aria-label={t.sequence.label}
                    className="h-7 max-w-64 flex-1 text-xs"
                  />
                  <Tooltip label={t.sequence.backgroundHint}>
                    <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                      <input type="checkbox" checked={step.background} onChange={(event) => update(step.id, { background: event.target.checked })} className="size-3.5 accent-[var(--primary)]" />
                      {t.sequence.background}
                    </label>
                  </Tooltip>
                </div>
                {(missing || globalMissing || noop || state?.error) && (
                  <div className="mt-1.5 flex items-center gap-1.5 pl-[4.5rem] text-[11px]">
                    {missing ? <><AlertTriangle className="size-3 text-warning" /> <span className="text-muted-foreground">{t.sequence.scriptMissing}</span></>
                      : globalMissing ? <><AlertTriangle className="size-3 text-warning" /> <span className="text-muted-foreground">{t.sequence.globalMissing}</span></>
                      : noop ? <><CircleSlash className="size-3 text-warning" /> <span className="text-warning">{t.sequence.noCommand}</span></> : null}
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
            <Button size="sm" variant="outline" onClick={() => {
              if (!globals.length) { setManageGlobals(true); return }
              setSteps((list) => [...list, newStep({ globalCommand: globals[0].id })])
            }}>
              <Globe /> {t.sequence.addGlobal}
            </Button>
            <Button size="sm" variant="outline" onClick={() => {
              const step = newStep({})
              setFocusId(step.id)
              setSteps((list) => [...list, step])
            }}>
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
      <GlobalCommandsDialog open={manageGlobals} actions={actions} onOpenChange={setManageGlobals} />
    </Sheet>
  )
}
