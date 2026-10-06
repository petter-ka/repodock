package transfer

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ReadFile reads an export document from a user-selected path.
func ReadFile(path string) ([]byte, error) {
	if !strings.EqualFold(filepath.Ext(path), ".json") {
		return nil, fmt.Errorf("choose a .json file")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", filepath.Base(path), err)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, MaxDocumentSize+1))
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", filepath.Base(path), err)
	}
	if len(data) > MaxDocumentSize {
		return nil, fmt.Errorf("file is larger than %d bytes", MaxDocumentSize)
	}
	return data, nil
}

// WriteFile writes an export atomically (temp file, fsync, rename).
func WriteFile(path string, data []byte) error {
	if filepath.Ext(path) == "" {
		path += ".json"
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".tmp-*")
	if err != nil {
		return fmt.Errorf("create export: %w", err)
	}
	name := tmp.Name()
	fail := func(cause error) error {
		_ = tmp.Close()
		_ = os.Remove(name)
		return fmt.Errorf("write export: %w", cause)
	}
	if _, err := tmp.Write(data); err != nil {
		return fail(err)
	}
	if err := tmp.Sync(); err != nil {
		return fail(err)
	}
	if err := tmp.Close(); err != nil {
		return fail(err)
	}
	_ = os.Chmod(name, 0o644)
	if err := os.Rename(name, path); err != nil {
		_ = os.Remove(name)
		return fmt.Errorf("write export: %w", err)
	}
	return nil
}
