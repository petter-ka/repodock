//go:build !windows

package guard

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

// sleeperFlag makes the test binary sleep. macOS hides the environment of
// its own platform binaries (sh, sleep), so the tests use this binary,
// which — like node — is readable.
const sleeperFlag = "--repodock-test-sleeper"

// startEscaped starts a sleeper in a session of its own — out of reach of
// group tracking, like a daemonizing dev tool — with the given environment.
// The returned channel closes when it exits.
func startEscaped(t *testing.T, env []string) (int, <-chan struct{}) {
	t.Helper()
	cmd := exec.Command(os.Args[0], sleeperFlag)
	cmd.Env = env
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	go func() { _ = cmd.Wait(); close(done) }()
	t.Cleanup(func() { _ = cmd.Process.Kill() })
	return cmd.Process.Pid, done
}

func waitExit(t *testing.T, done <-chan struct{}, within time.Duration) {
	t.Helper()
	select {
	case <-done:
	case <-time.After(within):
		t.Fatal("process is still running")
	}
}

func stillRunning(done <-chan struct{}) bool {
	select {
	case <-done:
		return false
	default:
		return true
	}
}

// deadSession tags env the way a RepoDock instance that no longer runs did.
func deadSession(runID string) []string {
	return append(os.Environ(), EnvSession+"=gone", EnvOwner+"=999999:1", EnvRunID+"="+runID, EnvRepositoryID+"=repo-1")
}

func TestTagReplacesInheritedMarkers(t *testing.T) {
	g := New(filepath.Join(t.TempDir(), "running.json"))
	env := g.Tag([]string{"PATH=/bin", EnvSession + "=parent", EnvRunID + "=parent-run"}, "run-1", "repo-1")
	got, ok := tagOf(env)
	if !ok || got.session != g.session || got.runID != "run-1" || got.repositoryID != "repo-1" || got.owner != g.owner {
		t.Fatalf("tag = %+v", got)
	}
	if len(env) != 5 {
		t.Fatalf("inherited markers must be dropped: %v", env)
	}
}

func TestStopOwnKillsProcessesThatLeftTheGroup(t *testing.T) {
	g := New(filepath.Join(t.TempDir(), "running.json"))
	_, mine := startEscaped(t, g.Tag(os.Environ(), "run-1", "repo-1"))
	_, other := startEscaped(t, New(filepath.Join(t.TempDir(), "other.json")).Tag(os.Environ(), "run-2", "repo-1"))
	time.Sleep(100 * time.Millisecond)
	if n := g.StopOwn(); n != 1 {
		t.Fatalf("signalled %d processes, want 1", n)
	}
	waitExit(t, mine, 5*time.Second)
	if !stillRunning(other) {
		t.Fatal("processes of another session must be left alone")
	}
}

func TestWatchdogKillsMarkedProcessesWhenRepoDockDies(t *testing.T) {
	g := New(filepath.Join(t.TempDir(), "running.json"))
	if err := g.StartWatchdog(); err != nil {
		t.Fatal(err)
	}
	_, done := startEscaped(t, g.Tag(os.Environ(), "run-1", "repo-1"))
	time.Sleep(200 * time.Millisecond)
	g.mu.Lock()
	_ = g.watchdog.Close() // crash: pipe closes without goodbye
	g.watchdog = nil
	g.mu.Unlock()
	waitExit(t, done, 5*time.Second)
}

func TestLeftoversListsOnlyProcessesOfDeadSessions(t *testing.T) {
	g := New(filepath.Join(t.TempDir(), "running.json"))
	pid, orphan := startEscaped(t, deadSession("old-run"))
	// Another instance that is still running (same owner as this test).
	_, live := startEscaped(t, New(filepath.Join(t.TempDir(), "live.json")).Tag(os.Environ(), "live-run", "repo-1"))
	_, own := startEscaped(t, g.Tag(os.Environ(), "own-run", "repo-1"))
	time.Sleep(100 * time.Millisecond)

	ctx := context.Background()
	found := g.Leftovers(ctx)
	if len(found) != 1 || found[0].RunID != "old-run" || found[0].RepositoryID != "repo-1" || found[0].PIDs[0] != pid {
		t.Fatalf("leftovers = %+v", found)
	}
	if n := g.StopLeftovers(ctx, []string{"another-run"}); n != 0 {
		t.Fatalf("stopping an unknown run signalled %d", n)
	}
	if n := g.StopLeftovers(ctx, nil); n != 0 {
		t.Fatalf("stopping no runs signalled %d", n)
	}
	if n := g.StopLeftovers(ctx, []string{"old-run"}); n != 1 {
		t.Fatalf("signalled %d, want 1", n)
	}
	waitExit(t, orphan, 5*time.Second)
	if !stillRunning(live) || !stillRunning(own) {
		t.Fatal("processes of live sessions must be left alone")
	}
}
