//go:build windows

package platform

// WarmEnvironment is a no-op on Windows: GUI apps inherit the user's PATH
// from the registry-backed environment, so no shell resolution is needed.
func WarmEnvironment() {}

// ChildEnvironment returns base unchanged on Windows.
func ChildEnvironment(base []string) []string { return base }
