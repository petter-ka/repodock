//go:build windows

package platform

import (
	"os/exec"
	"syscall"
)

// Windows needs no group tracking: every run is in a Job Object with
// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, so the OS ends the whole tree when
// RepoDock exits for any reason, including a crash.

func GroupID(*exec.Cmd) int              { return 0 }
func GroupAlive(int) bool                { return false }
func SignalGroup(int, bool) error        { return nil }
func GroupOf(int) int                    { return 0 }
func DetachedAttr() *syscall.SysProcAttr { return &syscall.SysProcAttr{} }

const GroupsSupported = false
