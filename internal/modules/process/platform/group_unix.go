//go:build !windows

package platform

import (
	"errors"
	"os/exec"
	"syscall"
)

// GroupID returns the process group a started command leads (ShellCommand
// sets Setpgid), or 0 when there is none.
func GroupID(cmd *exec.Cmd) int {
	if cmd.Process == nil {
		return 0
	}
	return cmd.Process.Pid
}

// GroupAlive reports whether any process is still in the group. EPERM means
// members exist but belong to someone else, which still counts as alive.
func GroupAlive(pgid int) bool {
	if pgid <= 1 {
		return false
	}
	err := syscall.Kill(-pgid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

// SignalGroup sends SIGTERM (force=false) or SIGKILL (force=true) to every
// member of the group. A group that no longer exists is not an error.
func SignalGroup(pgid int, force bool) error {
	if pgid <= 1 {
		return nil
	}
	sig := syscall.SIGTERM
	if force {
		sig = syscall.SIGKILL
	}
	if err := syscall.Kill(-pgid, sig); err != nil && !errors.Is(err, syscall.ESRCH) {
		return err
	}
	return nil
}

// GroupOf returns the process group of pid, or 0.
func GroupOf(pid int) int {
	pgid, err := syscall.Getpgid(pid)
	if err != nil {
		return 0
	}
	return pgid
}

// DetachedAttr starts a helper in its own session, so terminal hang-ups and
// Ctrl+C sent to RepoDock's process group do not reach it.
func DetachedAttr() *syscall.SysProcAttr { return &syscall.SysProcAttr{Setsid: true} }

// GroupsSupported is true where process groups are tracked for crash
// cleanup. Windows uses kill-on-close Job Objects instead.
const GroupsSupported = true
