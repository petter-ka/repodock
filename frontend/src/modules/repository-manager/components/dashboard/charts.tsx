// Small, dependency-free chart pieces for the dashboard. Marks carry colour;
// text always uses text tokens. Every chart card can switch to a table.
import { BarChart3, Table2 } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export type TableData = { columns: string[]; rows: Array<Array<string | number>> }

export function ChartCard({ title, hint, table, action, className, children }: {
  title: string
  hint?: string
  /** the same data as a table, for exact values and screen readers */
  table?: TableData
  action?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  const { t } = useI18n()
  const [asTable, setAsTable] = useState(false)
  return (
    <section className={cn("flex min-w-0 flex-col rounded-2xl border border-border bg-card p-5", className)}>
      <header className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {action}
        {table && table.rows.length > 0 && (
          <Tooltip label={asTable ? t.dashboard.chart : t.dashboard.table}>
            <Button size="icon-sm" variant="ghost" aria-pressed={asTable} aria-label={asTable ? t.dashboard.chart : t.dashboard.table} className="text-muted-foreground" onClick={() => setAsTable(!asTable)}>
              {asTable ? <BarChart3 /> : <Table2 />}
            </Button>
          </Tooltip>
        )}
      </header>
      {asTable && table ? <DataTable data={table} /> : children}
    </section>
  )
}

function DataTable({ data }: { data: TableData }) {
  return (
    <div className="thin-scrollbar overflow-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            {data.columns.map((column, i) => <th key={column} className={cn("py-1.5 pr-3 font-medium", i > 0 && "text-right")}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, r) => (
            <tr key={r} className="border-b border-border/60 last:border-0">
              {row.map((cell, i) => <td key={i} className={cn("py-1.5 pr-3", i > 0 && "text-right tabular-nums")}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function StatTile({ label, value, detail, icon, meter, tone = "default" }: {
  label: string
  value: React.ReactNode
  detail?: React.ReactNode
  icon: React.ReactNode
  /** 0…1 share drawn under the value */
  meter?: number
  tone?: "default" | "warning" | "success"
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-2xl border border-border bg-card px-4 py-3.5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={cn("[&_svg]:size-3.5", tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "")}>{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {meter !== undefined && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary/15" aria-hidden>
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round(Math.min(1, Math.max(0, meter)) * 100)}%` }} />
        </div>
      )}
      {detail && <div className="mt-1.5 truncate text-[0.6875rem] text-muted-foreground">{detail}</div>}
    </div>
  )
}

export type LegendItem = { label: string; color: string; hatched?: boolean; icon?: React.ReactNode }

export function Legend({ items, className }: { items: LegendItem[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground", className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className="size-2.5 shrink-0 rounded-[3px]" style={swatch(item.color, item.hatched)} />
          {item.icon}
          <span className="truncate">{item.label}</span>
        </li>
      ))}
    </ul>
  )
}

/** Fill for a mark; hatched marks use a 45° texture of the colour. */
export function swatch(color: string, hatched = false): React.CSSProperties {
  return hatched
    ? { backgroundImage: `repeating-linear-gradient(135deg, ${color} 0 2px, color-mix(in oklab, ${color} 25%, transparent) 2px 5px)` }
    : { backgroundColor: color }
}

export type Segment = { key: string; value: number; color: string; hatched?: boolean; label: string }
export type BarRow = { key: string; label: React.ReactNode; marker?: string; segments: Segment[]; onClick?: () => void }

/**
 * Horizontal bars from a shared baseline, optionally stacked. Bars are
 * scaled to the largest row; the total sits at the tip.
 */
export function StackedBars({ rows, format = String }: { rows: BarRow[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((row) => row.segments.reduce((n, s) => n + s.value, 0)))
  return (
    <ul className="grid gap-2.5">
      {rows.map((row) => {
        const total = row.segments.reduce((n, s) => n + s.value, 0)
        const visible = row.segments.filter((s) => s.value > 0)
        return (
          <li key={row.key} className="grid grid-cols-[minmax(0,8.5rem)_1fr] items-center gap-3">
            <button
              type="button"
              disabled={!row.onClick}
              onClick={row.onClick}
              className="flex min-w-0 items-center gap-2 rounded text-left text-xs outline-none enabled:hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
            >
              {row.marker && <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: row.marker }} />}
              <span className="truncate font-medium">{row.label}</span>
            </button>
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-3.5 min-w-0 gap-[2px]" style={{ width: `${(total / max) * 100}%` }}>
                {visible.map((segment, i) => (
                  <Tooltip key={segment.key} label={<span className="tabular-nums">{segment.label}: <strong>{format(segment.value)}</strong></span>}>
                    <span
                      className={cn("h-full min-w-[3px] transition-opacity hover:opacity-80", i === visible.length - 1 && "rounded-r-[4px]")}
                      style={{ flexGrow: segment.value, flexBasis: 0, ...swatch(segment.color, segment.hatched) }}
                    />
                  </Tooltip>
                ))}
              </div>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{format(total)}</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** A ring split into categories, total in the middle, 2px gaps between arcs. */
export function Donut({ items, total, caption }: { items: Array<{ key: string; label: string; value: number; color: string }>; total: number; caption: string }) {
  const size = 148
  const stroke = 18
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const sum = items.reduce((n, item) => n + item.value, 0) || 1
  const gap = items.length > 1 ? 3 : 0
  let offset = 0
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={`${caption}: ${items.map((i) => `${i.label} ${i.value}`).join(", ")}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
        {items.map((item) => {
          const length = (item.value / sum) * c
          const dash = Math.max(1, length - gap)
          const circle = (
            <circle
              key={item.key}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={item.color}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
              className="transition-opacity hover:opacity-80"
            />
          )
          offset += length
          return (
            <Tooltip key={item.key} label={<span className="tabular-nums">{item.label}: <strong>{item.value}</strong> ({Math.round((item.value / sum) * 100)}%)</span>}>
              {circle}
            </Tooltip>
          )
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tabular-nums">{total}</span>
        <span className="text-[0.6875rem] text-muted-foreground">{caption}</span>
      </div>
    </div>
  )
}

/** Ranked single-series bars with the value at the tip. */
export function BarList({ items }: { items: Array<{ key: string; label: string; value: number; muted?: boolean }> }) {
  const max = Math.max(1, ...items.map((item) => item.value))
  return (
    <ul className="grid gap-2">
      {items.map((item) => (
        <li key={item.key} className="grid grid-cols-[minmax(0,7rem)_1fr] items-center gap-3 text-xs">
          <span className={cn("truncate", item.muted ? "text-muted-foreground" : "font-medium")}>{item.label}</span>
          <div className="flex items-center gap-2">
            <span className={cn("h-3 rounded-r-[4px]", item.muted ? "bg-[var(--series-other)]" : "bg-primary")} style={{ width: `${(item.value / max) * 100}%`, minWidth: 3 }} />
            <span className="tabular-nums text-muted-foreground">{item.value}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}
