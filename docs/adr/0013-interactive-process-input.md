# ADR-0013: Answer process prompts through a stdin pipe

- Status: Accepted
- Date: 2026-10-07

## Context

Many CLI tools ask questions on standard output and wait for an answer on standard input: `Ok to proceed? (y)`, `Overwrite? [y/N]`, `npm init`, migration confirmations, password prompts. Child processes were started with no stdin, so they read EOF at once: prompts failed or silently took a default. A prompt also usually ends without a newline, so it stayed in the line buffer and was never shown in the console.

## Decision

### Standard input

- Every run gets a **stdin pipe** (`exec.Cmd.StdinPipe`). It stays open for the life of the process and is closed by Go when the process exits.
- `SendInput(runID, text, secret)` writes `text + "\n"`. The text must be a single line (no CR/LF/NUL) of at most 4 KiB. It goes to the process **as data**: it is never put into a shell command, so the ADR-0008 boundary is unchanged.
- `CloseInput(runID)` closes the pipe so the process reads EOF (like Ctrl+D). Later input is rejected.
- Writes are serialized per run and bounded by a 3 s timeout, so a process that never reads cannot block the caller.

### Console echo

Pipes do not echo, so RepoDock adds the sent line to the console as an output line with `stream: "stdin"`. When `secret` is set (the user toggled "hide what I type", which is turned on automatically for password/token-like prompts), the echo is masked (`•••`). The real text never reaches the console, the event stream or logs.

### Prompt detection

The line writer emits a buffered, unterminated line after output has been quiet for 250 ms, with `partial: true`. Lines being redrawn with carriage returns (progress bars) are not flushed early. The frontend treats a run whose latest output line is partial as **waiting for input**. Its process card gets a badge, and the input bar under the console targets it and shows the prompt as the placeholder.

### UI

An input bar under the console appears whenever a process in scope is running. It targets the run selected in the console, otherwise the newest run waiting on a prompt, otherwise the newest running run, and there is a picker when several are running. It provides a text field (Enter sends, an empty Enter sends an empty line), quick **y**, **n** and **⏎** buttons, **EOF** (also Ctrl+D in an empty field), and a hide-input toggle.

## Alternatives considered

- **Pseudo-terminal (ConPTY / `creack/pty`)**: gives full TTY behaviour (arrow-key menus, raw mode, real echo, colours without `FORCE_COLOR`). However, it merges stdout and stderr, needs a terminal emulator in the frontend, and changes process-tree handling on every OS. This is a much larger change, kept as a possible future ADR.
- **Keep stdin closed and pass `--yes` style flags**: works only for tools that offer such flags, and the user has to know them in advance.

## Consequences

- Line-based prompts work: readline, `read -p`, `set /p`, `input()`, `[y/N]` questions and most password prompts that read from stdin.
- Prompts that need a TTY (interactive arrow-key lists such as some `inquirer`/`@clack/prompts` modes) may still refuse to run or fall back to defaults. Some tools check `isTTY` and skip prompting altogether.
- A tool that reads stdin until EOF now waits instead of seeing EOF at once. The user can send **EOF**, or stop the process.
- A foreground sequence step that prompts now waits for an answer instead of failing immediately. The waiting badge makes that visible.
- Grandchildren inherit the stdin handle; termination is unchanged (ADR-0007).

## Reconsider when

Users need full-screen or arrow-key interactive tools inside RepoDock. That points to a PTY-backed terminal view.
