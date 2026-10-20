// Package graphqlscan finds GraphQL schema files under a folder for the
// "GraphQL map" mini app (ADR-0029). It only reads files; parsing and
// merging the SDL happens in the frontend.
package graphqlscan

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/example/repodock/internal/domain"
)

// Limits keep a scan of a huge folder (or a home directory picked by
// mistake) bounded.
const (
	MaxFiles     = 2000
	MaxFileSize  = 4 << 20
	MaxTotalSize = 48 << 20
)

// Extensions are the schema file suffixes, compared case-insensitively.
var Extensions = []string{".graphql", ".graphqls", ".gql"}

// skipDirs are dependency, build and tool folders that hold copies or
// generated output rather than the schema sources.
var skipDirs = map[string]bool{
	"node_modules": true, "dist": true, "build": true, "out": true, "coverage": true,
	"vendor": true, "bower_components": true, "jspm_packages": true, "target": true,
}

func isSchemaFile(name string) bool {
	ext := strings.ToLower(filepath.Ext(name))
	for _, candidate := range Extensions {
		if ext == candidate {
			return true
		}
	}
	return false
}

// Scan walks root (an absolute directory) and returns its schema files
// sorted by path. Hidden folders and skipDirs are not entered; unreadable
// entries are ignored.
func Scan(root string) (domain.GraphQLScan, error) {
	result := domain.GraphQLScan{Root: root, Files: []domain.GraphQLFile{}}
	if !filepath.IsAbs(root) {
		return result, fmt.Errorf("folder path must be absolute: %s", root)
	}
	info, err := os.Stat(root)
	if err != nil {
		return result, fmt.Errorf("open folder: %w", err)
	}
	if !info.IsDir() {
		return result, fmt.Errorf("not a folder: %s", root)
	}

	errStop := errors.New("limit reached")
	var total int64
	err = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			if entry != nil && entry.IsDir() && path != root {
				return fs.SkipDir
			}
			return nil
		}
		name := entry.Name()
		if entry.IsDir() {
			if path != root && (strings.HasPrefix(name, ".") || skipDirs[name]) {
				return fs.SkipDir
			}
			return nil
		}
		if !entry.Type().IsRegular() || !isSchemaFile(name) {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return nil
		}
		if info.Size() > MaxFileSize {
			result.Skipped++
			return nil
		}
		if len(result.Files) >= MaxFiles || total+info.Size() > MaxTotalSize {
			result.Truncated = true
			return errStop
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			rel = name
		}
		total += int64(len(data))
		result.Files = append(result.Files, domain.GraphQLFile{Path: filepath.ToSlash(rel), Content: string(data), Size: int64(len(data))})
		return nil
	})
	if err != nil && !errors.Is(err, errStop) {
		return result, err
	}
	sort.Slice(result.Files, func(i, j int) bool { return result.Files[i].Path < result.Files[j].Path })
	return result, nil
}
