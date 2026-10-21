import { ArrowUpCircle, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Info, Loader2, RefreshCw, SquareArrowOutUpRight, TriangleAlert } from "lucide-react"
import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { errorMessage, getBackend } from "@/lib/bridge"
import type { AppInfo, Release, UpdateCheck } from "@/lib/contracts"
import { useI18n } from "@/lib/i18n"
import { cn, formatTime } from "@/lib/utils"
import { parseMarkdown, type Block, type Inline } from "../markdown"

const api = () => getBackend().api
const openLink = (url: string) => { if (url.startsWith("https://")) void api().OpenExternalURL(url).catch(() => undefined) }

const formatDate = (value: string, locale: string, withTime = false) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime()) || date.getFullYear() < 2000) return ""
  return new Intl.DateTimeFormat(locale, withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(date)
}

// The last check survives leaving the settings page for this session.
let lastCheck: UpdateCheck | null = null

/**
 * The running version and, on request, the latest release and changelog
 * from GitHub (ADR-0034). Nothing is fetched until the user asks.
 */
export function AboutCard() {
  const { t, f, locale } = useI18n()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [check, setCheck] = useState<UpdateCheck | null>(lastCheck)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    void api().AppInfo().then(setInfo).catch(() => undefined)
  }, [])

  const run = async () => {
    setChecking(true)
    setError("")
    try {
      const result = await api().CheckForUpdates()
      lastCheck = { ...result, releases: result.releases ?? [] }
      setCheck(lastCheck)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setChecking(false)
    }
  }

  const dev = !info || info.version === "dev"
  const releases = check?.releases ?? []

  return (
    <section aria-labelledby="about-title" className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <h2 id="about-title" className="text-sm font-semibold">{t.about.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t.about.hint}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" onClick={() => void run()} disabled={checking}>
            {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />} {checking ? t.about.checking : t.about.check}
          </Button>
          {info?.repository && (
            <Button size="sm" variant="outline" onClick={() => openLink(info.repository)}><SquareArrowOutUpRight /> {t.about.github}</Button>
          )}
        </div>
      </div>

      <dl className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg bg-muted/50 px-3 py-2">
          <dt className="text-[0.6875rem] text-muted-foreground">{t.about.version}</dt>
          <dd className="mt-0.5 flex items-center gap-2 text-lg font-semibold tabular-nums">
            {dev ? t.about.devBuild : info.version}
            {info?.modified && <Badge variant="warning">{t.about.modified}</Badge>}
          </dd>
        </div>
        <div className="rounded-lg bg-muted/50 px-3 py-2">
          <dt className="text-[0.6875rem] text-muted-foreground">{t.about.commit}</dt>
          <dd className="mt-0.5 truncate font-mono text-xs" title={info?.commit}>
            {info?.commit ? info.commit.slice(0, 12) : "—"}
            {info?.commitTime && <span className="block font-sans text-[0.6875rem] text-muted-foreground">{formatDate(info.commitTime, locale, true)}</span>}
          </dd>
        </div>
        <div className="rounded-lg bg-muted/50 px-3 py-2">
          <dt className="text-[0.6875rem] text-muted-foreground">{t.about.platform}</dt>
          <dd className="mt-0.5 font-mono text-xs">{info?.platform ?? "—"}<span className="block font-sans text-[0.6875rem] text-muted-foreground">{info?.goVersion}</span></dd>
        </div>
      </dl>

      <div aria-live="polite">
        {error && (
          <div role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            <span className="min-w-0 flex-1">{f(t.about.failed, { error })}</span>
          </div>
        )}
        {check && !error && <Status check={check} />}
      </div>

      {releases.length > 0 && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{t.about.changelog}</h3>
          <ul className="mt-2 grid gap-2">
            {releases.slice(0, 10).map((release, index) => (
              <ReleaseItem key={release.tag} release={release} open={release.newer || (index === 0 && !releases.some((r) => r.newer))} current={release.tag === check?.current} />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function Status({ check }: { check: UpdateCheck }) {
  const { t, f } = useI18n()
  const checked = f(t.about.checkedAt, { time: formatTime(check.checkedAt) })
  if (!check.latest.tag) {
    return <Note icon={<Info className="size-4 text-muted-foreground" />} title={t.about.noReleases} detail={checked} />
  }
  if (check.updateAvailable) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3">
        <ArrowUpCircle className="size-5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-medium">{f(t.about.available, { version: check.latest.tag })}</div>
          <div className="text-xs text-muted-foreground">{f(t.about.youHave, { version: check.current })} · {checked}</div>
        </div>
        <Button size="sm" onClick={() => openLink(check.latest.url)}><ExternalLink /> {t.about.download}</Button>
      </div>
    )
  }
  if (!check.comparable) {
    return <Note icon={<Info className="size-4 text-muted-foreground" />} title={f(t.about.devLatest, { version: check.latest.tag })} detail={checked} />
  }
  return <Note icon={<CheckCircle2 className="size-4 text-success" />} title={f(t.about.upToDate, { version: check.current })} detail={checked} />
}

function Note({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return (
    <div className="mt-4 flex items-center gap-3 rounded-xl bg-muted/50 px-4 py-3 text-sm">
      {icon}
      <span className="min-w-0 flex-1 font-medium">{title}</span>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </div>
  )
}

function ReleaseItem({ release, open: initiallyOpen, current }: { release: Release; open: boolean; current: boolean }) {
  const { t, locale } = useI18n()
  const [open, setOpen] = useState(initiallyOpen)
  const blocks = open ? parseMarkdown(release.notes) : []
  return (
    <li className="rounded-xl border border-border">
      <button
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring"
      >
        {open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
        <span className="min-w-0 truncate font-medium">{release.name}</span>
        {release.name !== release.tag && <span className="shrink-0 font-mono text-xs text-muted-foreground">{release.tag}</span>}
        {release.newer && <Badge variant="info">{t.about.new}</Badge>}
        {current && <Badge variant="success">{t.about.installed}</Badge>}
        {release.prerelease && <Badge variant="warning">{t.about.prerelease}</Badge>}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">{formatDate(release.publishedAt, locale)}</span>
      </button>
      {open && (
        <div className="border-t border-border px-4 pb-3 pt-2 text-sm">
          {blocks.length ? <Notes blocks={blocks} /> : <p className="text-xs text-muted-foreground">{t.about.noNotes}</p>}
          <button onClick={() => openLink(release.url)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            <ExternalLink className="size-3" /> {t.about.openRelease}
          </button>
        </div>
      )}
    </li>
  )
}

function Notes({ blocks }: { blocks: Block[] }) {
  return (
    <div className="grid gap-2">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "heading":
            return <h4 key={i} className={cn("font-semibold", block.level <= 2 ? "mt-1 text-sm" : "text-xs")}><Text inline={block.inline} /></h4>
          case "list": {
            const List = block.ordered ? "ol" : "ul"
            return (
              <List key={i} className={cn("grid gap-1 pl-5 text-xs", block.ordered ? "list-decimal" : "list-disc")}>
                {block.items.map((item, j) => <li key={j}><Text inline={item} /></li>)}
              </List>
            )
          }
          case "quote":
            return <blockquote key={i} className="border-l-2 border-border pl-3 text-xs text-muted-foreground"><Text inline={block.inline} /></blockquote>
          case "code":
            return <pre key={i} className="thin-scrollbar overflow-x-auto rounded-lg bg-muted/60 px-3 py-2 font-mono text-[0.6875rem]">{block.text}</pre>
          default:
            return <p key={i} className="text-xs"><Text inline={block.inline} /></p>
        }
      })}
    </div>
  )
}

function Text({ inline }: { inline: Inline[] }) {
  return (
    <>
      {inline.map((part, i) => {
        switch (part.kind) {
          case "code":
            return <code key={i} className="rounded bg-muted px-1 font-mono text-[0.9em]">{part.text}</code>
          case "strong":
            return <strong key={i} className="font-semibold">{part.text}</strong>
          case "em":
            return <em key={i}>{part.text}</em>
          case "link":
            return part.href.startsWith("https://") ? (
              <button key={i} onClick={() => openLink(part.href)} title={part.href} className="font-medium text-primary hover:underline">{part.text}</button>
            ) : <span key={i}>{part.text}</span>
          default:
            return <span key={i}>{part.text}</span>
        }
      })}
    </>
  )
}
