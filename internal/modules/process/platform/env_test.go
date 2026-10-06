package platform

import (
	"os"
	"strings"
	"testing"
)

func TestMergePathListsKeepsFirstOccurrence(t *testing.T) {
	sep := string(os.PathListSeparator)
	got := MergePathLists(sep, strings.Join([]string{"/a", "/b"}, sep), strings.Join([]string{"/b", "", "/c"}, sep), "/a")
	if want := strings.Join([]string{"/a", "/b", "/c"}, sep); got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestWithPathReplacesExistingPath(t *testing.T) {
	sep := string(os.PathListSeparator)
	env := []string{"HOME=/h", "PATH=/usr/bin", "X=1"}
	got := WithPath(env, "/shell/bin"+sep+"/usr/bin", []string{"/opt/homebrew/bin"})
	if got[1] != "PATH=/shell/bin"+sep+"/usr/bin"+sep+"/opt/homebrew/bin" {
		t.Fatalf("env = %v", got)
	}
	if env[1] != "PATH=/usr/bin" {
		t.Fatal("input slice must not be modified")
	}
	if added := WithPath([]string{"HOME=/h"}, "/x", nil); added[len(added)-1] != "PATH=/x" {
		t.Fatalf("missing PATH must be added: %v", added)
	}
}
