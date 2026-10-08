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

### PATH on macOS and Linux

Apps launched from Finder, the Dock or a desktop launcher do not inherit a terminal's PATH, and a login shell (`zsh -l`) does not read `~/.zshrc`, where nvm, fnm, asdf and similar tools usually add `node`/`npm`. Without help, commands fail with `zsh:1: command not found: npm`.

At startup the process module resolves the PATH of the user's **interactive login shell** once, in the background (`$SHELL -i -l -c`, stdin closed, 8 s timeout, PATH extracted between markers so profile banners are ignored). Every child process gets `PATH = <shell PATH> + <inherited PATH> + <existing well-known tool folders>` (Homebrew, MacPorts, volta, bun, pnpm, asdf, mise, nodenv, newest nvm version), de-duplicated. If resolution fails or times out, the fallback folders still apply and a warning is logged. Windows GUI apps already inherit the user PATH, so this is a no-op there.

The PATH is resolved once per app launch: after installing a new Node version manager, restart RepoDock.

## Output

Output is line-oriented. Stdout/stderr are captured through writers (not pipes read concurrently with `Wait`), split on `
`, with bare `
` resetting the current line (progress bars) and lines capped at 16 KiB. Lines are coalesced into `process:output-batch` events every ~50 ms. All output of a run is flushed before its `process:exited` event. Each line contains:

- run ID
- repository ID
- process PID when available
- stream: stdout/stderr, or stdin for the echo of input sent by the user
- partial: true for an unterminated line emitted after 250 ms of silence (a prompt); carriage-return redraws are never flushed early
- global sequence number
- timestamp
- text

Long-term, a raw byte stream may be added for terminal-grade behavior.

## Standard input

Every run has a stdin pipe that stays open until the process exits (ADR-0013). `SendInput` writes one line as data (never shell text), serialized per run with a 3 s timeout; `CloseInput` sends EOF. Input is echoed to the console as a `stdin` line, masked when marked secret, and never logged.

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

## Nothing outlives RepoDock (ADR-0019)

Every process group is tracked from start until its last member exits (not just the shell). Quitting SIGTERMs all tracked groups and SIGKILLs survivors synchronously after 5 s; SIGINT/SIGTERM/SIGHUP run the same shutdown. A watchdog process (the RepoDock binary with `--repodock-process-watchdog`) receives the tracked groups over a pipe and kills them if RepoDock dies without saying goodbye (crash, Force Quit). `running-processes.json` lets the next launch kill same-boot leftovers if the watchdog died too. Windows relies on kill-on-close Job Objects.

Group tracking cannot follow descendants that leave their group (`setsid`, daemons). Every child therefore carries `REPODOCK_SESSION`, `REPODOCK_OWNER`, `REPODOCK_RUN_ID` and `REPODOCK_REPOSITORY_ID` (ADR-0021). Quitting and the watchdog also kill every process marked with the session; at launch, processes marked by a session whose RepoDock is gone are listed in a dialog where the user can stop them.
