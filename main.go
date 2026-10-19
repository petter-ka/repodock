// The JWT tool signs test tokens with whatever RSA key a team already uses,
// including legacy keys under 1024 bits (ADR-0020).
//
//go:debug rsa1024min=0
package main

import (
	"embed"
	"log"
	"os"

	"github.com/example/repodock/internal/app"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// The same binary doubles as the process watchdog (ADR-0019); it must
	// branch off before any UI is created.
	if app.IsWatchdog(os.Args) {
		app.RunWatchdog(os.Args)
		return
	}
	// `repodock <folder>` offers to add the folder (ADR-0026). Paths are
	// made absolute first because a second launch forwards its arguments to
	// the running instance without its working directory.
	os.Args = app.AbsoluteArgs(os.Args)
	application := app.New()
	app.QueueLaunchArgs(application, os.Args[1:])
	onStartup, onBeforeClose, onShutdown := app.Hooks(application)
	onSecondInstance, onFileOpen := app.LaunchHooks(application)

	err := wails.Run(&options.App{
		Title:            "RepoDock",
		Width:            1480,
		Height:           920,
		MinWidth:         1080,
		MinHeight:        680,
		BackgroundColour: &options.RGBA{R: 15, G: 17, B: 21, A: 1},
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		OnStartup: onStartup,
		// Closing with running processes shows a progress overlay instead
		// of a window that looks frozen while they stop (ADR-0023).
		OnBeforeClose: onBeforeClose,
		OnShutdown:    onShutdown,
		// One RepoDock per workspace file; launching it again hands the
		// arguments to the running one.
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId:               app.InstanceID(application),
			OnSecondInstanceLaunch: onSecondInstance,
		},
		// DisableZoom keeps the window as it was without Mac options.
		Mac: &mac.Options{OnFileOpen: onFileOpen, DisableZoom: true},
		Bind: []interface{}{
			application,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}
