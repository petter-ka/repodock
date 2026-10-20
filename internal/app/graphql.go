package app

import (
	"fmt"

	"github.com/example/repodock/internal/domain"
	gqlmod "github.com/example/repodock/internal/modules/graphqlscan"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// ScanGraphQLFiles lists the GraphQL schema files under folder for the
// "GraphQL map" mini app (ADR-0029).
func (a *App) ScanGraphQLFiles(folder string) (domain.GraphQLScan, error) {
	return gqlmod.Scan(folder)
}

// BrowseGraphQLFolder opens the native folder picker. An empty path means
// the user cancelled.
func (a *App) BrowseGraphQLFolder() (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("application is not ready")
	}
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:           "Select a folder with GraphQL schema files",
		ShowHiddenFiles: true,
	})
}
