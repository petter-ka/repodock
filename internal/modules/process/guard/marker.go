package guard

import (
	"context"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/example/repodock/internal/domain"
	gnet "github.com/shirou/gopsutil/v4/net"
	gops "github.com/shirou/gopsutil/v4/process"
)

// Marker environment variables (ADR-0021). Every process RepoDock starts
// gets them and every descendant inherits them, including processes that
// leave the process group (setsid, daemons) where group tracking cannot
// follow. They identify the process as RepoDock's after RepoDock is gone.
const (
	// EnvSession is a random ID per RepoDock launch.
	EnvSession = "REPODOCK_SESSION"
	// EnvOwner is "<pid>:<creation time ms>" of the RepoDock instance, so a
	// live instance (e.g. a second copy) is told apart from a dead one.
	EnvOwner        = "REPODOCK_OWNER"
	EnvRunID        = "REPODOCK_RUN_ID"
	EnvRepositoryID = "REPODOCK_REPOSITORY_ID"
)

const markerPrefix = "REPODOCK_"

type tag struct{ session, owner, runID, repositoryID string }

type tagged struct {
	proc    *gops.Process
	tag     tag
	ppid    int32
	created int64
}

// Tag returns env without marker variables RepoDock itself inherited (when
// it was started from a run of another instance) plus this session's
// markers for one run.
func (g *Guard) Tag(env []string, runID, repositoryID string) []string {
	out := make([]string, 0, len(env)+4)
	for _, kv := range env {
		if !strings.HasPrefix(kv, markerPrefix) {
			out = append(out, kv)
		}
	}
	return append(out,
		EnvSession+"="+g.session,
		EnvOwner+"="+g.owner,
		EnvRunID+"="+runID,
		EnvRepositoryID+"="+repositoryID,
	)
}

// StopOwn kills every process still carrying this session's marker. The
// process manager has already stopped the groups it tracks; this catches
// descendants that left their group. It returns how many were signalled.
func (g *Guard) StopOwn() int {
	return stopSession(g.session)
}

func stopSession(session string) int {
	if session == "" {
		return 0
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return terminate(scan(ctx, func(t tag) bool { return t.session == session }))
}

// Leftovers lists runs started by RepoDock sessions that are no longer
// running but whose processes still are, one entry per run.
func (g *Guard) Leftovers(ctx context.Context) []domain.LeftoverRun {
	found := g.orphans(ctx, func(string) bool { return true })
	if len(found) == 0 {
		return []domain.LeftoverRun{}
	}
	ports := listeningByPID(ctx)
	byRun := map[string][]tagged{}
	for _, t := range found {
		byRun[t.tag.runID] = append(byRun[t.tag.runID], t)
	}
	out := make([]domain.LeftoverRun, 0, len(byRun))
	for runID, members := range byRun {
		root := rootOf(members)
		entry := domain.LeftoverRun{RunID: runID, RepositoryID: root.tag.repositoryID, PIDs: []int{}, Ports: []int{}}
		if cmd, err := root.proc.CmdlineWithContext(ctx); err == nil {
			entry.Command = truncate(cmd, 300)
		}
		if root.created > 0 {
			entry.StartedAt = time.UnixMilli(root.created).UTC().Format(time.RFC3339)
		}
		sort.Slice(members, func(i, j int) bool { return members[i].created < members[j].created })
		seen := map[int]bool{}
		entry.PIDs = append(entry.PIDs, int(root.proc.Pid))
		for _, m := range members {
			if m.proc.Pid != root.proc.Pid {
				entry.PIDs = append(entry.PIDs, int(m.proc.Pid))
			}
			for _, port := range ports[m.proc.Pid] {
				if !seen[port] {
					seen[port] = true
					entry.Ports = append(entry.Ports, port)
				}
			}
		}
		sort.Ints(entry.Ports)
		out = append(out, entry)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StartedAt < out[j].StartedAt })
	return out
}

// StopLeftovers kills the processes of the given leftover runs. Processes
// are looked up again, so only those still marked by a dead session are
// touched. It returns how many were signalled.
func (g *Guard) StopLeftovers(ctx context.Context, runIDs []string) int {
	if len(runIDs) == 0 {
		return 0
	}
	only := map[string]bool{}
	for _, id := range runIDs {
		only[id] = true
	}
	return terminate(g.orphans(ctx, func(runID string) bool { return only[runID] }))
}

// orphans finds marked processes of the accepted runs whose RepoDock
// instance is gone.
func (g *Guard) orphans(ctx context.Context, runs func(runID string) bool) []tagged {
	owners := map[string]bool{}
	return scan(ctx, func(t tag) bool {
		if t.session == g.session || !runs(t.runID) {
			return false
		}
		alive, known := owners[t.owner]
		if !known {
			alive = ownerAlive(ctx, t.owner)
			owners[t.owner] = alive
		}
		return !alive
	})
}

// scan returns live processes whose environment carries a marker accepted
// by keep. Processes of other users are unreadable and skipped.
func scan(ctx context.Context, keep func(tag) bool) []tagged {
	pids, err := gops.PidsWithContext(ctx)
	if err != nil {
		return nil
	}
	self := int32(os.Getpid())
	out := []tagged{}
	for _, pid := range pids {
		if pid <= 1 || pid == self {
			continue
		}
		p, err := gops.NewProcessWithContext(ctx, pid)
		if err != nil {
			continue
		}
		env, err := p.EnvironWithContext(ctx)
		if err != nil {
			continue
		}
		t, ok := tagOf(env)
		if !ok || !keep(t) || zombie(ctx, p) {
			continue
		}
		entry := tagged{proc: p, tag: t}
		entry.ppid, _ = p.PpidWithContext(ctx)
		entry.created, _ = p.CreateTimeWithContext(ctx)
		out = append(out, entry)
	}
	return out
}

func tagOf(env []string) (tag, bool) {
	var t tag
	for _, kv := range env {
		if !strings.HasPrefix(kv, markerPrefix) {
			continue
		}
		key, value, _ := strings.Cut(kv, "=")
		switch key {
		case EnvSession:
			t.session = value
		case EnvOwner:
			t.owner = value
		case EnvRunID:
			t.runID = value
		case EnvRepositoryID:
			t.repositoryID = value
		}
	}
	return t, t.session != "" && t.owner != ""
}

func ownerOf(pid int) string {
	return strconv.Itoa(pid) + ":" + strconv.FormatInt(startTime(pid), 10)
}

// ownerAlive reports whether the RepoDock instance "<pid>:<created>" still
// runs: a reused PID has a different creation time.
func ownerAlive(ctx context.Context, owner string) bool {
	pidText, createdText, ok := strings.Cut(owner, ":")
	pid, err1 := strconv.Atoi(pidText)
	created, err2 := strconv.ParseInt(createdText, 10, 64)
	if !ok || err1 != nil || err2 != nil || pid <= 0 {
		return false
	}
	p, err := gops.NewProcessWithContext(ctx, int32(pid))
	if err != nil || zombie(ctx, p) {
		return false
	}
	actual, err := p.CreateTimeWithContext(ctx)
	return err == nil && actual == created
}

// rootOf picks the member whose parent is not in the same run (the process
// RepoDock started, or the oldest survivor once it exited).
func rootOf(members []tagged) tagged {
	in := map[int32]bool{}
	for _, m := range members {
		in[m.proc.Pid] = true
	}
	var root *tagged
	for i := range members {
		m := &members[i]
		if in[m.ppid] {
			continue
		}
		if root == nil || m.created < root.created {
			root = m
		}
	}
	if root == nil {
		return members[0]
	}
	return *root
}

// terminate sends SIGTERM, waits up to killGrace, then SIGKILLs survivors.
// A process is only force-killed if it is still the same one (same
// creation time), never a PID reused in the meantime.
func terminate(targets []tagged) int {
	signalled := 0
	for _, t := range targets {
		if t.proc.Terminate() == nil {
			signalled++
		}
	}
	if signalled == 0 {
		return 0
	}
	deadline := time.Now().Add(killGrace)
	for time.Now().Before(deadline) && anyRunning(targets) {
		time.Sleep(100 * time.Millisecond)
	}
	for _, t := range targets {
		if running(t) {
			_ = t.proc.Kill()
		}
	}
	return signalled
}

func running(t tagged) bool {
	ctx := context.Background()
	if ok, _ := t.proc.IsRunningWithContext(ctx); !ok || zombie(ctx, t.proc) {
		return false
	}
	created, err := t.proc.CreateTimeWithContext(ctx)
	return err == nil && created == t.created
}

func anyRunning(targets []tagged) bool {
	for _, t := range targets {
		if running(t) {
			return true
		}
	}
	return false
}

func zombie(ctx context.Context, p *gops.Process) bool {
	status, err := p.StatusWithContext(ctx)
	if err != nil {
		return false
	}
	for _, s := range status {
		if s == gops.Zombie {
			return true
		}
	}
	return false
}

// listeningByPID maps PIDs to the TCP ports they listen on.
func listeningByPID(ctx context.Context) map[int32][]int {
	out := map[int32][]int{}
	conns, err := gnet.ConnectionsWithContext(ctx, "tcp")
	if err != nil {
		return out
	}
	for _, c := range conns {
		if c.Status == "LISTEN" && c.Pid > 0 && c.Laddr.Port > 0 {
			out[c.Pid] = append(out[c.Pid], int(c.Laddr.Port))
		}
	}
	return out
}
