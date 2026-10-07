import { CornerDownLeft, Terminal } from "lucide-react"
import { forwardRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n"
import { readJSON, writeJSON } from "@/lib/preferences"
import { displayName, type Repository } from "../domain"

const HISTORY_LIMIT = 50

/** Free-form shell command for the selected repository, with ↑/↓ history. */
export const CommandInput = forwardRef<HTMLInputElement, { repo: Repository; onRun: (command: string) => void }>(function CommandInput({ repo, onRun }, ref) {
  const { t, f } = useI18n()
  const key = `history.${repo.id}`
  const [value, setValue] = useState("")
  const [cursor, setCursor] = useState(-1)

  const submit = () => {
    const command = value.trim()
    if (!command) return
    const history = readJSON<string[]>(key, []).filter((item) => item !== command)
    writeJSON(key, [command, ...history].slice(0, HISTORY_LIMIT))
    onRun(command)
    setValue("")
    setCursor(-1)
  }

  const browse = (direction: 1 | -1) => {
    const history = readJSON<string[]>(key, [])
    const next = Math.max(-1, Math.min(history.length - 1, cursor + direction))
    setCursor(next)
    setValue(next === -1 ? "" : history[next])
  }

  return (
    <form
      className="px-6 pb-4 pt-3"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Terminal className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={ref}
            value={value}
            spellCheck={false}
            autoComplete="off"
            aria-label={f(t.scripts.customPlaceholder, { name: displayName(repo) })}
            placeholder={f(t.scripts.customPlaceholder, { name: displayName(repo) })}
            onChange={(event) => {
              setValue(event.target.value)
              setCursor(-1)
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp") { event.preventDefault(); browse(1) }
              else if (event.key === "ArrowDown") { event.preventDefault(); browse(-1) }
              else if (event.key === "Escape") { setValue(""); setCursor(-1) }
            }}
            className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 font-mono text-[13px] outline-none placeholder:font-sans placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <Button type="submit" variant="outline" disabled={!value.trim()}>
          <CornerDownLeft /> {t.common.run}
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{t.scripts.runHint}</p>
    </form>
  )
})
