import { Command } from "lucide-react"
import { Tooltip } from "@/components/ui/tooltip"
import type { AppModule, MiniApp } from "@/lib/module"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/**
 * Narrow application rail listing registered feature modules, then the mini
 * app toggles (each opens or closes a floating window).
 */
export function AppRail({ modules, active, onChange, miniApps = [], openMiniApps = [], onToggleMiniApp }: {
  modules: AppModule[]
  active: string
  onChange: (id: string) => void
  miniApps?: MiniApp[]
  openMiniApps?: string[]
  onToggleMiniApp?: (id: string) => void
}) {
  const { t } = useI18n()
  const item = (module: AppModule) => {
    const Icon = module.icon
    const label = module.label(t)
    return (
      <Tooltip key={module.id} label={label} side="right">
        <button
          aria-label={label}
          aria-current={active === module.id ? "page" : undefined}
          onClick={() => onChange(module.id)}
          className={cn(
            "flex size-10 items-center justify-center rounded-xl outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
            active === module.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
          )}
        >
          <Icon className="size-5" />
        </button>
      </Tooltip>
    )
  }
  return (
    <nav aria-label={t.app.name} className="flex w-16 shrink-0 flex-col items-center border-r border-border bg-rail py-4">
      <div className="mb-6 flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm" aria-hidden>
        <Command className="size-5" />
      </div>
      <div className="flex flex-1 flex-col gap-2">
        {modules.filter((m) => !m.footer).map(item)}
        {miniApps.length > 0 && (
          <div role="group" aria-label={t.miniApps.title} className="mt-2 flex flex-col gap-2 border-t border-border pt-3">
            {miniApps.map((app) => {
              const Icon = app.icon
              const label = app.label(t)
              const open = openMiniApps.includes(app.id)
              return (
                <Tooltip key={app.id} label={`${label} — ${open ? t.miniApps.hide : t.miniApps.show}`} side="right">
                  <button
                    aria-label={label}
                    aria-pressed={open}
                    onClick={() => onToggleMiniApp?.(app.id)}
                    className={cn(
                      "relative flex size-10 items-center justify-center rounded-xl outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
                      open ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent/70 hover:text-foreground",
                    )}
                  >
                    <Icon className="size-[18px]" />
                    {open && <span aria-hidden className="absolute bottom-1 size-1 rounded-full bg-primary" />}
                  </button>
                </Tooltip>
              )
            })}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2">{modules.filter((m) => m.footer).map(item)}</div>
    </nav>
  )
}
