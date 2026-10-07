import { ChevronDown, ChevronRight, Loader2, Play } from "lucide-react"
import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Tooltip } from "@/components/ui/tooltip"
import { useI18n } from "@/lib/i18n"
import { readPreference, writePreference } from "@/lib/preferences"
import { cn } from "@/lib/utils"
import type { Repository } from "../domain"

const EXPANDED_KEY = "scripts.expanded"

/**
 * One chip per package.json script, in declaration order. Click runs it.
 * Collapsed by default; the open/closed choice is remembered per device.
 */
export function ScriptChips({ repo, runningLabels, onRun }: { repo: Repository; runningLabels: Set<string>; onRun: (script: string) => void }) {
  const { t, f } = useI18n()
  const [expanded, setExpanded] = useState(() => readPreference(EXPANDED_KEY) === "true")
  const runningCount = repo.scripts.filter((script) => runningLabels.has(script.name)).length
  const toggle = () => setExpanded((open) => {
    writePreference(EXPANDED_KEY, String(!open))
    return !open
  })

  return (
    <section aria-label={t.scripts.title} className="px-6 pt-4">
      <button
        aria-expanded={expanded}
        aria-controls="script-chips"
        onClick={toggle}
        className={cn("-ml-1 flex items-center gap-1.5 rounded-md px-1 py-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", expanded && "mb-2")}
      >
        {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em]">{t.scripts.title}</h2>
        <Badge className="tabular-nums">{repo.scripts.length}</Badge>
        {!expanded && runningCount > 0 && (
          <Badge variant="success" className="gap-1 tabular-nums"><Loader2 className="size-3 animate-spin" />{f(t.scripts.runningCount, { count: runningCount })}</Badge>
        )}
      </button>
      {expanded && (repo.scripts.length === 0 ? (
        <p id="script-chips" className="text-xs text-muted-foreground">{repo.problem ? t.scripts.unknown : repo.packageManager ? t.scripts.empty : t.scripts.plainFolder}</p>
      ) : (
        <div id="script-chips" className="flex flex-wrap gap-1.5">
          {repo.scripts.map((script) => {
            const running = runningLabels.has(script.name)
            return (
              <Tooltip key={script.name} label={<span className="font-mono">{script.command}</span>}>
                <button
                  onClick={() => onRun(script.name)}
                  aria-label={f(t.scripts.runScript, { name: script.name })}
                  className={cn(
                    "group/chip inline-flex max-w-[320px] items-center gap-1.5 rounded-full border px-3 py-1 text-xs outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
                    running ? "border-success/50 bg-success/10 text-foreground" : "border-border bg-card hover:border-primary/50 hover:bg-accent",
                  )}
                >
                  {running ? (
                    <Loader2 className="size-3 shrink-0 animate-spin text-success" aria-label={t.scripts.runningHint} />
                  ) : (
                    <Play className="size-3 shrink-0 text-muted-foreground group-hover/chip:text-primary" />
                  )}
                  <span className="shrink-0 whitespace-nowrap font-semibold">{script.name}</span>
                  <span className="truncate font-mono text-[11px] text-muted-foreground">{script.command}</span>
                </button>
              </Tooltip>
            )
          })}
        </div>
      ))}
    </section>
  )
}
