package repository

import (
	"bufio"
	"bytes"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/example/repodock/internal/domain"
)

// maxSpecLength bounds a version request read from a file.
const maxSpecLength = 100

// versionFiles are read in this order within a folder; the nearest folder
// with any of them wins, like nvm, fnm, asdf and mise do.
var versionFiles = []struct {
	name  string
	parse func([]byte) string
}{
	{".nvmrc", firstValue},
	{".node-version", firstValue},
	{".tool-versions", toolVersionsNode},
	{".mise.toml", miseNode},
	{"mise.toml", miseNode},
}

// nodeRequest finds what dir says about its Node.js version: the nearest
// version file (or package.json "volta.node") in dir or the workspace
// folders above it, plus dir's own "engines.node". Files are only read.
func nodeRequest(dir string, pkg packageJSON, parents []string) domain.NodeRequest {
	request := domain.NodeRequest{Engines: pkg.EnginesNode}
	if spec, source := versionIn(dir, pkg); spec != "" {
		request.Spec, request.Source = spec, source
		return request
	}
	for _, parent := range parents {
		parentPkg, _ := readPackageJSON(parent)
		spec, source := versionIn(parent, parentPkg)
		if spec == "" {
			continue
		}
		rel, err := filepath.Rel(dir, filepath.Join(parent, source))
		if err != nil {
			rel = filepath.Join(parent, source)
		}
		request.Spec, request.Source = spec, filepath.ToSlash(rel)
		return request
	}
	return request
}

// versionIn returns the version one folder asks for and the file it came
// from; package.json "volta.node" is reported as "package.json (volta)".
func versionIn(dir string, pkg packageJSON) (spec, source string) {
	for _, file := range versionFiles {
		data, err := readSmall(filepath.Join(dir, file.name))
		if err != nil {
			continue
		}
		if spec := cleanSpec(file.parse(data)); spec != "" {
			return spec, file.name
		}
	}
	if pkg.VoltaNode != "" {
		return pkg.VoltaNode, "package.json (volta)"
	}
	return "", ""
}

// firstValue is the first word of the first line that is not blank or a
// comment (.nvmrc and .node-version).
func firstValue(data []byte) string {
	scanner := bufio.NewScanner(bytes.NewReader(data))
	for scanner.Scan() {
		line, _, _ := strings.Cut(scanner.Text(), "#")
		if fields := strings.Fields(line); len(fields) > 0 {
			return fields[0]
		}
	}
	return ""
}

// toolVersionsNode reads the "nodejs" (asdf) or "node" (mise) line of a
// .tool-versions file; with several versions listed, the first wins.
func toolVersionsNode(data []byte) string {
	scanner := bufio.NewScanner(bytes.NewReader(data))
	for scanner.Scan() {
		line, _, _ := strings.Cut(scanner.Text(), "#")
		fields := strings.Fields(line)
		if len(fields) >= 2 && (fields[0] == "nodejs" || fields[0] == "node") {
			return fields[1]
		}
	}
	return ""
}

var (
	tomlSection = regexp.MustCompile(`^\s*\[\s*([^\]]+?)\s*\]`)
	tomlNode    = regexp.MustCompile(`^\s*["']?node(js)?["']?\s*=\s*(.+)$`)
	tomlString  = regexp.MustCompile(`["']([^"']*)["']`)
	tomlVersion = regexp.MustCompile(`version\s*=\s*["']([^"']*)["']`)
)

// miseNode reads `node = "20"` (or a list, or `{ version = "20" }`) from
// the [tools] table of a mise.toml. It is a line scan, not a TOML parser.
func miseNode(data []byte) string {
	scanner := bufio.NewScanner(bytes.NewReader(data))
	inTools := false
	for scanner.Scan() {
		line := scanner.Text()
		if m := tomlSection.FindStringSubmatch(line); m != nil {
			inTools = m[1] == "tools"
			continue
		}
		if !inTools {
			continue
		}
		m := tomlNode.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		value := strings.TrimSpace(m[2])
		if strings.HasPrefix(value, "{") {
			if v := tomlVersion.FindStringSubmatch(value); v != nil {
				return v[1]
			}
			return ""
		}
		if v := tomlString.FindStringSubmatch(value); v != nil {
			return v[1]
		}
	}
	return ""
}

// cleanSpec trims a version request and drops one that is too long or not
// a single printable line.
func cleanSpec(spec string) string {
	spec = strings.TrimSpace(spec)
	if len(spec) > maxSpecLength {
		return ""
	}
	for _, r := range spec {
		if r < 0x20 || r == 0x7f {
			return ""
		}
	}
	return spec
}

// stringField returns object[key] when object is a JSON object and the
// value a string.
func stringField(object any, key string) string {
	m, ok := object.(map[string]any)
	if !ok {
		return ""
	}
	value, _ := m[key].(string)
	return value
}

// hasWorkspaces accepts both package.json forms: an array of globs, or an
// object with a "packages" array (Yarn classic).
func hasWorkspaces(value any) bool {
	switch v := value.(type) {
	case []any:
		return len(v) > 0
	case map[string]any:
		packages, _ := v["packages"].([]any)
		return len(packages) > 0
	}
	return false
}
