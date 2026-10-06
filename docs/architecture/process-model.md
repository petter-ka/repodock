# Process Model

## Lifecycle

```text
Requested
   │
   ▼
Starting ────────► Failed
   │
   ▼
Running ─────────► Stopping
   │                  │
   │                  ▼
   └──────────────► Exited
```

## Command resolution

1. If the user selected a package script, resolve the local package manager.
2. Build the argument vector `[pm, "run", script]`; the platform layer quotes it for the shell (ADR-0008). Script names are never concatenated into shell text by callers.
3. If a custom command was entered, preserve it as single-line shell text.
4. Execute with the repository folder as the working directory.
5. Construct a clean process environment from the host environment plus any selected repository env-file values in future stages. MVP only discovers/edits env files; it does not auto-inject them unless explicitly configured.

## Shell abstraction

`internal/modules/process/platform` exposes an OS-neutral surface with build-tagged implementations:

```go
func ShellCommand(command, workdir string) *exec.Cmd // cmd.exe /d /s /c "…" | $SHELL -l -c …
func JoinArgv(argv []string) (string, error)         // quote (Unix) or validate (Windows)
func Attach(cmd *exec.Cmd) Tree                      // Job Object | process group
type Tree interface { Terminate(grace time.Duration) error; Close() }
func ParentMap() (map[int32]int32, error)            // one process-table scan per stats tick
```

Child processes inherit the host environment plus `FORCE_COLOR=1` (unless already set) so Node tooling keeps colors; the console renders ANSI SGR codes and strips other escape sequences.

## Output

Output is line-oriented. Stdout/stderr are captured through writers (not pipes read concurrently with `Wait`), split on `
`, with bare `` resetting the current line (progress bars) and lines capped at 16 KiB. Lines are coalesced into `process:output-batch` events every ~50 ms. All output of a run is flushed before its `process:exited` event. Each line contains:

- run ID
- repository ID
- process PID when available
- stream: stdout/stderr
- global sequence number
- timestamp
- text

Long-term, a raw byte stream may be added for terminal-grade behavior.

## Process termination

See ADR-0007.

- Windows: Job Object per run (`TerminateJobObject`), `taskkill /T /F` fallback.
- Unix-like systems: process group, `SIGTERM` then `SIGKILL` after a 3 s grace period.

## Retention

The manager keeps every active run plus the 200 most recent finished runs (risk R-006).

## Metrics

Use gopsutil for cross-platform basic metrics, aggregated over the run's whole process tree (shell → package manager → node → workers):

- RSS memory bytes (sum).
- CPU percent since the previous sample (sum; may exceed 100 % on multi-core machines, like `top`).
- process count and root process status.

One shared sampler ticks at about 1 Hz for all runs, builds a single parent map per tick, and sleeps while nothing is running.
