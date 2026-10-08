package sequence

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/example/repodock/internal/domain"
)

// fakeExecutor resolves steps by label: "fail" exits 1, "block" runs until
// stopped, "" is a no-op, anything else exits 0.
type fakeExecutor struct {
	mu      sync.Mutex
	started []string
	blocked map[string]chan struct{}
	runs    map[string]domain.Run
}

func newFake() *fakeExecutor {
	return &fakeExecutor{blocked: map[string]chan struct{}{}, runs: map[string]domain.Run{}}
}

func (f *fakeExecutor) StartStep(_ domain.Repository, step domain.CommandStep, sequenceID string) (domain.Run, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if step.Command == "error" {
		return domain.Run{}, fmt.Errorf("cannot start")
	}
	id := fmt.Sprintf("run-%d", len(f.started))
	f.started = append(f.started, step.Command)
	run := domain.Run{ID: id, Status: domain.RunRunning, SequenceID: sequenceID, StepID: step.ID}
	switch step.Command {
	case "":
		run.Status = domain.RunSkipped
	case "block":
		f.blocked[id] = make(chan struct{})
	}
	f.runs[id] = run
	return run, nil
}

func (f *fakeExecutor) Wait(runID string) (domain.Run, error) {
	f.mu.Lock()
	ch := f.blocked[runID]
	run := f.runs[runID]
	f.mu.Unlock()
	if ch != nil {
		<-ch
		run.Status = domain.RunStopped
		return run, nil
	}
	if f.commandOf(runID) == "fail" {
		run.Status, run.ExitCode = domain.RunFailed, 1
		return run, nil
	}
	run.Status = domain.RunExited
	return run, nil
}

func (f *fakeExecutor) commandOf(runID string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var i int
	_, _ = fmt.Sscanf(runID, "run-%d", &i)
	return f.started[i]
}

func (f *fakeExecutor) Stop(runID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if ch, ok := f.blocked[runID]; ok {
		close(ch)
		delete(f.blocked, runID)
	}
	return nil
}

func steps(commands ...string) []domain.CommandStep {
	out := make([]domain.CommandStep, 0, len(commands))
	for i, c := range commands {
		out = append(out, domain.CommandStep{ID: fmt.Sprintf("s%d", i), Label: c, Command: c, Enabled: true})
	}
	return out
}

func statuses(run domain.SequenceRun) []domain.StepStatus {
	out := make([]domain.StepStatus, 0, len(run.Steps))
	for _, s := range run.Steps {
		out = append(out, s.Status)
	}
	return out
}

func equal(a, b []domain.StepStatus) bool {
	return fmt.Sprint(a) == fmt.Sprint(b)
}

var repo = domain.Repository{ID: "repo"}

func TestSequenceRunsInOrderAndSkipsNoops(t *testing.T) {
	fake := newFake()
	r := New(fake)
	var events int
	var mu sync.Mutex
	r.SetEmitter(func(string, any) { mu.Lock(); events++; mu.Unlock() })

	all := steps("build", "", "test")
	all = append(all, domain.CommandStep{ID: "off", Command: "never", Enabled: false})
	started, err := r.Start(repo, all)
	if err != nil {
		t.Fatal(err)
	}
	if len(started.Steps) != 3 {
		t.Fatalf("disabled steps must be excluded: %#v", started.Steps)
	}
	final, _ := r.Wait(started.ID)
	if final.Status != domain.SequenceCompleted {
		t.Fatalf("status = %s", final.Status)
	}
	want := []domain.StepStatus{domain.StepCompleted, domain.StepSkipped, domain.StepCompleted}
	if !equal(statuses(final), want) {
		t.Fatalf("steps = %v", statuses(final))
	}
	if fmt.Sprint(fake.started) != fmt.Sprint([]string{"build", "", "test"}) {
		t.Fatalf("started = %q", fake.started)
	}
	mu.Lock()
	defer mu.Unlock()
	if events == 0 {
		t.Fatal("expected sequence:updated events")
	}
}

func TestSequenceStopsOnFailure(t *testing.T) {
	r := New(newFake())
	run, _ := r.Start(repo, steps("build", "fail", "deploy"))
	final, _ := r.Wait(run.ID)
	want := []domain.StepStatus{domain.StepCompleted, domain.StepFailed, domain.StepCancelled}
	if final.Status != domain.SequenceFailed || !equal(statuses(final), want) {
		t.Fatalf("final = %s %v", final.Status, statuses(final))
	}
	if final.Steps[1].Error != "exit code 1" {
		t.Fatalf("error = %q", final.Steps[1].Error)
	}
}

func TestSequenceStartErrorFails(t *testing.T) {
	r := New(newFake())
	run, _ := r.Start(repo, steps("error", "next"))
	final, _ := r.Wait(run.ID)
	if final.Status != domain.SequenceFailed || final.Steps[0].Error != "cannot start" || final.Steps[1].Status != domain.StepCancelled {
		t.Fatalf("final = %#v", final)
	}
}

func TestBackgroundStepsDoNotBlock(t *testing.T) {
	fake := newFake()
	r := New(fake)
	all := steps("block", "after")
	all[0].Background = true
	run, _ := r.Start(repo, all)
	final, _ := r.Wait(run.ID)
	want := []domain.StepStatus{domain.StepStarted, domain.StepCompleted}
	if final.Status != domain.SequenceCompleted || !equal(statuses(final), want) {
		t.Fatalf("final = %s %v", final.Status, statuses(final))
	}
}

func TestCancelStopsCurrentStep(t *testing.T) {
	r := New(newFake())
	run, _ := r.Start(repo, steps("block", "never"))
	if _, err := r.Start(repo, steps("x")); err == nil {
		t.Fatal("a second concurrent sequence for the same repository must be rejected")
	}
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if r.List()[0].Steps[0].RunID != "" {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if err := r.CancelRepository(repo.ID); err != nil {
		t.Fatal(err)
	}
	final, _ := r.Wait(run.ID)
	want := []domain.StepStatus{domain.StepCancelled, domain.StepCancelled}
	if final.Status != domain.SequenceCancelled || !equal(statuses(final), want) {
		t.Fatalf("final = %s %v", final.Status, statuses(final))
	}
}

func TestStoppingStepProcessCancelsSequence(t *testing.T) {
	fake := newFake()
	r := New(fake)
	run, _ := r.Start(repo, steps("block", "never"))
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && r.List()[0].Steps[0].RunID == "" {
		time.Sleep(5 * time.Millisecond)
	}
	// The user stops the step's process from the process card, not the sequence.
	if err := fake.Stop(r.List()[0].Steps[0].RunID); err != nil {
		t.Fatal(err)
	}
	final, _ := r.Wait(run.ID)
	want := []domain.StepStatus{domain.StepCancelled, domain.StepCancelled}
	if final.Status != domain.SequenceCancelled || !equal(statuses(final), want) {
		t.Fatalf("final = %s %v", final.Status, statuses(final))
	}
}

func TestNoEnabledSteps(t *testing.T) {
	r := New(newFake())
	all := steps("a")
	all[0].Enabled = false
	if _, err := r.Start(repo, all); err == nil {
		t.Fatal("expected error")
	}
}
