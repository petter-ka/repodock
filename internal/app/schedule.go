package app

import (
	"github.com/example/repodock/internal/domain"
)

// scheduleInterval is how often schedules are evaluated; a scheduled start
// or stop happens at most this late.
const scheduleInterval = 5 // seconds

// SetRepositorySkipped makes "Run group" leave the repository out (or take
// it back in). It can still be run on its own (ADR-0024).
func (a *App) SetRepositorySkipped(repoID string, skipped bool) error {
	if err := a.workspace.SetRepositorySkipped(repoID, skipped); err != nil {
		return err
	}
	return a.persist()
}

// SetRepositoryContinuous marks a repository as long-running (a dev
// server): group runs count it as up once its last step has started instead
// of waiting for it to finish (ADR-0028).
func (a *App) SetRepositoryContinuous(repoID string, continuous bool) error {
	if err := a.workspace.SetRepositoryContinuous(repoID, continuous); err != nil {
		return err
	}
	return a.persist()
}

// SetGroupSchedules gives the listed groups the same schedule; each keeps
// its own copy and other groups keep theirs (ADR-0025). Postponed or
// cancelled starts and stops of those groups are forgotten.
func (a *App) SetGroupSchedules(groupIDs []string, schedule domain.GroupSchedule) ([]domain.Group, error) {
	groups, err := a.workspace.SetGroupSchedules(groupIDs, schedule)
	if err != nil {
		return nil, err
	}
	err = a.persist()
	a.schedule.Reset(groupIDs...)
	return groups, err
}

// ScheduledStops lists the scheduled stops announced with a countdown.
func (a *App) ScheduledStops() []domain.ScheduledStop { return a.schedule.Pending() }

// PostponeScheduledStop moves a group's announced stop by minutes.
func (a *App) PostponeScheduledStop(groupID string, minutes int) error {
	return a.schedule.Postpone(groupID, minutes)
}

// SkipScheduledStop cancels a group's announced stop; its schedule resumes
// with the next one.
func (a *App) SkipScheduledStop(groupID string) error { return a.schedule.Skip(groupID) }

// ScheduleStatuses returns every scheduled group's next start and stop and
// whether the user cancelled them.
func (a *App) ScheduleStatuses() []domain.GroupScheduleStatus { return a.schedule.Statuses() }

// SkipNextScheduled cancels a group's next scheduled "start" or "stop"
// (kind) ahead of time; the schedule resumes with the one after it. An empty
// groupID cancels it for every group with a schedule.
func (a *App) SkipNextScheduled(groupID string, kind string) error {
	return a.schedule.SkipNext(groupID, kind)
}

// ResumeScheduled takes back a cancelled "start" or "stop" (kind); an empty
// groupID takes it back for every scheduled group.
func (a *App) ResumeScheduled(groupID string, kind string) error {
	return a.schedule.Resume(groupID, kind)
}

// StopScheduledNow stops a group whose stop is announced right away.
func (a *App) StopScheduledNow(groupID string) error { return a.schedule.StopNow(groupID) }

// scheduleHost lets the scheduler act on the workspace's groups.
type scheduleHost struct{ a *App }

func (h scheduleHost) Groups() []domain.Group { return h.a.workspace.Snapshot().Groups }

func (h scheduleHost) Running(groupID string) int {
	group, ok := h.a.workspace.Group(groupID)
	if !ok {
		return 0
	}
	members := make(map[string]bool, len(group.RepositoryIDs))
	for _, id := range group.RepositoryIDs {
		members[id] = true
	}
	count := 0
	for _, run := range h.a.process.ActiveRuns() {
		if members[run.RepositoryID] {
			count++
		}
	}
	return count
}

func (h scheduleHost) StartGroup(groupID string) error {
	_, err := h.a.RunGroup(groupID)
	return err
}

func (h scheduleHost) StopGroup(groupID string) error { return h.a.StopGroup(groupID) }
