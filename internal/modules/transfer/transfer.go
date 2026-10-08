// Package transfer exports groups and repository registrations to a
// portable JSON document and merges such documents back into a workspace
// (ADR-0011). Building, parsing and merging are pure; file I/O is limited
// to file.go. Nothing is executed, and env file contents are never part of
// the document.
package transfer

import (
	"bytes"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/example/repodock/internal/domain"
	"github.com/google/uuid"
)

const (
	// Format identifies RepoDock export documents.
	Format = "repodock.workspace-export"
	// Version is the current export document version. Version 2 added
	// globalCommands and the step globalCommand reference; version 3 added
	// the repository alias, the plain-folder flag and quick commands. Older
	// documents are still read.
	Version = 3
	// UnknownPackageManager is the placeholder of an imported repository
	// that expects a package.json, until its first refresh.
	UnknownPackageManager = "npm"
	// MaxDocumentSize bounds import files.
	MaxDocumentSize = 4 << 20
	maxNameLength   = 200
	maxSteps        = 200
	// maxQuickCommands mirrors workspace.MaxQuickCommands.
	maxQuickCommands = 100
)

// Document is the on-disk export format. Field names are part of the file
// contract; change them only with a version bump.
type Document struct {
	Format     string    `json:"format"`
	Version    int       `json:"version"`
	ExportedAt time.Time `json:"exportedAt"`
	// GlobalCommands are referenced from steps by ID. IDs are only
	// meaningful inside the document; import assigns local ones.
	GlobalCommands []domain.GlobalCommand `json:"globalCommands,omitempty"`
	Groups         []DocumentGroup        `json:"groups"`
}

type DocumentGroup struct {
	Name         string               `json:"name"`
	RunMode      domain.GroupRunMode  `json:"runMode"`
	Collapsed    bool                 `json:"collapsed"`
	Repositories []DocumentRepository `json:"repositories"`
}

type DocumentRepository struct {
	Name string `json:"name"`
	// Alias is the user-chosen display name (version 3+).
	Alias string `json:"alias,omitempty"`
	// PlainFolder marks a folder registered without package.json (version
	// 3+). Without it, an imported folder that has no package.json is
	// reported as a problem, as in versions 1–2.
	PlainFolder bool `json:"plainFolder,omitempty"`
	// QuickCommands are the pinned chips (version 3+). GlobalCommand refers
	// to the document's globalCommands[].id, as in steps.
	QuickCommands []domain.QuickCommand `json:"quickCommands,omitempty"`
	// Path uses forward slashes; a leading "~/" means the user's home folder.
	Path            string               `json:"path"`
	CommandSequence []domain.CommandStep `json:"commandSequence"`
}

// Build exports the given groups (all when groupIDs is empty). A full export
// carries every global command; a partial one only those its steps use.
func Build(ws domain.Workspace, groupIDs []string, home string, now time.Time) (Document, error) {
	wanted := map[string]bool{}
	for _, id := range groupIDs {
		wanted[id] = true
	}
	repos := make(map[string]domain.Repository, len(ws.Repositories))
	for _, repo := range ws.Repositories {
		repos[repo.ID] = repo
	}

	doc := Document{Format: Format, Version: Version, ExportedAt: now.UTC(), Groups: []DocumentGroup{}}
	for _, group := range ws.Groups {
		if len(wanted) > 0 && !wanted[group.ID] {
			continue
		}
		out := DocumentGroup{Name: group.Name, RunMode: group.RunMode, Collapsed: group.Collapsed, Repositories: []DocumentRepository{}}
		for _, id := range group.RepositoryIDs {
			repo, ok := repos[id]
			if !ok {
				continue
			}
			steps := append([]domain.CommandStep{}, repo.CommandSequence...)
			if repo.CommandSequence == nil {
				steps = nil
			}
			out.Repositories = append(out.Repositories, DocumentRepository{Name: repo.Name, Alias: repo.Alias, PlainFolder: repo.PackageManager == "", QuickCommands: quickOrNil(repo.QuickCommands), Path: portablePath(repo.Path, home), CommandSequence: steps})
		}
		doc.Groups = append(doc.Groups, out)
	}
	if len(wanted) > 0 && len(doc.Groups) != len(wanted) {
		return Document{}, fmt.Errorf("one or more groups to export were not found")
	}

	used := map[string]bool{}
	for _, group := range doc.Groups {
		for _, repo := range group.Repositories {
			for _, step := range repo.CommandSequence {
				if step.Script == "" && step.GlobalCommand != "" {
					used[step.GlobalCommand] = true
				}
			}
			for _, cmd := range repo.QuickCommands {
				if cmd.Script == "" && cmd.GlobalCommand != "" {
					used[cmd.GlobalCommand] = true
				}
			}
		}
	}
	for _, cmd := range ws.GlobalCommands {
		if len(wanted) == 0 || used[cmd.ID] {
			doc.GlobalCommands = append(doc.GlobalCommands, cmd)
		}
	}
	return doc, nil
}

// Encode renders a document as indented JSON with a trailing newline.
func Encode(doc Document) ([]byte, error) {
	data, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("encode export: %w", err)
	}
	return append(data, '\n'), nil
}

// Parse decodes and validates an export document. Unknown fields are
// rejected so typos and foreign files fail loudly instead of half-importing.
func Parse(data []byte) (Document, error) {
	var doc Document
	if len(data) > MaxDocumentSize {
		return doc, fmt.Errorf("file is larger than %d bytes", MaxDocumentSize)
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&doc); err != nil {
		return doc, fmt.Errorf("not a valid RepoDock export: %w", err)
	}
	if doc.Format != Format {
		return doc, fmt.Errorf("not a RepoDock export (format %q)", doc.Format)
	}
	if doc.Version < 1 || doc.Version > Version {
		return doc, fmt.Errorf("export version %d is not supported (this RepoDock reads version %d)", doc.Version, Version)
	}
	if doc.Version < 2 && len(doc.GlobalCommands) > 0 {
		return doc, fmt.Errorf("global commands require export version 2")
	}
	globals := map[string]bool{}
	names := map[string]bool{}
	for i, cmd := range doc.GlobalCommands {
		if err := validName(cmd.Name); err != nil {
			return doc, fmt.Errorf("global command %d: %w", i+1, err)
		}
		if strings.TrimSpace(cmd.ID) == "" || globals[cmd.ID] {
			return doc, fmt.Errorf("global command %q: missing or repeated id", cmd.Name)
		}
		key := strings.ToLower(strings.TrimSpace(cmd.Name))
		if names[key] {
			return doc, fmt.Errorf("global command name %q is used more than once", cmd.Name)
		}
		if strings.TrimSpace(cmd.Command) == "" {
			return doc, fmt.Errorf("global command %q: command is empty", cmd.Name)
		}
		if strings.ContainsAny(cmd.Name+cmd.Command, "\r\n\x00") {
			return doc, fmt.Errorf("global command %q contains line breaks or NUL bytes", cmd.Name)
		}
		globals[cmd.ID], names[key] = true, true
	}
	for gi, group := range doc.Groups {
		if err := validName(group.Name); err != nil {
			return doc, fmt.Errorf("group %d: %w", gi+1, err)
		}
		if group.RunMode != "" && !group.RunMode.Valid() {
			return doc, fmt.Errorf("group %q: unknown run mode %q", group.Name, group.RunMode)
		}
		for ri, repo := range group.Repositories {
			where := fmt.Sprintf("group %q, repository %d", group.Name, ri+1)
			if strings.TrimSpace(repo.Path) == "" {
				return doc, fmt.Errorf("%s: path is empty", where)
			}
			if (repo.Alias != "" || repo.PlainFolder || len(repo.QuickCommands) > 0) && doc.Version < 3 {
				return doc, fmt.Errorf("%s: aliases, plain folders and quick commands require export version 3", where)
			}
			if len(repo.QuickCommands) > maxQuickCommands {
				return doc, fmt.Errorf("%s: more than %d quick commands", where, maxQuickCommands)
			}
			for _, cmd := range repo.QuickCommands {
				if strings.ContainsAny(cmd.Label+cmd.Script+cmd.GlobalCommand+cmd.Command, "\r\n\x00") {
					return doc, fmt.Errorf("%s: quick command %q contains line breaks or NUL bytes", where, cmd.Label)
				}
				if cmd.Script == "" && cmd.GlobalCommand != "" && !globals[cmd.GlobalCommand] {
					return doc, fmt.Errorf("%s: quick command %q references an unknown global command", where, cmd.Label)
				}
			}
			if repo.Alias != "" {
				if err := validName(repo.Alias); err != nil || strings.ContainsAny(repo.Alias, "\r\n\x00") {
					return doc, fmt.Errorf("%s: invalid alias", where)
				}
			}
			if len(repo.CommandSequence) > maxSteps {
				return doc, fmt.Errorf("%s: more than %d steps", where, maxSteps)
			}
			for _, step := range repo.CommandSequence {
				for _, text := range []string{step.Label, step.Script, step.Command} {
					if strings.ContainsAny(text, "\r\n\x00") {
						return doc, fmt.Errorf("%s: step %q contains line breaks or NUL bytes", where, step.Label)
					}
				}
				if step.Script == "" && step.GlobalCommand != "" && !globals[step.GlobalCommand] {
					return doc, fmt.Errorf("%s: step %q references an unknown global command", where, step.Label)
				}
			}
		}
	}
	return doc, nil
}

func validName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("name is empty")
	}
	if len(name) > maxNameLength {
		return fmt.Errorf("name is longer than %d characters", maxNameLength)
	}
	return nil
}

// Environment abstracts the checks Plan needs, so tests stay hermetic.
type Environment struct {
	Home string
	// DirExists reports whether an absolute path is an existing folder.
	DirExists func(path string) bool
	// SamePath compares paths with platform semantics.
	SamePath func(a, b string) bool
}

// Plan describes what Merge would do, for the confirmation dialog.
func Plan(doc Document, current domain.Workspace, env Environment) domain.ImportPreview {
	preview := domain.ImportPreview{ExportedAt: doc.ExportedAt, Groups: []domain.ImportGroupPreview{}, GlobalCommands: []domain.ImportGlobalCommandPreview{}}
	for _, p := range planGlobals(doc, current) {
		preview.GlobalCommands = append(preview.GlobalCommands, domain.ImportGlobalCommandPreview{
			ID: p.doc.ID, Name: strings.TrimSpace(p.doc.Name), Command: strings.TrimSpace(p.doc.Command), Status: p.status, ImportName: p.name,
		})
		if p.status != domain.ImportGlobalExisting {
			preview.ShellCommands++
		}
	}
	for _, group := range doc.Groups {
		g := domain.ImportGroupPreview{Name: strings.TrimSpace(group.Name), Repositories: []domain.ImportRepositoryPreview{}}
		g.Exists = findGroup(current, g.Name) != nil
		if !g.Exists {
			preview.GroupsToCreate++
		}
		for _, repo := range group.Repositories {
			path := LocalPath(repo.Path, env.Home)
			// Preview steps keep document global command IDs, which match
			// preview.GlobalCommands[].ID.
			r := domain.ImportRepositoryPreview{Name: displayName(repo), Path: path, Steps: sanitizeSteps(repo.CommandSequence, nil)}
			// Several records of one folder are allowed (ADR-0015), so a
			// path repeated inside the file is imported once per entry; only
			// paths already in the workspace are skipped.
			switch {
			case findRepoByPath(current, path, env.SamePath) != nil:
				r.Status = domain.ImportExisting
				preview.Existing++
			case !env.DirExists(path):
				r.Status = domain.ImportMissing
				preview.New++
				preview.Missing++
			default:
				r.Status = domain.ImportNew
				preview.New++
			}
			r.QuickCommands = sanitizeQuick(repo.QuickCommands, nil)
			if r.Status == domain.ImportNew || r.Status == domain.ImportMissing {
				for _, cmd := range r.QuickCommands {
					if cmd.Script == "" && cmd.GlobalCommand == "" && cmd.Command != "" {
						preview.ShellCommands++
					}
				}
				for _, step := range r.Steps {
					if step.Script == "" && step.GlobalCommand == "" && step.Command != "" {
						preview.ShellCommands++
					}
				}
			}
			g.Repositories = append(g.Repositories, r)
		}
		preview.Groups = append(preview.Groups, g)
	}
	return preview
}

// Merge adds the document's groups, repositories and global commands to
// current without changing anything that already exists: groups are
// matched by name (case-insensitively), repositories by path, and global
// commands by name and command text (a name clash with different text adds
// a renamed copy). It returns the new workspace and the IDs of added
// repositories, which the caller should refresh.
func Merge(doc Document, current domain.Workspace, env Environment, opts domain.ImportOptions) (domain.Workspace, []string, domain.ImportResult) {
	ws := current
	ws.Groups = append([]domain.Group{}, current.Groups...)
	ws.Repositories = append([]domain.Repository{}, current.Repositories...)
	ws.GlobalCommands = append([]domain.GlobalCommand{}, current.GlobalCommands...)
	result := domain.ImportResult{}
	added := []string{}

	globalIDs := map[string]string{} // document ID → local ID
	for _, p := range planGlobals(doc, current) {
		if p.status == domain.ImportGlobalExisting {
			globalIDs[p.doc.ID] = p.localID
			continue
		}
		local := domain.GlobalCommand{ID: uuid.NewString(), Name: p.name, Command: strings.TrimSpace(p.doc.Command)}
		ws.GlobalCommands = append(ws.GlobalCommands, local)
		globalIDs[p.doc.ID] = local.ID
		result.GlobalCommandsAdded++
	}

	// New groups keep the document's order relative to groups that already
	// exist: each is inserted right after the previous document group, or,
	// before any, ahead of the first document group already present.
	anchor := -1
	for di, group := range doc.Groups {
		name := strings.TrimSpace(group.Name)
		target := findGroup(ws, name)
		if target != nil {
			anchor = groupPosition(ws, name) + 1
		} else {
			mode := group.RunMode
			if !mode.Valid() {
				mode = domain.GroupRunSequential
			}
			if anchor < 0 {
				anchor = len(ws.Groups)
				for _, later := range doc.Groups[di+1:] {
					if at := groupPosition(ws, strings.TrimSpace(later.Name)); at >= 0 {
						anchor = at
						break
					}
				}
			}
			created := domain.Group{ID: uuid.NewString(), Name: name, RunMode: mode, Collapsed: group.Collapsed, RepositoryIDs: []string{}}
			ws.Groups = append(ws.Groups[:anchor], append([]domain.Group{created}, ws.Groups[anchor:]...)...)
			target = &ws.Groups[anchor]
			anchor++
			result.GroupsCreated++
		}
		for _, repo := range group.Repositories {
			path := overridePath(LocalPath(repo.Path, env.Home), opts.PathOverrides, env.SamePath)
			if findRepoByPath(current, path, env.SamePath) != nil {
				result.RepositoriesSkipped++
				continue
			}
			record := domain.Repository{
				ID: uuid.NewString(), Name: strings.TrimSpace(repo.Name), Alias: strings.TrimSpace(repo.Alias), Path: path, GroupID: target.ID,
				Scripts: []domain.Script{}, EnvFiles: []string{},
				CommandSequence: []domain.CommandStep{},
				QuickCommands:   sanitizeQuick(repo.QuickCommands, globalIDs),
			}
			if opts.ImportSequences {
				record.CommandSequence = sanitizeSteps(repo.CommandSequence, globalIDs)
			}
			if record.Name == "" {
				record.Name = filepath.Base(path)
			}
			// The first refresh fills in the real package manager. Until then
			// a placeholder marks "expects package.json", so a folder that
			// lost it reports a problem instead of becoming a plain folder.
			if !repo.PlainFolder {
				record.PackageManager = UnknownPackageManager
			}
			ws.Repositories = append(ws.Repositories, record)
			target.RepositoryIDs = append(target.RepositoryIDs, record.ID)
			added = append(added, record.ID)
			result.RepositoriesAdded++
		}
	}
	return ws, added, result
}

// sanitizeSteps copies the enabled steps with fresh IDs; disabled steps
// (stored by files written before ADR-0022) are dropped. When globalIDs is
// non-nil, global command references are rewritten from document IDs to
// local IDs.
func sanitizeSteps(steps []domain.CommandStep, globalIDs map[string]string) []domain.CommandStep {
	out := make([]domain.CommandStep, 0, len(steps))
	for _, step := range steps {
		if !step.Enabled {
			continue
		}
		step.ID = uuid.NewString()
		step.Label = strings.TrimSpace(step.Label)
		step.Script = strings.TrimSpace(step.Script)
		step.GlobalCommand = strings.TrimSpace(step.GlobalCommand)
		step.Command = strings.TrimSpace(step.Command)
		if step.Script != "" {
			step.GlobalCommand = ""
		}
		if step.GlobalCommand != "" {
			step.Command = ""
			if globalIDs != nil {
				step.GlobalCommand = globalIDs[step.GlobalCommand]
			}
		}
		out = append(out, step)
	}
	return out
}

// globalPlan is what importing one document global command will do.
type globalPlan struct {
	doc    domain.GlobalCommand
	status domain.ImportGlobalCommandStatus
	// name is the local name after import.
	name string
	// localID is set when an identical command already exists.
	localID string
}

// planGlobals reuses an existing command with the same name and text, and
// otherwise adds the document command, renaming it when its name is taken.
func planGlobals(doc Document, current domain.Workspace) []globalPlan {
	taken := map[string]bool{}
	for _, cmd := range current.GlobalCommands {
		taken[strings.ToLower(strings.TrimSpace(cmd.Name))] = true
	}
	out := make([]globalPlan, 0, len(doc.GlobalCommands))
	for _, cmd := range doc.GlobalCommands {
		name, command := strings.TrimSpace(cmd.Name), strings.TrimSpace(cmd.Command)
		p := globalPlan{doc: cmd, status: domain.ImportGlobalNew, name: name}
		for _, existing := range current.GlobalCommands {
			if strings.EqualFold(strings.TrimSpace(existing.Name), name) && strings.TrimSpace(existing.Command) == command {
				p.status, p.localID, p.name = domain.ImportGlobalExisting, existing.ID, existing.Name
				break
			}
		}
		if p.status != domain.ImportGlobalExisting {
			if taken[strings.ToLower(name)] {
				p.status, p.name = domain.ImportGlobalRenamed, uniqueName(name, taken)
			}
			taken[strings.ToLower(p.name)] = true
		}
		out = append(out, p)
	}
	return out
}

// uniqueName returns "name (imported)", "name (imported 2)", … — the first
// one not in taken.
func uniqueName(name string, taken map[string]bool) string {
	for n := 1; ; n++ {
		candidate := name + " (imported)"
		if n > 1 {
			candidate = fmt.Sprintf("%s (imported %d)", name, n)
		}
		if !taken[strings.ToLower(candidate)] {
			return candidate
		}
	}
}

// overridePath returns the user's replacement for path, if any.
func overridePath(path string, overrides map[string]string, same func(a, b string) bool) string {
	for from, to := range overrides {
		if strings.TrimSpace(to) != "" && same(from, path) {
			return filepath.Clean(strings.TrimSpace(to))
		}
	}
	return path
}

// portablePath rewrites paths under home as "~/…" with forward slashes.
func portablePath(path, home string) string {
	if home != "" {
		if rel, err := filepath.Rel(home, path); err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel) {
			if rel == "." {
				return "~"
			}
			return "~/" + filepath.ToSlash(rel)
		}
	}
	return filepath.ToSlash(path)
}

// LocalPath expands "~/" and converts to the platform separator.
func LocalPath(path, home string) string {
	path = strings.TrimSpace(path)
	if path == "~" {
		return filepath.Clean(home)
	}
	if strings.HasPrefix(path, "~/") && home != "" {
		return filepath.Join(home, filepath.FromSlash(path[2:]))
	}
	return filepath.Clean(filepath.FromSlash(path))
}

func groupPosition(ws domain.Workspace, name string) int {
	for i := range ws.Groups {
		if strings.EqualFold(strings.TrimSpace(ws.Groups[i].Name), name) {
			return i
		}
	}
	return -1
}

func findGroup(ws domain.Workspace, name string) *domain.Group {
	for i := range ws.Groups {
		if strings.EqualFold(strings.TrimSpace(ws.Groups[i].Name), name) {
			return &ws.Groups[i]
		}
	}
	return nil
}

func findRepoByPath(ws domain.Workspace, path string, same func(a, b string) bool) *domain.Repository {
	for i := range ws.Repositories {
		if same(ws.Repositories[i].Path, path) {
			return &ws.Repositories[i]
		}
	}
	return nil
}

func displayName(repo DocumentRepository) string {
	if alias := strings.TrimSpace(repo.Alias); alias != "" {
		return alias
	}
	return repo.Name
}

// sanitizeQuick gives imported quick commands fresh IDs and maps global
// command references to local IDs (nil keeps document IDs, for previews).
// Entries left without anything to run are dropped.
func sanitizeQuick(commands []domain.QuickCommand, globalIDs map[string]string) []domain.QuickCommand {
	out := []domain.QuickCommand{}
	for _, cmd := range commands {
		cmd.ID = uuid.NewString()
		cmd.Label = strings.TrimSpace(cmd.Label)
		cmd.Script = strings.TrimSpace(cmd.Script)
		cmd.GlobalCommand = strings.TrimSpace(cmd.GlobalCommand)
		cmd.Command = strings.TrimSpace(cmd.Command)
		if cmd.Script != "" {
			cmd.GlobalCommand, cmd.Command = "", ""
		} else if cmd.GlobalCommand != "" {
			cmd.Command = ""
			if globalIDs != nil {
				cmd.GlobalCommand = globalIDs[cmd.GlobalCommand]
			}
		}
		if cmd.Script == "" && cmd.GlobalCommand == "" && cmd.Command == "" {
			continue
		}
		out = append(out, cmd)
	}
	return out
}

func quickOrNil(commands []domain.QuickCommand) []domain.QuickCommand {
	if len(commands) == 0 {
		return nil
	}
	return append([]domain.QuickCommand{}, commands...)
}
