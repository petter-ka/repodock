package process

import (
	"sync"
	"time"

	"github.com/example/repodock/internal/domain"
	"github.com/example/repodock/internal/modules/process/platform"
	gops "github.com/shirou/gopsutil/v4/process"
)

// statsSampler polls RSS/CPU for every active run's process tree on one
// shared ticker. One parent map per tick keeps the cost independent of the
// number of runs. It sleeps while nothing is running.
type statsSampler struct {
	m        *Manager
	interval time.Duration
	wakeCh   chan struct{}
	stop     chan struct{}
	once     sync.Once

	// cache keeps gopsutil handles across ticks; CPU percent is computed
	// from the delta since the previous sample of the same handle.
	cache map[int32]*gops.Process
}

func newStatsSampler(m *Manager, interval time.Duration) *statsSampler {
	s := &statsSampler{m: m, interval: interval, wakeCh: make(chan struct{}, 1), stop: make(chan struct{}), cache: map[int32]*gops.Process{}}
	go s.loop()
	return s
}

func (s *statsSampler) wake() {
	select {
	case s.wakeCh <- struct{}{}:
	default:
	}
}

func (s *statsSampler) close() { s.once.Do(func() { close(s.stop) }) }

func (s *statsSampler) loop() {
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	for {
		select {
		case <-s.stop:
			return
		case <-s.wakeCh:
		case <-ticker.C:
		}
		if !s.sample() {
			// Nothing running: drop handles and block until the next start.
			s.cache = map[int32]*gops.Process{}
			select {
			case <-s.stop:
				return
			case <-s.wakeCh:
			}
		}
	}
}

// sample emits one snapshot per running run and reports whether any run
// was active.
func (s *statsSampler) sample() bool {
	runs := s.m.ActiveRuns()
	live := make([]domain.Run, 0, len(runs))
	for _, run := range runs {
		if run.Status == domain.RunRunning && run.PID > 0 {
			live = append(live, run)
		}
	}
	if len(live) == 0 {
		return len(runs) > 0
	}

	parents, err := platform.ParentMap()
	if err != nil {
		parents = map[int32]int32{}
	}
	children := make(map[int32][]int32, len(parents))
	for pid, ppid := range parents {
		if pid != ppid {
			children[ppid] = append(children[ppid], pid)
		}
	}

	seen := map[int32]bool{}
	for _, run := range live {
		root := int32(run.PID)
		tree := descendants(root, children)
		snapshot := domain.ProcessSnapshot{RunID: run.ID, RepositoryID: run.RepositoryID, PID: root, Status: "unknown", ObservedAt: time.Now().UTC()}
		for _, pid := range tree {
			seen[pid] = true
			p := s.handle(pid)
			if p == nil {
				continue
			}
			snapshot.ProcessCount++
			if info, err := p.MemoryInfo(); err == nil {
				snapshot.MemoryBytes += info.RSS
			}
			if cpu, err := p.Percent(0); err == nil {
				snapshot.CPUPercent += cpu
			}
			if pid == root {
				if statuses, err := p.Status(); err == nil && len(statuses) > 0 {
					snapshot.Status = statuses[0]
				}
			}
		}

		s.m.mu.Lock()
		current, ok := s.m.runs[run.ID]
		stillRunning := ok && current.run.Status.Active()
		if stillRunning {
			s.m.snapshots[run.ID] = snapshot
		}
		s.m.mu.Unlock()
		if stillRunning {
			s.m.emit(EventStats, snapshot)
		}
	}
	for pid := range s.cache {
		if !seen[pid] {
			delete(s.cache, pid)
		}
	}
	return true
}

func (s *statsSampler) handle(pid int32) *gops.Process {
	if p, ok := s.cache[pid]; ok {
		return p
	}
	p, err := gops.NewProcess(pid)
	if err != nil {
		return nil
	}
	s.cache[pid] = p
	return p
}

// descendants returns root and every transitive child.
func descendants(root int32, children map[int32][]int32) []int32 {
	out := []int32{root}
	visited := map[int32]bool{root: true}
	for i := 0; i < len(out); i++ {
		for _, child := range children[out[i]] {
			if !visited[child] {
				visited[child] = true
				out = append(out, child)
			}
		}
	}
	return out
}
