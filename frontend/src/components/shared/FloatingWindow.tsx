import { X } from "lucide-react"
import { useEffect, useId, useRef } from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

/** How much of a window must stay on screen so it can always be dragged back. */
const KEEP_VISIBLE = 80
const TITLE_HEIGHT = 36

export function clampPosition(x: number, y: number, width: number) {
  const maxX = Math.max(0, window.innerWidth - KEEP_VISIBLE)
  const maxY = Math.max(0, window.innerHeight - TITLE_HEIGHT)
  return { x: Math.min(maxX, Math.max(KEEP_VISIBLE - width, x)), y: Math.min(maxY, Math.max(0, y)) }
}

/**
 * Non-modal floating window: no overlay, the rest of the app stays usable.
 * Drag it by the title bar (pointer), or move it with Alt+arrow keys while
 * focus is inside. Esc closes it. Pointer-down brings it to the front.
 */
export function FloatingWindow({ title, icon: Icon, width, position, zIndex, closeLabel, onMove, onFocus, onClose, children }: {
  title: string
  icon: LucideIcon
  width: number
  position: { x: number; y: number }
  zIndex: number
  closeLabel: string
  onMove: (position: { x: number; y: number }, persist: boolean) => void
  onFocus: () => void
  onClose: () => void
  children: React.ReactNode
}) {
  const titleId = useId()
  const ref = useRef<HTMLElement>(null)

  // Keep the window reachable when the app window shrinks.
  useEffect(() => {
    const reclamp = () => {
      const next = clampPosition(position.x, position.y, width)
      if (next.x !== position.x || next.y !== position.y) onMove(next, true)
    }
    reclamp()
    window.addEventListener("resize", reclamp)
    return () => window.removeEventListener("resize", reclamp)
  }, [position.x, position.y, width, onMove])

  const startDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const offsetX = event.clientX - position.x
    const offsetY = event.clientY - position.y
    let latest = position
    const move = (e: PointerEvent) => {
      latest = clampPosition(e.clientX - offsetX, e.clientY - offsetY, width)
      onMove(latest, false)
    }
    const up = () => {
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", up)
      handle.removeEventListener("pointercancel", up)
      onMove(latest, true)
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", up)
    handle.addEventListener("pointercancel", up)
  }

  return (
    <section
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      style={{ left: position.x, top: position.y, width, zIndex }}
      onPointerDownCapture={onFocus}
      onFocusCapture={onFocus}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); onClose() }
        if (event.altKey && event.key.startsWith("Arrow")) {
          event.preventDefault()
          const step = event.shiftKey ? 64 : 16
          const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0
          const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0
          onMove(clampPosition(position.x + dx, position.y + dy, width), true)
        }
      }}
      className="fixed flex max-h-[calc(100vh-16px)] flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xl ring-1 ring-black/5"
    >
      <header
        onPointerDown={startDrag}
        className={cn("flex h-9 shrink-0 cursor-grab select-none items-center gap-2 border-b border-border bg-muted/50 pl-3 pr-1 active:cursor-grabbing")}
      >
        <Icon className="size-4 text-muted-foreground" />
        <h2 id={titleId} className="flex-1 truncate text-xs font-semibold">{title}</h2>
        <button
          aria-label={closeLabel}
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" />
        </button>
      </header>
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">{children}</div>
    </section>
  )
}
