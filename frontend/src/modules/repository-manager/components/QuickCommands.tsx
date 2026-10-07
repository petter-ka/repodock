import { AlertTriangle, FileCode2, Globe, Layers, Loader2, Plus, Terminal, X, Zap } from "lucide-react"
import { useMemo, useState, type DragEvent } from "react"
import { PromptDialog } from "@/components/shared/PromptDialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tooltip } from "@/components/ui/tooltip"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { GlobalCommand, QuickCommand, Repository } from "../domain"
import { useWorkspaceState } from "../hooks/useStores"
import { isNoopSlot, moveToSlot } from "../reorder"
import { dragHas, QUICK_DRAG_TYPE, SCRIPT_DRAG_TYPE } from "./dragTypes"

const blank = (patch: Partial<QuickCommand>): QuickCommand => ({ id: "", label: "", script: "", globalCommand: "", command: "", ...patch })

/**
 * Pinned scripts and commands of a repository, as chips. A click starts the
 * command in the background (its output goes to the Background drawer).
 * Script chips can be dragged in from the Scripts section; chips can be
 * reordered by dragging and removed with ×. Changes are saved immediately.
 */
export function QuickCommands({ repo, runningQuickIds, backgroundCount, backgroundActive, onRun, onOpenBackground, onSave }: {
  repo: Repository
  /** quick command IDs with an active background run */
  runningQuickIds: Set<string>
  backgroundCount: number
  backgroundActive: number
  onRun: (quick: QuickCommand, global?: GlobalCommand) => void
  onOpenBackground: () => void
  onSave: (commands: QuickCommand[]) => void
}) {
  const { t, f } = useI18n()
  const { workspace } = useWorkspaceState()
  const [adding, setAdding] = useState(false)
  // Insertion slot under the pointer during a drag, and the chip being moved.
  const [dropSlot, setDropSlot] = useState<number | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const quick = repo.quickCommands
  const globalById = useMemo(() => new Map(workspace.globalCommands.map((g) => [g.id, g])), [workspace.globalCommands])
  const scriptNames = useMemo(() => new Set(repo.scripts.map((s) => s.name)), [repo.scripts])
  const pinnedScripts = new Set(quick.map((q) => q.script).filter(Boolean))

  const insert = (item: QuickCommand, slot = quick.length) => onSave([...quick.slice(0, slot), item, ...quick.slice(slot)])
  const remove = (id: string) => onSave(quick.filter((q) => q.id !== id))

  const accepts = (event: DragEvent) => dragHas(event, SCRIPT_DRAG_TYPE, QUICK_DRAG_TYPE)
  const over = (event: DragEvent, slot: number) => {
    if (!accepts(event)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = dragHas(event, QUICK_DRAG_TYPE) ? "move" : "copy"
    if (slot !== dropSlot) setDropSlot(slot)
  }
  const drop = (event: DragEvent) => {
    if (!accepts(event)) return
    event.preventDefault()
    const slot = dropSlot ?? quick.length
    const script = event.dataTransfer.getData(SCRIPT_DRAG_TYPE)
    if (script) {
      // A script that is already pinned is moved instead of duplicated.
      const existing = quick.findIndex((q) => q.script === script)
      if (existing >= 0) { if (!isNoopSlot(slot, existing)) onSave(moveToSlot(quick, existing, slot)) }
      else insert(blank({ script }), slot)
    } else if (dragFrom !== null && !isNoopSlot(slot, dragFrom)) {
      onSave(moveToSlot(quick, dragFrom, slot))
    }
    setDropSlot(null)
    setDragFrom(null)
  }
  const indicator = dropSlot !== null && !(dragFrom !== null && isNoopSlot(dropSlot, dragFrom)) ? dropSlot : null

  return (
    <section
      aria-label={t.quick.title}
      className="flex items-start gap-2 px-6 pt-3"
      onDragOver={(event) => over(event, quick.length)}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropSlot(null) }}
      onDrop={drop}
    >
      <h2 className="flex h-6 shrink-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"><Zap className="size-3" /> {t.quick.title}</h2>
      <ol className={cn("flex min-h-6 min-w-0 flex-1 flex-wrap items-center gap-1 rounded-md transition", dropSlot !== null && "bg-primary/5 ring-1 ring-primary/30")}>
        {quick.length === 0 && (
          <li className="flex h-6 items-center rounded-md border border-dashed border-border px-2 text-xs text-muted-foreground">{t.quick.empty}</li>
        )}
        {quick.map((item, index) => {
          const global = item.globalCommand ? globalById.get(item.globalCommand) : undefined
          const problem = item.script ? (scriptNames.has(item.script) ? "" : t.sequence.scriptMissing) : item.globalCommand && !global ? t.sequence.globalMissing : ""
          const text = item.script ? repo.scripts.find((s) => s.name === item.script)?.command ?? item.script : global?.command ?? item.command
          const running = runningQuickIds.has(item.id)
          return (
            <li
              key={item.id}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move"
                event.dataTransfer.setData(QUICK_DRAG_TYPE, item.id)
                setDragFrom(index)
              }}
              onDragEnd={() => { setDragFrom(null); setDropSlot(null) }}
              onDragOver={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                over(event, event.clientX < rect.left + rect.width / 2 ? index : index + 1)
              }}
              className={cn("group/quick relative flex items-center", dragFrom === index && "opacity-40")}
            >
              {(indicator === index || (indicator === index + 1 && index === quick.length - 1)) && (
                <span aria-hidden className={cn("pointer-events-none absolute inset-y-0.5 w-0.5 rounded-full bg-primary", indicator === index ? "-left-[3px]" : "-right-[3px]")} />
              )}
              <Tooltip label={<span className="flex flex-col gap-0.5">{text && <span className="font-mono">{text}</span>}{problem && <span className="text-warning">{problem}</span>}<span className="text-muted-foreground">{t.quick.runHint}</span></span>}>
                <button
                  disabled={!!problem}
                  onClick={() => onRun(item, global)}
                  aria-label={f(t.quick.run, { name: item.label })}
                  className={cn(
                    "inline-flex h-6 max-w-[220px] items-center gap-1.5 rounded-full border py-0 pl-2.5 pr-6 text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
                    running ? "border-success/50 bg-success/10" : "border-border bg-card enabled:hover:border-primary/50 enabled:hover:bg-accent",
                  )}
                >
                  {problem ? <AlertTriangle className="size-3 shrink-0 text-warning" />
                    : running ? <Loader2 className="size-3 shrink-0 animate-spin text-success" />
                      : item.script ? <FileCode2 className="size-3 shrink-0 text-muted-foreground" />
                        : item.globalCommand ? <Globe className="size-3 shrink-0 text-muted-foreground" />
                          : <Terminal className="size-3 shrink-0 text-muted-foreground" />}
                  <span className="truncate font-medium">{item.label}</span>
                </button>
              </Tooltip>
              <button
                aria-label={f(t.quick.remove, { name: item.label })}
                onClick={() => remove(item.id)}
                className="absolute right-1 rounded-full p-0.5 text-muted-foreground opacity-0 outline-none transition hover:bg-destructive/15 hover:text-destructive focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/quick:opacity-100"
              >
                <X className="size-3" />
              </button>
            </li>
          )
        })}
        <li>
          <DropdownMenu>
            <Tooltip label={t.quick.add}>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label={t.quick.add} className="size-6 text-muted-foreground"><Plus /></Button>
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent align="start">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={repo.scripts.length === 0}><FileCode2 /> {t.quick.addScript}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                  {repo.scripts.map((script) => (
                    <DropdownMenuItem key={script.name} disabled={pinnedScripts.has(script.name)} onSelect={() => insert(blank({ script: script.name }))}>
                      <span className="font-mono">{script.name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger disabled={workspace.globalCommands.length === 0}><Globe /> {t.quick.addGlobal}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                  {workspace.globalCommands.map((g) => (
                    <DropdownMenuItem key={g.id} onSelect={() => insert(blank({ globalCommand: g.id }))}>{g.name}</DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setAdding(true)}><Terminal /> {t.quick.addCommand}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </li>
      </ol>
      <Tooltip label={t.quick.openBackground}>
        <Button size="sm" variant="ghost" onClick={onOpenBackground} className="h-6 shrink-0 gap-1 px-2 text-xs text-muted-foreground">
          <Layers /> {t.quick.background}
          {backgroundCount > 0 && <Badge variant={backgroundActive > 0 ? "success" : "default"} className="tabular-nums">{backgroundActive > 0 ? backgroundActive : backgroundCount}</Badge>}
        </Button>
      </Tooltip>
      <PromptDialog
        open={adding}
        title={t.quick.addCommandTitle}
        label={t.quick.commandLabel}
        placeholder="npx eslint . --fix"
        submitLabel={t.quick.pin}
        onOpenChange={setAdding}
        onSubmit={(command) => insert(blank({ command }))}
      />
    </section>
  )
}
