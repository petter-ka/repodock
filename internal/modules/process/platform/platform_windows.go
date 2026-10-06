//go:build windows

package platform

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// ShellCommand runs command through cmd.exe. The command line is passed raw
// (`/s /c "<command>"`) because Go's default argument escaping follows the
// MSVCRT rules, which cmd.exe does not understand.
func ShellCommand(command, workdir string) *exec.Cmd {
	shell := os.Getenv("ComSpec")
	if shell == "" || !filepath.IsAbs(shell) {
		shell = filepath.Join(os.Getenv("SystemRoot"), "System32", "cmd.exe")
	}
	cmd := exec.Command(shell)
	cmd.Dir = workdir
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CmdLine:       `cmd.exe /d /s /c "` + command + `"`,
		HideWindow:    true,
		CreationFlags: windows.CREATE_NO_WINDOW | windows.CREATE_NEW_PROCESS_GROUP,
	}
	return cmd
}

// safeArg is the conservative character set that passes through cmd.exe
// unchanged: no quotes, spaces, %, ^, &, |, <, >, (, ) or !.
var safeArg = regexp.MustCompile(`^[A-Za-z0-9._:@/+=,\-\\]+$`)

// JoinArgv converts an argument vector into cmd.exe text. cmd.exe has no
// reliable quoting for arbitrary data, so arguments outside a safe character
// set are rejected instead of escaped.
func JoinArgv(argv []string) (string, error) {
	if len(argv) == 0 {
		return "", fmt.Errorf("empty argument vector")
	}
	for _, arg := range argv {
		if !safeArg.MatchString(arg) {
			return "", fmt.Errorf("argument %q contains characters that cannot be passed safely to cmd.exe; run it as a custom command instead", arg)
		}
	}
	return strings.Join(argv, " "), nil
}

type jobTree struct {
	pid int
	job windows.Handle
}

// Attach places the started process in a Job Object configured to kill every
// member when the job is terminated or its last handle closes. Descendants
// inherit the job, so the whole tree is covered, including on app crash.
func Attach(cmd *exec.Cmd) Tree {
	tree := &jobTree{pid: cmd.Process.Pid}
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return tree
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{
		BasicLimitInformation: windows.JOBOBJECT_BASIC_LIMIT_INFORMATION{
			LimitFlags: windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
		},
	}
	if _, err := windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
		_ = windows.CloseHandle(job)
		return tree
	}
	proc, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(tree.pid))
	if err != nil {
		_ = windows.CloseHandle(job)
		return tree
	}
	defer windows.CloseHandle(proc)
	if err := windows.AssignProcessToJobObject(job, proc); err != nil {
		_ = windows.CloseHandle(job)
		return tree
	}
	tree.job = job
	return tree
}

// Terminate kills the job; if no job could be created it falls back to
// taskkill's tree mode. Windows console processes started without a console
// cannot receive Ctrl+C, so there is no graceful phase.
func (t *jobTree) Terminate(_ time.Duration) error {
	if t.job != 0 {
		if err := windows.TerminateJobObject(t.job, 1); err == nil {
			return nil
		}
	}
	kill := exec.Command("taskkill", "/PID", strconv.Itoa(t.pid), "/T", "/F")
	kill.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW}
	if out, err := kill.CombinedOutput(); err != nil {
		if p, findErr := os.FindProcess(t.pid); findErr == nil {
			if killErr := p.Kill(); killErr == nil {
				return nil
			}
		}
		return fmt.Errorf("taskkill %d: %w (%s)", t.pid, err, strings.TrimSpace(string(out)))
	}
	return nil
}

// Close releases the job handle. Because of KILL_ON_JOB_CLOSE this also
// ends descendants that outlived the shell.
func (t *jobTree) Close() {
	if t.job != 0 {
		_ = windows.CloseHandle(t.job)
		t.job = 0
	}
}
