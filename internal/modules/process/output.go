package process

import (
	"sync"
	"time"

	"github.com/example/repodock/internal/domain"
)

// maxLineBytes splits pathological lines so a single write cannot grow a
// buffer without bound.
const maxLineBytes = 16 * 1024

// lineWriter turns a byte stream into lines. A bare carriage return resets
// the current line, mimicking how a terminal redraws progress bars.
//
// Interactive prompts ("Continue? (y/n) ") usually end without a newline.
// When output pauses for promptIdle with such a partial line buffered, it is
// emitted with partial=true so the prompt is visible and the console can
// ask for input. Lines being redrawn with carriage returns (progress bars)
// are not flushed early. Write, Flush and the idle timer may run on
// different goroutines.
type lineWriter struct {
	mu         sync.Mutex
	buf        []byte
	pendingCR  bool
	redrawing  bool // buf was reset by a carriage return
	emit       func(text string, partial bool)
	promptIdle time.Duration
	timer      *time.Timer
	closed     bool
}

func newLineWriter(emit func(text string, partial bool), promptIdle time.Duration) *lineWriter {
	return &lineWriter{emit: emit, promptIdle: promptIdle}
}

func (w *lineWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	for _, b := range p {
		if w.pendingCR {
			w.pendingCR = false
			if b != '\n' {
				w.buf = w.buf[:0]
				w.redrawing = true
			}
		}
		switch b {
		case '\n':
			w.emitLine(false)
		case '\r':
			w.pendingCR = true
		default:
			w.buf = append(w.buf, b)
			if len(w.buf) >= maxLineBytes {
				w.emitLine(false)
			}
		}
	}
	w.armLocked()
	return len(p), nil
}

// armLocked (re)starts the prompt timer when a partial line is buffered.
func (w *lineWriter) armLocked() {
	if w.promptIdle <= 0 || w.closed || len(w.buf) == 0 || w.redrawing {
		if w.timer != nil {
			w.timer.Stop()
		}
		return
	}
	if w.timer == nil {
		w.timer = time.AfterFunc(w.promptIdle, w.flushPrompt)
	} else {
		w.timer.Reset(w.promptIdle)
	}
}

func (w *lineWriter) flushPrompt() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if !w.closed && len(w.buf) > 0 && !w.redrawing {
		w.emitLine(true)
	}
}

// Flush emits a trailing partial line, if any, and stops prompt detection.
func (w *lineWriter) Flush() {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.closed = true
	if w.timer != nil {
		w.timer.Stop()
	}
	if len(w.buf) > 0 {
		w.emitLine(false)
	}
}

func (w *lineWriter) emitLine(partial bool) {
	w.emit(string(w.buf), partial)
	w.buf = w.buf[:0]
	w.redrawing = false
}

// batcher coalesces output lines and emits them at most every interval (or
// when maxBatch lines are pending) so a chatty process cannot flood the
// renderer with one IPC event per line.
type batcher struct {
	mu       sync.Mutex
	pending  []domain.ProcessOutput
	emitMu   sync.Mutex
	emit     func([]domain.ProcessOutput)
	interval time.Duration
	maxBatch int
	stop     chan struct{}
	stopOnce sync.Once
}

func newBatcher(interval time.Duration, maxBatch int, emit func([]domain.ProcessOutput)) *batcher {
	b := &batcher{emit: emit, interval: interval, maxBatch: maxBatch, stop: make(chan struct{})}
	go b.loop()
	return b
}

func (b *batcher) add(line domain.ProcessOutput) {
	b.mu.Lock()
	b.pending = append(b.pending, line)
	full := len(b.pending) >= b.maxBatch
	b.mu.Unlock()
	if full {
		b.flush()
	}
}

// flush emits everything pending. emitMu serializes emission so batches
// reach the frontend in sequence order.
func (b *batcher) flush() {
	b.emitMu.Lock()
	defer b.emitMu.Unlock()
	b.mu.Lock()
	lines := b.pending
	b.pending = nil
	b.mu.Unlock()
	if len(lines) > 0 {
		b.emit(lines)
	}
}

func (b *batcher) loop() {
	ticker := time.NewTicker(b.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			b.flush()
		case <-b.stop:
			b.flush()
			return
		}
	}
}

func (b *batcher) close() { b.stopOnce.Do(func() { close(b.stop) }) }
