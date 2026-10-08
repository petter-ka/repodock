import { ArrowRight, MessageSquareText } from "lucide-react"
import { useState } from "react"
import { Badge, type BadgeVariant } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tooltip } from "@/components/ui/tooltip"
import { useI18n } from "@/lib/i18n"
import type { EnvChange } from "../envDocument"

const changeVariant: Record<EnvChange["kind"], BadgeVariant> = { added: "success", changed: "warning", removed: "destructive" }

/** Values stay masked unless the user revealed them in the sheet. */
function Value({ text, revealed }: { text: string; revealed: boolean }) {
  if (!text) return <span className="italic text-muted-foreground">∅</span>
  return <span className="truncate font-mono">{revealed ? text : "•".repeat(Math.min(Math.max(text.length, 4), 12))}</span>
}

/** Confirmation listing the variable-level changes of an env file (save or discard). */
export function EnvChangesDialog({ open, title, description, changes, revealed, confirmLabel, destructive, onConfirm, alternative, onOpenChange }: {
  open: boolean
  title: string
  description: string
  changes: EnvChange[]
  revealed: boolean
  confirmLabel: string
  destructive?: boolean
  onConfirm: () => Promise<void> | void
  /** optional second confirm action, e.g. save keeping old values as comments */
  alternative?: { label: string; hint: string; onConfirm: () => Promise<void> | void }
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const confirm = async (action: () => Promise<void> | void) => {
    setBusy(true)
    try {
      await action()
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t.common.close} className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.env.formatOnly}</p>
        ) : (
          <ul className="thin-scrollbar max-h-72 overflow-auto rounded-lg border border-border">
            {changes.map((change) => (
              <li key={`${change.kind}:${change.key}`} className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs last:border-b-0">
                <Badge variant={changeVariant[change.kind]} className="w-[70px] justify-center">{t.env.change[change.kind]}</Badge>
                <span className="min-w-0 shrink-0 truncate font-mono font-medium">{change.key}</span>
                <span className="ml-auto flex min-w-0 items-center gap-1.5 text-muted-foreground">
                  {change.kind !== "added" && <Value text={change.before} revealed={revealed} />}
                  {change.kind === "changed" && <ArrowRight className="size-3 shrink-0" />}
                  {change.kind !== "removed" && <span className="text-foreground"><Value text={change.value} revealed={revealed} /></span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t.common.cancel}</Button>
          {alternative && (
            <Tooltip label={alternative.hint}>
              <Button variant="outline" disabled={busy} onClick={() => void confirm(alternative.onConfirm)}><MessageSquareText /> {alternative.label}</Button>
            </Tooltip>
          )}
          <Button autoFocus variant={destructive ? "destructive" : "default"} disabled={busy} onClick={() => void confirm(onConfirm)}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
