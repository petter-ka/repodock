import { AlertTriangle, ArrowRightLeft, Check, ChevronRight, Clock, Copy, Eye, EyeOff, Loader2, PencilLine, ShieldCheck, ShieldQuestion, ShieldX, Sparkles } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip } from "@/components/ui/tooltip"
import { errorMessage } from "@/lib/bridge"
import { useI18n } from "@/lib/i18n"
import { hasMod, modLabel } from "@/lib/keyboard"
import { cn } from "@/lib/utils"
import { useNotifications } from "@/state/notifications"
import { jwtApi, type JwtDecoded, type JwtSettings, type JwtToken } from "./api"
import { settingsFromToken } from "./fromToken"
import { RolesEditor } from "./RolesEditor"

type Tab = "encode" | "decode"

const SAVE_DELAY = 400

function formatDateTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date)
}

/**
 * Remembered settings: loaded from the backend once, saved shortly after
 * every change, and flushed when the window closes.
 */
function useJwtSettings() {
  const [settings, setSettings] = useState<JwtSettings | null>(null)
  const [error, setError] = useState("")
  const pending = useRef<JwtSettings | null>(null)
  const timer = useRef<number>(undefined)

  const flush = useCallback(() => {
    window.clearTimeout(timer.current)
    const next = pending.current
    pending.current = null
    if (next) jwtApi.save(next).catch((err) => setError(errorMessage(err)))
  }, [])

  useEffect(() => {
    jwtApi.settings().then(setSettings).catch((err) => setError(errorMessage(err)))
    return flush
  }, [flush])

  const update = useCallback((patch: Partial<JwtSettings>) => {
    setSettings((current) => {
      if (!current) return current
      const next = { ...current, ...patch }
      pending.current = next
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(flush, SAVE_DELAY)
      return next
    })
  }, [flush])

  return { settings, update, error }
}

/** Generate test JWTs with a chosen set of roles, and decode/verify tokens. */
export function JwtTool() {
  const { t } = useI18n()
  const { settings, update, error } = useJwtSettings()
  const [tab, setTab] = useState<Tab>("encode")
  const [decodeText, setDecodeText] = useState("")
  // The token whose claims were last copied into the Encode form; kept here so
  // switching tabs does not re-apply it over later edits.
  const filledFrom = useRef("")

  if (!settings) {
    return (
      <div className="flex items-center justify-center p-8 text-muted-foreground">
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : <Loader2 className="size-5 animate-spin" />}
      </div>
    )
  }

  return (
    <div>
      {/* The window body scrolls; the tab bar stays on top. */}
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-card px-3 py-2">
        <div role="radiogroup" aria-label={t.jwt.mode} className="flex rounded-lg border border-border p-0.5 text-xs">
          {(["encode", "decode"] as const).map((option) => (
            <button
              key={option}
              role="radio"
              aria-checked={tab === option}
              onClick={() => setTab(option)}
              className={cn("rounded-md px-2.5 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring", tab === option ? "bg-accent font-medium" : "text-muted-foreground")}
            >
              {option === "encode" ? t.jwt.encode : t.jwt.decode}
            </button>
          ))}
        </div>
        <span className="ml-auto text-[11px] text-muted-foreground">{error ? <span className="text-destructive">{error}</span> : t.jwt.saved}</span>
      </div>
      {tab === "encode"
        ? <Encoder settings={settings} update={update} onDecode={(token) => { filledFrom.current = token; setDecodeText(token); setTab("decode") }} />
        : <Decoder settings={settings} update={update} text={decodeText} onText={setDecodeText} filledFrom={filledFrom} onEdit={() => setTab("encode")} />}
    </div>
  )
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={cn("grid gap-1", wide && "col-span-2")}>
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function Section({ title, summary, defaultOpen, children }: { title: string; summary?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details open={defaultOpen} className="group/section border-t border-border">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 transition group-open/section:rotate-90" />
        {title}
        {summary && <span className="ml-auto font-normal normal-case tracking-normal">{summary}</span>}
      </summary>
      <div className="px-3 pb-3">{children}</div>
    </details>
  )
}

function Encoder({ settings, update, onDecode }: { settings: JwtSettings; update: (patch: Partial<JwtSettings>) => void; onDecode: (token: string) => void }) {
  const { t, f } = useI18n()
  const { notify } = useNotifications()
  const [showKeys, setShowKeys] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<JwtToken | null>(null)
  const [failure, setFailure] = useState("")
  const [copied, setCopied] = useState(false)

  const extraValid = useMemo(() => {
    const text = settings.extraClaims.trim()
    if (!text) return true
    try {
      const value: unknown = JSON.parse(text)
      return typeof value === "object" && value !== null && !Array.isArray(value)
    } catch {
      return false
    }
  }, [settings.extraClaims])

  const rs = settings.algorithm === "RS256"
  const keyReady = rs ? settings.privateKey.trim() !== "" : settings.secret !== ""
  const ready = settings.id.trim() !== "" && settings.email.trim() !== "" && settings.expiresInDays > 0 && keyReady && extraValid

  const generate = async () => {
    if (!ready || busy) return
    setBusy(true)
    setFailure("")
    try {
      setResult(await jwtApi.generate(settings))
      setCopied(false)
    } catch (err) {
      setResult(null)
      setFailure(errorMessage(err) || t.common.error)
    } finally {
      setBusy(false)
    }
  }

  const copy = () => {
    if (!result) return
    void navigator.clipboard?.writeText(result.token).then(() => {
      setCopied(true)
      notify(t.jwt.copied, { tone: "success", duration: 1500 })
    })
  }

  const text = (key: "id" | "email" | "issuer" | "subject" | "realm" | "channel" | "deviceId", mono = true) => (
    <Input value={settings[key]} onChange={(event) => update({ [key]: event.target.value })} spellCheck={false} autoComplete="off" className={cn("h-8 text-xs", mono && "font-mono")} />
  )
  const keyClass = cn("thin-scrollbar h-20 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-[11px] leading-4 outline-none focus-visible:ring-2 focus-visible:ring-ring", !showKeys && "[-webkit-text-security:disc]")

  return (
    <div
      onKeyDown={(event) => {
        if (hasMod(event) && event.key === "Enter") { event.preventDefault(); void generate() }
      }}
    >
      <Section title={t.jwt.claims} defaultOpen>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t.jwt.id}>{text("id")}</Field>
          <Field label={t.jwt.email}>{text("email")}</Field>
          <Field label={t.jwt.expires}>
            <Input
              type="number"
              min={0}
              step="any"
              value={Number.isFinite(settings.expiresInDays) ? settings.expiresInDays : ""}
              onChange={(event) => update({ expiresInDays: event.target.valueAsNumber })}
              aria-invalid={!(settings.expiresInDays > 0)}
              className="h-8 font-mono text-xs"
            />
          </Field>
          <Field label={t.jwt.algorithm}>
            <div role="radiogroup" aria-label={t.jwt.algorithm} className="flex h-8 rounded-lg border border-border p-0.5 text-xs">
              {(["RS256", "HS256"] as const).map((alg) => (
                <button
                  key={alg}
                  type="button"
                  role="radio"
                  aria-checked={settings.algorithm === alg}
                  onClick={() => update({ algorithm: alg })}
                  className={cn("flex-1 rounded-md font-mono outline-none focus-visible:ring-2 focus-visible:ring-ring", settings.algorithm === alg ? "bg-accent font-medium" : "text-muted-foreground")}
                >
                  {alg}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t.jwt.issuer}>{text("issuer")}</Field>
          <Field label={t.jwt.subject}>{text("subject")}</Field>
          <Field label={t.jwt.realm}>{text("realm")}</Field>
          <Field label={t.jwt.channel}>{text("channel")}</Field>
          <Field label={t.jwt.deviceId} wide>{text("deviceId")}</Field>
        </div>
      </Section>

      <Section title={t.jwt.roles} summary={f(t.jwt.rolesSelected, { selected: settings.selectedRoles.length, total: settings.roles.length })} defaultOpen>
        <RolesEditor value={settings} onChange={update} />
      </Section>

      <Section
        title={t.jwt.keys}
        defaultOpen={!keyReady}
        summary={<span className={keyReady ? "text-success" : "text-warning"}>{rs ? t.jwt.privateKey : t.jwt.secret}: {keyReady ? t.jwt.keySet : t.jwt.keyMissing}</span>}
      >
        <div className="grid gap-2">
          <p className="text-[11px] text-muted-foreground">{t.jwt.keysHint}</p>
          {rs ? (
            <>
              <Field label={t.jwt.privateKey}>
                <textarea value={settings.privateKey} onChange={(event) => update({ privateKey: event.target.value })} spellCheck={false} autoComplete="off" placeholder="-----BEGIN RSA PRIVATE KEY-----" className={keyClass} />
              </Field>
              <Field label={t.jwt.publicKey}>
                <textarea value={settings.publicKey} onChange={(event) => update({ publicKey: event.target.value })} spellCheck={false} autoComplete="off" placeholder="-----BEGIN PUBLIC KEY-----" className={keyClass} />
              </Field>
            </>
          ) : (
            <Field label={t.jwt.secret}>
              <Input type={showKeys ? "text" : "password"} value={settings.secret} onChange={(event) => update({ secret: event.target.value })} spellCheck={false} autoComplete="off" className="h-8 font-mono text-xs" />
            </Field>
          )}
          <Button size="xs" variant="outline" className="justify-self-start" onClick={() => setShowKeys((value) => !value)}>
            {showKeys ? <><EyeOff /> {t.jwt.hideKeys}</> : <><Eye /> {t.jwt.showKeys}</>}
          </Button>
        </div>
      </Section>

      <Section title={t.jwt.extra} defaultOpen={settings.extraClaims.trim() !== ""}>
        <textarea
          value={settings.extraClaims}
          onChange={(event) => update({ extraClaims: event.target.value })}
          spellCheck={false}
          aria-invalid={!extraValid}
          placeholder={'{\n  "tenant": "t1"\n}'}
          className={cn("thin-scrollbar h-20 w-full resize-y rounded-lg border bg-background px-3 py-2 font-mono text-[11px] leading-4 outline-none focus-visible:ring-2 focus-visible:ring-ring", extraValid ? "border-border" : "border-destructive")}
        />
        <p className={cn("mt-1 text-[11px]", extraValid ? "text-muted-foreground" : "text-destructive")}>{extraValid ? t.jwt.extraHint : t.jwt.extraInvalid}</p>
      </Section>

      <div className="sticky bottom-0 z-10 grid gap-2 border-t border-border bg-card p-3">
        <Button disabled={!ready || busy} onClick={() => void generate()} title={`${modLabel}+Enter`}>
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {t.jwt.generate}
        </Button>
        {failure && <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {failure}</p>}
        {result && (
          <div className="grid gap-2 rounded-lg border border-success/40 bg-success/5 p-2.5">
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Clock className="size-3.5" /> {f(t.jwt.expiresAt, { time: formatDateTime(result.expiresAt) })}
              <span className="ml-auto flex gap-1">
                <Button size="xs" variant="outline" onClick={() => onDecode(result.token)}><ArrowRightLeft /> {t.jwt.openInDecoder}</Button>
                <Button size="xs" onClick={copy}>{copied ? <Check /> : <Copy />} {t.jwt.copy}</Button>
              </span>
            </div>
            <p className="thin-scrollbar max-h-24 select-all overflow-auto break-all font-mono text-[11px] leading-4">{result.token}</p>
          </div>
        )}
      </div>
    </div>
  )
}

const signatureBadge = {
  valid: { variant: "success", icon: ShieldCheck },
  invalid: { variant: "destructive", icon: ShieldX },
  unverified: { variant: "outline", icon: ShieldQuestion },
} as const

function Decoder({ settings, update, text, onText, filledFrom, onEdit }: {
  settings: JwtSettings
  update: (patch: Partial<JwtSettings>) => void
  text: string
  onText: (text: string) => void
  filledFrom: React.RefObject<string>
  onEdit: () => void
}) {
  const { t, f } = useI18n()
  const [decoded, setDecoded] = useState<JwtDecoded | null>(null)
  const [failure, setFailure] = useState("")

  // Decode as the user types; verification uses the keys from the Encode tab.
  useEffect(() => {
    if (!text.trim()) {
      setDecoded(null)
      setFailure("")
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      jwtApi.decode(text, settings)
        .then((result) => {
          if (cancelled) return
          setDecoded(result)
          setFailure("")
          // Fill the Encode form once per token so it can be re-issued or tweaked.
          if (filledFrom.current !== text) {
            filledFrom.current = text
            update(settingsFromToken(settings, result.payload, result.algorithm))
          }
        })
        .catch((err) => { if (!cancelled) { setDecoded(null); setFailure(errorMessage(err) || t.common.error) } })
    }, 200)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [text, settings, update, filledFrom, t.common.error])

  const badge = decoded ? signatureBadge[decoded.signature] : null

  return (
    <div className="grid gap-3 p-3">
      <textarea
        autoFocus
        value={text}
        onChange={(event) => onText(event.target.value)}
        placeholder={t.jwt.pasteToken}
        spellCheck={false}
        aria-label={t.jwt.token}
        className="thin-scrollbar h-24 w-full resize-y break-all rounded-lg border border-border bg-background px-3 py-2 font-mono text-[11px] leading-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {failure && <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {failure}</p>}
      {!decoded && !failure && <p className="text-[11px] text-muted-foreground">{t.jwt.decodeHint}</p>}

      {decoded && badge && (
        <>
          <div className="flex flex-wrap items-center gap-1.5" aria-live="polite">
            <Tooltip label={decoded.signatureError || t.jwt[decoded.signature]}>
              <Badge variant={badge.variant}><badge.icon className="size-3" /> {t.jwt[decoded.signature]}</Badge>
            </Tooltip>
            {decoded.algorithm && <Badge variant="outline" className="font-mono">{decoded.algorithm}</Badge>}
            {decoded.expiresAt && (
              <Badge variant={decoded.expired ? "destructive" : "success"}>
                <Clock className="size-3" /> {f(decoded.expired ? t.jwt.expired : t.jwt.validUntil, { time: formatDateTime(decoded.expiresAt) })}
              </Badge>
            )}
            {decoded.issuedAt && <span className="text-[11px] text-muted-foreground">{f(t.jwt.issued, { time: formatDateTime(decoded.issuedAt) })}</span>}
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-[11px] text-muted-foreground">
            <PencilLine className="size-3.5 shrink-0 text-primary" />
            <span className="flex-1">{t.jwt.filledFromToken}</span>
            <Button size="xs" variant="outline" onClick={onEdit}>{t.jwt.editInEncoder}</Button>
          </div>

          {decoded.roles.length > 0 && (
            <div className="grid gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t.jwt.tokenRoles}</span>
              <div className="flex flex-wrap gap-1">
                {decoded.roles.map((role) => <Badge key={role} variant="info" className="font-mono">{role}</Badge>)}
              </div>
            </div>
          )}

          <JsonBlock title={t.jwt.payload} json={decoded.payload} />
          <JsonBlock title={t.jwt.header} json={decoded.header} />
        </>
      )}
    </div>
  )
}

function JsonBlock({ title, json }: { title: string; json: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</span>
      <pre className="console-scrollbar max-h-64 overflow-auto rounded-lg bg-console p-3 font-mono text-[11px] leading-4 text-console-foreground">{json}</pre>
    </div>
  )
}
