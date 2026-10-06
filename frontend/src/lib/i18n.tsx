import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { en, type Messages } from "./locales/en"
import { hu } from "./locales/hu"
import { readPreference, writePreference } from "./preferences"

export type Locale = "en" | "hu"

export const locales: Record<Locale, { label: string; messages: Messages }> = {
  en: { label: "English", messages: en },
  hu: { label: "Magyar", messages: hu },
}

/** Replaces `{name}` placeholders with values. Unknown placeholders are kept. */
export function format(template: string, values: Record<string, string | number> = {}) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match))
}

export function resolveLocale(value: string | null | undefined): Locale {
  return value && value in locales ? (value as Locale) : "en"
}

type I18nValue = {
  locale: Locale
  setLocale: (value: Locale) => void
  t: Messages
  f: typeof format
}

const I18nContext = createContext<I18nValue | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => resolveLocale(readPreference("locale")))

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const setLocale = useCallback((value: Locale) => {
    setLocaleState(value)
    writePreference("locale", value)
  }, [])

  const value = useMemo(() => ({ locale, setLocale, t: locales[locale].messages, f: format }), [locale, setLocale])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const context = useContext(I18nContext)
  if (!context) throw new Error("useI18n must be used inside I18nProvider")
  return context
}
