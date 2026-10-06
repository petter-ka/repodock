// Package platform hides OS-specific shell, quoting and process-tree
// semantics behind an OS-neutral surface (ADR-0007, ADR-0008).
package platform

import (
	"fmt"
	"strings"
	"time"
)

// Tree is a handle to a started process and its descendants.
type Tree interface {
	// Terminate stops the whole tree. Implementations may signal gracefully
	// first and escalate to a hard kill after grace.
	Terminate(grace time.Duration) error
	// Close releases OS resources held by the handle.
	Close()
}

// ValidateCommandText rejects shell text that cannot be passed through the
// platform shell as a single command line.
func ValidateCommandText(command string) error {
	if strings.ContainsAny(command, "\r\n") {
		return fmt.Errorf("command must be a single line")
	}
	if strings.IndexByte(command, 0) >= 0 {
		return fmt.Errorf("command contains a NUL byte")
	}
	return nil
}
