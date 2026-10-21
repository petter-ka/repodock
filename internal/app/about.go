package app

import (
	"context"
	"fmt"
	"net/url"
	"runtime"
	"runtime/debug"
	"time"

	"github.com/example/repodock/internal/domain"
	updatesmod "github.com/example/repodock/internal/modules/updates"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// Version is the release tag the build was made from. The release workflow
// sets it with -ldflags "-X github.com/example/repodock/internal/app.Version=<tag>";
// local builds report "dev".
var Version = "dev"

// AppInfo identifies this build for Settings → About (ADR-0034).
func (a *App) AppInfo() domain.AppInfo {
	info := domain.AppInfo{
		Version:    Version,
		Platform:   runtime.GOOS + "/" + runtime.GOARCH,
		GoVersion:  runtime.Version(),
		Repository: "https://github.com/" + updatesmod.Repository,
	}
	if build, ok := debug.ReadBuildInfo(); ok {
		for _, setting := range build.Settings {
			switch setting.Key {
			case "vcs.revision":
				info.Commit = setting.Value
			case "vcs.time":
				info.CommitTime = setting.Value
			case "vcs.modified":
				info.Modified = setting.Value == "true"
			}
		}
	}
	return info
}

// CheckForUpdates asks GitHub for the latest releases and their notes.
// It is the only network request RepoDock makes, and only on request.
func (a *App) CheckForUpdates() (domain.UpdateCheck, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	return a.updates.Check(ctx)
}

// OpenExternalURL opens an https link (a release page, a link in release
// notes) in the default browser.
func (a *App) OpenExternalURL(link string) error {
	parsed, err := url.Parse(link)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return fmt.Errorf("only https links can be opened: %q", link)
	}
	if a.ctx == nil {
		return fmt.Errorf("application is not ready")
	}
	wailsruntime.BrowserOpenURL(a.ctx, parsed.String())
	return nil
}
