// Package process owns child process lifecycle, output streaming, metrics and
// termination (ADR-0002). Each run gets its own exec.Cmd and goroutines; all
// shared state goes through Manager's lock.
package process

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/example/repodock/internal/domain"
	"github.com/example/repodock/internal/modules/process/platform"
	"github.com/google/uuid"
)

// Event names emitted by the manager.
const (
	EventStarted     = "process:started"
	EventOutputBatch = "process:output-batch"
	EventStats       = "process:stats"
	EventExited      = "process:exited"
)

// Emitter delivers events to the presentation layer. It must not block.
type Emitter func(event string, payload any)

// Spec describes what to run. Exactly one of Argv or Command is used; when
// both are empty the run is a recorded no-op (ADR-0006).
type Spec struct {
	RepositoryID string
	Workdir      string
	Label        string
	// Command is shell text entered by the user and run verbatim.
	Command string
	// Argv is a structured invocation (e.g. a package script). It is quoted
	// by the platform layer, never concatenated by callers.
	Argv       []string
	SequenceID string
	StepID     string
}

type Options struct {
	StatsInterval  time.Duration
	OutputInterval time.Duration
	StopGrace      time.Duration
	// PromptIdle is how long output must pause before an unterminated line
	// is shown as a prompt. Zero disables prompt detection.
	PromptIdle time.Duration
	// RetainFinished bounds how many finished runs are kept for display.
	RetainFinished int
}

func DefaultOptions() Options {
	return Options{StatsInterval: time.Second, OutputInterval: 50 * time.Millisecond, StopGrace: 3 * time.Second, PromptIdle: 250 * time.Millisecond, RetainFinished: 200}
}

type Manager struct {
	opts Options

	mu        sync.RWMutex
	runs      map[string]*trackedRun
	order     []string
	snapshots map[string]domain.ProcessSnapshot

	emitMu  sync.RWMutex
	emitter Emitter

	seq    atomic.Uint64
	output *batcher
	stats  *statsSampler
}

type trackedRun struct {
	run           domain.Run
	spec          Spec
	cmd           *exec.Cmd
	tree          platform.Tree
	done          chan struct{}
	stopRequested bool

	// stdin is the write end of the child's standard input. inputMu
	// serializes writes so lines from concurrent calls never interleave.
	stdin       io.WriteCloser
	inputMu     sync.Mutex
	inputClosed bool
}

func New(opts Options) *Manager {
	m := &Manager{opts: opts, runs: map[string]*trackedRun{}, snapshots: map[string]domain.ProcessSnapshot{}}
	m.output = newBatcher(opts.OutputInterval, 500, func(lines []domain.ProcessOutput) { m.emit(EventOutputBatch, lines) })
	m.stats = newStatsSampler(m, opts.StatsInterval)
	platform.WarmEnvironment()
	return m
}

func (m *Manager) SetEmitter(emitter Emitter) {
	m.emitMu.Lock()
	m.emitter = emitter
	m.emitMu.Unlock()
}

// Start launches spec and returns immediately. A spawn failure yields a
// failed run (with an explanatory stderr line) rather than an error, so the
// console can show why; an error is returned only for invalid input.
func (m *Manager) Start(spec Spec) (domain.Run, error) {
	text, err := commandText(spec)
	if err != nil {
		return domain.Run{}, err
	}
	if spec.RepositoryID == "" {
		return domain.Run{}, fmt.Errorf("repository ID is required")
	}
	label := strings.TrimSpace(spec.Label)
	if label == "" {
		label = text
	}
	now := time.Now().UTC()
	t := &trackedRun{
		spec: spec,
		done: make(chan struct{}),
		run: domain.Run{
			ID: uuid.NewString(), RepositoryID: spec.RepositoryID, Command: text, Label: label,
			Status: domain.RunStarting, ExitCode: -1, StartedAt: now,
			SequenceID: spec.SequenceID, StepID: spec.StepID,
		},
	}

	if text == "" {
		t.run.Status = domain.RunSkipped
		t.run.ExitCode = 0
		t.run.EndedAt = now
		close(t.done)
		m.register(t)
		m.emit(EventStarted, t.run)
		m.emit(EventExited, exitOf(t.run))
		return t.run, nil
	}

	if info, err := os.Stat(spec.Workdir); err != nil || !info.IsDir() {
		return m.failStart(t, fmt.Errorf("working directory %q is not available", spec.Workdir)), nil
	}

	cmd := platform.ShellCommand(text, spec.Workdir)
	cmd.Env = childEnv()
	cmd.WaitDelay = 2 * time.Second
	stdout := newLineWriter(func(line string, partial bool) { m.appendOutput(t, "stdout", line, partial) }, m.opts.PromptIdle)
	stderr := newLineWriter(func(line string, partial bool) { m.appendOutput(t, "stderr", line, partial) }, m.opts.PromptIdle)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	t.cmd = cmd

	m.register(t)
	// A pipe keeps stdin open so interactive prompts can be answered with
	// SendInput; it is closed by CloseInput (EOF) or when the process exits.
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return m.failStart(t, fmt.Errorf("open standard input: %w", err)), nil
	}
	t.stdin = stdin
	if err := cmd.Start(); err != nil {
		return m.failStart(t, fmt.Errorf("start command: %w", err)), nil
	}
	tree := platform.Attach(cmd)

	m.mu.Lock()
	t.tree = tree
	t.run.PID = cmd.Process.Pid
	t.run.Status = domain.RunRunning
	run := t.run
	m.mu.Unlock()

	m.emit(EventStarted, run)
	go m.wait(t, stdout, stderr)
	m.stats.wake()
	return run, nil
}

func commandText(spec Spec) (string, error) {
	if len(spec.Argv) > 0 {
		return platform.JoinArgv(spec.Argv)
	}
	text := strings.TrimSpace(spec.Command)
	if err := platform.ValidateCommandText(text); err != nil {
		return "", err
	}
	return text, nil
}

// childEnv inherits the host environment, extends PATH with the user's
// shell PATH on macOS/Linux (GUI launches lack it), and asks common Node
// tooling to keep colors even though output is not a TTY. Env-file values
// are never injected implicitly (see process-model.md).
func childEnv() []string {
	env := platform.ChildEnvironment(os.Environ())
	if _, ok := os.LookupEnv("FORCE_COLOR"); !ok {
		env = append(env, "FORCE_COLOR=1")
	}
	return env
}

func (m *Manager) failStart(t *trackedRun, cause error) domain.Run {
	m.register(t)
	m.appendOutput(t, "stderr", "RepoDock: "+cause.Error(), false)
	m.output.flush()
	m.mu.Lock()
	t.run.Status = domain.RunFailed
	t.run.EndedAt = time.Now().UTC()
	run := t.run
	m.mu.Unlock()
	close(t.done)
	m.emit(EventStarted, run)
	m.emit(EventExited, exitOf(run))
	return run
}

func (m *Manager) register(t *trackedRun) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.runs[t.run.ID]; exists {
		return
	}
	m.runs[t.run.ID] = t
	m.order = append(m.order, t.run.ID)
}

func (m *Manager) appendOutput(t *trackedRun, stream, text string, partial bool) {
	m.mu.RLock()
	pid := t.run.PID
	m.mu.RUnlock()
	m.output.add(domain.ProcessOutput{
		RunID: t.run.ID, RepositoryID: t.run.RepositoryID, PID: pid,
		Stream: stream, Text: text, Partial: partial, Seq: m.seq.Add(1), Timestamp: time.Now().UTC(),
	})
}

// MaxInputLength bounds one line of input sent to a process.
const MaxInputLength = 4096

// inputTimeout bounds how long SendInput waits for a process that is not
// reading its input (and whose pipe buffer is full).
const inputTimeout = 3 * time.Second

// SendInput writes one line (text plus a newline) to the run's standard
// input, answering prompts such as "Continue? (y/n)". The line is echoed to
// the console as a "stdin" output line; secret input is echoed masked.
// The text is passed to the process as data and never interpreted.
func (m *Manager) SendInput(runID, text string, secret bool) error {
	if len(text) > MaxInputLength {
		return fmt.Errorf("input is longer than %d bytes", MaxInputLength)
	}
	if strings.ContainsAny(text, "\r\n\x00") {
		return fmt.Errorf("input must be a single line")
	}
	t, err := m.inputTarget(runID)
	if err != nil {
		return err
	}
	echo := text
	if secret {
		echo = strings.Repeat("•", min(len([]rune(text)), 12))
	}
	m.appendOutput(t, "stdin", echo, false)
	return t.writeInput([]byte(text + "\n"))
}

// CloseInput closes the run's standard input so the process reads EOF
// (like Ctrl+D in a terminal). Further input is rejected.
func (m *Manager) CloseInput(runID string) error {
	t, err := m.inputTarget(runID)
	if err != nil {
		return err
	}
	t.inputMu.Lock()
	defer t.inputMu.Unlock()
	if t.inputClosed {
		return nil
	}
	t.inputClosed = true
	m.appendOutput(t, "stdin", "^D", false)
	return t.stdin.Close()
}

func (m *Manager) inputTarget(runID string) (*trackedRun, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	t, ok := m.runs[runID]
	if !ok {
		return nil, fmt.Errorf("run not found: %s", runID)
	}
	if t.run.Status != domain.RunRunning || t.stdin == nil {
		return nil, fmt.Errorf("the process is not running")
	}
	return t, nil
}

func (t *trackedRun) writeInput(data []byte) error {
	t.inputMu.Lock()
	defer t.inputMu.Unlock()
	if t.inputClosed {
		return fmt.Errorf("input was closed for this process")
	}
	// A pipe write blocks when the child does not read and the buffer is
	// full; never let that hang the caller.
	result := make(chan error, 1)
	go func() {
		_, err := t.stdin.Write(data)
		result <- err
	}()
	select {
	case err := <-result:
		if err != nil {
			return fmt.Errorf("send input: %w", err)
		}
		return nil
	case <-time.After(inputTimeout):
		return fmt.Errorf("the process is not reading its input")
	case <-t.done:
		return fmt.Errorf("the process exited")
	}
}

func (m *Manager) wait(t *trackedRun, stdout, stderr *lineWriter) {
	err := t.cmd.Wait()
	// Wait has returned, so the copy goroutines are finished (or abandoned
	// after WaitDelay) and the writers can be flushed safely.
	stdout.Flush()
	stderr.Flush()
	if t.tree != nil {
		t.tree.Close()
	}

	exitCode := -1
	if t.cmd.ProcessState != nil {
		exitCode = t.cmd.ProcessState.ExitCode()
	}

	m.mu.Lock()
	status := domain.RunExited
	switch {
	case t.stopRequested:
		status = domain.RunStopped
	case exitCode != 0:
		status = domain.RunFailed
	case err != nil && !errors.Is(err, exec.ErrWaitDelay):
		status = domain.RunFailed
	}
	t.run.ExitCode = exitCode
	t.run.Status = status
	t.run.EndedAt = time.Now().UTC()
	run := t.run
	delete(m.snapshots, run.ID)
	m.pruneLocked()
	m.mu.Unlock()

	// Output must reach the frontend before the terminal state.
	m.output.flush()
	close(t.done)
	m.emit(EventExited, exitOf(run))
}

// pruneLocked drops the oldest finished runs beyond the retention limit.
func (m *Manager) pruneLocked() {
	finished := 0
	for _, id := range m.order {
		if t, ok := m.runs[id]; ok && !t.run.Status.Active() {
			finished++
		}
	}
	if finished <= m.opts.RetainFinished {
		return
	}
	drop := finished - m.opts.RetainFinished
	kept := m.order[:0]
	for _, id := range m.order {
		t := m.runs[id]
		if drop > 0 && t != nil && !t.run.Status.Active() {
			delete(m.runs, id)
			drop--
			continue
		}
		kept = append(kept, id)
	}
	m.order = kept
}

func exitOf(run domain.Run) domain.ProcessExit {
	return domain.ProcessExit{RunID: run.ID, RepositoryID: run.RepositoryID, ExitCode: run.ExitCode, Status: run.Status, EndedAt: run.EndedAt}
}

// Wait blocks until the run reaches a terminal state.
func (m *Manager) Wait(runID string) (domain.Run, error) {
	m.mu.RLock()
	t, ok := m.runs[runID]
	m.mu.RUnlock()
	if !ok {
		return domain.Run{}, fmt.Errorf("run not found: %s", runID)
	}
	<-t.done
	m.mu.RLock()
	defer m.mu.RUnlock()
	return t.run, nil
}

// Done returns a channel closed when the run finishes.
func (m *Manager) Done(runID string) (<-chan struct{}, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	t, ok := m.runs[runID]
	if !ok {
		return nil, false
	}
	return t.done, true
}

func (m *Manager) Run(runID string) (domain.Run, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	t, ok := m.runs[runID]
	if !ok {
		return domain.Run{}, false
	}
	return t.run, true
}

// Stop terminates the run's process tree. Stopping a finished run is a no-op.
func (m *Manager) Stop(runID string) error {
	m.mu.Lock()
	t, ok := m.runs[runID]
	if !ok {
		m.mu.Unlock()
		return fmt.Errorf("run not found: %s", runID)
	}
	if t.run.Status != domain.RunRunning || t.tree == nil {
		m.mu.Unlock()
		return nil
	}
	t.stopRequested = true
	t.run.Status = domain.RunStopping
	run := t.run
	tree := t.tree
	m.mu.Unlock()

	// The MVP contract reuses process:started for the stopping-state update.
	m.emit(EventStarted, run)
	if err := tree.Terminate(m.opts.StopGrace); err != nil {
		return fmt.Errorf("stop run %s: %w", runID, err)
	}
	return nil
}

// Restart stops the run if needed, waits for it, and starts the same spec.
func (m *Manager) Restart(runID string) (domain.Run, error) {
	m.mu.RLock()
	t, ok := m.runs[runID]
	m.mu.RUnlock()
	if !ok {
		return domain.Run{}, fmt.Errorf("run not found: %s", runID)
	}
	if err := m.Stop(runID); err != nil {
		return domain.Run{}, err
	}
	select {
	case <-t.done:
	case <-time.After(m.opts.StopGrace + 5*time.Second):
		return domain.Run{}, fmt.Errorf("run %s did not stop in time", runID)
	}
	return m.Start(t.spec)
}

// StopRepository stops every active run belonging to a repository.
func (m *Manager) StopRepository(repoID string) error {
	var errs []error
	for _, run := range m.ActiveRuns() {
		if run.RepositoryID == repoID {
			if err := m.Stop(run.ID); err != nil {
				errs = append(errs, err)
			}
		}
	}
	return errors.Join(errs...)
}

// Shutdown stops every active run and waits up to timeout for them to exit.
func (m *Manager) Shutdown(timeout time.Duration) {
	active := m.ActiveRuns()
	for _, run := range active {
		_ = m.Stop(run.ID)
	}
	deadline := time.After(timeout)
	for _, run := range active {
		if done, ok := m.Done(run.ID); ok {
			select {
			case <-done:
			case <-deadline:
				m.stats.close()
				m.output.close()
				return
			}
		}
	}
	m.stats.close()
	m.output.close()
}

// ActiveRuns returns runs that still own a live process, oldest first.
func (m *Manager) ActiveRuns() []domain.Run {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]domain.Run, 0)
	for _, id := range m.order {
		if t := m.runs[id]; t != nil && t.run.Status.Active() {
			out = append(out, t.run)
		}
	}
	return out
}

// Runs returns all retained runs (active and recently finished), oldest first.
func (m *Manager) Runs() []domain.Run {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]domain.Run, 0, len(m.order))
	for _, id := range m.order {
		if t := m.runs[id]; t != nil {
			out = append(out, t.run)
		}
	}
	return out
}

func (m *Manager) Snapshots() []domain.ProcessSnapshot {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]domain.ProcessSnapshot, 0, len(m.snapshots))
	for _, snapshot := range m.snapshots {
		out = append(out, snapshot)
	}
	return out
}

func (m *Manager) emit(event string, payload any) {
	m.emitMu.RLock()
	emitter := m.emitter
	m.emitMu.RUnlock()
	if emitter != nil {
		emitter(event, payload)
	}
}
