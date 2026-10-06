package main

import (
	"embed"
	"log"

	"github.com/example/repodock/internal/app"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	application := app.New()
	onStartup, onShutdown := app.Hooks(application)

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
		OnStartup:  onStartup,
		OnShutdown: onShutdown,
		Bind: []interface{}{
			application,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}
