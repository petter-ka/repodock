import { Maximize2, Minimize2, X } from "lucide-react"
import { useEffect, useId, useRef } from "react"
import type { LucideIcon } from "lucide-react"
import { hasMod } from "@/lib/keyboard"
import { cn } from "@/lib/utils"

/** How much of a window must stay on screen so it can always be dragged back. */
const KEEP_VISIBLE = 80
const TITLE_HEIGHT = 36

const MARGIN = 8
const MIN_WIDTH = 420
const MIN_HEIGHT = 280

/** Keeps a resizable window between its minimum size and the viewport. */
export function clampSize(width: number, height: number) {
  return {
    width: Math.round(Math.max(Math.min(MIN_WIDTH, window.innerWidth - 2 * MARGIN), Math.min(window.innerWidth - 2 * MARGIN, width))),
    height: Math.round(Math.max(Math.min(MIN_HEIGHT, window.innerHeight - 2 * MARGIN), Math.min(window.innerHeight - 2 * MARGIN, height))),
  }
}

export function clampPosition(x: number, y: number, width: number) {
  const maxX = Math.max(0, window.innerWidth - KEEP_VISIBLE)
  const maxY = Math.max(0, window.innerHeight - TITLE_HEIGHT)
  return { x: Math.min(maxX, Math.max(KEEP_VISIBLE - width, x)), y: Math.min(maxY, Math.max(0, y)) }
}

type Size = { width: number; height: number }

/**
 * Non-modal floating window: no overlay, the rest of the app stays usable.
 * Drag it by the title bar (pointer), or move it with Alt+arrow keys while
 * focus is inside. Esc closes it. Pointer-down brings it to the front.
 * A resizable window (`resize` set) also resizes from its corner or with
 * Alt+Mod+arrow keys, and maximizes from its title bar (button or
 * double-click).
 */
export function FloatingWindow({ title, icon: Icon, width: baseWidth, height, position, zIndex, closeLabel, resize, onMove, onFocus, onClose, children }: {
  title: string
  icon: LucideIcon
  width: number
  /** fixed height; content-sized when omitted */
  height?: number
  position: { x: number; y: number }
  zIndex: number
  closeLabel: string
  resize?: {
    maximized: boolean
    labels: { maximize: string; restore: string; resize: string }
    onResize: (size: Size, persist: boolean) => void
    onToggleMaximized: () => void
  }
  onMove: (position: { x: number; y: number }, persist: boolean) => void
  onFocus: () => void
  onClose: () => void
  children: React.ReactNode
}) {
  const titleId = useId()
  const ref = useRef<HTMLElement>(null)
  const maximized = resize?.maximized ?? false
  const size = resize && height !== undefined ? clampSize(baseWidth, height) : null
  const width = size?.width ?? baseWidth

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

  const startResize = (event: React.PointerEvent<HTMLElement>) => {
    if (!resize || !size || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    const start = { x: event.clientX, y: event.clientY }
    let latest = size
    const move = (e: PointerEvent) => {
      latest = clampSize(size.width + e.clientX - start.x, size.height + e.clientY - start.y)
      resize.onResize(latest, false)
    }
    const up = () => {
      handle.removeEventListener("pointermove", move)
      handle.removeEventListener("pointerup", up)
      handle.removeEventListener("pointercancel", up)
      resize.onResize(latest, true)
    }
    handle.addEventListener("pointermove", move)
    handle.addEventListener("pointerup", up)
    handle.addEventListener("pointercancel", up)
  }

  const startDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (maximized || event.button !== 0 || (event.target as HTMLElement).closest("button")) return
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
      style={maximized
        ? { left: MARGIN, top: MARGIN, width: `calc(100vw - ${2 * MARGIN}px)`, height: `calc(100vh - ${2 * MARGIN}px)`, zIndex }
        : { left: position.x, top: position.y, width, height: size?.height ?? height, zIndex }}
      onPointerDownCapture={onFocus}
      onFocusCapture={onFocus}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); onClose() }
        if (event.altKey && event.key.startsWith("Arrow") && hasMod(event)) {
          if (!resize || !size || maximized) return
          event.preventDefault()
          const step = event.shiftKey ? 64 : 16
          const dw = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0
          const dh = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0
          resize.onResize(clampSize(size.width + dw, size.height + dh), true)
          return
        }
        if (event.altKey && event.key.startsWith("Arrow") && !maximized) {
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
        onDoubleClick={(event) => {
          if (resize && !(event.target as HTMLElement).closest("button")) resize.onToggleMaximized()
        }}
        className={cn("flex h-9 shrink-0 select-none items-center gap-2 border-b border-border bg-muted/50 pl-3 pr-1", !maximized && "cursor-grab active:cursor-grabbing")}
      >
        <Icon className="size-4 text-muted-foreground" />
        <h2 id={titleId} className="flex-1 truncate text-xs font-semibold">{title}</h2>
        {resize && (
          <button
            aria-label={maximized ? resize.labels.restore : resize.labels.maximize}
            title={maximized ? resize.labels.restore : resize.labels.maximize}
            onClick={resize.onToggleMaximized}
            className="rounded-md p-1 text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {maximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </button>
        )}
        <button
          aria-label={closeLabel}
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" />
        </button>
      </header>
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">{children}</div>
      {resize && size && !maximized && (
        <div
          role="presentation"
          title={resize.labels.resize}
          onPointerDown={startResize}
          className="absolute bottom-0 right-0 z-10 size-4 cursor-nwse-resize touch-none bg-[linear-gradient(135deg,transparent_50%,var(--color-border)_50%,var(--color-border)_60%,transparent_60%,transparent_72%,var(--color-border)_72%,var(--color-border)_82%,transparent_82%)]"
        />
      )}
    </section>
  )
}
