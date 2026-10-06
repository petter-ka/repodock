package app

import (
	"fmt"
	"os"
	"time"

	"github.com/example/repodock/internal/domain"
	transfermod "github.com/example/repodock/internal/modules/transfer"
	workspacemod "github.com/example/repodock/internal/modules/workspace"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var jsonFilter = []runtime.FileFilter{{DisplayName: "RepoDock workspace (*.json)", Pattern: "*.json"}}

// ExportWorkspace asks for a destination and writes the given groups (all
// groups when groupIDs is empty). It returns the written path, or "" when
// the user cancelled. Env file contents are never exported.
func (a *App) ExportWorkspace(groupIDs []string) (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("application is not ready")
	}
	name := "repodock-workspace.json"
	if len(groupIDs) == 1 {
		if group, ok := a.workspace.Group(groupIDs[0]); ok {
			name = "repodock-" + safeFileName(group.Name) + ".json"
		}
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title: "Export RepoDock workspace", DefaultFilename: name, Filters: jsonFilter,
	})
	if err != nil || path == "" {
		return "", err
	}
	return path, a.exportTo(path, groupIDs)
}

// ChooseImportFile opens the native file picker. "" means cancelled.
func (a *App) ChooseImportFile() (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("application is not ready")
	}
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{Title: "Import RepoDock workspace", Filters: jsonFilter})
}

// PreviewImport parses an export and describes what importing it would do.
// Nothing is changed.
func (a *App) PreviewImport(path string) (domain.ImportPreview, error) {
	doc, err := readDocument(path)
	if err != nil {
		return domain.ImportPreview{}, err
	}
	preview := transfermod.Plan(doc, a.workspace.Snapshot(), transferEnv())
	preview.Path = path
	return preview, nil
}

// ApplyImport merges an export into the workspace: new groups are created,
// new repositories registered and refreshed, existing ones left unchanged.
// Nothing is executed.
func (a *App) ApplyImport(path string, options domain.ImportOptions) (domain.ImportResult, error) {
	doc, err := readDocument(path)
	if err != nil {
		return domain.ImportResult{}, err
	}
	var added []string
	var result domain.ImportResult
	a.workspace.Update(func(ws *domain.Workspace) {
		*ws, added, result = transfermod.Merge(doc, *ws, transferEnv(), options)
	})
	for _, id := range added {
		// Missing folders keep the record and report the problem.
		_, _ = a.refresh(id)
	}
	return result, a.persist()
}

func (a *App) exportTo(path string, groupIDs []string) error {
	home, _ := os.UserHomeDir()
	doc, err := transfermod.Build(a.workspace.Snapshot(), groupIDs, home, time.Now())
	if err != nil {
		return err
	}
	data, err := transfermod.Encode(doc)
	if err != nil {
		return err
	}
	return transfermod.WriteFile(path, data)
}

func readDocument(path string) (transfermod.Document, error) {
	data, err := transfermod.ReadFile(path)
	if err != nil {
		return transfermod.Document{}, err
	}
	return transfermod.Parse(data)
}

func transferEnv() transfermod.Environment {
	home, _ := os.UserHomeDir()
	return transfermod.Environment{
		Home: home,
		DirExists: func(path string) bool {
			info, err := os.Stat(path)
			return err == nil && info.IsDir()
		},
		SamePath: workspacemod.SamePath,
	}
}

func safeFileName(name string) string {
	out := make([]rune, 0, len(name))
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			out = append(out, r)
		case r == ' ':
			out = append(out, '-')
		}
	}
	if len(out) == 0 {
		return "group"
	}
	return string(out)
}
