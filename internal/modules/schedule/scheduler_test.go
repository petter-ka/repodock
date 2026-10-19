package schedule

import (
	"sync"
	"testing"
	"time"

	"github.com/example/repodock/internal/domain"
)

type fakeHost struct {
	mu      sync.Mutex
	groups  []domain.Group
	running map[string]int
	started []string
	stopped []string
}

func (h *fakeHost) Groups() []domain.Group { h.mu.Lock(); defer h.mu.Unlock(); return h.groups }
func (h *fakeHost) Running(id string) int  { h.mu.Lock(); defer h.mu.Unlock(); return h.running[id] }
func (h *fakeHost) StartGroup(id string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.started = append(h.started, id)
	h.running[id] = 1
	return nil
}
func (h *fakeHost) StopGroup(id string) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.stopped = append(h.stopped, id)
	h.running[id] = 0
	return nil
}

type clock struct{ t time.Time }

func (c *clock) now() time.Time      { return c.t }
func (c *clock) set(value string)    { c.t = at(value) }
func (c *clock) add(d time.Duration) { c.t = c.t.Add(d) }
func at(value string) time.Time {
	t, _ := time.ParseInLocation("2006-01-02 15:04", value, time.Local)
	return t
}
func weekdays() []int { return []int{1, 2, 3, 4, 5} }
func newSetup(s domain.GroupSchedule) (*fakeHost, *clock, *Scheduler, *[]any) {
	host := &fakeHost{groups: []domain.Group{{ID: "g", Name: "Work", Schedule: s}}, running: map[string]int{}}
	c := &clock{}
	sched := New(host, c.now)
	events := &[]any{}
	sched.SetEmitter(func(_ string, payload any) { *events = append(*events, payload) })
	return host, c, sched, events
}

// 2026-10-19 is a Monday.

func TestOccurrencesHonourDays(t *testing.T) {
	s := domain.GroupSchedule{Days: []int{0, 6}} // weekend
	got := Occurrences(s, "18:00", at("2026-10-19 00:00"), at("2026-10-26 00:00"))
	if len(got) != 2 || got[0] != at("2026-10-24 18:00") || got[1] != at("2026-10-25 18:00") {
		t.Fatalf("occurrences = %v", got)
	}
	if Occurrences(s, "bad", at("2026-10-19 00:00"), at("2026-10-26 00:00")) != nil {
		t.Fatal("invalid clock should yield nothing")
	}
}

func TestStartFiresOnceAtItsTime(t *testing.T) {
	host, c, s, _ := newSetup(domain.GroupSchedule{Days: weekdays(), StartEnabled: true, StartAt: "09:00"})
	c.set("2026-10-19 08:59")
	s.last = c.t
	c.add(30 * time.Second)
	s.Tick()
	if len(host.started) != 0 {
		t.Fatalf("started early: %v", host.started)
	}
	c.add(45 * time.Second)
	s.Tick()
	c.add(30 * time.Second)
	s.Tick()
	if len(host.started) != 1 {
		t.Fatalf("started = %v", host.started)
	}
}

func TestStartSkipsDaysOffAndRunningGroups(t *testing.T) {
	host, c, s, _ := newSetup(domain.GroupSchedule{Days: weekdays(), StartEnabled: true, StartAt: "09:00"})
	c.set("2026-10-24 08:59") // Saturday
	s.last = c.t
	c.add(2 * time.Minute)
	s.Tick()
	c.set("2026-10-26 08:59") // Monday, already running
	s.last = c.t
	host.running["g"] = 2
	c.add(2 * time.Minute)
	s.Tick()
	if len(host.started) != 0 {
		t.Fatalf("started = %v", host.started)
	}
}

func TestMissedTimesFireOnlyWhenRecent(t *testing.T) {
	host, c, s, _ := newSetup(domain.GroupSchedule{Days: weekdays(), StartEnabled: true, StartAt: "09:00"})
	c.set("2026-10-19 08:00")
	s.last = c.t
	c.set("2026-10-19 10:00") // slept through 09:00
	s.Tick()
	if len(host.started) != 0 {
		t.Fatalf("a start two hours late fired: %v", host.started)
	}
}

func TestStopIsAnnouncedThenFires(t *testing.T) {
	host, c, s, events := newSetup(domain.GroupSchedule{Days: weekdays(), StopEnabled: true, StopAt: "18:00"})
	host.running["g"] = 3
	c.set("2026-10-19 17:00")
	s.last = c.t
	s.Tick()
	if len(s.Pending()) != 0 {
		t.Fatalf("announced too early: %v", s.Pending())
	}
	c.set("2026-10-19 17:31")
	s.Tick()
	pending := s.Pending()
	if len(pending) != 1 || pending[0].StopAt != at("2026-10-19 18:00") || pending[0].Running != 3 || pending[0].Postponed {
		t.Fatalf("pending = %#v", pending)
	}
	c.set("2026-10-19 18:00")
	s.Tick()
	if len(host.stopped) != 1 || len(s.Pending()) != 0 {
		t.Fatalf("stopped = %v pending = %v", host.stopped, s.Pending())
	}
	last := (*events)[len(*events)-2]
	if ev, ok := last.(domain.ScheduleEvent); !ok || ev.Action != "stopped" {
		t.Fatalf("events = %#v", *events)
	}
}

func TestIdleGroupsAreNotAnnouncedOrStopped(t *testing.T) {
	host, c, s, _ := newSetup(domain.GroupSchedule{Days: weekdays(), StopEnabled: true, StopAt: "18:00"})
	c.set("2026-10-19 17:45")
	s.last = c.t
	s.Tick()
	c.set("2026-10-19 18:01")
	s.Tick()
	if len(s.Pending()) != 0 || len(host.stopped) != 0 {
		t.Fatalf("pending = %v stopped = %v", s.Pending(), host.stopped)
	}
}

func TestPostponeMovesTheStop(t *testing.T) {
	host, c, s, _ := newSetup(domain.GroupSchedule{Days: weekdays(), StopEnabled: true, StopAt: "18:00"})
	host.running["g"] = 1
	c.set("2026-10-19 17:50")
	s.last = c.t
	s.Tick()
	if err := s.Postpone("g", 15); err != nil {
		t.Fatal(err)
	}
	if p := s.Pending(); len(p) != 1 || p[0].StopAt != at("2026-10-19 18:15") || !p[0].Postponed {
		t.Fatalf("pending = %#v", p)
	}
	c.set("2026-10-19 18:01")
	s.Tick()
	if len(host.stopped) != 0 {
		t.Fatal("stopped at the original time")
	}
	// Postponing again counts from the postponed time.
	if err := s.Postpone("g", 15); err != nil {
		t.Fatal(err)
	}
	c.set("2026-10-19 18:16")
	s.Tick()
	if len(host.stopped) != 0 {
		t.Fatal("stopped before the second postponement")
	}
	c.set("2026-10-19 18:30")
	s.Tick()
	if len(host.stopped) != 1 {
		t.Fatalf("stopped = %v", host.stopped)
	}
}

func TestSkipCancelsOnlyThisStop(t *testing.T) {
	host, c, s, _ := newSetup(domain.GroupSchedule{Days: []int{0, 1, 2, 3, 4, 5, 6}, StopEnabled: true, StopAt: "18:00"})
	host.running["g"] = 1
	c.set("2026-10-19 17:45")
	s.last = c.t
	s.Tick()
	if err := s.Skip("g"); err != nil {
		t.Fatal(err)
	}
	if len(s.Pending()) != 0 {
		t.Fatalf("pending after skip = %v", s.Pending())
	}
	c.set("2026-10-19 18:05")
	s.Tick()
	if len(host.stopped) != 0 {
		t.Fatal("skipped stop fired")
	}
	c.set("2026-10-20 17:40")
	s.Tick()
	c.set("2026-10-20 18:00")
	s.Tick()
	if len(host.stopped) != 1 {
		t.Fatalf("next day's stop did not fire: %v", host.stopped)
	}
}

func TestStopNow(t *testing.T) {
	host, c, s, _ := newSetup(domain.GroupSchedule{Days: weekdays(), StopEnabled: true, StopAt: "18:00"})
	host.running["g"] = 1
	c.set("2026-10-19 17:45")
	s.last = c.t
	s.Tick()
	if err := s.StopNow("g"); err != nil {
		t.Fatal(err)
	}
	if len(host.stopped) != 1 || len(s.Pending()) != 0 {
		t.Fatalf("stopped = %v pending = %v", host.stopped, s.Pending())
	}
	if err := s.Postpone("g", 10); err == nil {
		t.Fatal("postponing a stop that already happened should fail")
	}
}

func TestSkipNextStartAheadOfTime(t *testing.T) {
	host, c, s, _ := newSetup(domain.GroupSchedule{Days: weekdays(), StartEnabled: true, StartAt: "09:00"})
	c.set("2026-10-19 07:00")
	s.last = c.t
	if err := s.SkipNext("g", KindStart); err != nil {
		t.Fatal(err)
	}
	if st := s.Statuses(); len(st) != 1 || !st[0].StartSkipped || st[0].NextStart != at("2026-10-19 09:00") {
		t.Fatalf("statuses = %#v", st)
	}
	c.set("2026-10-19 09:00")
	s.Tick()
	if len(host.started) != 0 {
		t.Fatal("cancelled start ran")
	}
	// The next day's start is back on and runs.
	if st := s.Statuses(); st[0].StartSkipped || st[0].NextStart != at("2026-10-20 09:00") {
		t.Fatalf("statuses after = %#v", st)
	}
	c.set("2026-10-20 08:59")
	s.Tick()
	c.set("2026-10-20 09:00")
	s.Tick()
	if len(host.started) != 1 {
		t.Fatalf("started = %v", host.started)
	}
}

func TestResumeTakesBackACancelledStart(t *testing.T) {
	host, c, s, _ := newSetup(domain.GroupSchedule{Days: weekdays(), StartEnabled: true, StartAt: "09:00"})
	c.set("2026-10-19 07:00")
	s.last = c.t
	_ = s.SkipNext("g", KindStart)
	if err := s.Resume("g", KindStart); err != nil {
		t.Fatal(err)
	}
	c.set("2026-10-19 09:00")
	s.Tick()
	if len(host.started) != 1 {
		t.Fatalf("started = %v", host.started)
	}
}

func TestCancelledStopIsNeverAnnounced(t *testing.T) {
	host, c, s, events := newSetup(domain.GroupSchedule{Days: weekdays(), StopEnabled: true, StopAt: "18:00"})
	host.running["g"] = 1
	c.set("2026-10-19 12:00")
	s.last = c.t
	s.Tick()
	if err := s.SkipNext("g", KindStop); err != nil {
		t.Fatal(err)
	}
	if st := s.Statuses(); !st[0].StopSkipped || st[0].NextStop != at("2026-10-19 18:00") {
		t.Fatalf("statuses = %#v", st)
	}
	c.set("2026-10-19 17:45")
	s.Tick()
	c.set("2026-10-19 18:00")
	s.Tick()
	if len(s.Pending()) != 0 || len(host.stopped) != 0 {
		t.Fatalf("pending = %v stopped = %v", s.Pending(), host.stopped)
	}
	found := false
	for _, e := range *events {
		if list, ok := e.([]domain.GroupScheduleStatus); ok && len(list) == 1 && list[0].StopSkipped {
			found = true
		}
	}
	if !found {
		t.Fatal("no status event reported the cancelled stop")
	}
	// Undo before the time restores it.
	c.set("2026-10-20 12:00")
	s.Tick()
	_ = s.SkipNext("g", KindStop)
	_ = s.Resume("g", KindStop)
	if st := s.Statuses(); st[0].StopSkipped {
		t.Fatalf("still skipped: %#v", st)
	}
}

func TestStopNowCountsAsTodaysStop(t *testing.T) {
	host, c, s, _ := newSetup(domain.GroupSchedule{Days: weekdays(), StopEnabled: true, StopAt: "18:00"})
	host.running["g"] = 1
	c.set("2026-10-19 17:45")
	s.last = c.t
	s.Tick()
	_ = s.StopNow("g")
	// Today's stop is done, not "cancelled": the status moves to tomorrow.
	if st := s.Statuses(); st[0].StopSkipped || st[0].NextStop != at("2026-10-20 18:00") {
		t.Fatalf("statuses = %#v", st)
	}
}

func TestSkipNextRejectsUnknownKindsAndMissingSchedules(t *testing.T) {
	_, c, s, _ := newSetup(domain.GroupSchedule{Days: weekdays(), StopEnabled: true, StopAt: "18:00"})
	c.set("2026-10-19 12:00")
	if s.SkipNext("g", "lunch") == nil || s.SkipNext("g", KindStart) == nil || s.SkipNext("missing", KindStop) == nil {
		t.Fatal("expected errors")
	}
}
