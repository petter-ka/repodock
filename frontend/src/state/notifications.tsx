import { createContext, useCallback, useContext, useMemo, useState } from "react"

export type NotificationTone = "info" | "success" | "warning" | "error"

export type Notification = {
  id: number
  tone: NotificationTone
  message: string
  /** milliseconds; 0 keeps the notification until dismissed */
  duration: number
}

type NotifyOptions = { tone?: NotificationTone; duration?: number }

type NotificationsValue = {
  items: Notification[]
  notify: (message: string, options?: NotifyOptions) => void
  dismiss: (id: number) => void
}

const NotificationsContext = createContext<NotificationsValue | null>(null)
let nextId = 1

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Notification[]>([])

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((n) => n.id !== id)), [])

  const notify = useCallback((message: string, options: NotifyOptions = {}) => {
    const tone = options.tone ?? "info"
    const duration = options.duration ?? (tone === "error" ? 8000 : 3500)
    const id = nextId++
    setItems((list) => [...list.slice(-4), { id, tone, message, duration }])
    if (duration > 0) window.setTimeout(() => dismiss(id), duration)
  }, [dismiss])

  const value = useMemo(() => ({ items, notify, dismiss }), [items, notify, dismiss])
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

export function useNotifications() {
  const context = useContext(NotificationsContext)
  if (!context) throw new Error("useNotifications must be used inside NotificationsProvider")
  return context
}
