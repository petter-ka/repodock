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
