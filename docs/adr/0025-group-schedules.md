# ADR-0025: Start and stop groups on their own schedules, with a countdown before stops

- Status: Accepted
- Date: 2026-10-19

## Context

Users start the same groups every working morning and forget dev servers running overnight and over weekends. They asked for set start and stop times, for which days they apply (weekdays, weekends, every day, or custom), and for a warning with a countdown before a stop so work in progress is not cut off.

## Decision

- **Every group has its own `schedule`**, so groups can run at different times, or have none at all:
  - `days` (0 = Sunday … 6 = Saturday), `startEnabled`/`startAt` and `stopEnabled`/`stopAt` (`"HH:MM"`, local time). Start and stop are independent: either or both may be on, and both apply on the same days. The times of a switched-off part are kept, so switching it back on restores them.
  - Validation: known weekdays, valid times for enabled parts, at least one day when anything is on, start ≠ stop.
- **Setting schedules for several groups at once.** `SetGroupSchedules(groupIDs, schedule)` copies one schedule to every listed group. Each group keeps its own copy, edited separately later; groups not listed are untouched. At least one group is required.
  - (A single workspace-wide schedule with a group selection was tried first. It could not give groups different times, so it was replaced the same day.)
- A new `schedule` module owns timing (Go is the source of truth). It depends on `domain` only; the app facade supplies the groups, a per-group live-process count and the start/stop actions through a `Host` interface. It ticks every 5 s:
  - **start** — at `startAt` on a scheduled day, runs the group ("Run group", honouring its run mode and skips) unless it already has live processes;
  - **stop** — at `stopAt`, stops the group (`StopGroup`: cancels the group run and stops every member process) if anything runs;
  - a time is only acted on while RepoDock is running and at most 10 minutes late (e.g. after sleep); times before RepoDock started never fire.
- **Countdown.** A stop of a group with live processes is announced 30 minutes ahead: `schedule:pending` carries every announced stop (`ScheduledStop { groupId, groupName, stopAt, postponed, running }`) whenever the list changes; `ScheduledStops()` returns it. Idle groups are neither announced nor stopped.
  - `PostponeScheduledStop(groupID, minutes)` moves the announced stop (from its current time; 1–720 minutes; repeatable).
  - `SkipScheduledStop(groupID)` cancels this occurrence only; the next scheduled stop applies.
  - `StopScheduledNow(groupID)` stops at once and counts as this occurrence (it is done, not cancelled).
- **Cancelling ahead of time.** `SkipNextScheduled(groupID, "start"|"stop")` cancels the group's next start or stop however far ahead it is (within a week). `ResumeScheduled(groupID, kind)` takes the cancellation back. A cancelled stop is never announced.
- `ScheduleStatuses()` and the `schedule:status` event report each scheduled group's next start and stop: `GroupScheduleStatus { groupId, nextStart, startSkipped, nextStop, stopSkipped, stopPostponed }`. A zero time means none within a week. The frontend shows only what the backend reports.
  - Overrides live in memory and are forgotten when the schedule is edited.
- `schedule:fired` (`ScheduleEvent { groupId, groupName, action: started|stopped, error }`) reports every action so the frontend can notify.
- UI:
  - The schedule dialog starts with **Apply to**: every group as a row with a checkbox and its current schedule ("Weekdays · starts 09:00 · stops 18:00" / "No schedule"), plus All/None.
    - Opened from the sidebar header ("Set schedule…") or the dashboard's week card, every group is ticked: the setup-everything case.
    - Opened from a group's menu, its clock or its dashboard card, only that group is ticked and its own settings are loaded.
    - Ticked groups that share a schedule load it; otherwise the draft starts at weekdays 09:00–18:00 with start and stop on.
    - An amber note names the ticked groups whose different schedule would be replaced.
    - "Save for N group(s)" saves the settings; "Turn off for these" switches off only the ticked groups.
  - The rest of the dialog: day presets (Every day / Weekdays / Weekends / Custom) and per-day toggles; start and stop switches with time inputs; a 24-hour preview strip (running window, countdown zone, now); the next start/stop with relative time.
  - The sidebar header clock shows "N of M groups scheduled". Its menu cancels or restores the next start/stop of **every** scheduled group (`groupID` "") and offers "Set schedule…".
  - A clock on each scheduled group offers the same for that group only, plus "Edit schedule…".
  - The countdown is a dialog with a ring and mm:ss.
    - Groups stopping at the same time are shown together ("2 groups stop"). Postpone (+15/+30/+60 min), "Cancel this stop" and "Stop now" act on all of them; each group has its own "Keep running".
    - A group whose stop was postponed is listed separately.
    - "Hide" turns it into a pill in the corner; it comes back by itself at 5 minutes and at 1 minute left.
  - The clock on a scheduled group's sidebar header opens a menu: "Cancel next start · Tomorrow 09:00", "Cancel next stop · Today 18:00" (or "Restore …" once cancelled) and "Edit schedule…". The clock turns amber and crossed-out while something is cancelled.
  - Each dashboard group card shows the next start and stop as chips, each with a small × to cancel it for that group, or Undo once cancelled. The week chart draws every group's own window in its colour.

## Alternatives considered

- **Cron expressions**: powerful but hostile for "weekdays 9 to 6".
- **OS-level scheduling (launchd/Task Scheduler) to start RepoDock itself**: out of scope; schedules act while RepoDock is open, which the dialog states.
- **Stopping without warning**: rejected; losing a debugging session to a timer is worse than a dev server running overnight.

## Consequences

- Additive field; older files load with no schedules.
- Postponements and skips do not survive a restart (the stop then happens at its scheduled time, still announced first).
- Start and stop are computed per day; an overnight window (start 22:00, stop 02:00) stops at 02:00 on each scheduled day.
