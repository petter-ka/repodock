import type { BadgeVariant } from "@/components/ui/badge"
import type { RunStatus, StepStatus } from "../domain"

export const runStatusVariant: Record<RunStatus, BadgeVariant> = {
  queued: "default", starting: "info", running: "success", stopping: "warning",
  exited: "success", failed: "destructive", stopped: "warning", skipped: "outline",
}

export const runStatusDot: Record<RunStatus, string> = {
  queued: "bg-muted-foreground", starting: "bg-primary animate-pulse", running: "bg-success", stopping: "bg-warning animate-pulse",
  exited: "bg-success", failed: "bg-destructive", stopped: "bg-warning", skipped: "bg-muted-foreground/40",
}

export const stepStatusVariant: Record<StepStatus, BadgeVariant> = {
  pending: "outline", running: "info", started: "success", completed: "success",
  failed: "destructive", skipped: "outline", cancelled: "warning",
}
