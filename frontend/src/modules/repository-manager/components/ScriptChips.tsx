import { Loader2, Play } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Tooltip } from "@/components/ui/tooltip"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { Repository } from "../domain"

/** One chip per package.json script, in declaration order. Click runs it. */
export function ScriptChips({ repo, runningLabels, onRun }: { repo: Repository; runningLabels: Set<string>; onRun: (script: string) => void }) {
  const { t, f } = useI18n()
  return (
    <section aria-label={t.scripts.title} className="px-6 pt-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t.scripts.title}</h2>
        <Badge className="tabular-nums">{repo.scripts.length}</Badge>
      </div>
      {repo.scripts.length === 0 ? (
        <p className="text-xs text-muted-foreground">{repo.problem ? t.scripts.unknown : t.scripts.empty}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
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
      )}
    </section>
  )
}
