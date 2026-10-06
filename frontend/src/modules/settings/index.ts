import { Settings2 } from "lucide-react"
import type { AppModule } from "@/lib/module"
import { SettingsView } from "./views/SettingsView"

export const settingsModule: AppModule = {
  id: "settings",
  icon: Settings2,
  label: (t) => t.rail.settings,
  View: SettingsView,
  footer: true,
}
