import { AlertTriangle, ArrowDown, ArrowUp, CircleSlash, FileCode2, Globe, GripVertical, Play, Save, Settings2, Square, Terminal, Trash2 } from "lucide-react"
import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react"
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

/** MIME types of in-app drags; other drags (files, text) are ignored. */
const STEP_DRAG_TYPE = "application/x-repodock-step"
const PALETTE_DRAG_TYPE = "application/x-repodock-palette"

/** Something that can be added to the sequence from the palette. */
type PaletteItem =
  | { kind: "script"; script: string }
  | { kind: "global"; id: string }
  | { kind: "command" }
  | { kind: "empty" }

/** What is being dragged: a step of the sequence (by index) or a palette item. */
type Drag = { kind: "step"; from: number } | { kind: "palette"; item: PaletteItem }

function initialSteps(repo: Repository): CommandStep[] {
  return structuredClone(repo.commandSequence ?? [])
}

// Every saved step runs: the sequence holds only what is in it (ADR-0022).
const newStep = (patch: Partial<CommandStep>): CommandStep => ({
  id: crypto.randomUUID(), label: "", script: "", globalCommand: "", command: "", enabled: true, background: false, ...patch,
})

function insertAt<T>(list: readonly T[], slot: number, item: T): T[] {
  const copy = [...list]
  copy.splice(Math.min(Math.max(slot, 0), copy.length), 0, item)
  return copy
}

/**
 * Edits a repository's command sequence: the package.json scripts, global
 * commands and custom steps on the left are dragged (or clicked) into the
 * ordered sequence on the right, where steps are reordered by dragging.
 */
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
  // The drag in progress, and the insertion slot under the pointer.
  const [drag, setDrag] = useState<Drag | null>(null)
  const [dropSlot, setDropSlot] = useState<number | null>(null)

  const saved = useMemo(() => JSON.stringify(repo.commandSequence ?? []), [repo.commandSequence])
  const dirty = JSON.stringify(steps) !== saved
  const running = sequence?.status === "running"
  const stepState = useMemo(() => new Map(sequence?.steps.map((s) => [s.stepId, s]) ?? []), [sequence])
  const scriptByName = useMemo(() => new Map(repo.scripts.map((s) => [s.name, s])), [repo.scripts])
  const globals = workspace.globalCommands
  const globalById = useMemo(() => new Map(globals.map((g) => [g.id, g])), [globals])
  // How often each script / global command is already in the draft.
  const uses = useMemo(() => {
    const count = new Map<string, number>()
    for (const step of steps) {
      const key = step.script ? `script:${step.script}` : step.globalCommand ? `global:${step.globalCommand}` : ""
      if (key) count.set(key, (count.get(key) ?? 0) + 1)
    }
    return count
  }, [steps])

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

  const stepFor = (item: PaletteItem): CommandStep => {
    switch (item.kind) {
      case "script": return newStep({ script: item.script })
      case "global": return newStep({ globalCommand: item.id })
      case "command": {
        const step = newStep({})
        setFocusId(step.id)
        return step
      }
      case "empty": return newStep({ label: t.sequence.emptyStep })
    }
  }
  const add = (item: PaletteItem, slot?: number) => {
    const step = stepFor(item)
    setSteps((list) => insertAt(list, slot ?? list.length, step))
  }

  const endDrag = () => { setDrag(null); setDropSlot(null) }
  const overSlot = (event: DragEvent, slot: number) => {
    if (!drag) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = drag.kind === "step" ? "move" : "copy"
    if (slot !== dropSlot) setDropSlot(slot)
  }
  const drop = (event: DragEvent) => {
    if (!drag) return
    event.preventDefault()
    if (dropSlot !== null) {
      if (drag.kind === "step") setSteps((list) => moveToSlot(list, drag.from, dropSlot))
      else add(drag.item, dropSlot)
    }
    endDrag()
  }
  const indicatorSlot = drag && dropSlot !== null && !(drag.kind === "step" && isNoopSlot(dropSlot, drag.from)) ? dropSlot : null

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

  const paletteItem = (item: PaletteItem, key: string, icon: ReactNode, name: string, detail: string, used = 0) => (
    <li key={key}>
      <Tooltip label={f(t.sequence.addToEnd, { name })}>
        <button
          type="button"
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "copy"
            event.dataTransfer.setData(PALETTE_DRAG_TYPE, key)
            setDrag({ kind: "palette", item })
          }}
          onDragEnd={endDrag}
          onClick={() => add(item)}
          className="group flex w-full cursor-grab items-center gap-2 rounded-lg border border-border bg-card px-2 py-1.5 text-left outline-none transition hover:border-primary/50 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        >
          <GripVertical className="size-3.5 shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground" />
          {icon}
          <span className="grid min-w-0 flex-1">
            <span className="truncate font-mono text-xs font-medium">{name}</span>
            {detail && <span className="truncate font-mono text-[10px] text-muted-foreground">{detail}</span>}
          </span>
          {used > 0 && <Badge variant="info" className="shrink-0 tabular-nums">{f(t.sequence.used, { count: used })}</Badge>}
        </button>
      </Tooltip>
    </li>
  )

  return (
    <Sheet open={open} onOpenChange={requestClose}>
      <SheetContent closeLabel={t.common.close} className="max-w-4xl">
        <SheetHeader>
          <SheetTitle>{t.sequence.title} · {displayName(repo)}</SheetTitle>
          <SheetDescription>{t.sequence.hint}</SheetDescription>
          {sequence && (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <Badge variant={sequence.status === "running" ? "info" : sequence.status === "completed" ? "success" : sequence.status === "failed" ? "destructive" : sequence.status === "cancelled" ? "warning" : "outline"}>
                {t.sequence.sequenceStatus[sequence.status]}
              </Badge>
            </div>
          )}
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <aside aria-label={t.sequence.available} className="thin-scrollbar max-h-64 shrink-0 overflow-y-auto border-b border-border p-4 sm:max-h-none sm:w-72 sm:border-b-0 sm:border-r">
            <p className="mb-3 text-xs text-muted-foreground">{t.sequence.paletteHint}</p>

            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t.sequence.scripts}</h3>
            {repo.scripts.length === 0
              ? <p className="mb-4 text-xs text-muted-foreground">{t.sequence.noScripts}</p>
              : (
                <ul className="mb-4 space-y-1">
                  {repo.scripts.map((script) => paletteItem(
                    { kind: "script", script: script.name }, `script:${script.name}`,
                    <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />, script.name, script.command, uses.get(`script:${script.name}`),
                  ))}
                </ul>
              )}

            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t.sequence.globals}</h3>
              <Tooltip label={t.sequence.manageGlobal}>
                <Button size="icon-sm" variant="ghost" aria-label={t.sequence.manageGlobal} onClick={() => setManageGlobals(true)}><Settings2 /></Button>
              </Tooltip>
            </div>
            {globals.length === 0
              ? <p className="mb-4 text-xs text-muted-foreground">{t.sequence.noGlobals}</p>
              : (
                <ul className="mb-4 space-y-1">
                  {globals.map((g) => paletteItem(
                    { kind: "global", id: g.id }, `global:${g.id}`,
                    <Globe className="size-3.5 shrink-0 text-muted-foreground" />, g.name, g.command, uses.get(`global:${g.id}`),
                  ))}
                </ul>
              )}

            <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t.sequence.other}</h3>
            <ul className="space-y-1">
              {paletteItem({ kind: "command" }, "command", <Terminal className="size-3.5 shrink-0 text-muted-foreground" />, t.sequence.customCommand, t.sequence.customCommandHint)}
              {paletteItem({ kind: "empty" }, "empty", <CircleSlash className="size-3.5 shrink-0 text-muted-foreground" />, t.sequence.emptyStep, t.sequence.emptyStepHint)}
            </ul>
          </aside>

          <ol
            aria-label={t.sequence.title}
            className="thin-scrollbar min-h-40 flex-1 space-y-2 overflow-y-auto p-4"
            // The empty area below the last step drops at the end.
            onDragOver={(event) => overSlot(event, steps.length)}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropSlot(null) }}
            onDrop={drop}
          >
            {steps.length === 0 && (
              <li className={cn("rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground transition", indicatorSlot !== null ? "border-primary bg-primary/5" : "border-border")}>
                {t.sequence.noSteps}
              </li>
            )}
            {steps.map((step, index) => {
              const kind = step.script ? "script" : step.globalCommand ? "global" : "command"
              const state = stepState.get(step.id)
              const script = step.script ? scriptByName.get(step.script) : undefined
              const missing = !!step.script && !script
              const global = step.globalCommand ? globalById.get(step.globalCommand) : undefined
              const globalMissing = !!step.globalCommand && !global
              const noop = kind === "command" && !step.command.trim()
              return (
                <li
                  key={step.id}
                  className={cn("relative rounded-xl border border-border bg-card p-3 transition", drag?.kind === "step" && drag.from === index && "opacity-40")}
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
                        setDrag({ kind: "step", from: index })
                      }}
                      onDragEnd={endDrag}
                      className="-ml-1 flex h-8 shrink-0 cursor-grab items-center rounded text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
                    >
                      <GripVertical className="size-4" />
                    </span>
                    <span className="w-5 text-right text-xs tabular-nums text-muted-foreground">{index + 1}.</span>
                    {kind === "script" ? <FileCode2 aria-label={t.sequence.kindScript} className="size-4 shrink-0 text-muted-foreground" />
                      : kind === "global" ? <Globe aria-label={t.sequence.kindGlobal} className="size-4 shrink-0 text-muted-foreground" />
                        : <Terminal aria-label={t.sequence.kindCommand} className="size-4 shrink-0 text-muted-foreground" />}
                    {kind === "command" ? (
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
                    ) : (
                      <span className="grid min-w-0 flex-1">
                        <span className="truncate font-mono text-sm font-medium">{kind === "script" ? step.script : global?.name ?? t.transfer.missingGlobal}</span>
                        <span className="truncate font-mono text-[11px] text-muted-foreground" title={kind === "script" ? script?.command : global?.command}>
                          {kind === "script" ? script?.command : global?.command}
                        </span>
                      </span>
                    )}
                    {state && <Badge variant={state.status === "cancelled" && !state.runId ? "outline" : stepStatusVariant[state.status]}>{t.sequence.status[state.status]}</Badge>}
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

                  <div className="mt-2 flex items-center gap-2 pl-[4.25rem]">
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
                    <div className="mt-1.5 flex items-center gap-1.5 pl-[4.25rem] text-[11px]">
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
        </div>

        <div className="flex items-center gap-2 border-t border-border p-4">
          <span className="text-xs text-muted-foreground">{f(t.sequence.stepCount, { count: steps.length })}</span>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" disabled={!dirty || busy} onClick={() => void save()}><Save /> {t.common.save}</Button>
            {running && sequence ? (
              <Button variant="destructive" onClick={() => void actions.cancelSequence(sequence.id)}><Square /> {t.sequence.cancelRun}</Button>
            ) : (
              <Button disabled={busy || steps.length === 0} onClick={() => void saveAndRun()}><Play /> {dirty ? t.sequence.runSaved : t.sequence.run}</Button>
            )}
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
