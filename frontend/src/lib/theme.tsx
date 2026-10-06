import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { readPreference, writePreference } from "./preferences"

export type ThemeMode = "system" | "light" | "dark"

const query = "(prefers-color-scheme: dark)"

function resolveMode(value: string | null): ThemeMode {
  return value === "light" || value === "dark" || value === "system" ? value : "system"
}

function apply(mode: ThemeMode) {
  const dark = mode === "dark" || (mode === "system" && window.matchMedia(query).matches)
  document.documentElement.classList.toggle("dark", dark)
  document.documentElement.style.colorScheme = dark ? "dark" : "light"
}

/** Applies the stored theme before React renders to avoid a flash. */
export function applyStoredTheme() {
  apply(resolveMode(readPreference("theme")))
}

type ThemeValue = { mode: ThemeMode; setMode: (mode: ThemeMode) => void }
const ThemeContext = createContext<ThemeValue | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => resolveMode(readPreference("theme")))

  useEffect(() => {
    apply(mode)
    if (mode !== "system") return
    const media = window.matchMedia(query)
    const listener = () => apply("system")
    media.addEventListener("change", listener)
    return () => media.removeEventListener("change", listener)
  }, [mode])

  const setMode = useCallback((value: ThemeMode) => {
    setModeState(value)
    writePreference("theme", value)
  }, [])

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error("useTheme must be used inside ThemeProvider")
  return context
}
