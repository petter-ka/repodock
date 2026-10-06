package sequence

import (
	"fmt"
	"sync"
	"time"

	"github.com/example/repodock/internal/domain"
	"github.com/google/uuid"
)

// EventGroupUpdated carries a full GroupRun snapshot after every change.
const EventGroupUpdated = "group:updated"

type groupState struct {
	run       domain.GroupRun
	cancelled bool
	done      chan struct{}
}

func hasEnabledSteps(repo domain.Repository) bool {
	for _, step := range repo.CommandSequence {
		if step.Enabled {
			return true
		}
	}
	return false
}

// StartGroup runs the saved sequence of every repository in repos (group
// order). Sequential mode runs one repository at a time and stops at the
// first failure; parallel mode starts all of them at once and lets each
// finish independently. Repositories without enabled steps are skipped.
func (r *Runner) StartGroup(group domain.Group, repos []domain.Repository) (domain.GroupRun, error) {
	mode := group.RunMode
	if !mode.Valid() {
		mode = domain.GroupRunSequential
	}
	runnable := 0
	for _, repo := range repos {
		if hasEnabledSteps(repo) {
			runnable++
		}
	}
	if runnable == 0 {
		return domain.GroupRun{}, fmt.Errorf("no repository in this group has enabled sequence steps")
	}

	r.mu.Lock()
	if existing, ok := r.groups[group.ID]; ok && existing.run.Status == domain.SequenceRunning {
		r.mu.Unlock()
		return domain.GroupRun{}, fmt.Errorf("this group is already running")
	}
	gs := &groupState{done: make(chan struct{}), run: domain.GroupRun{
		ID: uuid.NewString(), GroupID: group.ID, Mode: mode, Status: domain.SequenceRunning, StartedAt: time.Now().UTC(),
	}}
	for _, repo := range repos {
		status := domain.StepPending
		if !hasEnabledSteps(repo) {
			status = domain.StepSkipped
		}
		gs.run.Repos = append(gs.run.Repos, domain.GroupRepoState{RepositoryID: repo.ID, Name: repo.Name, Status: status})
	}
	r.groups[group.ID] = gs
	snapshot := cloneGroup(gs.run)
	r.mu.Unlock()

	r.emitGroup(snapshot)
	go r.executeGroup(gs, repos)
	return snapshot, nil
}

func (r *Runner) executeGroup(gs *groupState, repos []domain.Repository) {
	defer close(gs.done)
	if gs.run.Mode == domain.GroupRunParallel {
		var wg sync.WaitGroup
		for i, repo := range repos {
			if gs.run.Repos[i].Status == domain.StepSkipped || r.groupCancelled(gs) {
				continue
			}
			seqID, ok := r.startMember(gs, i, repo)
			if !ok {
				continue
			}
			wg.Add(1)
			go func() {
				defer wg.Done()
				r.awaitMember(gs, i, seqID)
			}()
		}
		wg.Wait()
	} else {
		for i, repo := range repos {
			if gs.run.Repos[i].Status == domain.StepSkipped {
				continue
			}
			if r.groupCancelled(gs) {
				break
			}
			seqID, ok := r.startMember(gs, i, repo)
			if !ok {
				break
			}
			if r.awaitMember(gs, i, seqID) != domain.StepCompleted {
				break
			}
		}
	}
	r.finishGroup(gs)
}

// startMember starts one repository's sequence and records it.
func (r *Runner) startMember(gs *groupState, i int, repo domain.Repository) (string, bool) {
	seq, err := r.Start(repo, repo.CommandSequence)
	if err != nil {
		r.updateGroup(gs, func() {
			gs.run.Repos[i].Status = domain.StepFailed
			gs.run.Repos[i].Error = err.Error()
		})
		return "", false
	}
	r.updateGroup(gs, func() {
		gs.run.Repos[i].Status = domain.StepRunning
		gs.run.Repos[i].SequenceID = seq.ID
	})
	// A cancel may have arrived between Start and recording the ID.
	if r.groupCancelled(gs) {
		_ = r.Cancel(seq.ID)
	}
	return seq.ID, true
}

// awaitMember waits for a member sequence and maps its outcome.
func (r *Runner) awaitMember(gs *groupState, i int, sequenceID string) domain.StepStatus {
	final, err := r.Wait(sequenceID)
	status := domain.StepCompleted
	message := ""
	switch {
	case err != nil:
		status, message = domain.StepFailed, err.Error()
	case final.Status == domain.SequenceCancelled:
		status = domain.StepCancelled
	case final.Status == domain.SequenceFailed:
		status = domain.StepFailed
		for _, step := range final.Steps {
			if step.Status == domain.StepFailed {
				message = fmt.Sprintf("%s: %s", step.Label, step.Error)
				break
			}
		}
	}
	r.updateGroup(gs, func() {
		gs.run.Repos[i].Status = status
		gs.run.Repos[i].Error = message
	})
	return status
}

func (r *Runner) finishGroup(gs *groupState) {
	r.updateGroup(gs, func() {
		failed := false
		for j := range gs.run.Repos {
			switch gs.run.Repos[j].Status {
			case domain.StepPending:
				gs.run.Repos[j].Status = domain.StepCancelled
			case domain.StepFailed:
				failed = true
			}
		}
		switch {
		case gs.cancelled:
			gs.run.Status = domain.SequenceCancelled
		case failed:
			gs.run.Status = domain.SequenceFailed
		default:
			gs.run.Status = domain.SequenceCompleted
		}
		gs.run.EndedAt = time.Now().UTC()
	})
}

// CancelGroup stops the group run: pending repositories never start and
// running member sequences are cancelled. Background steps that already
// started keep running; StopRepository stops those.
func (r *Runner) CancelGroup(groupID string) error {
	r.mu.Lock()
	gs, ok := r.groups[groupID]
	if !ok || gs.run.Status != domain.SequenceRunning {
		r.mu.Unlock()
		return nil
	}
	gs.cancelled = true
	var running []string
	for _, repo := range gs.run.Repos {
		if repo.Status == domain.StepRunning && repo.SequenceID != "" {
			running = append(running, repo.SequenceID)
		}
	}
	r.mu.Unlock()
	for _, id := range running {
		_ = r.Cancel(id)
	}
	return nil
}

// WaitGroup blocks until the group's current run finishes.
func (r *Runner) WaitGroup(groupID string) (domain.GroupRun, error) {
	r.mu.Lock()
	gs, ok := r.groups[groupID]
	r.mu.Unlock()
	if !ok {
		return domain.GroupRun{}, fmt.Errorf("no group run for %s", groupID)
	}
	<-gs.done
	r.mu.Lock()
	defer r.mu.Unlock()
	return cloneGroup(gs.run), nil
}

// GroupRuns returns the most recent run of every group.
func (r *Runner) GroupRuns() []domain.GroupRun {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]domain.GroupRun, 0, len(r.groups))
	for _, gs := range r.groups {
		out = append(out, cloneGroup(gs.run))
	}
	return out
}

func (r *Runner) groupCancelled(gs *groupState) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return gs.cancelled
}

func (r *Runner) updateGroup(gs *groupState, mutate func()) {
	r.mu.Lock()
	mutate()
	snapshot := cloneGroup(gs.run)
	r.mu.Unlock()
	r.emitGroup(snapshot)
}

func (r *Runner) emitGroup(run domain.GroupRun) {
	r.mu.Lock()
	emitter := r.emitter
	r.mu.Unlock()
	if emitter != nil {
		emitter(EventGroupUpdated, run)
	}
}

func cloneGroup(run domain.GroupRun) domain.GroupRun {
	run.Repos = append([]domain.GroupRepoState{}, run.Repos...)
	return run
}
