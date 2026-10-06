import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react"
import { useNotifications, type NotificationTone } from "@/state/notifications"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

const icons: Record<NotificationTone, React.ReactNode> = {
  info: <Info className="size-4 text-primary" />,
  success: <CheckCircle2 className="size-4 text-success" />,
  warning: <AlertTriangle className="size-4 text-warning" />,
  error: <XCircle className="size-4 text-destructive" />,
}

export function Toaster() {
  const { items, dismiss } = useNotifications()
  const { t } = useI18n()
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {items.map((item) => (
        <div
          key={item.id}
          role={item.tone === "error" ? "alert" : "status"}
          className={cn("pointer-events-auto flex items-start gap-3 rounded-xl border bg-card px-4 py-3 text-sm text-card-foreground shadow-xl", item.tone === "error" ? "border-destructive/40" : "border-border")}
        >
          <span className="mt-0.5">{icons[item.tone]}</span>
          <span className="min-w-0 flex-1 break-words">{item.message}</span>
          <button aria-label={t.common.dismiss} onClick={() => dismiss(item.id)} className="rounded p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
