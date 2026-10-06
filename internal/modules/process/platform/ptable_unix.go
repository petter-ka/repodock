//go:build !windows

package platform

import "github.com/shirou/gopsutil/v4/process"

// ParentMap returns pid → parent pid for every visible process.
func ParentMap() (map[int32]int32, error) {
	procs, err := process.Processes()
	if err != nil {
		return nil, err
	}
	out := make(map[int32]int32, len(procs))
	for _, p := range procs {
		if ppid, err := p.Ppid(); err == nil {
			out[p.Pid] = ppid
		}
	}
	return out, nil
}
