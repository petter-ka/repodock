// The single boundary between React and the Wails runtime. Components and
// feature modules must go through this file instead of touching `window.go`
// or `window.runtime` directly.
import type { AppBinding, EventMap } from "./contracts"
import { createMockBackend } from "./mockBridge"

type WailsRuntime = {
  EventsOn: (event: string, callback: (...payload: unknown[]) => void) => () => void
}

declare global {
  interface Window {
    // Wails v2 binds methods under window.go.<go package>.<struct>.
    go?: { app?: { App?: AppBinding } }
    runtime?: WailsRuntime
  }
}

type Listener = (payload: never) => void

export type Backend = {
  api: AppBinding
  on<K extends keyof EventMap>(event: K, callback: (payload: EventMap[K]) => void): () => void
  native: boolean
}

function wailsBackend(): Backend | null {
  const api = window.go?.app?.App
  const runtime = window.runtime
  if (!api || !runtime) return null
  return {
    api,
    native: true,
    on(event, callback) {
      return runtime.EventsOn(event, (payload) => (callback as Listener)(payload as never))
    },
  }
}

let backend: Backend | null = null

/** Returns the Wails backend, or an in-memory mock when running in a plain browser. */
export function getBackend(): Backend {
  backend ??= wailsBackend() ?? createMockBackend()
  return backend
}

/** Converts unknown rejection values (Wails rejects with strings) into messages. */
export function errorMessage(error: unknown): string {
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  return String(error)
}
