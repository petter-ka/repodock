import { useEffect, useState } from "react"
import { AppRail } from "@/components/layout/AppRail"
import { clampPosition, clampSize, FloatingWindow } from "@/components/shared/FloatingWindow"
import { Toaster } from "@/components/shared/Toaster"
import { TooltipProvider } from "@/components/ui/tooltip"
import { I18nProvider, useI18n } from "@/lib/i18n"
import { modLabel } from "@/lib/keyboard"
import { readPreference, writePreference } from "@/lib/preferences"
import { ThemeProvider } from "@/lib/theme"
import { ClosingOverlay } from "@/modules/app-closing"
import { LeftoverProcessesDialog } from "@/modules/leftover-processes"
import { LaunchFolderDialog, repositoryManagerModule } from "@/modules/repository-manager"
import { ScheduledStopCountdown } from "@/modules/scheduled-stop"
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
  const toggleMiniApp = (id: string) => {
    const app = miniAppList.find((candidate) => candidate.id === id)
    miniApps.toggle(id, { maximized: app?.resizable && app.openMaximized })
  }
  const View = (modules.find((m) => m.id === active) ?? modules[0]).View

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      <AppRail modules={modules} active={active} onChange={select} miniApps={miniAppList} openMiniApps={openApps.open} onToggleMiniApp={toggleMiniApp} />
      <View />
      <MiniAppHost />
      <LeftoverProcessesDialog />
      <LaunchFolderDialog onShow={() => select(repositoryManagerModule.id)} />
      <ScheduledStopCountdown />
      <Toaster />
      <ClosingOverlay />
    </div>
  )
}

/** Renders the open mini apps as floating windows above the current view. */
function MiniAppHost() {
  const { t, f } = useI18n()
  const { open, positions, sizes, maximized } = useMiniApps()
  return (
    <>
      {open.map((id, index) => {
        const app = miniAppList.find((candidate) => candidate.id === id)
        if (!app) return null
        // Until moved, windows cascade from the top-right corner by registry
        // order (not stacking order, so focusing one never moves another).
        const slot = miniAppList.indexOf(app)
        const size = sizes[id] ?? (app.height === undefined ? undefined : clampSize(app.width, app.height))
        const width = app.resizable && size ? size.width : app.width
        const height = app.resizable && size ? size.height : app.height
        const position = positions[id] ?? clampPosition(window.innerWidth - width - 24 - slot * 24, 72 + slot * 24, width)
        const close = () => miniApps.close(id)
        return (
          <FloatingWindow
            key={id}
            title={app.label(t)}
            icon={app.icon}
            width={width}
            height={height}
            position={position}
            zIndex={30 + index}
            closeLabel={t.common.close}
            resize={app.resizable ? {
              maximized: maximized.includes(id),
              labels: { maximize: t.miniApps.maximize, restore: t.miniApps.restore, resize: f(t.miniApps.resize, { mod: modLabel }) },
              onResize: (next, persist) => miniApps.resize(id, next, persist),
              onToggleMaximized: () => miniApps.toggleMaximized(id),
            } : undefined}
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
