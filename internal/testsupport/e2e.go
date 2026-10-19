// Package testsupport holds helpers shared by tests. Nothing in the app
// imports it.
package testsupport

import "testing"

// E2E marks a test that starts real OS processes (shells, scripts, the
// watchdog, sockets). Such tests depend on the machine's timing and tools,
// so they are skipped under `go test -short`, which CI uses; a plain
// `go test ./...` runs them.
func E2E(t *testing.T) {
	t.Helper()
	if testing.Short() {
		t.Skip("end-to-end test (starts real processes); skipped with -short")
	}
}
