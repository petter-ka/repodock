// Per-device UI preferences (theme, locale, command history). These are
// presentation conveniences only; backend state never lives here.
const prefix = "repodock."

export function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(prefix + key)
  } catch {
    return null
  }
}

export function writePreference(key: string, value: string) {
  try {
    localStorage.setItem(prefix + key, value)
  } catch {
    // Storage can be unavailable (private mode, quota); preferences are optional.
  }
}

export function readJSON<T>(key: string, fallback: T): T {
  const raw = readPreference(key)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeJSON(key: string, value: unknown) {
  writePreference(key, JSON.stringify(value))
}
