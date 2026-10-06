//go:build windows

package platform

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

// ParentMap returns pid → parent pid for every process using a single
// toolhelp snapshot.
func ParentMap() (map[int32]int32, error) {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return nil, err
	}
	defer windows.CloseHandle(snap)
	var entry windows.ProcessEntry32
	entry.Size = uint32(unsafe.Sizeof(entry))
	out := map[int32]int32{}
	for err = windows.Process32First(snap, &entry); err == nil; err = windows.Process32Next(snap, &entry) {
		out[int32(entry.ProcessID)] = int32(entry.ParentProcessID)
	}
	return out, nil
}
