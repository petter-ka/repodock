// Package hostprocess inspects and terminates arbitrary processes on this
// machine (not only those RepoDock started): lookup by PID or by the port a
// process listens on, and graceful-then-forced termination. It backs the
// "Kill process" mini app (ADR-0018).
package hostprocess

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/example/repodock/internal/domain"
	gnet "github.com/shirou/gopsutil/v4/net"
	gops "github.com/shirou/gopsutil/v4/process"
)

// ErrNotFound means no process has the requested PID.
var ErrNotFound = errors.New("process not found")

const (
	maxCommandLength = 2000
	pollInterval     = 100 * time.Millisecond
	// udpSocket is SOCK_DGRAM; bound UDP sockets have no LISTEN state.
	udpSocket = 2
)

type Service struct {
	self  int32
	grace time.Duration
}

// New returns a service that waits grace after SIGTERM before forcing.
func New(grace time.Duration) *Service {
	return &Service{self: int32(os.Getpid()), grace: grace}
}

// Describe returns what is known about a process. Fields the OS does not
// reveal (e.g. another user's command line) are left empty.
func (s *Service) Describe(ctx context.Context, pid int32) (domain.HostProcess, error) {
	if pid <= 0 {
		return domain.HostProcess{}, fmt.Errorf("PID must be a positive number")
	}
	if ok, _ := gops.PidExistsWithContext(ctx, pid); !ok {
		return domain.HostProcess{}, fmt.Errorf("no process with PID %d: %w", pid, ErrNotFound)
	}
	info := domain.HostProcess{PID: int(pid), Ports: []int{}}
	proc, err := gops.NewProcessWithContext(ctx, pid)
	if err != nil {
		return domain.HostProcess{}, fmt.Errorf("no process with PID %d: %w", pid, ErrNotFound)
	}
	info.Name, _ = proc.NameWithContext(ctx)
	if ppid, err := proc.PpidWithContext(ctx); err == nil {
		info.PPID = int(ppid)
	}
	if cmd, err := proc.CmdlineWithContext(ctx); err == nil {
		if len(cmd) > maxCommandLength {
			cmd = cmd[:maxCommandLength] + "…"
		}
		info.Command = cmd
	}
	info.User, _ = proc.UsernameWithContext(ctx)
	if created, err := proc.CreateTimeWithContext(ctx); err == nil && created > 0 {
		info.StartedAt = time.UnixMilli(created).UTC().Format(time.RFC3339)
	}
	if conns, err := gnet.ConnectionsPidWithContext(ctx, "inet", pid); err == nil {
		info.Ports = listeningPorts(conns)
	}
	info.Protected = s.protected(ctx, pid)
	return info, nil
}

// ByPort returns the processes listening on a TCP port or bound to a UDP
// port. An entry with PID 0 means the socket exists but its owner is not
// visible (another user's process without sufficient permissions).
func (s *Service) ByPort(ctx context.Context, port int) ([]domain.HostProcess, error) {
	if port < 1 || port > 65535 {
		return nil, fmt.Errorf("port must be between 1 and 65535")
	}
	conns, err := gnet.ConnectionsWithContext(ctx, "inet")
	if err != nil {
		return nil, fmt.Errorf("list network connections: %w", err)
	}
	pids := map[int32]bool{}
	for _, c := range conns {
		if int(c.Laddr.Port) == port && listening(c) {
			pids[c.Pid] = true
		}
	}
	out := []domain.HostProcess{}
	for pid := range pids {
		if pid == 0 {
			out = append(out, domain.HostProcess{Ports: []int{port}, Protected: "owner not visible — it may belong to another user"})
			continue
		}
		info, err := s.Describe(ctx, pid)
		if err != nil {
			continue // exited in the meantime
		}
		out = append(out, info)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].PID < out[j].PID })
	return out, nil
}

// Kill terminates a process (and, optionally, its descendants first):
// SIGTERM, then SIGKILL for whatever is still alive after the grace period.
// It returns the PIDs that were signalled and whether force was needed.
func (s *Service) Kill(ctx context.Context, pid int32, children bool) ([]int, bool, error) {
	if reason := s.protected(ctx, pid); reason != "" {
		return nil, false, fmt.Errorf("refusing to kill PID %d: %s", pid, reason)
	}
	root, err := gops.NewProcessWithContext(ctx, pid)
	if err != nil {
		return nil, false, fmt.Errorf("no process with PID %d: %w", pid, ErrNotFound)
	}
	targets := []*gops.Process{}
	if children {
		targets = descendants(ctx, root) // deepest first
	}
	targets = append(targets, root)

	signalled := []int{}
	for _, p := range targets {
		if err := p.TerminateWithContext(ctx); err != nil {
			if gone(err) {
				continue
			}
			if p.Pid == pid {
				return nil, false, permissionHint(pid, err)
			}
			continue
		}
		signalled = append(signalled, int(p.Pid))
	}
	deadline := time.Now().Add(s.grace)
	for time.Now().Before(deadline) && anyAlive(ctx, targets) {
		select {
		case <-ctx.Done():
			return signalled, false, ctx.Err()
		case <-time.After(pollInterval):
		}
	}
	forced := false
	for _, p := range targets {
		if alive(ctx, p) {
			forced = true
			if err := p.KillWithContext(ctx); err != nil && !gone(err) && p.Pid == pid {
				return signalled, true, permissionHint(pid, err)
			}
		}
	}
	return signalled, forced, nil
}

// protected explains why a PID must not be killed from the UI, or "".
func (s *Service) protected(ctx context.Context, pid int32) string {
	switch {
	case pid <= 1:
		return "system process"
	case pid == s.self:
		return "this is RepoDock itself"
	}
	// Killing an ancestor (the launching shell, launchd session, terminal)
	// would take RepoDock down with it.
	for current, depth := s.self, 0; current > 1 && depth < 64; depth++ {
		p, err := gops.NewProcessWithContext(ctx, current)
		if err != nil {
			break
		}
		parent, err := p.PpidWithContext(ctx)
		if err != nil || parent <= 1 {
			break
		}
		if parent == pid {
			return "RepoDock runs inside this process"
		}
		current = parent
	}
	return ""
}

func listening(c gnet.ConnectionStat) bool {
	return c.Status == "LISTEN" || (c.Type == udpSocket && c.Raddr.Port == 0)
}

func listeningPorts(conns []gnet.ConnectionStat) []int {
	seen := map[int]bool{}
	ports := []int{}
	for _, c := range conns {
		port := int(c.Laddr.Port)
		if port > 0 && listening(c) && !seen[port] {
			seen[port] = true
			ports = append(ports, port)
		}
	}
	sort.Ints(ports)
	return ports
}

func descendants(ctx context.Context, p *gops.Process) []*gops.Process {
	out := []*gops.Process{}
	children, err := p.ChildrenWithContext(ctx)
	if err != nil {
		return out
	}
	for _, child := range children {
		out = append(out, descendants(ctx, child)...)
		out = append(out, child)
	}
	return out
}

func alive(ctx context.Context, p *gops.Process) bool {
	running, err := p.IsRunningWithContext(ctx)
	if err != nil || !running {
		return false
	}
	// A zombie has exited; it only waits for its parent to reap it.
	if status, err := p.StatusWithContext(ctx); err == nil {
		for _, s := range status {
			if s == gops.Zombie {
				return false
			}
		}
	}
	return true
}

func anyAlive(ctx context.Context, ps []*gops.Process) bool {
	for _, p := range ps {
		if alive(ctx, p) {
			return true
		}
	}
	return false
}

// gone reports an error meaning the process exited before it was signalled.
func gone(err error) bool {
	return errors.Is(err, os.ErrProcessDone) || errors.Is(err, syscall.ESRCH) || strings.Contains(err.Error(), "already finished") || strings.Contains(err.Error(), "no such process")
}

func permissionHint(pid int32, err error) error {
	if strings.Contains(strings.ToLower(err.Error()), "permitted") || strings.Contains(strings.ToLower(err.Error()), "denied") {
		return fmt.Errorf("not allowed to kill PID %d — it belongs to another user or the system", pid)
	}
	return fmt.Errorf("kill PID %d: %w", pid, err)
}
