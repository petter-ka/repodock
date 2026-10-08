import { AlertTriangle, Check, Copy, Plus, Trash2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip } from "@/components/ui/tooltip"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { addEnvEntry, envKeyPattern, parseEnv, removeEnvLine, renameEnvKey, setEnvValue, type EnvEntry } from "../envDocument"

type RowState = "added" | "changed" | null

/**
 * Key/value form over the dotenv text. Every edit goes through the
 * line-preserving helpers in envDocument, so the raw text stays the single
 * draft and comments/formatting survive.
 */
export function EnvForm({ draft, saved, revealed, onChange }: {
  draft: string
  /** file text on disk, to highlight changed rows */
  saved: string
  revealed: boolean
  onChange: (next: string) => void
}) {
  const { t, f } = useI18n()
  const entries = useMemo(() => parseEnv(draft), [draft])
  const savedValues = useMemo(() => new Map(parseEnv(saved).map((entry) => [entry.key, entry.value])), [saved])
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const entry of entries) map.set(entry.key, (map.get(entry.key) ?? 0) + 1)
    return map
  }, [entries])

  const [newKey, setNewKey] = useState("")
  const [newValue, setNewValue] = useState("")
  const newKeyError = !newKey ? "" : !envKeyPattern.test(newKey) ? t.env.invalidKey : counts.has(newKey) ? f(t.env.duplicateKey, { key: newKey }) : ""
  const add = () => {
    if (!newKey || newKeyError) return
    onChange(addEnvEntry(draft, newKey, newValue))
    setNewKey("")
    setNewValue("")
  }

  const rowState = (entry: EnvEntry): RowState =>
    !savedValues.has(entry.key) ? "added" : savedValues.get(entry.key) !== entry.value ? "changed" : null

  return (
    <div className="console-scrollbar absolute inset-0 overflow-auto bg-background p-4">
      <div className="grid grid-cols-[minmax(140px,2fr)_minmax(0,3fr)_auto] items-center gap-x-2 gap-y-1.5">
        <span className="px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t.env.key}</span>
        <span className="px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t.env.value}</span>
        <span />
        {entries.length === 0 && <p className="col-span-3 py-3 text-sm text-muted-foreground">{t.env.noVariables}</p>}
        {entries.map((entry) => (
          <EnvRow
            key={`${entry.line}:${entry.key}`}
            entry={entry}
            state={rowState(entry)}
            duplicate={(counts.get(entry.key) ?? 0) > 1}
            revealed={revealed}
            isTaken={(key) => counts.has(key)}
            onValue={(value) => onChange(setEnvValue(draft, entry.line, value))}
            onRename={(key) => onChange(renameEnvKey(draft, entry.line, key))}
            onRemove={() => onChange(removeEnvLine(draft, entry.line))}
          />
        ))}

        <div className="col-span-3 mt-3 border-t border-border" />
        <Input
          value={newKey}
          onChange={(event) => setNewKey(event.target.value.trim())}
          onKeyDown={(event) => { if (event.key === "Enter") add() }}
          placeholder={t.env.newKey}
          aria-label={t.env.key}
          aria-invalid={!!newKeyError}
          spellCheck={false}
          autoComplete="off"
          className={cn("mt-2 h-8 font-mono text-xs", newKeyError && "border-destructive focus-visible:ring-destructive")}
        />
        <Input
          value={newValue}
          type={revealed ? "text" : "password"}
          onChange={(event) => setNewValue(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") add() }}
          placeholder={t.env.value}
          aria-label={t.env.value}
          spellCheck={false}
          autoComplete="off"
          className="mt-2 h-8 font-mono text-xs"
        />
        <Button size="sm" variant="outline" className="mt-2" disabled={!newKey || !!newKeyError} onClick={add}><Plus /> {t.env.addVariable}</Button>
        {newKeyError && <p role="alert" className="col-span-3 px-1 text-[11px] text-destructive">{newKeyError}</p>}
      </div>
      <p className="mt-4 text-[11px] text-muted-foreground">{t.env.formNote}</p>
    </div>
  )
}

function EnvRow({ entry, state, duplicate, revealed, isTaken, onValue, onRename, onRemove }: {
  entry: EnvEntry
  state: RowState
  duplicate: boolean
  revealed: boolean
  isTaken: (key: string) => boolean
  onValue: (value: string) => void
  onRename: (key: string) => void
  onRemove: () => void
}) {
  const { t, f } = useI18n()
  // The key is committed on blur/Enter so a half-typed key never breaks the line.
  const [key, setKey] = useState(entry.key)
  useEffect(() => setKey(entry.key), [entry.key])
  const commitKey = () => {
    if (key === entry.key) return
    if (envKeyPattern.test(key) && !isTaken(key)) onRename(key)
    else setKey(entry.key)
  }
  // Copy feedback stays on the button only; the value is never shown or logged.
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(copiedTimer.current), [])
  const copy = () => {
    void navigator.clipboard?.writeText(entry.value).then(() => {
      setCopied(true)
      window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1500)
    })
  }
  const keyInvalid = key !== entry.key && (!envKeyPattern.test(key) || isTaken(key))

  return (
    <>
      <div className="relative flex items-center">
        <span
          aria-hidden
          className={cn("absolute -left-2.5 h-5 w-1 rounded-full", state === "added" ? "bg-success" : state === "changed" ? "bg-warning" : "bg-transparent")}
        />
        <Input
          value={key}
          onChange={(event) => setKey(event.target.value.trim())}
          onBlur={commitKey}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitKey()
            if (event.key === "Escape" && key !== entry.key) {
              event.stopPropagation()
              setKey(entry.key)
            }
          }}
          aria-label={t.env.key}
          aria-invalid={keyInvalid}
          title={keyInvalid ? (envKeyPattern.test(key) ? f(t.env.duplicateKey, { key }) : t.env.invalidKey) : undefined}
          spellCheck={false}
          autoComplete="off"
          className={cn("h-8 pr-7 font-mono text-xs font-medium", keyInvalid && "border-destructive focus-visible:ring-destructive")}
        />
        {duplicate && (
          <Tooltip label={t.env.duplicate}>
            <AlertTriangle aria-label={t.env.duplicate} className="absolute right-2 size-3.5 text-warning" />
          </Tooltip>
        )}
      </div>
      <Input
        value={entry.value}
        type={revealed ? "text" : "password"}
        onChange={(event) => onValue(event.target.value)}
        aria-label={f(t.env.valueOf, { key: entry.key })}
        spellCheck={false}
        autoComplete="off"
        className={cn("h-8 font-mono text-xs", state && "border-warning/60", state === "added" && "border-success/60")}
      />
      <div className="flex items-center">
        <Tooltip label={copied ? t.env.copied : f(t.env.copyValue, { key: entry.key })}>
          <Button size="icon-sm" variant="ghost" aria-label={f(t.env.copyValue, { key: entry.key })} onClick={copy} className={copied ? "text-success hover:text-success" : "text-muted-foreground"}>{copied ? <Check /> : <Copy />}</Button>
        </Tooltip>
        <Tooltip label={f(t.env.removeVariable, { key: entry.key })}>
          <Button size="icon-sm" variant="ghost" aria-label={f(t.env.removeVariable, { key: entry.key })} onClick={onRemove} className="text-muted-foreground hover:text-destructive"><Trash2 /></Button>
        </Tooltip>
      </div>
    </>
  )
}
