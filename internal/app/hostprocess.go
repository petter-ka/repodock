package app

import (
	"context"
	"time"

	"github.com/example/repodock/internal/domain"
	"github.com/example/repodock/internal/modules/process/platform"
)

// Host process lookups can shell out (lsof on macOS), so they get a bound.
const hostLookupTimeout = 15 * time.Second

// FindProcessByPID describes any process on this machine (ADR-0018).
func (a *App) FindProcessByPID(pid int) (domain.HostProcess, error) {
	ctx, cancel := context.WithTimeout(context.Background(), hostLookupTimeout)
	defer cancel()
	info, err := a.host.Describe(ctx, int32(pid))
	if err != nil {
		return domain.HostProcess{}, err
	}
	a.annotateRun(&info)
	return info, nil
}

// FindProcessesByPort lists the processes listening on (or bound to) a port.
func (a *App) FindProcessesByPort(port int) ([]domain.HostProcess, error) {
	ctx, cancel := context.WithTimeout(context.Background(), hostLookupTimeout)
	defer cancel()
	list, err := a.host.ByPort(ctx, port)
	if err != nil {
		return nil, err
	}
	for i := range list {
		a.annotateRun(&list[i])
	}
	return list, nil
}

// KillHostProcess terminates a process: SIGTERM, then SIGKILL after a grace
// period. A process that belongs to a RepoDock run is stopped through the
// process manager instead, so the run's state and output stay consistent.
func (a *App) KillHostProcess(pid int, includeChildren bool) (domain.KillResult, error) {
	if run, ok := a.runOwning(pid); ok {
		if err := a.process.Stop(run.ID); err != nil {
			return domain.KillResult{}, err
		}
		return domain.KillResult{PID: pid, Signalled: []int{run.PID}, RunID: run.ID}, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), hostLookupTimeout)
	defer cancel()
	signalled, forced, err := a.host.Kill(ctx, int32(pid), includeChildren)
	if err != nil {
		return domain.KillResult{}, err
	}
	return domain.KillResult{PID: pid, Signalled: signalled, Forced: forced}, nil
}

func (a *App) annotateRun(info *domain.HostProcess) {
	if info.PID == 0 {
		return
	}
	if run, ok := a.runOwning(info.PID); ok {
		info.RunID, info.RepositoryID = run.ID, run.RepositoryID
	}
}

// runOwning finds the active run whose process tree contains pid.
func (a *App) runOwning(pid int) (domain.Run, bool) {
	runs := a.process.ActiveRuns()
	if len(runs) == 0 || pid <= 0 {
		return domain.Run{}, false
	}
	byPID := make(map[int32]domain.Run, len(runs))
	for _, run := range runs {
		byPID[int32(run.PID)] = run
	}
	parents, _ := platform.ParentMap()
	for current, depth := int32(pid), 0; current > 1 && depth < 64; depth++ {
		if run, ok := byPID[current]; ok {
			return run, true
		}
		parent, ok := parents[current]
		if !ok {
			break
		}
		current = parent
	}
	return domain.Run{}, false
}
