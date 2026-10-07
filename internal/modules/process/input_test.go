package process

import (
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/example/repodock/internal/domain"
)

type partialLine struct {
	text    string
	partial bool
}

func TestLineWriterEmitsPromptAfterIdle(t *testing.T) {
	var mu sync.Mutex
	var got []partialLine
	w := newLineWriter(func(s string, partial bool) {
		mu.Lock()
		got = append(got, partialLine{s, partial})
		mu.Unlock()
	}, 20*time.Millisecond)
	snapshot := func() []partialLine {
		mu.Lock()
		defer mu.Unlock()
		return append([]partialLine{}, got...)
	}

	_, _ = w.Write([]byte("intro\nContinue? (y/n) "))
	time.Sleep(80 * time.Millisecond)
	lines := snapshot()
	if len(lines) != 2 || lines[0] != (partialLine{"intro", false}) || lines[1] != (partialLine{"Continue? (y/n) ", true}) {
		t.Fatalf("lines = %#v", lines)
	}

	// A progress bar redrawn with carriage returns is not flushed early.
	_, _ = w.Write([]byte("10%\r50%"))
	time.Sleep(80 * time.Millisecond)
	if len(snapshot()) != 2 {
		t.Fatalf("redrawn line must not be emitted as a prompt: %#v", snapshot())
	}
	_, _ = w.Write([]byte("\rdone\n"))
	w.Flush()
	lines = snapshot()
	if len(lines) != 3 || lines[2] != (partialLine{"done", false}) {
		t.Fatalf("lines = %#v", lines)
	}

	// After Flush the timer is disarmed.
	_, _ = w.Write([]byte("late"))
	time.Sleep(60 * time.Millisecond)
	if len(snapshot()) != 3 {
		t.Fatalf("no prompt detection after Flush: %#v", snapshot())
	}
}

func requireNode(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node is not available")
	}
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestSendInputAnswersPrompt(t *testing.T) {
	requireNode(t)
	m, rec := newTestManager(t)
	script := `node -e "process.stdout.write('Continue? (y/n) ');process.stdin.once('data',d=>{console.log('answer:'+String(d).trim());process.exit(0)})"`
	run, err := m.Start(spec(t, script))
	if err != nil {
		t.Fatal(err)
	}

	waitFor(t, "prompt", func() bool {
		for _, line := range rec.output(run.ID) {
			if line.Partial && strings.Contains(line.Text, "(y/n)") {
				return true
			}
		}
		return false
	})

	if err := m.SendInput(run.ID, "two\nlines", false); err == nil {
		t.Fatal("multi-line input must be rejected")
	}
	if err := m.SendInput(run.ID, "y", false); err != nil {
		t.Fatal(err)
	}
	final, _ := m.Wait(run.ID)
	if final.Status != domain.RunExited {
		t.Fatalf("final = %+v", final)
	}
	time.Sleep(50 * time.Millisecond)
	var echoed, answered bool
	for _, line := range rec.output(run.ID) {
		echoed = echoed || (line.Stream == "stdin" && line.Text == "y")
		answered = answered || strings.Contains(line.Text, "answer:y")
	}
	if !echoed || !answered {
		t.Fatalf("echoed=%v answered=%v output=%+v", echoed, answered, rec.output(run.ID))
	}
	if err := m.SendInput(run.ID, "y", false); err == nil {
		t.Fatal("input to a finished run must be rejected")
	}
}

func TestSecretInputIsMaskedAndCloseInputSendsEOF(t *testing.T) {
	requireNode(t)
	m, rec := newTestManager(t)
	script := `node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{console.log('got:'+s.trim().length);process.exit(0)})"`
	run, err := m.Start(spec(t, script))
	if err != nil {
		t.Fatal(err)
	}
	if err := m.SendInput(run.ID, "hunter2", true); err != nil {
		t.Fatal(err)
	}
	if err := m.CloseInput(run.ID); err != nil {
		t.Fatal(err)
	}
	if err := m.SendInput(run.ID, "more", false); err == nil {
		t.Fatal("input after EOF must be rejected")
	}
	final, _ := m.Wait(run.ID)
	if final.Status != domain.RunExited {
		t.Fatalf("final = %+v", final)
	}
	time.Sleep(50 * time.Millisecond)
	var got bool
	for _, line := range rec.output(run.ID) {
		if strings.Contains(line.Text, "hunter2") {
			t.Fatal("secret input must never be echoed")
		}
		got = got || strings.Contains(line.Text, "got:7")
	}
	if !got {
		t.Fatalf("output = %+v", rec.output(run.ID))
	}
}
