import type { LucideIcon } from "lucide-react"
import type { Messages } from "./locales/en"
import type { NotificationTone } from "@/state/notifications"

export type ModuleContext = {
  notify: (message: string, options?: { tone?: NotificationTone; duration?: number }) => void
  t: Messages
  f: (template: string, values?: Record<string, string | number>) => string
}

/**
 * A feature module registered in the application rail. Modules own their
 * view, state and backend wiring; the shell only knows this contract.
 */
export type AppModule = {
  id: string
  icon: LucideIcon
  label: (t: Messages) => string
  View: React.ComponentType
  /** Called once at app start; returns a cleanup function. */
  init?: (context: ModuleContext) => () => void
  /** Pinned to the bottom of the rail (e.g. settings). */
  footer?: boolean
}
