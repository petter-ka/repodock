package sequence

import (
	"fmt"
	"testing"
	"time"

	"github.com/example/repodock/internal/domain"
)

func member(id string, commands ...string) domain.Repository {
	repo := domain.Repository{ID: id, Name: id}
	for i, c := range commands {
		repo.CommandSequence = append(repo.CommandSequence, domain.CommandStep{ID: fmt.Sprintf("%s-%d", id, i), Label: c, Command: c, Enabled: true})
	}
	return repo
}

func repoStatuses(run domain.GroupRun) string {
	out := ""
	for _, r := range run.Repos {
		out += r.RepositoryID + "=" + string(r.Status) + " "
	}
	return out
}

func (f *fakeExecutor) startedCommands() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string{}, f.started...)
}

func TestSequentialGroupStopsAtFirstFailure(t *testing.T) {
	fake := newFake()
	r := New(fake)
	group := domain.Group{ID: "g", RunMode: domain.GroupRunSequential}
	repos := []domain.Repository{member("a", "build"), member("empty"), member("b", "fail"), member("c", "never")}
	repos[1].CommandSequence = []domain.CommandStep{{ID: "x", Command: "disabled", Enabled: false}}

	started, err := r.StartGroup(group, repos)
	if err != nil {
		t.Fatal(err)
	}
	if started.Mode != domain.GroupRunSequential || started.Repos[1].Status != domain.StepSkipped {
		t.Fatalf("started = %#v", started)
	}
	final, _ := r.WaitGroup("g")
	if got := repoStatuses(final); got != "a=completed empty=skipped b=failed c=cancelled " {
		t.Fatalf("statuses = %s", got)
	}
	if final.Status != domain.SequenceFailed || final.Repos[2].Error != "fail: exit code 1" {
		t.Fatalf("final = %#v", final)
	}
	if fmt.Sprint(fake.startedCommands()) != "[build fail]" {
		t.Fatalf("started = %v", fake.startedCommands())
	}
}

func TestSequentialGroupTreatsBackgroundStepsAsStarted(t *testing.T) {
	r := New(newFake())
	api := member("api", "block")
	api.CommandSequence[0].Background = true
	if _, err := r.StartGroup(domain.Group{ID: "g"}, []domain.Repository{api, member("web", "build")}); err != nil {
		t.Fatal(err)
	}
	final, _ := r.WaitGroup("g")
	if final.Status != domain.SequenceCompleted || repoStatuses(final) != "api=completed web=completed " {
		t.Fatalf("final = %s %s", final.Status, repoStatuses(final))
	}
}

func TestParallelGroupStartsEverythingAndCancels(t *testing.T) {
	fake := newFake()
	r := New(fake)
	group := domain.Group{ID: "g", RunMode: domain.GroupRunParallel}
	if _, err := r.StartGroup(group, []domain.Repository{member("a", "block"), member("b", "fail"), member("c", "ok")}); err != nil {
		t.Fatal(err)
	}

	// While "a" is still blocked, b and c must already have started.
	deadline := time.Now().Add(2 * time.Second)
	for len(fake.startedCommands()) < 3 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if len(fake.startedCommands()) != 3 {
		t.Fatalf("started = %v", fake.startedCommands())
	}
	if _, err := r.StartGroup(group, []domain.Repository{member("a", "x")}); err == nil {
		t.Fatal("a running group must not start twice")
	}

	// Wait until c has finished so the outcome is deterministic.
	for time.Now().Before(deadline) {
		if runs := r.GroupRuns(); runs[0].Repos[2].Status == domain.StepCompleted && runs[0].Repos[1].Status == domain.StepFailed {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if err := r.CancelGroup("g"); err != nil {
		t.Fatal(err)
	}
	final, _ := r.WaitGroup("g")
	if got := repoStatuses(final); got != "a=cancelled b=failed c=completed " {
		t.Fatalf("statuses = %s", got)
	}
	if final.Status != domain.SequenceCancelled || final.Mode != domain.GroupRunParallel {
		t.Fatalf("final = %#v", final)
	}
}

func TestGroupWithoutEnabledStepsIsRejected(t *testing.T) {
	r := New(newFake())
	repo := member("a", "x")
	repo.CommandSequence[0].Enabled = false
	if _, err := r.StartGroup(domain.Group{ID: "g"}, []domain.Repository{repo, {ID: "b"}}); err == nil {
		t.Fatal("expected error")
	}
}

func TestGroupLeavesOutSkippedMembers(t *testing.T) {
	fake := newFake()
	r := New(fake)
	group := domain.Group{ID: "g", RunMode: domain.GroupRunSequential, SkippedRepositoryIDs: []string{"b"}}
	repos := []domain.Repository{member("a", "one"), member("b", "two"), member("c", "three")}

	started, err := r.StartGroup(group, repos)
	if err != nil {
		t.Fatal(err)
	}
	if !started.Repos[1].Excluded || started.Repos[1].Status != domain.StepSkipped || started.Repos[0].Excluded {
		t.Fatalf("started = %#v", started.Repos)
	}
	final, _ := r.WaitGroup("g")
	if got := repoStatuses(final); got != "a=completed b=skipped c=completed " {
		t.Fatalf("statuses = %s", got)
	}
	if fmt.Sprint(fake.startedCommands()) != "[one three]" {
		t.Fatalf("started = %v", fake.startedCommands())
	}
}

func TestGroupWithEveryMemberSkippedIsRejected(t *testing.T) {
	r := New(newFake())
	group := domain.Group{ID: "g", SkippedRepositoryIDs: []string{"a"}}
	if _, err := r.StartGroup(group, []domain.Repository{member("a", "one"), member("empty")}); err == nil {
		t.Fatal("expected an error when nothing would run")
	}
}

func TestContinuousMemberIsUpOnceItsLastStepRuns(t *testing.T) {
	for _, mode := range []domain.GroupRunMode{domain.GroupRunSequential, domain.GroupRunParallel} {
		t.Run(string(mode), func(t *testing.T) {
			fake := newFake()
			r := New(fake)
			server := member("web", "install", "block") // "block" never exits, like `npm run dev`
			server.Continuous = true
			group := domain.Group{ID: "g", RunMode: mode}

			done := make(chan domain.GroupRun, 1)
			if _, err := r.StartGroup(group, []domain.Repository{server, member("api", "build")}); err != nil {
				t.Fatal(err)
			}
			go func() { final, _ := r.WaitGroup("g"); done <- final }()
			select {
			case final := <-done:
				if got := repoStatuses(final); got != "web=started api=completed " || final.Status != domain.SequenceCompleted || !final.Repos[0].Continuous {
					t.Fatalf("final = %s %s", got, final.Status)
				}
			case <-time.After(2 * time.Second):
				t.Fatal("the group run waited for a continuous member to exit")
			}
			// The dev server is still running; the earlier step had to finish first.
			if got := fmt.Sprint(fake.startedCommands()); mode == domain.GroupRunSequential && got != "[install block build]" {
				t.Fatalf("started = %s", got)
			}
			_ = r.CancelRepository("web")
		})
	}
}

func TestContinuousMemberFailingBeforeItsServerStartsFailsTheGroup(t *testing.T) {
	r := New(newFake())
	server := member("web", "fail", "block")
	server.Continuous = true
	if _, err := r.StartGroup(domain.Group{ID: "g", RunMode: domain.GroupRunSequential}, []domain.Repository{server, member("api", "build")}); err != nil {
		t.Fatal(err)
	}
	final, _ := r.WaitGroup("g")
	if got := repoStatuses(final); got != "web=failed api=cancelled " {
		t.Fatalf("statuses = %s", got)
	}
}
