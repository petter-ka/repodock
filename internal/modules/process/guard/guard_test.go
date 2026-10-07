//go:build !windows

package guard

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"testing"
	"time"

	"github.com/example/repodock/internal/modules/process/platform"
)

// The test binary doubles as the watchdog, exactly like the app binary.
func TestMain(m *testing.M) {
	if len(os.Args) > 1 && os.Args[1] == WatchdogFlag {
		RunWatchdog(os.Stdin)
		os.Exit(0)
	}
	os.Exit(m.Run())
}

// startGroup starts `sleep` behind a shell in a new process group, the way
// RepoDock starts runs, and returns the group ID.
func startGroup(t *testing.T) int {
	t.Helper()
	cmd := exec.Command("/bin/sh", "-c", "sleep 60 & sleep 60")
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	pgid := cmd.Process.Pid
	go func() { _ = cmd.Wait() }()
	t.Cleanup(func() { _ = syscall.Kill(-pgid, syscall.SIGKILL) })
	return pgid
}

func waitGone(t *testing.T, pgid int, within time.Duration) {
	t.Helper()
	deadline := time.Now().Add(within)
	for platform.GroupAlive(pgid) && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	if platform.GroupAlive(pgid) {
		t.Fatalf("process group %d is still alive", pgid)
	}
}

func TestWatchdogKillsGroupsWhenRepoDockDies(t *testing.T) {
	g := New(filepath.Join(t.TempDir(), "running.json"))
	if err := g.StartWatchdog(); err != nil {
		t.Fatal(err)
	}
	pgid := startGroup(t)
	g.Track(pgid, "sleep")
	time.Sleep(200 * time.Millisecond)

	// A crash closes the pipe without a goodbye; simulate exactly that.
	g.mu.Lock()
	_ = g.watchdog.Close()
	g.watchdog = nil
	g.mu.Unlock()
	waitGone(t, pgid, 5*time.Second)
}

func TestWatchdogLeavesGroupsAloneAfterGoodbye(t *testing.T) {
	g := New(filepath.Join(t.TempDir(), "running.json"))
	if err := g.StartWatchdog(); err != nil {
		t.Fatal(err)
	}
	pgid := startGroup(t)
	g.Track(pgid, "sleep")
	g.Close() // clean shutdown path: the manager already stopped everything
	time.Sleep(time.Second)
	if !platform.GroupAlive(pgid) {
		t.Fatal("a clean goodbye must not kill anything")
	}
}

func TestSweepPreviousKillsVerifiedLeftovers(t *testing.T) {
	path := filepath.Join(t.TempDir(), "running.json")
	previous := New(path)
	pgid := startGroup(t)
	previous.Track(pgid, "sleep") // previous session crashed: record left behind

	reused := startGroup(t)
	data, _ := os.ReadFile(path)
	var rec record
	_ = json.Unmarshal(data, &rec)
	// A recycled PID: same group ID, different start time — must be spared.
	rec.Entries = append(rec.Entries, Entry{PGID: reused, LeaderStart: 1})
	data, _ = json.Marshal(rec)
	_ = os.WriteFile(path, data, 0o600)

	killed := New(path).SweepPrevious()
	if len(killed) != 1 || killed[0].PGID != pgid {
		t.Fatalf("killed = %+v", killed)
	}
	waitGone(t, pgid, 5*time.Second)
	if !platform.GroupAlive(reused) {
		t.Fatal("a group whose leader start time differs must not be killed")
	}
}

func TestSweepIgnoresRecordsFromAnotherBoot(t *testing.T) {
	path := filepath.Join(t.TempDir(), "running.json")
	pgid := startGroup(t)
	data, _ := json.Marshal(record{BootTime: 1, Entries: []Entry{{PGID: pgid, LeaderStart: startTime(pgid)}}})
	_ = os.WriteFile(path, data, 0o600)
	if killed := New(path).SweepPrevious(); len(killed) != 0 || !platform.GroupAlive(pgid) {
		t.Fatalf("records from another boot must be ignored, killed = %+v", killed)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("a stale record should be removed")
	}
}
