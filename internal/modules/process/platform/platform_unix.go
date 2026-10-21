//go:build !windows

package platform

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"syscall"
	"time"
)

// ShellCommand runs command through the user's login shell so PATH entries
// from shell profiles (Homebrew, …) are visible to GUI launches. The child
// gets env, with pathPrefix folders first on PATH; a prelude keeps them
// first after the profile ran and sets up nvm/fnm when the command calls
// them (ADR-0031). The child becomes the leader of a new process group.
func ShellCommand(command, workdir string, env []string, pathPrefix []string) *exec.Cmd {
	shell := userShell()
	if len(pathPrefix) > 0 {
		env = WithPath(env, strings.Join(pathPrefix, string(os.PathListSeparator)), nil)
	}
	cmd := exec.Command(shell, "-l", "-c", prelude(shell, command, pathPrefix, managerSetup)+command)
	cmd.Dir = workdir
	cmd.Env = env
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	return cmd
}

var plainArg = regexp.MustCompile(`^[A-Za-z0-9._:@/+=,\-]+$`)

// JoinArgv converts an argument vector into POSIX shell text using single
// quotes, which disable every expansion.
func JoinArgv(argv []string) (string, error) {
	if len(argv) == 0 {
		return "", fmt.Errorf("empty argument vector")
	}
	parts := make([]string, len(argv))
	for i, arg := range argv {
		if strings.IndexByte(arg, 0) >= 0 {
			return "", fmt.Errorf("argument contains a NUL byte")
		}
		if plainArg.MatchString(arg) {
			parts[i] = arg
			continue
		}
		parts[i] = "'" + strings.ReplaceAll(arg, "'", `'\''`) + "'"
	}
	return strings.Join(parts, " "), nil
}

type groupTree struct{ pgid int }

func Attach(cmd *exec.Cmd) Tree { return &groupTree{pgid: cmd.Process.Pid} }

// Terminate sends SIGTERM to the process group and escalates to SIGKILL if
// any member is still alive after grace.
func (t *groupTree) Terminate(grace time.Duration) error {
	if err := syscall.Kill(-t.pgid, syscall.SIGTERM); err != nil {
		if errors.Is(err, syscall.ESRCH) {
			return nil
		}
		return fmt.Errorf("signal process group %d: %w", t.pgid, err)
	}
	go func() {
		deadline := time.Now().Add(grace)
		for time.Now().Before(deadline) {
			if syscall.Kill(-t.pgid, 0) != nil {
				return
			}
			time.Sleep(100 * time.Millisecond)
		}
		_ = syscall.Kill(-t.pgid, syscall.SIGKILL)
	}()
	return nil
}

func (t *groupTree) Close() {}
