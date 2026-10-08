// Package guard makes sure processes started by RepoDock do not outlive it
// as "ghosts" holding ports and files (ADR-0019). It is used on platforms
// with process groups (macOS, Linux); Windows relies on kill-on-close Job
// Objects instead.
//
// Three layers, each covering what the previous cannot:
//   - the process manager kills every tracked group on a normal quit;
//   - a watchdog child process (this binary started with WatchdogFlag)
//     reads a pipe from RepoDock and kills the tracked groups as soon as the
//     pipe closes without a goodbye — i.e. when RepoDock crashes or is
//     force-quit (SIGKILL), which no in-process handler can catch;
//   - a small record file lists live groups; on the next launch, groups
//     from the same boot that still run the same processes are killed, in
//     case the watchdog died too;
//   - marker environment variables on every child (marker.go, ADR-0021)
//     find descendants that left their group, so quitting and the watchdog
//     kill them too, and a later launch can list what still survived.
package guard

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/example/repodock/internal/modules/process/platform"
	"github.com/google/uuid"
	"github.com/shirou/gopsutil/v4/host"
	gops "github.com/shirou/gopsutil/v4/process"
)

// WatchdogFlag is the argument that starts this binary as the watchdog.
const WatchdogFlag = "--repodock-process-watchdog"

// killGrace is how long a group gets between SIGTERM and SIGKILL.
const killGrace = 2 * time.Second

// Entry identifies one process group RepoDock started. LeaderStart (the
// group leader's creation time, ms) guards against PID reuse.
type Entry struct {
	PGID        int    `json:"pgid"`
	LeaderStart int64  `json:"leaderStart"`
	Command     string `json:"command"`
}

type record struct {
	BootTime uint64  `json:"bootTime"`
	Entries  []Entry `json:"entries"`
}

// Guard tracks live process groups in a record file and, once started, in
// the watchdog.
type Guard struct {
	mu       sync.Mutex
	path     string
	boot     uint64
	entries  map[int]Entry
	watchdog io.WriteCloser
	// session and owner are this launch's marker values (marker.go).
	session string
	owner   string
}

// New returns a guard that keeps its record at path.
func New(path string) *Guard {
	boot, _ := host.BootTime()
	return &Guard{path: path, boot: boot, entries: map[int]Entry{}, session: uuid.NewString(), owner: ownerOf(os.Getpid())}
}

// Track records a group RepoDock just started.
func (g *Guard) Track(pgid int, command string) {
	if pgid <= 1 || !platform.GroupsSupported {
		return
	}
	entry := Entry{PGID: pgid, LeaderStart: startTime(pgid), Command: truncate(command, 200)}
	g.mu.Lock()
	defer g.mu.Unlock()
	g.entries[pgid] = entry
	g.sendLocked(fmt.Sprintf("track %d %d", entry.PGID, entry.LeaderStart))
	g.saveLocked()
}

// Untrack forgets a group whose members have all exited.
func (g *Guard) Untrack(pgid int) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if _, ok := g.entries[pgid]; !ok {
		return
	}
	delete(g.entries, pgid)
	g.sendLocked(fmt.Sprintf("untrack %d", pgid))
	g.saveLocked()
}

// SweepPrevious kills groups left running by a previous session that ended
// without cleaning up, and returns them. Only entries from the current boot
// whose processes are verifiably the same are touched.
func (g *Guard) SweepPrevious() []Entry {
	if !platform.GroupsSupported {
		return nil
	}
	data, err := os.ReadFile(g.path)
	if err != nil {
		return nil
	}
	var previous record
	if json.Unmarshal(data, &previous) != nil || previous.BootTime == 0 || previous.BootTime != g.boot {
		_ = os.Remove(g.path) // unreadable, or from before a reboot: every PID is meaningless now
		return nil
	}
	killed := killAll(previous.Entries)
	g.mu.Lock()
	g.saveLocked()
	g.mu.Unlock()
	return killed
}

// StartWatchdog launches the watchdog process. Failure is logged, not
// fatal: the other layers still apply.
func (g *Guard) StartWatchdog() error {
	if !platform.GroupsSupported {
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate executable: %w", err)
	}
	cmd := exec.Command(exe, WatchdogFlag, g.session)
	cmd.SysProcAttr = platform.DetachedAttr()
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start watchdog: %w", err)
	}
	go func() { _ = cmd.Wait() }()
	g.mu.Lock()
	defer g.mu.Unlock()
	g.watchdog = stdin
	for _, e := range g.entries {
		g.sendLocked(fmt.Sprintf("track %d %d", e.PGID, e.LeaderStart))
	}
	return nil
}

// Close ends a clean shutdown: the caller has already stopped every group.
// The watchdog is told goodbye (so it exits without killing anything) and
// the record is removed.
func (g *Guard) Close() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.sendLocked("bye")
	if g.watchdog != nil {
		_ = g.watchdog.Close()
		g.watchdog = nil
	}
	g.entries = map[int]Entry{}
	_ = os.Remove(g.path)
}

func (g *Guard) sendLocked(line string) {
	if g.watchdog == nil {
		return
	}
	if _, err := io.WriteString(g.watchdog, line+"\n"); err != nil {
		slog.Warn("process watchdog unavailable", "error", err)
		_ = g.watchdog.Close()
		g.watchdog = nil
	}
}

func (g *Guard) saveLocked() {
	rec := record{BootTime: g.boot, Entries: make([]Entry, 0, len(g.entries))}
	for _, e := range g.entries {
		rec.Entries = append(rec.Entries, e)
	}
	if len(rec.Entries) == 0 {
		_ = os.Remove(g.path)
		return
	}
	data, _ := json.Marshal(rec)
	if err := os.MkdirAll(filepath.Dir(g.path), 0o700); err != nil {
		return
	}
	tmp := g.path + ".tmp"
	if os.WriteFile(tmp, data, 0o600) == nil {
		_ = os.Rename(tmp, g.path)
	}
}

// RunWatchdog is the watchdog's main loop. It returns when RepoDock says
// goodbye, or kills every tracked group — and every process still marked
// with session — when the pipe closes without one.
func RunWatchdog(in io.Reader, session string) {
	entries := map[int]Entry{}
	scanner := bufio.NewScanner(in)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		switch {
		case len(fields) == 1 && fields[0] == "bye":
			return
		case len(fields) == 3 && fields[0] == "track":
			pgid, err1 := strconv.Atoi(fields[1])
			start, err2 := strconv.ParseInt(fields[2], 10, 64)
			if err1 == nil && err2 == nil {
				entries[pgid] = Entry{PGID: pgid, LeaderStart: start}
			}
		case len(fields) == 2 && fields[0] == "untrack":
			if pgid, err := strconv.Atoi(fields[1]); err == nil {
				delete(entries, pgid)
			}
		}
	}
	// EOF without goodbye: RepoDock is gone.
	list := make([]Entry, 0, len(entries))
	for _, e := range entries {
		list = append(list, e)
	}
	killAll(list)
	stopSession(session)
}

// killAll terminates the groups that still belong to RepoDock: SIGTERM,
// then SIGKILL for whatever survives the grace period.
func killAll(entries []Entry) []Entry {
	targets := []Entry{}
	for _, e := range entries {
		if ours(e) {
			targets = append(targets, e)
		}
	}
	for _, e := range targets {
		_ = platform.SignalGroup(e.PGID, false)
	}
	deadline := time.Now().Add(killGrace)
	for time.Now().Before(deadline) && anyAlive(targets) {
		time.Sleep(100 * time.Millisecond)
	}
	for _, e := range targets {
		if platform.GroupAlive(e.PGID) {
			_ = platform.SignalGroup(e.PGID, true)
		}
	}
	return targets
}

// ours reports whether the group still contains processes RepoDock started.
// A live leader must have the recorded start time; if the leader has
// exited, a member of the group must have started after it. A PID cannot be
// reused as a group ID while that group exists, so a surviving group with a
// member newer than the leader's start is the original one.
func ours(e Entry) bool {
	if e.PGID <= 1 || !platform.GroupAlive(e.PGID) {
		return false
	}
	if leader, err := gops.NewProcess(int32(e.PGID)); err == nil {
		if created, err := leader.CreateTime(); err == nil {
			return e.LeaderStart != 0 && created == e.LeaderStart
		}
	}
	pids, err := gops.Pids()
	if err != nil {
		return false
	}
	for _, pid := range pids {
		if platform.GroupOf(int(pid)) != e.PGID {
			continue
		}
		if p, err := gops.NewProcess(pid); err == nil {
			if created, err := p.CreateTime(); err == nil && created >= e.LeaderStart {
				return true
			}
		}
	}
	return false
}

func anyAlive(entries []Entry) bool {
	for _, e := range entries {
		if platform.GroupAlive(e.PGID) {
			return true
		}
	}
	return false
}

func startTime(pid int) int64 {
	p, err := gops.NewProcess(int32(pid))
	if err != nil {
		return 0
	}
	created, _ := p.CreateTime()
	return created
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
