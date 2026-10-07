import { CornerDownLeft, Eye, EyeOff, Keyboard, Send } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip } from "@/components/ui/tooltip"
import { stripAnsi } from "@/lib/ansi"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { Run } from "../domain"
import type { RepositoryActions } from "../hooks/useRepositoryActions"
import { useProcessVersion } from "../hooks/useStores"
import { processStore } from "../store/processStore"

const SECRET_PROMPT = /pass(word|phrase)?|secret|token|api[ _-]?key|otp|pin\b/i

/**
 * Answers interactive prompts ("Continue? (y/n)") of running processes by
 * writing a line to their stdin. Hidden when nothing in scope is running.
 */
export function ProcessInput({ runs, selectedRunId, repoNames, actions }: {
  runs: Run[]
  selectedRunId: string | null
  repoNames?: Map<string, string>
  actions: RepositoryActions
}) {
  const { t, f } = useI18n()
  const version = useProcessVersion()
  const [value, setValue] = useState("")
  const [chosenId, setChosenId] = useState<string | null>(null)
  const [secret, setSecret] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const running = useMemo(() => runs.filter((run) => run.status === "running"), [runs])
  const prompts = useMemo(() => {
    void version
    return new Map(running.map((run) => [run.id, processStore.prompt(run.id)]).filter((e): e is [string, string] => !!e[1]))
  }, [version, running])

  // Target: an explicit choice, else the console's selected run, else the
  // newest run waiting on a prompt, else the newest running run.
  const target = useMemo(() => {
    const byId = (id: string | null) => running.find((run) => run.id === id)
    const newest = [...running].reverse()
    return byId(chosenId) ?? byId(selectedRunId) ?? newest.find((run) => prompts.has(run.id)) ?? newest[0]
  }, [running, chosenId, selectedRunId, prompts])

  const prompt = target ? prompts.get(target.id) : undefined

  // Follow the console's run selection, and suggest hiding input for password-like prompts.
  useEffect(() => setChosenId(null), [selectedRunId])
  useEffect(() => {
    if (prompt !== undefined) setSecret(SECRET_PROMPT.test(stripAnsi(prompt)))
  }, [prompt])

  if (!target) return null

  const label = (run: Run) => `${repoNames ? `${repoNames.get(run.repositoryId) ?? ""} · ` : ""}${run.label}`

  const send = async (text: string) => {
    setBusy(true)
    try {
      if (await actions.sendInput(target.id, text, secret)) setValue("")
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  const eof = async () => {
    setBusy(true)
    try {
      await actions.closeInput(target.id)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      aria-label={t.input.title}
      className={cn("flex flex-wrap items-center gap-2 border-t px-6 py-2", prompt !== undefined ? "border-warning/50 bg-warning/10" : "border-border bg-card")}
      onSubmit={(event) => {
        event.preventDefault()
        void send(value)
      }}
    >
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium">
        {prompt !== undefined ? (
          <>
            <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-warning opacity-75" /><span className="relative inline-flex size-2 rounded-full bg-warning" /></span>
            <span className="text-warning">{t.input.waiting}</span>
          </>
        ) : (
          <><Keyboard className="size-4 text-muted-foreground" /> <span className="text-muted-foreground">{t.input.title}</span></>
        )}
      </span>

      {running.length > 1 ? (
        <select
          aria-label={t.input.target}
          value={target.id}
          onChange={(event) => setChosenId(event.target.value)}
          className="h-8 max-w-56 shrink-0 rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {running.map((run) => (
            <option key={run.id} value={run.id}>{prompts.has(run.id) ? "● " : ""}{label(run)}</option>
          ))}
        </select>
      ) : (
        <span className="max-w-56 shrink-0 truncate rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-muted-foreground" title={target.command}>{label(target)}</span>
      )}

      <div className="relative min-w-48 flex-1">
        <input
          ref={inputRef}
          type={secret ? "password" : "text"}
          value={value}
          disabled={busy}
          spellCheck={false}
          autoComplete="off"
          aria-label={f(t.input.placeholder, { name: target.label })}
          placeholder={prompt !== undefined ? stripAnsi(prompt).trim() || f(t.input.placeholder, { name: target.label }) : f(t.input.placeholder, { name: target.label })}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setValue("")
            else if (event.key === "d" && event.ctrlKey && !value) { event.preventDefault(); void eof() }
          }}
          className="h-8 w-full rounded-md border border-border bg-background px-3 pr-9 font-mono text-[13px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Tooltip label={secret ? t.input.show : t.input.hide}>
          <button
            type="button"
            aria-label={secret ? t.input.show : t.input.hide}
            aria-pressed={secret}
            onClick={() => setSecret((s) => !s)}
            className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5"
          >
            {secret ? <EyeOff /> : <Eye />}
          </button>
        </Tooltip>
      </div>

      <Button type="submit" size="sm" disabled={busy}><Send /> {t.input.send}</Button>
      <div className="flex shrink-0 items-center gap-1">
        <Tooltip label={t.input.yesHint}><Button type="button" size="xs" variant="outline" disabled={busy} onClick={() => void send("y")} className="font-mono">y</Button></Tooltip>
        <Tooltip label={t.input.noHint}><Button type="button" size="xs" variant="outline" disabled={busy} onClick={() => void send("n")} className="font-mono">n</Button></Tooltip>
        <Tooltip label={t.input.enterHint}><Button type="button" size="xs" variant="outline" disabled={busy} aria-label={t.input.enterHint} onClick={() => void send("")}><CornerDownLeft /></Button></Tooltip>
        <Tooltip label={<span className="flex items-center gap-1.5">{t.input.eofHint} <Kbd>Ctrl</Kbd><Kbd>D</Kbd></span>}>
          <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => void eof()} className="font-mono text-muted-foreground">EOF</Button>
        </Tooltip>
      </div>
    </form>
  )
}
