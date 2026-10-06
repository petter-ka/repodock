import { useEffect, useRef } from "react"

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)

/** Platform primary modifier: ⌘ on macOS, Ctrl elsewhere. */
export function hasMod(event: KeyboardEvent | React.KeyboardEvent) {
  return isMac ? event.metaKey : event.ctrlKey
}

export const modLabel = isMac ? "⌘" : "Ctrl"

export type Shortcut = {
  /** e.g. "mod+o", "alt+arrowdown", "mod+l" */
  keys: string
  handler: (event: KeyboardEvent) => void
  /** fire even when focus is inside a text field */
  allowInInput?: boolean
}

function matches(event: KeyboardEvent, keys: string) {
  const parts = keys.toLowerCase().split("+")
  const key = parts.pop()
  const wantMod = parts.includes("mod")
  const wantAlt = parts.includes("alt")
  const wantShift = parts.includes("shift")
  return (
    event.key.toLowerCase() === key &&
    hasMod(event) === wantMod &&
    event.altKey === wantAlt &&
    event.shiftKey === wantShift
  )
}

function isEditable(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
}

/** Registers global shortcuts for the lifetime of the component. */
export function useShortcuts(shortcuts: Shortcut[], enabled = true) {
  const ref = useRef(shortcuts)
  ref.current = shortcuts
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      for (const shortcut of ref.current) {
        if (!matches(event, shortcut.keys)) continue
        if (!shortcut.allowInInput && isEditable(event.target)) continue
        event.preventDefault()
        shortcut.handler(event)
        return
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [enabled])
}
