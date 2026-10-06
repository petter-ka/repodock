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
type lineWriter struct {
	buf       []byte
	pendingCR bool
	emit      func(string)
}

func newLineWriter(emit func(string)) *lineWriter { return &lineWriter{emit: emit} }

func (w *lineWriter) Write(p []byte) (int, error) {
	for _, b := range p {
		if w.pendingCR {
			w.pendingCR = false
			if b != '\n' {
				w.buf = w.buf[:0]
			}
		}
		switch b {
		case '\n':
			w.emitLine()
		case '\r':
			w.pendingCR = true
		default:
			w.buf = append(w.buf, b)
			if len(w.buf) >= maxLineBytes {
				w.emitLine()
			}
		}
	}
	return len(p), nil
}

// Flush emits a trailing partial line, if any.
func (w *lineWriter) Flush() {
	if len(w.buf) > 0 {
		w.emitLine()
	}
}

func (w *lineWriter) emitLine() {
	w.emit(string(w.buf))
	w.buf = w.buf[:0]
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
