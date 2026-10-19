// Package schedule starts and stops groups at the times their schedules set
// (ADR-0025). A scheduled stop of a running group is announced WarningLead
// ahead so the user can postpone or skip it. It depends on domain only; the
// app facade supplies the groups and the start/stop actions through Host.
package schedule

import (
	"fmt"
	"log/slog"
	"sort"
	"sync"
	"time"

	"github.com/example/repodock/internal/domain"
)

// Events emitted to the frontend.
const (
	// EventPending carries every announced stop ([]domain.ScheduledStop)
	// whenever that list changes.
	EventPending = "schedule:pending"
	// EventFired carries a domain.ScheduleEvent when a schedule acted.
	EventFired = "schedule:fired"
	// EventStatus carries every scheduled group's next start and stop
	// ([]domain.GroupScheduleStatus) whenever they change.
	EventStatus = "schedule:status"
)

// Kinds of scheduled action, for SkipNext and Resume.
const (
	KindStart = "start"
	KindStop  = "stop"
)

// horizon is how far ahead the next start or stop is looked for.
const horizon = 8 * 24 * time.Hour

// WarningLead is how long before a scheduled stop the countdown appears.
const WarningLead = 30 * time.Minute

// lateLimit bounds how late a missed time (e.g. after the computer slept)
// still fires. Times before RepoDock started never fire.
const lateLimit = 10 * time.Minute

// MaxPostpone bounds one postponement.
const MaxPostpone = 12 * 60

// Host is what the scheduler acts on.
type Host interface {
	Groups() []domain.Group
	// Running counts the live processes of a group's members, including a
	// group run in progress.
	Running(groupID string) int
	StartGroup(groupID string) error
	StopGroup(groupID string) error
}

// override replaces one scheduled stop (identified by its scheduled time).
type override struct {
	occurrence time.Time
	stopAt     time.Time
	// skipped: the user cancelled the stop; done: it happened early ("Stop
	// now"). Either way the scheduled time does nothing.
	skipped bool
	done    bool
}

type Scheduler struct {
	host Host
	now  func() time.Time

	mu        sync.Mutex
	emitter   func(string, any)
	last      time.Time
	overrides map[string]override
	// startSkips holds, per group, the scheduled start the user cancelled.
	startSkips map[string]time.Time
	pending    []domain.ScheduledStop
	statuses   []domain.GroupScheduleStatus
	quit       chan struct{}
	done       chan struct{}
}

// New creates a scheduler; now is the clock (time.Now outside tests).
func New(host Host, now func() time.Time) *Scheduler {
	if now == nil {
		now = time.Now
	}
	return &Scheduler{
		host: host, now: now, overrides: map[string]override{}, startSkips: map[string]time.Time{},
		pending: []domain.ScheduledStop{}, statuses: []domain.GroupScheduleStatus{},
	}
}

func (s *Scheduler) SetEmitter(emit func(string, any)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.emitter = emit
}

// Start evaluates the schedules every interval until Stop. Only times after
// Start fire.
func (s *Scheduler) Start(interval time.Duration) {
	s.mu.Lock()
	if s.quit != nil {
		s.mu.Unlock()
		return
	}
	s.last = s.now()
	s.quit, s.done = make(chan struct{}), make(chan struct{})
	quit, done := s.quit, s.done
	s.mu.Unlock()

	go func() {
		defer close(done)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		s.Tick()
		for {
			select {
			case <-quit:
				return
			case <-ticker.C:
				s.Tick()
			}
		}
	}()
}

// Stop ends the loop started by Start and waits for it.
func (s *Scheduler) Stop() {
	s.mu.Lock()
	quit, done := s.quit, s.done
	s.quit = nil
	s.mu.Unlock()
	if quit != nil {
		close(quit)
		<-done
	}
}

// Tick fires every start and stop due since the previous tick and refreshes
// the announced stops.
func (s *Scheduler) Tick() {
	now := s.now()
	s.mu.Lock()
	from := s.last
	if from.IsZero() || now.Sub(from) > 24*time.Hour {
		from = now
	}
	s.last = now
	for id, ov := range s.overrides {
		if now.Sub(ov.occurrence) > 24*time.Hour && now.Sub(ov.stopAt) > 24*time.Hour {
			delete(s.overrides, id)
		}
	}
	for id, at := range s.startSkips {
		if now.Sub(at) > 24*time.Hour {
			delete(s.startSkips, id)
		}
	}
	s.mu.Unlock()

	for _, group := range s.host.Groups() {
		if !group.Schedule.Active() {
			continue
		}
		s.fireStarts(group, from, now)
		s.fireStops(group, from, now)
	}
	s.refresh(now)
}

func (s *Scheduler) fireStarts(group domain.Group, from, now time.Time) {
	if !group.Schedule.StartEnabled {
		return
	}
	s.mu.Lock()
	skip := s.startSkips[group.ID]
	s.mu.Unlock()
	for _, at := range Occurrences(group.Schedule, group.Schedule.StartAt, from, now) {
		if at.Equal(skip) || now.Sub(at) > lateLimit || s.host.Running(group.ID) > 0 {
			continue
		}
		event := domain.ScheduleEvent{GroupID: group.ID, GroupName: group.Name, Action: "started"}
		if err := s.host.StartGroup(group.ID); err != nil {
			event.Error = err.Error()
		}
		slog.Info("scheduled group start", "groupId", group.ID, "error", event.Error)
		s.emit(EventFired, event)
	}
}

func (s *Scheduler) fireStops(group domain.Group, from, now time.Time) {
	if !group.Schedule.StopEnabled {
		return
	}
	s.mu.Lock()
	ov, has := s.overrides[group.ID]
	s.mu.Unlock()
	due := false
	for _, at := range Occurrences(group.Schedule, group.Schedule.StopAt, from, now) {
		if has && ov.occurrence.Equal(at) {
			continue // postponed, skipped or done
		}
		due = due || now.Sub(at) <= lateLimit
	}
	if has && !ov.skipped && !ov.done && inWindow(ov.stopAt, from, now) {
		due = true
	}
	if due && s.host.Running(group.ID) > 0 {
		s.stop(group)
	}
}

func (s *Scheduler) stop(group domain.Group) {
	event := domain.ScheduleEvent{GroupID: group.ID, GroupName: group.Name, Action: "stopped"}
	if err := s.host.StopGroup(group.ID); err != nil {
		event.Error = err.Error()
	}
	slog.Info("scheduled group stop", "groupId", group.ID, "error", event.Error)
	s.emit(EventFired, event)
}

// Pending returns the announced stops, soonest first.
func (s *Scheduler) Pending() []domain.ScheduledStop {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]domain.ScheduledStop{}, s.pending...)
}

// Statuses returns the next start and stop of every scheduled group.
func (s *Scheduler) Statuses() []domain.GroupScheduleStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]domain.GroupScheduleStatus{}, s.statuses...)
}

// Refresh re-evaluates the announced stops now (after a schedule changed or
// a group started or stopped).
func (s *Scheduler) Refresh() { s.refresh(s.now()) }

// Reset forgets the groups' postponed, cancelled or early stops and
// cancelled starts, e.g. after their schedules were edited.
func (s *Scheduler) Reset(groupIDs ...string) {
	s.mu.Lock()
	for _, id := range groupIDs {
		delete(s.overrides, id)
		delete(s.startSkips, id)
	}
	s.mu.Unlock()
	s.Refresh()
}

// forEachScheduled applies fn to every group with an active schedule. It
// fails only when it failed for every group.
func (s *Scheduler) forEachScheduled(fn func(groupID string) error) error {
	var last error
	done := 0
	for _, group := range s.host.Groups() {
		if !group.Schedule.Active() {
			continue
		}
		if err := fn(group.ID); err != nil {
			last = err
			continue
		}
		done++
	}
	if done == 0 {
		if last == nil {
			last = fmt.Errorf("no group has a schedule")
		}
		return last
	}
	return nil
}

// Postpone moves the group's announced stop by minutes.
func (s *Scheduler) Postpone(groupID string, minutes int) error {
	if minutes <= 0 || minutes > MaxPostpone {
		return fmt.Errorf("postpone by 1 to %d minutes", MaxPostpone)
	}
	now := s.now()
	stop, occurrence, ok := s.announced(groupID, now)
	if !ok {
		return fmt.Errorf("no scheduled stop is coming up for this group")
	}
	s.mu.Lock()
	s.overrides[groupID] = override{occurrence: occurrence, stopAt: stop.StopAt.Add(time.Duration(minutes) * time.Minute)}
	s.mu.Unlock()
	s.refresh(now)
	return nil
}

// Skip cancels the group's next stop; the schedule resumes with the one
// after it.
func (s *Scheduler) Skip(groupID string) error { return s.SkipNext(groupID, KindStop) }

// SkipNext cancels the group's next scheduled start or stop (kind), however
// far ahead it is (within a week). The schedule resumes with the one after.
// An empty groupID cancels it for every scheduled group.
func (s *Scheduler) SkipNext(groupID, kind string) error {
	if groupID == "" {
		return s.forEachScheduled(func(id string) error { return s.SkipNext(id, kind) })
	}
	now := s.now()
	group, ok := s.group(groupID)
	if !ok {
		return fmt.Errorf("group not found: %s", groupID)
	}
	switch kind {
	case KindStart:
		at, _, ok := s.upcomingStart(group, now)
		if !ok {
			return fmt.Errorf("no scheduled start is coming up for this group")
		}
		s.mu.Lock()
		s.startSkips[groupID] = at
		s.mu.Unlock()
	case KindStop:
		_, occurrence, _, _, ok := s.upcomingStop(group, now)
		if !ok {
			return fmt.Errorf("no scheduled stop is coming up for this group")
		}
		s.mu.Lock()
		s.overrides[groupID] = override{occurrence: occurrence, skipped: true}
		s.mu.Unlock()
	default:
		return fmt.Errorf("unknown schedule action %q", kind)
	}
	s.refresh(now)
	return nil
}

// Resume takes back a cancelled start or stop (kind) of the group; an empty
// groupID takes it back for every group.
func (s *Scheduler) Resume(groupID, kind string) error {
	if groupID == "" {
		return s.forEachScheduled(func(id string) error { return s.Resume(id, kind) })
	}
	switch kind {
	case KindStart:
		s.mu.Lock()
		delete(s.startSkips, groupID)
		s.mu.Unlock()
	case KindStop:
		s.mu.Lock()
		if ov, ok := s.overrides[groupID]; ok && ov.skipped {
			delete(s.overrides, groupID)
		}
		s.mu.Unlock()
	default:
		return fmt.Errorf("unknown schedule action %q", kind)
	}
	s.Refresh()
	return nil
}

// StopNow stops the group immediately instead of waiting for its announced
// stop, which is then considered done.
func (s *Scheduler) StopNow(groupID string) error {
	now := s.now()
	stop, occurrence, ok := s.announced(groupID, now)
	if !ok {
		return fmt.Errorf("no scheduled stop is coming up for this group")
	}
	s.mu.Lock()
	s.overrides[groupID] = override{occurrence: occurrence, done: true}
	s.mu.Unlock()
	err := s.host.StopGroup(groupID)
	s.emit(EventFired, domain.ScheduleEvent{GroupID: groupID, GroupName: stop.GroupName, Action: "stopped", Error: errorText(err)})
	s.refresh(now)
	return err
}

func (s *Scheduler) group(groupID string) (domain.Group, bool) {
	for _, group := range s.host.Groups() {
		if group.ID == groupID {
			return group, true
		}
	}
	return domain.Group{}, false
}

// announced finds the group's stop within WarningLead and the scheduled
// time that identifies it.
func (s *Scheduler) announced(groupID string, now time.Time) (domain.ScheduledStop, time.Time, bool) {
	group, ok := s.group(groupID)
	if !ok {
		return domain.ScheduledStop{}, time.Time{}, false
	}
	return s.nextStop(group, now)
}

// upcomingStart is the group's next scheduled start and whether the user
// cancelled it.
func (s *Scheduler) upcomingStart(group domain.Group, now time.Time) (at time.Time, skipped, ok bool) {
	if !group.Schedule.Active() || !group.Schedule.StartEnabled {
		return time.Time{}, false, false
	}
	// A start at this very moment is due now, not next.
	next := Occurrences(group.Schedule, group.Schedule.StartAt, now, now.Add(horizon))
	if len(next) == 0 {
		return time.Time{}, false, false
	}
	s.mu.Lock()
	skipped = s.startSkips[group.ID].Equal(next[0])
	s.mu.Unlock()
	return next[0], skipped, true
}

// upcomingStop is the group's next stop: a postponed one, or the next
// scheduled time not already done early. occurrence is the scheduled time
// that identifies it; skipped means the user cancelled it.
func (s *Scheduler) upcomingStop(group domain.Group, now time.Time) (at, occurrence time.Time, postponed, skipped, ok bool) {
	s.mu.Lock()
	ov, has := s.overrides[group.ID]
	s.mu.Unlock()
	if has && !ov.skipped && !ov.done && !ov.stopAt.Before(now) {
		return ov.stopAt, ov.occurrence, true, false, true
	}
	if !group.Schedule.Active() || !group.Schedule.StopEnabled {
		return time.Time{}, time.Time{}, false, false, false
	}
	for _, at := range Occurrences(group.Schedule, group.Schedule.StopAt, now.Add(-time.Second), now.Add(horizon)) {
		if has && ov.occurrence.Equal(at) {
			if ov.skipped {
				return at, at, false, true, true
			}
			continue // done early, or postponed and already past
		}
		return at, at, false, false, true
	}
	return time.Time{}, time.Time{}, false, false, false
}

// nextStop is the group's next stop if it will happen and is at most
// WarningLead away, regardless of whether anything is running.
func (s *Scheduler) nextStop(group domain.Group, now time.Time) (domain.ScheduledStop, time.Time, bool) {
	at, occurrence, postponed, skipped, ok := s.upcomingStop(group, now)
	if !ok || skipped || at.Sub(now) > WarningLead {
		return domain.ScheduledStop{}, time.Time{}, false
	}
	return domain.ScheduledStop{GroupID: group.ID, GroupName: group.Name, StopAt: at, Postponed: postponed}, occurrence, true
}

func (s *Scheduler) refresh(now time.Time) {
	pending := []domain.ScheduledStop{}
	statuses := []domain.GroupScheduleStatus{}
	for _, group := range s.host.Groups() {
		status := domain.GroupScheduleStatus{GroupID: group.ID}
		hasStart, hasStop := false, false
		status.NextStart, status.StartSkipped, hasStart = s.upcomingStart(group, now)
		status.NextStop, _, status.StopPostponed, status.StopSkipped, hasStop = s.upcomingStop(group, now)
		if hasStart || hasStop {
			statuses = append(statuses, status)
		}

		stop, _, ok := s.nextStop(group, now)
		if !ok {
			continue
		}
		if stop.Running = s.host.Running(group.ID); stop.Running == 0 {
			continue // nothing to stop, nothing to announce
		}
		pending = append(pending, stop)
	}
	sort.SliceStable(pending, func(i, j int) bool { return pending[i].StopAt.Before(pending[j].StopAt) })

	s.mu.Lock()
	changed := !samePending(s.pending, pending)
	statusChanged := !sameStatuses(s.statuses, statuses)
	s.pending = pending
	s.statuses = statuses
	s.mu.Unlock()
	if changed {
		s.emit(EventPending, append([]domain.ScheduledStop{}, pending...))
	}
	if statusChanged {
		s.emit(EventStatus, append([]domain.GroupScheduleStatus{}, statuses...))
	}
}

func sameStatuses(a, b []domain.GroupScheduleStatus) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		x, y := a[i], b[i]
		if x.GroupID != y.GroupID || !x.NextStart.Equal(y.NextStart) || !x.NextStop.Equal(y.NextStop) ||
			x.StartSkipped != y.StartSkipped || x.StopSkipped != y.StopSkipped || x.StopPostponed != y.StopPostponed {
			return false
		}
	}
	return true
}

func samePending(a, b []domain.ScheduledStop) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i].GroupID != b[i].GroupID || !a[i].StopAt.Equal(b[i].StopAt) || a[i].Running != b[i].Running || a[i].GroupName != b[i].GroupName {
			return false
		}
	}
	return true
}

func (s *Scheduler) emit(event string, payload any) {
	s.mu.Lock()
	emitter := s.emitter
	s.mu.Unlock()
	if emitter != nil {
		emitter(event, payload)
	}
}

// Occurrences lists the times in (from, to] at which clock ("HH:MM", local
// to from's location) falls on one of the schedule's days.
func Occurrences(schedule domain.GroupSchedule, clock string, from, to time.Time) []time.Time {
	hour, minute, ok := domain.ParseClock(clock)
	if !ok || !to.After(from) {
		return nil
	}
	days := map[time.Weekday]bool{}
	for _, d := range schedule.Days {
		days[time.Weekday(d)] = true
	}
	var out []time.Time
	loc := from.Location()
	start := from.In(loc)
	for day := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, loc); !day.After(to); day = day.AddDate(0, 0, 1) {
		at := time.Date(day.Year(), day.Month(), day.Day(), hour, minute, 0, 0, loc)
		if days[at.Weekday()] && at.After(from) && !at.After(to) {
			out = append(out, at)
		}
	}
	return out
}

func inWindow(at, from, to time.Time) bool { return at.After(from) && !at.After(to) }

func errorText(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
