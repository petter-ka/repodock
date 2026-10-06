import { Eye, EyeOff, FileKey2, Loader2, Save, ShieldAlert } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { ConfirmDialog } from "@/components/shared/ConfirmDialog"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { errorMessage } from "@/lib/bridge"
import { useI18n } from "@/lib/i18n"
import { hasMod, modLabel } from "@/lib/keyboard"
import { cn, formatTime } from "@/lib/utils"
import { repositoryApi } from "../api"
import type { EnvFile, Repository } from "../domain"
import { maskEnv } from "../envMask"
import type { RepositoryActions } from "../hooks/useRepositoryActions"

type Pending = { kind: "switch"; name: string } | { kind: "close" } | null

export function EnvSheet({ repo, open, actions, onOpenChange }: {
  repo: Repository
  open: boolean
  actions: RepositoryActions
  onOpenChange: (open: boolean) => void
}) {
  const { t, f } = useI18n()
  const [selected, setSelected] = useState<string | null>(null)
  const [file, setFile] = useState<EnvFile | null>(null)
  const [draft, setDraft] = useState("")
  const [revealed, setRevealed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState<Pending>(null)

  const dirty = file !== null && draft !== file.content
  const masked = useMemo(() => (revealed ? "" : maskEnv(draft)), [revealed, draft])

  // Pick the first file on open; mask again every time the sheet opens.
  useEffect(() => {
    if (!open) return
    setRevealed(false)
    setSelected((current) => (current && repo.envFiles.includes(current) ? current : (repo.envFiles[0] ?? null)))
  }, [open, repo.id, repo.envFiles])

  // Contents are read only on explicit user interaction (ADR-0005).
  useEffect(() => {
    if (!open || !selected) {
      setFile(null)
      setDraft("")
      return
    }
    let cancelled = false
    setLoading(true)
    setLoadError("")
    repositoryApi.readEnvironmentFile(repo.id, selected)
      .then((result) => {
        if (cancelled) return
        setFile(result)
        setDraft(result.content)
      })
      .catch((error) => { if (!cancelled) setLoadError(errorMessage(error)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, repo.id, selected])

  // Drop secrets from memory when the panel closes.
  useEffect(() => {
    if (!open) {
      setFile(null)
      setDraft("")
    }
  }, [open])

  const save = async () => {
    if (!file || !dirty) return
    setSaving(true)
    try {
      if (await actions.saveEnvFile(repo, file.name, draft)) setFile({ ...file, content: draft, modifiedAt: new Date().toISOString() })
    } finally {
      setSaving(false)
    }
  }

  const choose = (name: string) => {
    if (name === selected) return
    if (dirty) setPending({ kind: "switch", name })
    else {
      setSelected(name)
      setRevealed(false)
    }
  }

  const requestClose = (next: boolean) => {
    if (!next && dirty) setPending({ kind: "close" })
    else onOpenChange(next)
  }

  return (
    <Sheet open={open} onOpenChange={requestClose}>
      <SheetContent
        closeLabel={t.common.close}
        className="max-w-3xl"
        onKeyDown={(event) => {
          if (hasMod(event) && event.key.toLowerCase() === "s") {
            event.preventDefault()
            void save()
          }
        }}
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><FileKey2 className="size-4" /> {t.env.title} · {repo.name}</SheetTitle>
          <SheetDescription>{t.env.hint}</SheetDescription>
        </SheetHeader>

        {repo.envFiles.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">{t.env.noFiles}</div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-[180px_1fr]">
            <nav aria-label={t.env.title} className="border-r border-border p-2">
              {repo.envFiles.map((name) => (
                <button
                  key={name}
                  onClick={() => choose(name)}
                  aria-current={selected === name ? "true" : undefined}
                  className={cn("mb-0.5 w-full rounded-lg px-2.5 py-2 text-left font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring", selected === name ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:bg-accent/60")}
                >
                  {name}
                </button>
              ))}
            </nav>

            <div className="flex min-h-0 flex-col">
              <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-xs">
                <ShieldAlert className="size-3.5 shrink-0 text-warning" />
                <span className="text-muted-foreground">{t.env.sensitive}</span>
              </div>

              <div className="relative min-h-0 flex-1 bg-console">
                {loading ? (
                  <div className="flex h-full items-center justify-center text-console-muted"><Loader2 className="size-5 animate-spin" /></div>
                ) : loadError ? (
                  <div role="alert" className="p-4 text-sm text-destructive">{loadError}</div>
                ) : revealed ? (
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    spellCheck={false}
                    autoFocus
                    aria-label={selected ?? ""}
                    className="console-scrollbar absolute inset-0 resize-none bg-transparent p-4 font-mono text-xs leading-5 text-console-foreground outline-none"
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col">
                    <pre className="console-scrollbar flex-1 overflow-auto p-4 font-mono text-xs leading-5 text-console-foreground/80">{masked}</pre>
                    <div className="flex items-center justify-center gap-3 border-t border-white/10 px-4 py-2 text-xs text-console-muted">
                      {t.env.masked}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 border-t border-border px-4 py-3">
                <Button variant="outline" size="sm" disabled={!file} onClick={() => setRevealed((value) => !value)}>
                  {revealed ? <><EyeOff /> {t.env.hide}</> : <><Eye /> {t.env.reveal}</>}
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  {dirty ? <span className="font-medium text-warning">{t.env.unsaved}</span> : file ? f(t.env.modified, { time: formatTime(file.modifiedAt) }) : null}
                </span>
                <Button className="ml-auto" size="sm" title={`${modLabel}+S`} disabled={!dirty || saving} onClick={() => void save()}>
                  <Save /> {saving ? t.common.saving : t.common.save}
                </Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>

      <ConfirmDialog
        open={pending !== null}
        title={t.env.unsavedTitle}
        description={f(t.env.unsavedBody, { name: file?.name ?? "" })}
        confirmLabel={t.common.discard}
        destructive
        onOpenChange={(value) => { if (!value) setPending(null) }}
        onConfirm={() => {
          if (pending?.kind === "switch") {
            setDraft(file?.content ?? "")
            setSelected(pending.name)
            setRevealed(false)
          } else if (pending?.kind === "close") {
            setDraft(file?.content ?? "")
            onOpenChange(false)
          }
        }}
      />
    </Sheet>
  )
}
