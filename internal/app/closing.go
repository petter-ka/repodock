package app

import (
	"context"
	"time"

	"github.com/example/repodock/internal/domain"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// EventClosing reports progress while RepoDock stops its processes before
// quitting (ADR-0023).
const EventClosing = "app:closing"

// shutdownGrace is how long processes get to exit after SIGTERM before they
// are killed.
const shutdownGrace = 5 * time.Second

const closeTick = 250 * time.Millisecond

type closeState int

const (
	closeIdle closeState = iota
	closeStopping
	closeDone
)

// beforeClose runs when the window is closed or the app is asked to quit.
// Stopping processes can take seconds, which would look like a frozen
// window, so the close is held back: the shutdown runs in the background
// while the frontend shows its progress, and RepoDock quits once it is done.
// It returns true to prevent the close.
func (a *App) beforeClose(ctx context.Context) bool {
	a.closeMu.Lock()
	defer a.closeMu.Unlock()
	switch a.closeState {
	case closeDone:
		return false
	case closeStopping:
		return true // closing again while stopping changes nothing
	}
	if len(a.process.ActiveRuns()) == 0 && a.process.LiveGroupCount() == 0 {
		return false // nothing to stop: OnShutdown is instant
	}
	a.closeState = closeStopping
	go a.closeInBackground(ctx)
	return true
}

func (a *App) closeInBackground(ctx context.Context) {
	started := time.Now()
	stop := make(chan struct{})
	reporting := make(chan struct{})
	go func() {
		defer close(reporting)
		ticker := time.NewTicker(closeTick)
		defer ticker.Stop()
		for {
			runtime.EventsEmit(ctx, EventClosing, a.closingProgress(started, false))
			select {
			case <-stop:
				return
			case <-ticker.C:
			}
		}
	}()

	a.shutdown(ctx)
	close(stop)
	<-reporting
	runtime.EventsEmit(ctx, EventClosing, a.closingProgress(started, true))

	a.closeMu.Lock()
	a.closeState = closeDone
	a.closeMu.Unlock()
	runtime.Quit(ctx)
}

func (a *App) closingProgress(started time.Time, done bool) domain.ClosingProgress {
	elapsed := time.Since(started)
	progress := domain.ClosingProgress{
		Runs:      []domain.ClosingRun{},
		Groups:    a.process.LiveGroupCount(),
		Forcing:   elapsed > shutdownGrace,
		Done:      done,
		ElapsedMs: elapsed.Milliseconds(),
	}
	for _, run := range a.process.ActiveRuns() {
		entry := domain.ClosingRun{RunID: run.ID, Label: run.Label, PID: run.PID}
		if repo, ok := a.workspace.Repository(run.RepositoryID); ok {
			entry.RepositoryName = repo.DisplayName()
		}
		progress.Runs = append(progress.Runs, entry)
	}
	return progress
}
