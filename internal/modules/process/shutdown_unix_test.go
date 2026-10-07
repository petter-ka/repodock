//go:build !windows

package process

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// A shell that exits while leaving a child in its group (a typical ghost
// holding a port) must still be killed on shutdown.
func TestShutdownKillsChildrenLeftByExitedShell(t *testing.T) {
	m := New(Options{StatsInterval: time.Second, OutputInterval: 10 * time.Millisecond, StopGrace: 200 * time.Millisecond, RetainFinished: 10})
	pidFile := filepath.Join(t.TempDir(), "child.pid")
	run, err := m.Start(Spec{RepositoryID: "repo", Workdir: t.TempDir(), Command: "sh -c 'trap \"\" TERM; exec sleep 60' & echo $! > " + pidFile, Label: "ghost"})
	if err != nil {
		t.Fatal(err)
	}
	if done, ok := m.Done(run.ID); ok {
		<-done // the shell exits immediately, its child keeps running
	}
	var childPID int
	for i := 0; i < 50 && childPID == 0; i++ {
		data, _ := os.ReadFile(pidFile)
		childPID, _ = strconv.Atoi(strings.TrimSpace(string(data)))
		time.Sleep(20 * time.Millisecond)
	}
	if childPID == 0 || syscall.Kill(childPID, 0) != nil {
		t.Fatalf("expected a surviving child, pid %d", childPID)
	}

	start := time.Now()
	m.Shutdown(500 * time.Millisecond) // the child ignores SIGTERM: needs the synchronous SIGKILL
	// The SIGKILLed orphan is a zombie until launchd/init reaps it.
	for i := 0; i < 50 && syscall.Kill(childPID, 0) == nil; i++ {
		time.Sleep(20 * time.Millisecond)
	}
	if syscall.Kill(childPID, 0) == nil {
		t.Fatalf("child %d survived shutdown", childPID)
	}
	if time.Since(start) > 3*time.Second {
		t.Fatalf("shutdown took %v", time.Since(start))
	}
}
