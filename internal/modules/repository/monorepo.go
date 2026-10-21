package repository

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/example/repodock/internal/domain"
)

// maxAncestors bounds how far above a repository folder workspace-level
// files (a monorepo root's lockfile, turbo.json or .nvmrc) are looked for.
const maxAncestors = 6

// maxTasks bounds the tasks read from a task-runner configuration.
const maxTasks = 100

// maxConfigSize bounds turbo.json, nx.json and version files.
const maxConfigSize = 1 << 20

// ancestors lists the folders above dir that may hold workspace-level files
// for it: parents up to and including the first one with a .git entry (the
// repository root). A folder that is itself a Git root has none. The home
// folder and the filesystem root are never searched.
func ancestors(dir string) []string {
	if exists(filepath.Join(dir, ".git")) {
		return nil
	}
	home, _ := os.UserHomeDir()
	var out []string
	current := dir
	for range maxAncestors {
		parent := filepath.Dir(current)
		if parent == current || (home != "" && samePath(parent, home)) {
			break
		}
		out = append(out, parent)
		if exists(filepath.Join(parent, ".git")) {
			break
		}
		current = parent
	}
	return out
}

func samePath(a, b string) bool {
	a, b = filepath.Clean(a), filepath.Clean(b)
	if runtime.GOOS == "windows" || runtime.GOOS == "darwin" {
		return strings.EqualFold(a, b)
	}
	return a == b
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func emptyMonorepo() domain.Monorepo {
	return domain.Monorepo{Tools: []string{}, Tasks: []domain.MonorepoTask{}}
}

// taskRunners maps a configuration file to the task runner it belongs to,
// in display order.
var taskRunners = []struct{ file, tool string }{
	{"turbo.json", "turbo"},
	{"nx.json", "nx"},
	{"lerna.json", "lerna"},
	{"rush.json", "rush"},
}

func toolsIn(dir string) []string {
	tools := []string{}
	for _, runner := range taskRunners {
		if exists(filepath.Join(dir, runner.file)) {
			tools = append(tools, runner.tool)
		}
	}
	return tools
}

func declaresWorkspaces(dir string, pkg packageJSON) bool {
	return pkg.Workspaces || exists(filepath.Join(dir, "pnpm-workspace.yaml"))
}

// detectMonorepo describes the workspace tooling of dir. A folder without
// workspaces or a task runner of its own is checked for a workspace root
// above it; Turborepo tasks of that root still run from the member folder,
// scoped to it.
func detectMonorepo(dir string, pkg packageJSON, parents []string) domain.Monorepo {
	mono := emptyMonorepo()
	mono.Workspaces = declaresWorkspaces(dir, pkg)
	mono.Tools = toolsIn(dir)
	if mono.Workspaces || len(mono.Tools) > 0 {
		mono.Tasks = tasksIn(dir, mono.Tools, false)
		return mono
	}
	for _, parent := range parents {
		parentPkg, _ := readPackageJSON(parent)
		tools := toolsIn(parent)
		if declaresWorkspaces(parent, parentPkg) || len(tools) > 0 {
			mono.Root = parent
			mono.Tools = tools
			mono.Tasks = tasksIn(parent, tools, true)
			return mono
		}
	}
	return mono
}

// tasksIn reads the runnable tasks of the task runners in dir. Nx targets
// are offered only at the workspace root, where `nx run-many` makes sense.
func tasksIn(dir string, tools []string, member bool) []domain.MonorepoTask {
	tasks := []domain.MonorepoTask{}
	for _, tool := range tools {
		var names []string
		switch {
		case tool == "turbo":
			names = turboTasks(filepath.Join(dir, "turbo.json"))
		case tool == "nx" && !member:
			names = nxTargets(filepath.Join(dir, "nx.json"))
		}
		for _, name := range names {
			if len(tasks) == maxTasks {
				return tasks
			}
			tasks = append(tasks, domain.MonorepoTask{Tool: tool, Name: name})
		}
	}
	return tasks
}

// turboTasks lists the task names of a turbo.json ("tasks" in Turborepo 2,
// "pipeline" in 1.x). A root task "//#lint" runs as "lint".
func turboTasks(path string) []string {
	var config struct {
		Tasks    json.RawMessage `json:"tasks"`
		Pipeline json.RawMessage `json:"pipeline"`
	}
	if !readJSONC(path, &config) {
		return nil
	}
	raw := config.Tasks
	if len(bytes.TrimSpace(raw)) == 0 {
		raw = config.Pipeline
	}
	keys, _ := orderedKeys(raw)
	out := []string{}
	seen := map[string]bool{}
	for _, key := range keys {
		name := strings.TrimPrefix(key, "//#")
		if !validTaskName(name) || seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, name)
	}
	return out
}

// nxTargets lists nx.json "targetDefaults" target names; entries keyed by
// an executor ("@nx/vite:test") are not targets and are skipped.
func nxTargets(path string) []string {
	var config struct {
		TargetDefaults json.RawMessage `json:"targetDefaults"`
	}
	if !readJSONC(path, &config) {
		return nil
	}
	keys, _ := orderedKeys(config.TargetDefaults)
	out := []string{}
	for _, key := range keys {
		if validTaskName(key) && !strings.ContainsAny(key, "@/") {
			out = append(out, key)
		}
	}
	return out
}

func validTaskName(name string) bool {
	if name == "" || len(name) > 200 || strings.HasPrefix(name, "-") {
		return false
	}
	for _, r := range name {
		if r < 0x20 || r == 0x7f {
			return false
		}
	}
	return true
}

// TaskArgv returns the invocation of a monorepo task through the package
// manager's local-binary runner, as an argument vector for the process
// layer (never shell text).
func TaskArgv(packageManager string, task domain.MonorepoTask) ([]string, error) {
	var run []string
	switch task.Tool {
	case "turbo":
		run = []string{"turbo", "run", task.Name}
	case "nx":
		run = []string{"nx", "run-many", "-t", task.Name}
	default:
		return nil, fmt.Errorf("unsupported task runner: %q", task.Tool)
	}
	var exec []string
	switch packageManager {
	case "pnpm":
		exec = []string{"pnpm", "exec"}
	case "yarn":
		exec = []string{"yarn"}
	case "bun":
		exec = []string{"bun", "x"}
	default:
		exec = []string{"npm", "exec", "--"}
	}
	return append(exec, run...), nil
}

// HasTask reports whether the repository offers the task.
func HasTask(repo domain.Repository, tool, name string) (domain.MonorepoTask, bool) {
	for _, task := range repo.Monorepo.Tasks {
		if task.Tool == tool && task.Name == name {
			return task, true
		}
	}
	return domain.MonorepoTask{}, false
}

// readJSONC decodes a JSON file that may contain comments and trailing
// commas (turbo.json and nx.json allow them). Unreadable or invalid files
// yield false.
func readJSONC(path string, into any) bool {
	data, err := readSmall(path)
	if err != nil {
		return false
	}
	return json.Unmarshal(stripJSONC(data), into) == nil
}

func readSmall(path string) ([]byte, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > maxConfigSize {
		return nil, fmt.Errorf("%s is not a small regular file", path)
	}
	return os.ReadFile(path)
}

// stripJSONC removes // and /* */ comments outside strings and commas that
// directly precede a closing bracket.
func stripJSONC(data []byte) []byte {
	out := make([]byte, 0, len(data))
	inString, escaped := false, false
	for i := 0; i < len(data); i++ {
		c := data[i]
		if inString {
			out = append(out, c)
			switch {
			case escaped:
				escaped = false
			case c == '\\':
				escaped = true
			case c == '"':
				inString = false
			}
			continue
		}
		switch {
		case c == '"':
			inString = true
			out = append(out, c)
		case c == '/' && i+1 < len(data) && data[i+1] == '/':
			for i < len(data) && data[i] != '\n' {
				i++
			}
			if i < len(data) {
				out = append(out, '\n')
			}
		case c == '/' && i+1 < len(data) && data[i+1] == '*':
			i += 2
			for i+1 < len(data) && !(data[i] == '*' && data[i+1] == '/') {
				i++
			}
			i++
		case c == ']' || c == '}':
			// Drop a trailing comma (and the whitespace after it).
			j := len(out) - 1
			for j >= 0 && isSpace(out[j]) {
				j--
			}
			if j >= 0 && out[j] == ',' {
				out = append(out[:j], out[j+1:]...)
			}
			out = append(out, c)
		default:
			out = append(out, c)
		}
	}
	return out
}

func isSpace(c byte) bool { return c == ' ' || c == '\t' || c == '\n' || c == '\r' }

// orderedKeys returns the keys of a JSON object in declaration order.
func orderedKeys(raw json.RawMessage) ([]string, error) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return nil, nil
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	if delim, ok := tok.(json.Delim); !ok || delim != '{' {
		return nil, fmt.Errorf("not an object")
	}
	var keys []string
	for dec.More() {
		keyTok, err := dec.Token()
		if err != nil {
			return keys, err
		}
		key, _ := keyTok.(string)
		var skip json.RawMessage
		if err := dec.Decode(&skip); err != nil {
			return keys, err
		}
		keys = append(keys, key)
	}
	return keys, nil
}
