package app

import (
	"context"

	"github.com/example/repodock/internal/domain"
)

// LeftoverProcesses lists runs from earlier RepoDock sessions that are still
// running, e.g. after RepoDock and its watchdog were both force-killed
// (ADR-0021). The frontend asks once at startup and lets the user decide.
func (a *App) LeftoverProcesses() []domain.LeftoverRun {
	if a.guard == nil {
		return []domain.LeftoverRun{}
	}
	ctx, cancel := context.WithTimeout(context.Background(), hostLookupTimeout)
	defer cancel()
	runs := a.guard.Leftovers(ctx)
	for i := range runs {
		if repo, ok := a.workspace.Repository(runs[i].RepositoryID); ok {
			runs[i].RepositoryName = repo.DisplayName()
		}
	}
	return runs
}

// StopLeftoverProcesses kills the processes of the given leftover runs and
// returns how many were signalled.
func (a *App) StopLeftoverProcesses(runIDs []string) int {
	if a.guard == nil {
		return 0
	}
	ctx, cancel := context.WithTimeout(context.Background(), hostLookupTimeout)
	defer cancel()
	return a.guard.StopLeftovers(ctx, runIDs)
}
