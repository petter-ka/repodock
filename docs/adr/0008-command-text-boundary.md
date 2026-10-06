# ADR-0008: Explicit boundary between shell text and structured invocations

- Status: Accepted
- Date: 2026-10-06

## Context

RepoDock runs two kinds of commands: shell text typed by the user (custom commands, command steps), and package scripts whose names come from `package.json`. A repository's `package.json` is untrusted data; concatenating a script name into shell text (`"npm run " + name`) lets a crafted name such as `dev & calc` execute arbitrary commands.

On Windows, Go's default argument escaping follows MSVCRT rules, which `cmd.exe` does not understand, so even legitimate commands containing quotes were mangled.

## Decision

- `process.Spec` has two mutually exclusive inputs: `Command` (user shell text, run verbatim) and `Argv` (structured invocation).
- Package scripts are always passed as `Argv` (`[pm, "run", name]`). Only the process `platform` package turns `Argv` into shell text:
  - Unix: POSIX single-quoting, which disables every expansion.
  - Windows: `cmd.exe` has no reliable quoting for arbitrary data, so arguments outside a conservative character set are **rejected** with a message suggesting a custom command.
- On Windows the shell command line is passed raw via `SysProcAttr.CmdLine` (`cmd.exe /d /s /c "<text>"`).
- Command text must be a single line without NUL bytes.
- Unix uses the user's login shell (`$SHELL -l -c`, falling back to `/bin/sh`) so PATH entries from profiles (nvm, volta, Homebrew) work for GUI launches.

## Alternatives considered

- Execute scripts without a shell (`exec.Command("npm", ...)`): on Windows `npm` is a `.cmd` file executed through `cmd.exe` anyway, and on macOS GUI apps lack the login-shell PATH.
- Escape for `cmd.exe`: `%`, `^` and `!` handling depends on context and delayed-expansion settings; rejection is safer.

## Consequences

- Script names with unusual characters cannot be run from chips on Windows; the user can run them as an explicit custom command.
- Shell text entered by the user is trusted as the user's own intent; it is still only executed on explicit action.

## Reconsider when

Commands are imported from remote or shared sources (see risk R-007).
