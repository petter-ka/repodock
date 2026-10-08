package hostprocess

import (
	"context"
	"errors"
	"net"
	"os"
	"os/exec"
	"runtime"
	"slices"
	"testing"
	"time"
)

func startSleeper(t *testing.T, ignoreTerm bool) *exec.Cmd {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("uses POSIX shell")
	}
	script := "sleep 30"
	if ignoreTerm {
		script = "trap '' TERM; sleep 30 & wait"
	}
	cmd := exec.Command("/bin/sh", "-c", script)
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	// Reap in the background so the PID disappears once it exits. Wait must
	// be called exactly once, so cleanup waits for this goroutine instead.
	reaped := make(chan struct{})
	go func() { _ = cmd.Wait(); close(reaped) }()
	t.Cleanup(func() { _ = cmd.Process.Kill(); <-reaped })
	return cmd
}

func TestDescribeAndKill(t *testing.T) {
	s := New(time.Second)
	ctx := context.Background()
	cmd := startSleeper(t, false)
	pid := int32(cmd.Process.Pid)

	info, err := s.Describe(ctx, pid)
	if err != nil || info.PID != int(pid) || info.Name == "" || info.Protected != "" {
		t.Fatalf("describe = %+v, %v", info, err)
	}
	signalled, forced, err := s.Kill(ctx, pid, false)
	if err != nil || !slices.Contains(signalled, int(pid)) || forced {
		t.Fatalf("kill = %v %v %v", signalled, forced, err)
	}
}

func TestKillForcesAfterGrace(t *testing.T) {
	s := New(300 * time.Millisecond)
	cmd := startSleeper(t, true)
	time.Sleep(100 * time.Millisecond) // let the trap install
	_, forced, err := s.Kill(context.Background(), int32(cmd.Process.Pid), true)
	if err != nil || !forced {
		t.Fatalf("forced = %v, err = %v", forced, err)
	}
}

func TestProtectedProcesses(t *testing.T) {
	s := New(time.Second)
	ctx := context.Background()
	for _, pid := range []int32{1, int32(os.Getpid()), int32(os.Getppid())} {
		if _, _, err := s.Kill(ctx, pid, false); err == nil {
			t.Fatalf("killing PID %d must be refused", pid)
		}
	}
	if _, err := s.Describe(ctx, 0); err == nil {
		t.Fatal("PID 0 must be rejected")
	}
}

func TestDescribeMissingPID(t *testing.T) {
	cmd := startSleeper(t, false)
	pid := cmd.Process.Pid
	_ = cmd.Process.Kill()
	time.Sleep(200 * time.Millisecond)
	if _, err := New(time.Second).Describe(context.Background(), int32(pid)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("err = %v", err)
	}
}

func TestByPortFindsListener(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port
	s := New(time.Second)
	list, err := s.ByPort(context.Background(), port)
	if err != nil {
		t.Skipf("connections not available here: %v", err)
	}
	found := false
	for _, p := range list {
		if p.PID == os.Getpid() {
			found = true
			if p.Protected == "" || !slices.Contains(p.Ports, port) {
				t.Fatalf("self entry = %+v", p)
			}
		}
	}
	if !found {
		t.Fatalf("listener on %d not found in %+v", port, list)
	}
	if _, err := s.ByPort(context.Background(), 70000); err == nil {
		t.Fatal("out-of-range port must be rejected")
	}
}
