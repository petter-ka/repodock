package app

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/example/repodock/internal/domain"
)

// Regression for "the first custom command is skipped": a custom command
// step moved before a long-running script must run first, to completion,
// and only then the next step starts.
func TestSequenceRunsCustomCommandFirstInSavedOrder(t *testing.T) {
	a := newTestApp(t)
	dir := fixture(t)
	repo, err := a.AddRepository(dir, "")
	if err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(dir, "installed.txt")
	// Saved order as the UI sends it after moving the custom step to the top.
	steps := []domain.CommandStep{
		{ID: "install", Label: "", Command: "echo installed> installed.txt", Enabled: true},
		{ID: "start", Label: "start", Command: "node -e \"require('fs').statSync('installed.txt'); console.log('started after install')\"", Enabled: true},
	}
	if err := a.SaveCommandSequence(repo.ID, steps); err != nil {
		t.Fatal(err)
	}
	seq, err := a.RunSequence(repo.ID)
	if err != nil {
		t.Fatal(err)
	}
	final, _ := a.sequence.Wait(seq.ID)
	if final.Status != domain.SequenceCompleted || final.Steps[0].StepID != "install" || final.Steps[0].Status != domain.StepCompleted || final.Steps[1].Status != domain.StepCompleted {
		t.Fatalf("sequence = %+v", final)
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatal("the custom command did not run")
	}
}
