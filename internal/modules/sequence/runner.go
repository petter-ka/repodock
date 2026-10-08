// Package sequence executes a repository's ordered command steps in the
// backend so a sequence survives frontend reloads (ADR-0009). It depends on
// process execution only through the Executor interface.
package sequence

import (
	"fmt"
	"sync"
	"time"

	"github.com/example/repodock/internal/domain"
	"github.com/google/uuid"
)

// EventUpdated carries a full SequenceRun snapshot after every state change.
const EventUpdated = "sequence:updated"

// Executor starts and observes the process behind a single step.
type Executor interface {
	StartStep(repo domain.Repository, step domain.CommandStep, sequenceID string) (domain.Run, error)
	Wait(runID string) (domain.Run, error)
	Stop(runID string) error
}

type Runner struct {
	exec Executor

	mu      sync.Mutex
	emitter func(event string, payload any)
	runs    map[string]*state
	latest  map[string]string      // repository ID → most recent sequence ID
	groups  map[string]*groupState // group ID → most recent group run
}

type state struct {
	run        domain.SequenceRun
	cancelled  bool
	currentRun string
	done       chan struct{}
}

func New(exec Executor) *Runner {
	return &Runner{exec: exec, runs: map[string]*state{}, latest: map[string]string{}, groups: map[string]*groupState{}}
}

func (r *Runner) SetEmitter(emitter func(event string, payload any)) {
	r.mu.Lock()
	r.emitter = emitter
	r.mu.Unlock()
}

// Start runs the enabled steps of steps in order. Foreground steps must exit
// with code 0 before the next step starts; a failure stops the sequence.
// Background steps are launched and the sequence moves on.
func (r *Runner) Start(repo domain.Repository, steps []domain.CommandStep) (domain.SequenceRun, error) {
	enabled := make([]domain.CommandStep, 0, len(steps))
	for _, step := range steps {
		if step.Enabled {
			enabled = append(enabled, step)
		}
	}
	if len(enabled) == 0 {
		return domain.SequenceRun{}, fmt.Errorf("the sequence has no enabled steps")
	}

	r.mu.Lock()
	if id, ok := r.latest[repo.ID]; ok && r.runs[id].run.Status == domain.SequenceRunning {
		r.mu.Unlock()
		return domain.SequenceRun{}, fmt.Errorf("a sequence is already running for this repository")
	}
	st := &state{done: make(chan struct{}), run: domain.SequenceRun{
		ID: uuid.NewString(), RepositoryID: repo.ID, Status: domain.SequenceRunning, StartedAt: time.Now().UTC(),
	}}
	for _, step := range enabled {
		st.run.Steps = append(st.run.Steps, domain.SequenceStepState{StepID: step.ID, Label: step.Label, Status: domain.StepPending})
	}
	if previous, ok := r.latest[repo.ID]; ok {
		delete(r.runs, previous)
	}
	r.runs[st.run.ID] = st
	r.latest[repo.ID] = st.run.ID
	snapshot := cloneRun(st.run)
	r.mu.Unlock()

	r.emit(snapshot)
	go r.execute(st, repo, enabled)
	return snapshot, nil
}

func (r *Runner) execute(st *state, repo domain.Repository, steps []domain.CommandStep) {
	defer close(st.done)
	for i, step := range steps {
		if r.isCancelled(st) {
			r.finish(st, i, domain.SequenceCancelled)
			return
		}
		r.update(st, func() { st.run.Steps[i].Status = domain.StepRunning })

		run, err := r.exec.StartStep(repo, step, st.run.ID)
		if err != nil {
			r.update(st, func() {
				st.run.Steps[i].Status = domain.StepFailed
				st.run.Steps[i].Error = err.Error()
			})
			r.finish(st, i+1, domain.SequenceFailed)
			return
		}
		r.update(st, func() { st.run.Steps[i].RunID = run.ID; st.currentRun = run.ID })

		switch {
		case run.Status == domain.RunSkipped:
			r.update(st, func() { st.run.Steps[i].Status = domain.StepSkipped })
			continue
		case run.Status == domain.RunFailed:
			r.update(st, func() { st.run.Steps[i].Status = domain.StepFailed })
			r.finish(st, i+1, domain.SequenceFailed)
			return
		case step.Background:
			r.update(st, func() { st.run.Steps[i].Status = domain.StepStarted })
			continue
		}

		final, err := r.exec.Wait(run.ID)
		// Cancelling the sequence, or stopping the step's process from the
		// UI, is a user decision rather than a failure.
		if r.isCancelled(st) || (err == nil && final.Status == domain.RunStopped) {
			r.update(st, func() { st.run.Steps[i].Status = domain.StepCancelled })
			r.finish(st, i+1, domain.SequenceCancelled)
			return
		}
		if err != nil || final.Status != domain.RunExited {
			r.update(st, func() {
				st.run.Steps[i].Status = domain.StepFailed
				if err != nil {
					st.run.Steps[i].Error = err.Error()
				} else {
					st.run.Steps[i].Error = fmt.Sprintf("exit code %d", final.ExitCode)
				}
			})
			r.finish(st, i+1, domain.SequenceFailed)
			return
		}
		r.update(st, func() { st.run.Steps[i].Status = domain.StepCompleted })
	}
	r.finish(st, len(steps), domain.SequenceCompleted)
}

// finish marks steps from index `from` onward as cancelled and sets the
// terminal sequence status.
func (r *Runner) finish(st *state, from int, status domain.SequenceStatus) {
	r.update(st, func() {
		for j := from; j < len(st.run.Steps); j++ {
			if st.run.Steps[j].Status == domain.StepPending {
				st.run.Steps[j].Status = domain.StepCancelled
			}
		}
		st.run.Status = status
		st.run.EndedAt = time.Now().UTC()
		st.currentRun = ""
	})
}

// Cancel stops the sequence: the step currently being waited on is stopped
// and no further steps start. Background steps already launched keep running.
func (r *Runner) Cancel(sequenceID string) error {
	r.mu.Lock()
	st, ok := r.runs[sequenceID]
	if !ok {
		r.mu.Unlock()
		return fmt.Errorf("sequence not found: %s", sequenceID)
	}
	if st.run.Status != domain.SequenceRunning {
		r.mu.Unlock()
		return nil
	}
	st.cancelled = true
	current := st.currentRun
	r.mu.Unlock()
	if current != "" {
		return r.exec.Stop(current)
	}
	return nil
}

// CancelRepository cancels the repository's running sequence, if any.
func (r *Runner) CancelRepository(repoID string) error {
	r.mu.Lock()
	id, ok := r.latest[repoID]
	r.mu.Unlock()
	if !ok {
		return nil
	}
	return r.Cancel(id)
}

// Wait blocks until the sequence finishes. Intended for tests and shutdown.
func (r *Runner) Wait(sequenceID string) (domain.SequenceRun, error) {
	r.mu.Lock()
	st, ok := r.runs[sequenceID]
	r.mu.Unlock()
	if !ok {
		return domain.SequenceRun{}, fmt.Errorf("sequence not found: %s", sequenceID)
	}
	<-st.done
	r.mu.Lock()
	defer r.mu.Unlock()
	return cloneRun(st.run), nil
}

// List returns the most recent sequence of every repository.
func (r *Runner) List() []domain.SequenceRun {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]domain.SequenceRun, 0, len(r.latest))
	for _, id := range r.latest {
		out = append(out, cloneRun(r.runs[id].run))
	}
	return out
}

func (r *Runner) isCancelled(st *state) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return st.cancelled
}

func (r *Runner) update(st *state, mutate func()) {
	r.mu.Lock()
	mutate()
	snapshot := cloneRun(st.run)
	r.mu.Unlock()
	r.emit(snapshot)
}

func (r *Runner) emit(run domain.SequenceRun) {
	r.mu.Lock()
	emitter := r.emitter
	r.mu.Unlock()
	if emitter != nil {
		emitter(EventUpdated, run)
	}
}

func cloneRun(run domain.SequenceRun) domain.SequenceRun {
	run.Steps = append([]domain.SequenceStepState{}, run.Steps...)
	return run
}
