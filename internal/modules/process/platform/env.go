package platform

import (
	"os"
	"path/filepath"
	"strings"
)

// WithPath returns env with its PATH replaced by the merge of preferred,
// the existing PATH and extra directories. Entries keep their first
// position and duplicates are dropped. PATH matching is case-insensitive
// on Windows, where the variable may be spelled "Path".
func WithPath(env []string, preferred string, extra []string) []string {
	current := ""
	index := -1
	for i, kv := range env {
		key, value, _ := strings.Cut(kv, "=")
		if isPathKey(key) {
			current, index = value, i
		}
	}
	merged := MergePathLists(string(os.PathListSeparator), preferred, current, strings.Join(extra, string(os.PathListSeparator)))
	out := append([]string{}, env...)
	if index >= 0 {
		key, _, _ := strings.Cut(out[index], "=")
		out[index] = key + "=" + merged
	} else {
		out = append(out, "PATH="+merged)
	}
	return out
}

// MergePathLists joins PATH-style lists, keeping the first occurrence of
// each directory and skipping empty entries.
func MergePathLists(separator string, lists ...string) string {
	seen := map[string]bool{}
	var out []string
	for _, list := range lists {
		for dir := range strings.SplitSeq(list, separator) {
			dir = strings.TrimSpace(dir)
			if dir == "" {
				continue
			}
			key := filepath.Clean(dir)
			if os.PathSeparator == '\\' {
				key = strings.ToLower(key)
			}
			if seen[key] {
				continue
			}
			seen[key] = true
			out = append(out, dir)
		}
	}
	return strings.Join(out, separator)
}

func isPathKey(key string) bool {
	if os.PathSeparator == '\\' {
		return strings.EqualFold(key, "PATH")
	}
	return key == "PATH"
}

// SearchPath is the PATH child processes start with: the user's shell PATH
// (resolved once, see ChildEnvironment) plus well-known tool folders.
func SearchPath() string { return PathValue(ChildEnvironment(os.Environ())) }

// PathValue returns the PATH entry of env ("" when there is none).
func PathValue(env []string) string {
	value := ""
	for _, kv := range env {
		key, v, _ := strings.Cut(kv, "=")
		if isPathKey(key) {
			value = v
		}
	}
	return value
}

// FindExecutable looks name up in a PATH-style list the way a shell does
// and returns the first match, or "" when there is none. On Windows the
// PATHEXT extensions are tried.
func FindExecutable(name, pathList string) string {
	if name == "" || strings.ContainsAny(name, `/\`) {
		return ""
	}
	for _, dir := range filepath.SplitList(pathList) {
		if dir == "" || !filepath.IsAbs(dir) {
			continue
		}
		for _, candidate := range executableNames(name) {
			path := filepath.Join(dir, candidate)
			if isExecutable(path) {
				return path
			}
		}
	}
	return ""
}

func executableNames(name string) []string {
	if os.PathSeparator != '\\' {
		return []string{name}
	}
	exts := strings.Split(strings.ToLower(os.Getenv("PATHEXT")), ";")
	if len(exts) == 1 && exts[0] == "" {
		exts = []string{".com", ".exe", ".bat", ".cmd"}
	}
	names := []string{}
	if filepath.Ext(name) != "" {
		names = append(names, name)
	}
	for _, ext := range exts {
		if ext != "" {
			names = append(names, name+ext)
		}
	}
	return names
}

func isExecutable(path string) bool {
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return false
	}
	return os.PathSeparator == '\\' || info.Mode().Perm()&0o111 != 0
}
