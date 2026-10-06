import { useEffect, useState } from "react"
import { AppRail } from "@/components/layout/AppRail"
import { Toaster } from "@/components/shared/Toaster"
import { TooltipProvider } from "@/components/ui/tooltip"
import { I18nProvider, useI18n } from "@/lib/i18n"
import { readPreference, writePreference } from "@/lib/preferences"
import { ThemeProvider } from "@/lib/theme"
import { NotificationsProvider, useNotifications } from "@/state/notifications"
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

  const View = (modules.find((m) => m.id === active) ?? modules[0]).View

  return (
    <div className="flex h-full min-h-0 bg-background text-foreground">
      <AppRail modules={modules} active={active} onChange={select} />
      <View />
      <Toaster />
    </div>
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
