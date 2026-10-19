package app

import (
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/example/repodock/internal/domain"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// EventLaunchFolder tells the frontend that folders handed to RepoDock are
// waiting; it fetches them with TakeLaunchFolders (ADR-0026).
const EventLaunchFolder = "launch:folder"

// relaunchWindow ignores a folder handed over again this soon: on macOS
// AppKit also delivers command-line paths as "open file" events, so one
// launch reports the same folder twice.
const relaunchWindow = 5 * time.Second

// FolderArgs picks the folder arguments of a command line (without the
// program name): every argument that is not a flag, made absolute against
// cwd. On Windows a path rooted without a drive (`\work\app`) is on cwd's
// drive. A file stands for the folder it is in.
func FolderArgs(args []string, cwd string) []string {
	out := []string{}
	for _, arg := range args {
		arg = strings.TrimSpace(arg)
		if arg == "" || strings.HasPrefix(arg, "-") {
			continue
		}
		switch {
		case filepath.IsAbs(arg):
		case os.PathSeparator == '\\' && (strings.HasPrefix(arg, "/") || strings.HasPrefix(arg, `\`)):
			arg = filepath.VolumeName(cwd) + filepath.Clean(arg)
		default:
			arg = filepath.Join(cwd, arg)
		}
		arg = filepath.Clean(arg)
		if info, err := os.Stat(arg); err == nil && !info.IsDir() {
			arg = filepath.Dir(arg)
		}
		out = append(out, arg)
	}
	return out
}

// AbsoluteArgs returns args (program name first) with folder arguments made
// absolute. A second launch forwards its arguments to the running instance
// without its working directory, so main rewrites os.Args with this before
// Wails starts.
func AbsoluteArgs(args []string) []string {
	if len(args) < 2 {
		return args
	}
	cwd, err := os.Getwd()
	if err != nil {
		return args
	}
	out := []string{args[0]}
	folders := FolderArgs(args[1:], cwd)
	next := 0
	for _, arg := range args[1:] {
		trimmed := strings.TrimSpace(arg)
		if trimmed == "" || strings.HasPrefix(trimmed, "-") {
			out = append(out, arg)
			continue
		}
		out = append(out, folders[next])
		next++
	}
	return out
}

// QueueLaunchArgs remembers the folders on RepoDock's own command line
// (program name excluded); the frontend asks for them once it is ready.
func QueueLaunchArgs(a *App, args []string) {
	cwd, _ := os.Getwd()
	a.queueFolders(FolderArgs(args, cwd))
}

// InstanceID identifies the single running RepoDock per workspace file, so
// a second launch is forwarded to it instead of opening the same workspace
// twice.
func InstanceID(a *App) string {
	sum := sha256.Sum256([]byte(a.workspace.Path()))
	return "com.repodock.app." + hex.EncodeToString(sum[:8])
}

// LaunchHooks returns the callbacks for a second launch of RepoDock and for
// folders opened with RepoDock from the macOS Finder.
func LaunchHooks(a *App) (onSecondInstance func(options.SecondInstanceData), onFileOpen func(string)) {
	onSecondInstance = func(data options.SecondInstanceData) {
		// main made the arguments absolute before they were forwarded.
		a.queueFolders(FolderArgs(data.Args, data.WorkingDirectory))
		a.bringToFront()
	}
	onFileOpen = func(path string) {
		a.queueFolders(FolderArgs([]string{path}, "/"))
		a.bringToFront()
	}
	return onSecondInstance, onFileOpen
}

func (a *App) queueFolders(folders []string) {
	if len(folders) == 0 {
		return
	}
	now := time.Now()
	added := 0
	a.launchMu.Lock()
	if a.launchSeen == nil {
		a.launchSeen = map[string]time.Time{}
	}
	for _, folder := range folders {
		if last, ok := a.launchSeen[folder]; ok && now.Sub(last) < relaunchWindow {
			continue
		}
		a.launchSeen[folder] = now
		if !containsPath(a.launchFolders, folder) {
			a.launchFolders = append(a.launchFolders, folder)
			added++
		}
	}
	a.launchMu.Unlock()
	if added == 0 {
		return
	}
	slog.Info("folders handed to RepoDock", "count", added)
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, EventLaunchFolder, nil)
	}
}

func (a *App) bringToFront() {
	if a.ctx == nil {
		return
	}
	runtime.WindowUnminimise(a.ctx)
	runtime.WindowShow(a.ctx)
}

// TakeLaunchFolders returns the folders handed to RepoDock that are waiting
// for the user to place them in a group, and forgets them.
func (a *App) TakeLaunchFolders() []domain.FolderCheck {
	a.launchMu.Lock()
	folders := a.launchFolders
	a.launchFolders = nil
	a.launchMu.Unlock()
	out := make([]domain.FolderCheck, 0, len(folders))
	for _, folder := range folders {
		out = append(out, a.CheckRepositoryFolder(folder))
	}
	return out
}

func containsPath(paths []string, path string) bool {
	for _, p := range paths {
		if p == path {
			return true
		}
	}
	return false
}
