package process

import (
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/example/repodock/internal/domain"
	"github.com/example/repodock/internal/modules/process/platform"
	gops "github.com/shirou/gopsutil/v4/process"
)

type recorder struct {
	mu     sync.Mutex
	events []string
	lines  []domain.ProcessOutput
	stats  []domain.ProcessSnapshot
}

func (r *recorder) emit(event string, payload any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.events = append(r.events, event)
	switch p := payload.(type) {
	case []domain.ProcessOutput:
		r.lines = append(r.lines, p...)
	case domain.ProcessSnapshot:
		r.stats = append(r.stats, p)
	}
}

func (r *recorder) output(runID string) []domain.ProcessOutput {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []domain.ProcessOutput
	for _, line := range r.lines {
		if line.RunID == runID {
			out = append(out, line)
		}
	}
	return out
}

func newTestManager(t *testing.T) (*Manager, *recorder) {
	t.Helper()
	opts := DefaultOptions()
	opts.StatsInterval = 100 * time.Millisecond
	opts.OutputInterval = 10 * time.Millisecond
	opts.StopGrace = 500 * time.Millisecond
	m := New(opts)
	rec := &recorder{}
	m.SetEmitter(rec.emit)
	t.Cleanup(func() { m.Shutdown(5 * time.Second) })
	return m, rec
}

func spec(t *testing.T, command string) Spec {
	return Spec{RepositoryID: "repo", Workdir: t.TempDir(), Command: command}
}

func pick(windows, unix string) string {
	if runtime.GOOS == "windows" {
		return windows
	}
	return unix
}

func TestRunCapturesStdoutAndStderr(t *testing.T) {
	m, rec := newTestManager(t)
	run, err := m.Start(spec(t, pick("echo out& echo err 1>&2", "echo out; echo err 1>&2")))
	if err != nil {
		t.Fatal(err)
	}
	if run.PID == 0 || run.Status != domain.RunRunning {
		t.Fatalf("run = %#v", run)
	}
	final, err := m.Wait(run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if final.Status != domain.RunExited || final.ExitCode != 0 {
		t.Fatalf("final = %#v", final)
	}
	streams := map[string]string{}
	for _, line := range rec.output(run.ID) {
		streams[line.Stream] += strings.TrimSpace(line.Text)
		if line.RepositoryID != "repo" || line.PID != run.PID || line.Seq == 0 {
			t.Fatalf("line metadata = %#v", line)
		}
	}
	if streams["stdout"] != "out" || streams["stderr"] != "err" {
		t.Fatalf("streams = %#v", streams)
	}
	// All output must be delivered before the exit event.
	rec.mu.Lock()
	defer rec.mu.Unlock()
	last := rec.events[len(rec.events)-1]
	if last != EventExited {
		t.Fatalf("last event = %s, events = %v", last, rec.events)
	}
}

func TestRunNonZeroExit(t *testing.T) {
	m, _ := newTestManager(t)
	run, err := m.Start(spec(t, "exit 3"))
	if err != nil {
		t.Fatal(err)
	}
	final, _ := m.Wait(run.ID)
	if final.Status != domain.RunFailed || final.ExitCode != 3 {
		t.Fatalf("final = %#v", final)
	}
}

func TestEmptyCommandIsSkipped(t *testing.T) {
	m, rec := newTestManager(t)
	run, err := m.Start(spec(t, "   "))
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != domain.RunSkipped || run.ExitCode != 0 {
		t.Fatalf("run = %#v", run)
	}
	if _, err := m.Wait(run.ID); err != nil {
		t.Fatal(err)
	}
	rec.mu.Lock()
	defer rec.mu.Unlock()
	if len(rec.events) != 2 || rec.events[0] != EventStarted || rec.events[1] != EventExited {
		t.Fatalf("events = %v", rec.events)
	}
}

func TestMultilineCommandIsRejected(t *testing.T) {
	m, _ := newTestManager(t)
	if _, err := m.Start(spec(t, "echo a\necho b")); err == nil {
		t.Fatal("expected error")
	}
}

func TestMissingWorkdirFailsWithExplanation(t *testing.T) {
	m, rec := newTestManager(t)
	run, err := m.Start(Spec{RepositoryID: "repo", Workdir: t.TempDir() + "/missing", Command: "echo hi"})
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != domain.RunFailed {
		t.Fatalf("run = %#v", run)
	}
	lines := rec.output(run.ID)
	if len(lines) != 1 || lines[0].Stream != "stderr" || !strings.Contains(lines[0].Text, "working directory") {
		t.Fatalf("lines = %#v", lines)
	}
}

func TestStopTerminatesProcessTree(t *testing.T) {
	m, rec := newTestManager(t)
	run, err := m.Start(spec(t, pick("ping -n 60 127.0.0.1 > nul", "sleep 60; echo unreachable")))
	if err != nil {
		t.Fatal(err)
	}

	var child int32
	deadline := time.Now().Add(10 * time.Second)
	for child == 0 && time.Now().Before(deadline) {
		parents, err := platform.ParentMap()
		if err != nil {
			t.Fatal(err)
		}
		for pid, ppid := range parents {
			if ppid == int32(run.PID) {
				child = pid
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	if child == 0 {
		t.Fatal("child process never appeared")
	}

	// Let the stats sampler observe the running tree at least once.
	time.Sleep(350 * time.Millisecond)

	if err := m.Stop(run.ID); err != nil {
		t.Fatal(err)
	}
	final, _ := m.Wait(run.ID)
	if final.Status != domain.RunStopped {
		t.Fatalf("final = %#v", final)
	}

	deadline = time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if alive, _ := gops.PidExists(child); !alive {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if alive, _ := gops.PidExists(child); alive {
		t.Fatalf("child %d survived stop", child)
	}

	rec.mu.Lock()
	defer rec.mu.Unlock()
	if len(rec.stats) == 0 {
		t.Fatal("expected at least one stats snapshot")
	}
	if s := rec.stats[0]; s.RunID != run.ID || s.ProcessCount < 1 || s.MemoryBytes == 0 {
		t.Fatalf("snapshot = %#v", s)
	}
	if len(m.Snapshots()) != 0 {
		t.Fatal("snapshots of finished runs must be dropped")
	}
}

func TestRestartReusesSpec(t *testing.T) {
	m, _ := newTestManager(t)
	first, err := m.Start(spec(t, pick("ping -n 60 127.0.0.1 > nul", "sleep 60")))
	if err != nil {
		t.Fatal(err)
	}
	second, err := m.Restart(first.ID)
	if err != nil {
		t.Fatal(err)
	}
	if second.ID == first.ID || second.Command != first.Command || second.Status != domain.RunRunning {
		t.Fatalf("second = %#v", second)
	}
	if old, _ := m.Run(first.ID); old.Status != domain.RunStopped {
		t.Fatalf("first = %#v", old)
	}
	if err := m.StopRepository("repo"); err != nil {
		t.Fatal(err)
	}
	if final, _ := m.Wait(second.ID); final.Status != domain.RunStopped {
		t.Fatalf("final = %#v", final)
	}
}

func TestRetentionDropsOldFinishedRuns(t *testing.T) {
	m, _ := newTestManager(t)
	m.opts.RetainFinished = 3
	for range 6 {
		run, err := m.Start(spec(t, ""))
		if err != nil {
			t.Fatal(err)
		}
		_, _ = m.Wait(run.ID)
	}
	// Skipped runs bypass wait(), so trigger pruning explicitly.
	m.mu.Lock()
	m.pruneLocked()
	m.mu.Unlock()
	if got := len(m.Runs()); got != 3 {
		t.Fatalf("retained %d runs, want 3", got)
	}
}

func TestArgvIsQuotedForTheShell(t *testing.T) {
	m, rec := newTestManager(t)
	argv := []string{pick("echo", "printf"), pick("hello", "%s\\n"), pick("world", "a b;c")}
	run, err := m.Start(Spec{RepositoryID: "repo", Workdir: t.TempDir(), Argv: argv})
	if err != nil {
		t.Fatal(err)
	}
	final, _ := m.Wait(run.ID)
	if final.Status != domain.RunExited {
		t.Fatalf("final = %#v", final)
	}
	lines := rec.output(run.ID)
	want := pick("hello world", "a b;c")
	if len(lines) == 0 || strings.TrimSpace(lines[len(lines)-1].Text) != want {
		t.Fatalf("lines = %#v", lines)
	}
}

func TestLineWriter(t *testing.T) {
	var got []string
	w := newLineWriter(func(s string) { got = append(got, s) })
	_, _ = w.Write([]byte("a\r"))
	_, _ = w.Write([]byte("\nprogress 10%\rprogress 90%\rdone\nlast"))
	w.Flush()
	want := []string{"a", "done", "last"}
	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("got %q, want %q", got, want)
	}

	got = nil
	long := strings.Repeat("x", maxLineBytes+10)
	_, _ = w.Write([]byte(long + "\n"))
	if len(got) != 2 || len(got[0]) != maxLineBytes {
		t.Fatalf("long line split = %d parts", len(got))
	}
}
