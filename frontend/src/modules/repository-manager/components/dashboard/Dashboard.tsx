import {
  Infinity as InfinityIcon, AlarmClock, AlertTriangle, Boxes, CheckCircle2, Clock, Columns3, FileCode2, FolderGit2, Layers, ListOrdered, Loader2, Play, SkipForward, Square,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { computeDashboard, managerColor, READINESS_ORDER, runningSpans, type GroupStats, type Readiness } from "../../dashboard"
import { displayName, type Workspace } from "../../domain"
import type { RepositoryActions } from "../../hooks/useRepositoryActions"
import { useProcessVersion } from "../../hooks/useStores"
import { DAY_ORDER, describeDays, weekdayName } from "../../schedule"
import { processStore } from "../../store/processStore"
import { workspaceStore } from "../../store/workspaceStore"
import { ScheduleDialog } from "../ScheduleDialog"
import { NextEventChip, upcomingEvents } from "../ScheduleNext"
import { useScheduleStatus } from "../../store/scheduleStore"
import { BarList, ChartCard, Donut, Legend, StackedBars, StatTile, swatch, type LegendItem } from "./charts"

/**
 * The big picture of the workspace, grouped: how ready each group is, what
 * it is built with, and when it runs by itself. Live process detail lives
 * in the "Processes & console" tab.
 */
export function Dashboard({ workspace, actions }: { workspace: Workspace; actions: RepositoryActions }) {
  const { t, f } = useI18n()
  const data = useMemo(() => computeDashboard(workspace), [workspace])
  const [scheduleGroupId, setScheduleGroupId] = useState<string | null>(null)
  const scheduleGroup = workspace.groups.find((g) => g.id === scheduleGroupId) ?? null
  const { totals } = data
  const percent = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0)

  const readiness: Record<Readiness, LegendItem> = {
    ready: { label: t.dashboard.hasSequence, color: "var(--primary)" },
    skipped: { label: t.dashboard.skipped, color: "var(--primary)", hatched: true },
    noSequence: { label: t.dashboard.noSequence, color: "var(--series-other)" },
    problem: { label: t.dashboard.problem, color: "var(--warning)", icon: <AlertTriangle className="size-3 text-warning" /> },
  }
  const managerLabel = (key: string) => key || t.dashboard.plainFolder

  return (
    <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto grid w-full max-w-[1400px] gap-4 p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile icon={<FolderGit2 />} label={t.dashboard.repositories} value={totals.repositories} />
          <StatTile icon={<Layers />} label={t.dashboard.groups} value={totals.groups} />
          <StatTile icon={<FileCode2 />} label={t.dashboard.scripts} value={totals.scripts} />
          <StatTile
            icon={<CheckCircle2 />}
            tone="success"
            label={t.dashboard.ready}
            value={<>{percent(totals.ready, totals.repositories)}<span className="text-base text-muted-foreground">%</span></>}
            meter={totals.repositories ? totals.ready / totals.repositories : 0}
            detail={f(t.dashboard.shareOf, { value: totals.ready, total: totals.repositories })}
          />
          <StatTile icon={<AlarmClock />} label={t.dashboard.scheduled} value={totals.scheduled} detail={f(t.dashboard.shareOf, { value: totals.scheduled, total: totals.groups })} />
          <StatTile icon={<AlertTriangle />} tone={totals.problems ? "warning" : "default"} label={t.dashboard.attention} value={totals.problems} detail={t.dashboard.attentionHint} />
        </div>

        <div className="grid gap-4 xl:grid-cols-5">
          <ChartCard
            className="xl:col-span-2"
            title={t.dashboard.perGroup}
            hint={t.dashboard.perGroupHint}
            table={{
              columns: [t.launch.group, ...READINESS_ORDER.map((key) => readiness[key].label)],
              rows: data.groups.map((g) => [g.group.name, ...READINESS_ORDER.map((key) => g.readiness[key])]),
            }}
          >
            <StackedBars
              rows={data.groups.map((g) => ({
                key: g.group.id,
                label: g.group.name,
                marker: g.color,
                segments: READINESS_ORDER.map((key) => ({ key, value: g.readiness[key], color: readiness[key].color, hatched: readiness[key].hatched, label: readiness[key].label })),
              }))}
            />
            <Legend className="pt-4" items={READINESS_ORDER.map((key) => readiness[key])} />
            <dl className="mt-auto grid grid-cols-2 gap-2 pt-5">
              {READINESS_ORDER.map((key) => {
                const count = data.groups.reduce((n, g) => n + g.readiness[key], 0)
                return (
                  <div key={key} className="rounded-lg bg-muted/50 px-3 py-2">
                    <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="size-2 shrink-0 rounded-[2px]" style={swatch(readiness[key].color, readiness[key].hatched)} />
                      <span className="truncate">{readiness[key].label}</span>
                    </dt>
                    <dd className="mt-0.5 text-lg font-semibold tabular-nums">
                      {count}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">{percent(count, totals.repositories)}%</span>
                    </dd>
                  </div>
                )
              })}
            </dl>
          </ChartCard>
          <WeekChart className="xl:col-span-3" groups={data.groups} onSchedule={setScheduleGroupId} />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <ChartCard
            title={t.dashboard.managers}
            table={{ columns: [t.dashboard.managers, t.dashboard.repositories], rows: data.managers.map((m) => [managerLabel(m.key), m.count]) }}
          >
            <div className="flex flex-1 items-center gap-5">
              <Donut
                total={totals.repositories}
                caption={t.dashboard.repositories.toLowerCase()}
                items={data.managers.map((m) => ({ key: m.key || "plain", label: managerLabel(m.key), value: m.count, color: managerColor[m.key] }))}
              />
              <ul className="grid min-w-0 gap-1.5 text-xs">
                {data.managers.map((m) => (
                  <li key={m.key || "plain"} className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: managerColor[m.key] }} />
                    <span className="truncate">{managerLabel(m.key)}</span>
                    <span className="ml-auto pl-3 tabular-nums text-muted-foreground">{m.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          </ChartCard>
          <ChartCard
            title={t.dashboard.stack}
            hint={t.dashboard.stackHint}
            table={{ columns: [t.dashboard.stack, t.dashboard.repositories], rows: data.stack.map((s) => [s.other ? t.dashboard.other : s.name, s.count]) }}
          >
            {data.stack.length ? (
              <BarList items={data.stack.map((s) => ({ key: s.name || "other", label: s.other ? t.dashboard.other : s.name, value: s.count, muted: s.other }))} />
            ) : (
              <p className="text-xs text-muted-foreground">{t.dashboard.noStack}</p>
            )}
          </ChartCard>
          <ChartCard
            title={t.dashboard.dependencies}
            table={{ columns: [t.launch.group, t.dashboard.deps, t.dashboard.devDeps], rows: data.groups.map((g) => [g.group.name, g.dependencies, g.devDependencies]) }}
          >
            <StackedBars
              rows={data.groups.map((g) => ({
                key: g.group.id,
                label: g.group.name,
                marker: g.color,
                segments: [
                  { key: "deps", value: g.dependencies, color: "var(--series-1)", label: t.dashboard.deps },
                  { key: "dev", value: g.devDependencies, color: "var(--series-3)", label: t.dashboard.devDeps },
                ],
              }))}
            />
            <Legend className="mt-auto pt-4" items={[{ label: t.dashboard.deps, color: "var(--series-1)" }, { label: t.dashboard.devDeps, color: "var(--series-3)" }]} />
          </ChartCard>
        </div>

        <section>
          <h2 className="mb-3 mt-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{t.dashboard.groupsTitle}</h2>
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {data.groups.map((stats) => <GroupCard key={stats.group.id} stats={stats} actions={actions} onSchedule={() => setScheduleGroupId(stats.group.id)} />)}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            {data.problems.length ? <AlertTriangle className="size-4 text-warning" /> : <CheckCircle2 className="size-4 text-success" />}
            {t.dashboard.issues}
          </h2>
          {data.problems.length === 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">{t.dashboard.noIssues}</p>
          ) : (
            <ul className="mt-3 grid gap-1.5">
              {data.problems.map((repo) => (
                <li key={repo.id} className="flex items-center gap-3 rounded-lg bg-warning/10 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{displayName(repo)}</span>
                    <span className="block truncate text-xs text-muted-foreground" title={repo.problem}>{repo.problem}</span>
                  </span>
                  <Button size="xs" variant="outline" onClick={() => workspaceStore.select(repo.id)}>{t.dashboard.open}</Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <ScheduleDialog group={scheduleGroup} actions={actions} onOpenChange={(open) => { if (!open) setScheduleGroupId(null) }} />
    </div>
  )
}

/**
 * Seven day rows on a 24-hour axis. Each scheduled group draws the hours it
 * runs by itself in its colour; a start without a stop fades out, a stop
 * without a start fades in. The current time is marked on today's row.
 */
function WeekChart({ groups, onSchedule, className }: { groups: GroupStats[]; onSchedule: (groupId: string) => void; className?: string }) {
  const { t, f, locale } = useI18n()
  const scheduled = groups.filter((g) => g.scheduled)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const pct = (minutes: number) => `${(minutes / 1440) * 100}%`
  const today = now.getDay()
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const describe = (g: GroupStats) => {
    const s = g.schedule
    const text = s.startEnabled && s.stopEnabled ? f(t.dashboard.allDay, { start: s.startAt, stop: s.stopAt })
      : s.startEnabled ? f(t.dashboard.startOnly, { start: s.startAt }) : f(t.dashboard.stopOnly, { stop: s.stopAt })
    return `${g.group.name} · ${text} · ${describeDays(s.days, t, locale)}`
  }

  return (
    <ChartCard
      className={className}
      title={t.dashboard.week}
      hint={t.dashboard.weekHint}
      table={{
        columns: [t.launch.group, t.schedule.days, t.schedule.start, t.schedule.stop],
        rows: scheduled.map((g) => [g.group.name, describeDays(g.schedule.days, t, locale), g.schedule.startEnabled ? g.schedule.startAt : "—", g.schedule.stopEnabled ? g.schedule.stopAt : "—"]),
      }}
    >
      {scheduled.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-10 text-center">
          <Clock className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t.dashboard.noSchedules}</p>
          {groups[0] && <Button size="sm" variant="outline" onClick={() => onSchedule(groups[0].group.id)}><AlarmClock /> {t.dashboard.setSchedule}</Button>}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[2.75rem_1fr] gap-x-2">
            <span />
            <div className="relative mb-1 h-3 text-[10px] tabular-nums text-muted-foreground">
              {[0, 6, 12, 18, 24].map((h) => (
                <span key={h} className={cn("absolute", h === 0 ? "" : h === 24 ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: pct(h * 60) }}>{String(h).padStart(2, "0")}</span>
              ))}
            </div>
            {DAY_ORDER.map((day) => {
              const isToday = day === today
              return (
                <div key={day} className="contents">
                  <span className={cn("flex items-center text-xs capitalize", isToday ? "font-semibold text-foreground" : "text-muted-foreground")}>{weekdayName(day, locale)}</span>
                  <div className={cn("relative grid gap-[2px] border-t border-border/70 py-1.5", isToday && "bg-primary/[0.04]")}>
                    {[6, 12, 18].map((h) => <span key={h} aria-hidden className="absolute inset-y-0 w-px bg-border/70" style={{ left: pct(h * 60) }} />)}
                    {scheduled.map((g) => {
                      const on = g.schedule.days.includes(day)
                      const fade = g.schedule.startEnabled !== g.schedule.stopEnabled
                      return (
                        <div key={g.group.id} className="relative h-2">
                          {on && runningSpans(g.schedule).map(([from, to], i) => (
                            <Tooltip key={i} label={describe(g)}>
                              <span
                                className="absolute inset-y-0 rounded-[3px] transition-opacity hover:opacity-80"
                                style={{
                                  left: pct(from),
                                  width: pct(to - from),
                                  background: fade
                                    ? `linear-gradient(to ${g.schedule.startEnabled ? "right" : "left"}, ${g.color} 0%, color-mix(in oklab, ${g.color} 15%, transparent) 100%)`
                                    : g.color,
                                }}
                              />
                            </Tooltip>
                          ))}
                        </div>
                      )
                    })}
                    {isToday && (
                      <span aria-hidden className="absolute -inset-y-px z-10 w-0.5 rounded-full bg-foreground" style={{ left: pct(nowMinutes) }} title={t.dashboard.now} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <ul className="mt-auto flex flex-wrap gap-x-4 gap-y-1.5 pt-4 text-xs text-muted-foreground">
            {scheduled.map((g) => (
              <li key={g.group.id}>
                <button onClick={() => onSchedule(g.group.id)} className="flex items-center gap-1.5 rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="size-2.5 rounded-[3px]" style={{ backgroundColor: g.color }} />
                  {g.group.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </ChartCard>
  )
}

function GroupCard({ stats, actions, onSchedule }: { stats: GroupStats; actions: RepositoryActions; onSchedule: () => void }) {
  const { t, f } = useI18n()
  const version = useProcessVersion()
  const { group, repos, readiness, color, scheduled } = stats
  const { running, groupRun } = useMemo(() => {
    void version
    return { running: repos.reduce((n, repo) => n + processStore.activeCount(repo.id), 0), groupRun: processStore.groupRun(group.id) }
  }, [version, repos, group.id])
  const runningGroup = groupRun?.status === "running"
  const active = runningGroup || running > 0
  const skipped = new Set(group.skippedRepositoryIds ?? [])
  const events = upcomingEvents(useScheduleStatus(group.id))
  const total = repos.length

  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <header className="flex items-start gap-3">
        <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold">{group.name}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{f(t.dashboard.members, { count: total })}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              {group.runMode === "parallel" ? <Columns3 className="size-3" /> : <ListOrdered className="size-3" />}
              {group.runMode === "parallel" ? t.groupRun.parallel : t.groupRun.sequential}
            </span>
            {skipped.size > 0 && <><span aria-hidden>·</span><span className="inline-flex items-center gap-1"><SkipForward className="size-3" />{f(t.skip.count, { count: skipped.size })}</span></>}
          </p>
        </div>
        {running > 0 && <Badge variant="success" className="tabular-nums">{f(t.dashboard.running, { count: running })}</Badge>}
        {total > 0 && (active ? (
          <Tooltip label={t.groupRun.stop}>
            <Button size="icon-sm" variant="outline" aria-label={t.groupRun.stop} className="text-destructive" onClick={() => void actions.stopGroup(group.id)}>
              {runningGroup ? <Loader2 className="animate-spin" /> : <Square />}
            </Button>
          </Tooltip>
        ) : (
          <Tooltip label={t.groupRun.run}>
            <Button size="icon-sm" variant="outline" aria-label={t.groupRun.run} className="text-success" onClick={() => void actions.runGroup(group.id)}><Play /></Button>
          </Tooltip>
        ))}
      </header>

      {total > 0 ? (
        <div className="flex h-2 gap-[2px]" aria-hidden>
          {READINESS_ORDER.filter((key) => readiness[key] > 0).map((key, i, all) => (
            <span
              key={key}
              className={cn("h-full", i === all.length - 1 && "rounded-r-[4px]")}
              style={{
                flexGrow: readiness[key],
                ...swatch(key === "problem" ? "var(--warning)" : key === "noSequence" ? "var(--series-other)" : "var(--primary)", key === "skipped"),
              }}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t.dashboard.emptyGroup}</p>
      )}

      {total > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {repos.map((repo) => {
            const isSkipped = skipped.has(repo.id)
            return (
              <li key={repo.id}>
                <button
                  onClick={() => workspaceStore.select(repo.id)}
                  title={[repo.path, isSkipped ? t.skip.skipped : "", repo.continuous ? t.continuous.marker : "", repo.problem].filter(Boolean).join("\n")}
                  className={cn(
                    "flex max-w-52 items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs outline-none transition hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                    isSkipped && "border-dashed text-muted-foreground",
                  )}
                >
                  {repo.problem ? <AlertTriangle className="size-3 shrink-0 text-warning" />
                    : isSkipped ? <SkipForward className="size-3 shrink-0" />
                      : processStore.activeCount(repo.id) > 0 ? <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-success" />
                        : <Boxes className="size-3 shrink-0 text-muted-foreground" />}
                  <span className="truncate">{displayName(repo)}</span>
                  {repo.continuous && <InfinityIcon className="size-3 shrink-0 text-muted-foreground" aria-label={t.continuous.marker} />}
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{repo.packageManager || t.sidebar.folder}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <footer className="mt-auto flex items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
        <AlarmClock className={cn("size-3.5 shrink-0", scheduled && "text-primary")} />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {!scheduled ? t.dashboard.noSchedule
            : events.length === 0 ? t.schedule.nextNothing
              : events.map((event) => <NextEventChip key={event.kind} group={group} {...event} actions={actions} />)}
        </div>
        <Button size="xs" variant="ghost" onClick={onSchedule}>{scheduled ? t.schedule.menu : t.dashboard.setSchedule}</Button>
      </footer>
      {groupRun && !runningGroup && (
        <p className="-mt-1 text-[11px] text-muted-foreground">{f(t.dashboard.lastRun, { status: t.groupRun.status[groupRun.status] })}</p>
      )}
    </article>
  )
}
