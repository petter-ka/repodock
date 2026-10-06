import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/lib/i18n"

export function PromptDialog({
  open, title, description, label, initialValue = "", placeholder, submitLabel, onSubmit, onOpenChange,
}: {
  open: boolean
  title: string
  description?: string
  label: string
  initialValue?: string
  placeholder?: string
  submitLabel: string
  onSubmit: (value: string) => Promise<void> | void
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()
  const [value, setValue] = useState(initialValue)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) setValue(initialValue)
  }, [open, initialValue])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!value.trim()) return
    setBusy(true)
    try {
      await onSubmit(value.trim())
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t.common.close}>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
          </DialogHeader>
          <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
            {label}
            <Input autoFocus value={value} placeholder={placeholder} onChange={(event) => setValue(event.target.value)} className="text-foreground" />
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t.common.cancel}</Button>
            <Button type="submit" disabled={busy || !value.trim()}>{submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
