import { useEffect, useState } from "react"
import { AppRail } from "@/components/layout/AppRail"
import { clampPosition, FloatingWindow } from "@/components/shared/FloatingWindow"
import { Toaster } from "@/components/shared/Toaster"
import { TooltipProvider } from "@/components/ui/tooltip"
import { I18nProvider, useI18n } from "@/lib/i18n"
import { readPreference, writePreference } from "@/lib/preferences"
import { ThemeProvider } from "@/lib/theme"
import { miniApps, useMiniApps } from "@/state/miniApps"
import { NotificationsProvider, useNotifications } from "@/state/notifications"
import { miniAppList } from "./miniApps"
import { modules } from "./modules"

function Shell() {
  const { notify } = useNotifications()
  const { t, f } = useI18n()
  const [active, setActive] = useState(() => {
    const stored = readPreference("module")
    return modules.some((m) => m.id === stored) ? stored! : modules[0].id
  })

  // Modules connect to the backend once for the app lifetime, independent
  // of which view is visible. Messages captured here are the boot locale.
  useEffect(() => {
    const cleanups = modules.map((module) => module.init?.({ notify, t, f }))
    return () => cleanups.forEach((cleanup) => cleanup?.())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notify])

  const select = (id: string) => {
    setActive(id)
    writePreference("module", id)
  }

  const openApps = useMiniApps()
  const View = (modules.find((m) => m.id === active) ?? modules[0]).View

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      <AppRail modules={modules} active={active} onChange={select} miniApps={miniAppList} openMiniApps={openApps.open} onToggleMiniApp={miniApps.toggle} />
      <View />
      <MiniAppHost />
      <Toaster />
    </div>
  )
}

/** Renders the open mini apps as floating windows above the current view. */
function MiniAppHost() {
  const { t } = useI18n()
  const { open, positions } = useMiniApps()
  return (
    <>
      {open.map((id, index) => {
        const app = miniAppList.find((candidate) => candidate.id === id)
        if (!app) return null
        // Until moved, windows cascade from the top-right corner by registry
        // order (not stacking order, so focusing one never moves another).
        const slot = miniAppList.indexOf(app)
        const position = positions[id] ?? clampPosition(window.innerWidth - app.width - 24 - slot * 24, 72 + slot * 24, app.width)
        const close = () => miniApps.close(id)
        return (
          <FloatingWindow
            key={id}
            title={app.label(t)}
            icon={app.icon}
            width={app.width}
            position={position}
            zIndex={30 + index}
            closeLabel={t.common.close}
            onMove={(next, persist) => miniApps.move(id, next, persist)}
            onFocus={() => miniApps.focus(id)}
            onClose={close}
          >
            <app.View close={close} />
          </FloatingWindow>
        )
      })}
    </>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <NotificationsProvider>
          <TooltipProvider delayDuration={400}>
            <Shell />
          </TooltipProvider>
        </NotificationsProvider>
      </I18nProvider>
    </ThemeProvider>
  )
}
