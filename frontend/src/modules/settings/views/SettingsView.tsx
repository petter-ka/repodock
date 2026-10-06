import { Monitor, Moon, Sun } from "lucide-react"
import { useEffect, useState } from "react"
import { Kbd } from "@/components/ui/kbd"
import { getBackend } from "@/lib/bridge"
import { locales, useI18n, type Locale } from "@/lib/i18n"
import { modLabel } from "@/lib/keyboard"
import { useTheme, type ThemeMode } from "@/lib/theme"
import { cn } from "@/lib/utils"

const themeIcons: Record<ThemeMode, React.ReactNode> = {
  system: <Monitor className="size-4" />,
  light: <Sun className="size-4" />,
  dark: <Moon className="size-4" />,
}

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: Array<{ value: T; label: string; icon?: React.ReactNode }>
  onChange: (value: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="mt-4 inline-flex rounded-xl border border-border bg-background p-1">
      {options.map((option) => (
        <button
          key={option.value}
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
            value === option.value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  )
}

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      {children}
    </section>
  )
}

export function SettingsView() {
  const { mode, setMode } = useTheme()
  const { locale, setLocale, t } = useI18n()
  const [workspacePath, setWorkspacePath] = useState("")
  const backend = getBackend()

  useEffect(() => {
    void backend.api.StartupReport().then((report) => setWorkspacePath(report.workspacePath)).catch(() => undefined)
  }, [backend])

  const shortcuts: Array<[string[], string]> = [
    [[modLabel, "O"], t.shortcuts.addRepo],
    [[modLabel, "K"], t.shortcuts.focusFilter],
    [["Alt", "↓"], t.shortcuts.nextRepo],
    [["Alt", "↑"], t.shortcuts.prevRepo],
    [[modLabel, "J"], t.shortcuts.focusCommand],
    [[modLabel, "L"], t.shortcuts.clearConsole],
    [[modLabel, "S"], t.shortcuts.saveFile],
  ]

  return (
    <main className="thin-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto p-8">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">{t.settings.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.settings.subtitle}</p>

        <div className="mt-8 grid gap-4">
          {!backend.native && (
            <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-xs">{t.settings.browserMode}</div>
          )}
          <Card title={t.settings.theme} hint={t.settings.themeHint}>
            <Segmented
              label={t.settings.theme}
              value={mode}
              onChange={setMode}
              options={(["system", "light", "dark"] as ThemeMode[]).map((value) => ({ value, label: t.common[value], icon: themeIcons[value] }))}
            />
          </Card>
          <Card title={t.settings.language} hint={t.settings.languageHint}>
            <Segmented
              label={t.settings.language}
              value={locale}
              onChange={setLocale}
              options={(Object.keys(locales) as Locale[]).map((value) => ({ value, label: locales[value].label }))}
            />
          </Card>
          <Card title={t.settings.shortcuts}>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              {shortcuts.map(([keys, label]) => (
                <div key={label} className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 text-sm">
                  <dt>{label}</dt>
                  <dd className="flex gap-1">{keys.map((key) => <Kbd key={key}>{key}</Kbd>)}</dd>
                </div>
              ))}
            </dl>
          </Card>
          {workspacePath && (
            <Card title={t.settings.workspace} hint={t.settings.workspaceHint}>
              <code className="mt-3 block break-all rounded-lg bg-muted/60 px-3 py-2 font-mono text-xs">{workspacePath}</code>
            </Card>
          )}
        </div>
      </div>
    </main>
  )
}
