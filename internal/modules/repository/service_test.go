package repository

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/example/repodock/internal/domain"
)

func writeFile(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func scriptNames(meta Metadata) []string {
	names := make([]string, 0, len(meta.Scripts))
	for _, s := range meta.Scripts {
		names = append(names, s.Name)
	}
	return names
}

func TestInspectPreservesScriptOrder(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "package.json", `{
		"name": "web",
		"scripts": {"dev": "vite", "build": "tsc && vite build", "a:lint": "eslint .", "Zeta": "x"}
	}`)
	meta, err := New().Inspect(dir)
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"dev", "build", "a:lint", "Zeta"}; !reflect.DeepEqual(scriptNames(meta), want) {
		t.Fatalf("order = %v, want %v", scriptNames(meta), want)
	}
	if meta.Scripts[1].Command != "tsc && vite build" {
		t.Fatalf("command not preserved verbatim: %q", meta.Scripts[1].Command)
	}
	if meta.Name != "web" {
		t.Fatalf("name = %q", meta.Name)
	}
}

func TestInspectZeroScriptsAndFallbackName(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "package.json", `{"version": "1.0.0"}`)
	meta, err := New().Inspect(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(meta.Scripts) != 0 || meta.Scripts == nil {
		t.Fatalf("expected empty non-nil scripts, got %#v", meta.Scripts)
	}
	if meta.Name != filepath.Base(dir) {
		t.Fatalf("name = %q, want folder name", meta.Name)
	}
}

func TestInspectSkipsNonStringScriptsAndDuplicateKeys(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "package.json", `{"scripts": {"dev": "a", "weird": {"x": 1}, "num": 3, "dev": "b"}}`)
	meta, err := New().Inspect(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(meta.Scripts) != 1 || meta.Scripts[0].Command != "b" {
		t.Fatalf("scripts = %#v", meta.Scripts)
	}
}

func TestInspectMissingAndInvalidPackageJSON(t *testing.T) {
	dir := t.TempDir()
	if _, err := New().Inspect(dir); !errors.Is(err, ErrNoPackageJSON) {
		t.Fatalf("missing package.json: err = %v", err)
	}
	writeFile(t, dir, "package.json", `{"scripts": `)
	if _, err := New().Inspect(dir); err == nil {
		t.Fatal("expected error for invalid package.json")
	}
	writeFile(t, dir, "package.json", `{"scripts": ["dev"]}`)
	if _, err := New().Inspect(dir); err == nil {
		t.Fatal("expected error for non-object scripts")
	}
}

func TestInspectRejectsFiles(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "file.txt", "x")
	if _, err := New().Inspect(filepath.Join(dir, "file.txt")); err == nil {
		t.Fatal("expected error for non-directory")
	}
	if _, err := New().Inspect(filepath.Join(dir, "missing")); err == nil {
		t.Fatal("expected error for missing directory")
	}
}

func TestDetectPackageManager(t *testing.T) {
	dir := t.TempDir()
	if got := DetectPackageManager(dir, "pnpm@10.0.0"); got != "pnpm" {
		t.Fatalf("packageManager field: got %q", got)
	}
	if got := DetectPackageManager(dir, ""); got != "npm" {
		t.Fatalf("fallback: got %q", got)
	}
	writeFile(t, dir, "yarn.lock", "")
	if got := DetectPackageManager(dir, ""); got != "yarn" {
		t.Fatalf("lockfile: got %q", got)
	}
	if got := DetectPackageManager(dir, "deno@2"); got != "yarn" {
		t.Fatalf("unsupported field should fall back to lockfile: got %q", got)
	}
	if got := DetectPackageManager(dir, "bun@1.1"); got != "bun" {
		t.Fatalf("field wins over lockfile: got %q", got)
	}
}

func TestScriptArgvKeepsNameAsSeparateArgument(t *testing.T) {
	got := ScriptArgv("pnpm", "dev && rm -rf /")
	want := []string{"pnpm", "run", "dev && rm -rf /"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("argv = %#v", got)
	}
	if ScriptArgv("unknown", "x")[0] != "npm" {
		t.Fatal("unknown package manager should fall back to npm")
	}
}

func scriptsOf(names ...string) []domain.Script {
	out := make([]domain.Script, 0, len(names))
	for _, n := range names {
		out = append(out, domain.Script{Name: n, Command: n})
	}
	return out
}

func TestDetectStackHidesImpliedLibraries(t *testing.T) {
	got := DetectStack(map[string]any{"next": "15", "react": "19", "express": "5"}, map[string]any{"typescript": "5"})
	if strings.Join(got, ",") != "Next.js,Express,TypeScript" {
		t.Fatalf("stack = %v", got)
	}
	if len(DetectStack(nil, nil)) != 0 {
		t.Fatal("expected an empty stack")
	}
}

func TestInspectCountsDependencies(t *testing.T) {
	dir := t.TempDir()
	pkg := `{"name": "x", "dependencies": {"vue": "3", "pinia": "2"}, "devDependencies": {"vite": "6"}}`
	if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte(pkg), 0o600); err != nil {
		t.Fatal(err)
	}
	meta, err := New().Inspect(dir)
	if err != nil {
		t.Fatal(err)
	}
	if meta.Dependencies != 2 || meta.DevDependencies != 1 || strings.Join(meta.Stack, ",") != "Vue,Vite" {
		t.Fatalf("meta = %#v", meta)
	}
}

func mkdirs(t *testing.T, root string, rels ...string) {
	t.Helper()
	for _, rel := range rels {
		if err := os.MkdirAll(filepath.Join(root, rel), 0o755); err != nil {
			t.Fatal(err)
		}
	}
}

// A package inside a pnpm + Turborepo monorepo has no lockfile, version
// file or turbo.json of its own; they come from the workspace root.
func TestInspectMonorepoMember(t *testing.T) {
	root := t.TempDir()
	mkdirs(t, root, ".git", "apps/web")
	writeFile(t, root, "package.json", `{"name": "mono", "packageManager": "pnpm@9.12.0+sha512.abc", "devDependencies": {"turbo": "2"}}`)
	writeFile(t, root, "pnpm-workspace.yaml", "packages:\n  - apps/*\n")
	writeFile(t, root, "pnpm-lock.yaml", "")
	writeFile(t, root, ".nvmrc", "# team version\nlts/iron\n")
	writeFile(t, root, "turbo.json", `{
  // Turborepo allows comments
  "tasks": {
    "build": { "dependsOn": ["^build"] },
    "dev": { "cache": false, "persistent": true },
    "//#lint": {},
    "web#test": {}, /* trailing comma below */
  },
}`)
	member := filepath.Join(root, "apps", "web")
	writeFile(t, member, "package.json", `{"name": "web", "scripts": {"dev": "next dev"}, "engines": {"node": ">=20"}}`)

	meta, err := New().Inspect(member)
	if err != nil {
		t.Fatal(err)
	}
	if meta.PackageManager != "pnpm" || meta.PackageManagerVersion != "9.12.0" {
		t.Fatalf("package manager = %q %q", meta.PackageManager, meta.PackageManagerVersion)
	}
	if meta.Monorepo.Root != root || strings.Join(meta.Monorepo.Tools, ",") != "turbo" || meta.Monorepo.Workspaces {
		t.Fatalf("monorepo = %+v", meta.Monorepo)
	}
	var tasks []string
	for _, task := range meta.Monorepo.Tasks {
		tasks = append(tasks, task.Tool+":"+task.Name)
	}
	if strings.Join(tasks, ",") != "turbo:build,turbo:dev,turbo:lint,turbo:web#test" {
		t.Fatalf("tasks = %v", tasks)
	}
	if meta.NodeRequest != (domain.NodeRequest{Spec: "lts/iron", Source: "../../.nvmrc", Engines: ">=20"}) {
		t.Fatalf("node request = %+v", meta.NodeRequest)
	}

	rootMeta, err := New().Inspect(root)
	if err != nil {
		t.Fatal(err)
	}
	if rootMeta.Monorepo.Root != "" || !rootMeta.Monorepo.Workspaces || !strings.Contains(strings.Join(rootMeta.Stack, ","), "Turborepo") {
		t.Fatalf("root = %+v", rootMeta)
	}
}

func TestNxTargetsOnlyAtTheRoot(t *testing.T) {
	root := t.TempDir()
	mkdirs(t, root, ".git", "libs/ui")
	writeFile(t, root, "package.json", `{"name": "nx-mono", "workspaces": {"packages": ["libs/*"]}}`)
	writeFile(t, root, "yarn.lock", "")
	writeFile(t, root, "nx.json", `{"targetDefaults": {"build": {}, "@nx/vite:test": {}, "lint": {}}}`)
	writeFile(t, filepath.Join(root, "libs", "ui"), "package.json", `{"name": "ui"}`)

	meta, _ := New().Inspect(root)
	if len(meta.Monorepo.Tasks) != 2 || meta.Monorepo.Tasks[1] != (domain.MonorepoTask{Tool: "nx", Name: "lint"}) || meta.PackageManager != "yarn" {
		t.Fatalf("root = %+v", meta)
	}
	member, _ := New().Inspect(filepath.Join(root, "libs", "ui"))
	if member.Monorepo.Root != root || len(member.Monorepo.Tasks) != 0 || member.PackageManager != "yarn" {
		t.Fatalf("member = %+v", member)
	}
}

func TestNodeRequestSources(t *testing.T) {
	cases := []struct {
		files map[string]string
		want  domain.NodeRequest
	}{
		{map[string]string{".node-version": "v20.11.1\n"}, domain.NodeRequest{Spec: "v20.11.1", Source: ".node-version"}},
		{map[string]string{".tool-versions": "python 3.12\nnodejs 22.1.0 20.0.0\n"}, domain.NodeRequest{Spec: "22.1.0", Source: ".tool-versions"}},
		{map[string]string{"mise.toml": "[env]\nnode = \"no\"\n[tools]\nnode = \"20\"\n"}, domain.NodeRequest{Spec: "20", Source: "mise.toml"}},
		{map[string]string{".mise.toml": "[tools]\nnode = { version = \"18\", os = [\"linux\"] }\n"}, domain.NodeRequest{Spec: "18", Source: ".mise.toml"}},
		{map[string]string{"package.json": `{"volta": {"node": "20.11.1"}, "engines": {"node": "^20"}}`}, domain.NodeRequest{Spec: "20.11.1", Source: "package.json (volta)", Engines: "^20"}},
		{map[string]string{".nvmrc": "18\n", ".node-version": "20\n"}, domain.NodeRequest{Spec: "18", Source: ".nvmrc"}},
		{map[string]string{".nvmrc": "\n\n"}, domain.NodeRequest{}},
	}
	for _, c := range cases {
		dir := t.TempDir()
		mkdirs(t, dir, ".git")
		for name, content := range c.files {
			writeFile(t, dir, name, content)
		}
		meta, _ := New().Inspect(dir)
		if meta.NodeRequest != c.want {
			t.Errorf("%v: got %+v, want %+v", c.files, meta.NodeRequest, c.want)
		}
	}
}

func TestTaskArgvUsesThePackageManagersRunner(t *testing.T) {
	build := domain.MonorepoTask{Tool: "turbo", Name: "build"}
	want := map[string]string{
		"pnpm": "pnpm exec turbo run build",
		"yarn": "yarn turbo run build",
		"bun":  "bun x turbo run build",
		"npm":  "npm exec -- turbo run build",
	}
	for pm, expected := range want {
		argv, err := TaskArgv(pm, build)
		if err != nil || strings.Join(argv, " ") != expected {
			t.Errorf("%s: %v, %v", pm, argv, err)
		}
	}
	argv, _ := TaskArgv("npm", domain.MonorepoTask{Tool: "nx", Name: "test; rm -rf /"})
	if argv[len(argv)-1] != "test; rm -rf /" {
		t.Fatalf("task name must stay one argument: %v", argv)
	}
	if _, err := TaskArgv("npm", domain.MonorepoTask{Tool: "make", Name: "x"}); err == nil {
		t.Fatal("unknown tools must be rejected")
	}
}

func TestStripJSONCKeepsStrings(t *testing.T) {
	in := `{"a": "http://x//y", /* c */ "b": "/* not a comment */", "c": [1, 2,], } // end`
	var out map[string]any
	if err := json.Unmarshal(stripJSONC([]byte(in)), &out); err != nil {
		t.Fatalf("%v: %s", err, stripJSONC([]byte(in)))
	}
	if out["a"] != "http://x//y" || out["b"] != "/* not a comment */" {
		t.Fatalf("out = %v", out)
	}
}
