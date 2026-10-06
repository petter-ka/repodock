import type { BadgeVariant } from "@/components/ui/badge"
import type { RunStatus, StepStatus } from "../domain"

export const runStatusVariant: Record<RunStatus, BadgeVariant> = {
  queued: "default", starting: "info", running: "success", stopping: "warning",
  exited: "default", failed: "destructive", stopped: "outline", skipped: "outline",
}

export const runStatusDot: Record<RunStatus, string> = {
  queued: "bg-muted-foreground", starting: "bg-primary animate-pulse", running: "bg-success", stopping: "bg-warning animate-pulse",
  exited: "bg-muted-foreground/60", failed: "bg-destructive", stopped: "bg-muted-foreground/60", skipped: "bg-muted-foreground/40",
}

export const stepStatusVariant: Record<StepStatus, BadgeVariant> = {
  pending: "outline", running: "info", started: "success", completed: "success",
  failed: "destructive", skipped: "outline", cancelled: "outline",
}
