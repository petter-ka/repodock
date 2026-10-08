import { Code2, Eye, EyeOff, FileKey2, ListTree, Loader2, Save, ShieldAlert } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { errorMessage } from "@/lib/bridge"
import { useI18n } from "@/lib/i18n"
import { hasMod, modLabel } from "@/lib/keyboard"
import { cn, formatTime } from "@/lib/utils"
import { repositoryApi } from "../api"
import { displayName, type EnvFile, type Repository } from "../domain"
import { diffEnv, envTimestamp, keepPreviousAsComments } from "../envDocument"
import { maskEnv } from "../envMask"
import type { RepositoryActions } from "../hooks/useRepositoryActions"
import { EnvChangesDialog } from "./EnvChangesDialog"
import { EnvForm } from "./EnvForm"

type Pending = { kind: "save" } | { kind: "switch"; name: string } | { kind: "close" } | null
type View = "form" | "raw"

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
  const [view, setView] = useState<View>("form")

  const dirty = file !== null && draft !== file.content
  const masked = useMemo(() => (revealed ? "" : maskEnv(draft)), [revealed, draft])
  const changes = useMemo(() => (file ? diffEnv(file.content, draft) : []), [file, draft])

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

  /** Saving always goes through the changes dialog. */
  const requestSave = () => {
    if (file && dirty && !saving) setPending({ kind: "save" })
  }

  const save = async (content = draft) => {
    if (!file || !dirty) return
    setSaving(true)
    try {
      if (await actions.saveEnvFile(repo, file.name, content)) {
        setDraft(content)
        setFile({ ...file, content, modifiedAt: new Date().toISOString() })
      }
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
            requestSave()
          }
        }}
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><FileKey2 className="size-4" /> {t.env.title} · {displayName(repo)}</SheetTitle>
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
                <span className="min-w-0 flex-1 text-muted-foreground">{t.env.sensitive}</span>
                <div role="radiogroup" aria-label={t.env.view} className="flex shrink-0 rounded-lg border border-border p-0.5">
                  {([["form", t.env.form, <ListTree key="i" className="size-3.5" />], ["raw", t.env.raw, <Code2 key="i" className="size-3.5" />]] as const).map(([value, label, icon]) => (
                    <button
                      key={value}
                      role="radio"
                      aria-checked={view === value}
                      onClick={() => setView(value)}
                      className={cn("flex items-center gap-1.5 rounded-md px-2 py-1 outline-none transition focus-visible:ring-2 focus-visible:ring-ring", view === value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                    >
                      {icon} {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative min-h-0 flex-1 bg-console">
                {loading ? (
                  <div className="flex h-full items-center justify-center text-console-muted"><Loader2 className="size-5 animate-spin" /></div>
                ) : loadError ? (
                  <div role="alert" className="p-4 text-sm text-destructive">{loadError}</div>
                ) : view === "form" && file ? (
                  <EnvForm draft={draft} saved={file.content} revealed={revealed} onChange={setDraft} />
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
                  {revealed ? <><EyeOff /> {t.env.hide}</> : <><Eye /> {view === "form" ? t.env.showValues : t.env.reveal}</>}
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  {dirty ? <span className="font-medium text-warning">{t.env.unsaved}</span> : file ? f(t.env.modified, { time: formatTime(file.modifiedAt) }) : null}
                </span>
                <Button className="ml-auto" size="sm" title={`${modLabel}+S`} disabled={!dirty || saving} onClick={requestSave}>
                  <Save /> {saving ? t.common.saving : t.common.save}
                </Button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>

      <EnvChangesDialog
        open={pending !== null}
        title={pending?.kind === "save" ? f(t.env.saveTitle, { name: file?.name ?? "" }) : t.env.unsavedTitle}
        description={pending?.kind === "save" ? t.env.saveBody : f(t.env.unsavedBody, { name: file?.name ?? "" })}
        changes={changes}
        revealed={revealed}
        confirmLabel={pending?.kind === "save" ? t.common.save : t.common.discard}
        destructive={pending?.kind !== "save"}
        alternative={pending?.kind === "save" && file && changes.some((change) => change.kind !== "added")
          ? { label: t.env.saveKeepOld, hint: t.env.saveKeepOldHint, onConfirm: () => save(keepPreviousAsComments(file.content, draft, envTimestamp())) }
          : undefined}
        onOpenChange={(value) => { if (!value) setPending(null) }}
        onConfirm={async () => {
          if (pending?.kind === "save") {
            await save()
          } else if (pending?.kind === "switch") {
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
