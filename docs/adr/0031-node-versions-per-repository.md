# ADR-0031: Node.js version per repository, and nvm/fnm in commands

- Status: Accepted
- Date: 2026-10-21

## Context

Repositories pin different Node.js versions (`.nvmrc`, `.node-version`, `.tool-versions`, Volta), and developers keep several installed with nvm, fnm, Volta, asdf, mise, n, nodenv, nvs or Homebrew. RepoDock showed no version at all, and every command ran with whatever `node` the shell found first, so a repository asking for Node 20 could silently run on 22.

Commands run through `$SHELL -l -c` (ADR-0008). A login shell does not read `~/.zshrc`/`~/.bashrc`, where nvm is defined as a shell function, so a custom command such as `nvm use 18 && npm run dev` failed with `zsh:1: command not found: nvm`. fnm's `fnm use` needs `fnm env` for the same reason. Login profiles (and macOS `path_helper`) also reorder PATH after the environment is set, so a PATH change made only through the environment can be undone.

## Decision

- **Discovery, without executing anything** (`internal/modules/nodeversion`): installed versions are found by reading the managers' folders — nvm (`$NVM_DIR`, `~/.nvm`, `$XDG_CONFIG_HOME/nvm`), fnm (`$FNM_DIR`, XDG data, `~/Library/Application Support/fnm`, `%APPDATA%\fnm`), Volta (`tools/image/node`), asdf (`installs/nodejs`), mise (`installs/node`), n (`$N_PREFIX/n`, `/usr/local/n`), nodenv, nvs, nvm for Windows and Homebrew (`Cellar/node*`). Only folders named like a full version with a `node` executable count; aliases (`lts`, `20`) are skipped.
- **The default** is the first `node` on the PATH commands get (the interactive shell's PATH, see `docs/architecture/process-model.md`). If it is a discovered install, it is marked; otherwise (a system install, a shim) RepoDock runs `<node> --version` once, from the home folder, with a 3 s timeout. The scan runs in the background at startup and again on **Refresh all** or **Rescan installed versions**.
- **What a repository asks for** is read by the repository module during inspection (`Repository.nodeRequest`): the nearest of `.nvmrc`, `.node-version`, `.tool-versions` (`nodejs`/`node`), `.mise.toml`/`mise.toml` (`[tools] node`) and `package.json` `volta.node`, in the folder or a workspace folder above it (up to the Git root, never the home folder — a monorepo member uses the root's `.nvmrc`), plus the folder's own `engines.node`.
- **Resolution** (backend, `nodeversion.Resolve`): the user's choice (`Repository.nodeVersion`, an exact installed version), else the request (aliases `node`/`lts/*`/`lts/<codename>`/`system`, prefixes like `20`, or semver ranges → the newest installed match), else the default. A choice or request that is not installed is reported as `missing` and the next option is used, so commands still run. The status also reports `eol` (an end-of-life table of release lines), `enginesMismatch` (semver range check against `engines.node`) and `newer` (a higher installed major).
- **Every run of a repository** (scripts, commands, global and quick commands, sequence steps, tasks, restarts) gets the resolved version's bin folder first on PATH (`process.Spec.PathPrefix`), the default included, so what the header shows is what runs. A restart picks up a version chosen since.
- **Shell prelude** (`process/platform/prelude_unix.go`): RepoDock prefixes the user's command with shell text it writes itself:
  - a command that calls `nvm` (as a word) gets `export NVM_DIR=…; . <nvm.sh> --no-use` (nvm.sh is looked up in `NVM_DIR`, `~/.nvm`, Homebrew and distribution locations);
  - the PATH prefix is exported again, after the profile ran;
  - a command that calls `fnm` then gets `eval "$(fnm env --shell zsh|bash)"`, so `fnm use` inside it decides.
  Only paths RepoDock found are inserted, single-quoted; the user's text follows unchanged. fish gets the fish equivalents (`set -gx PATH …`, `fnm env --shell fish | source`); other shells get the PATH through the environment only. Windows sets PATH in the environment (`cmd /d` runs no AutoRun).
- **UI**: a Node chip in the repository header (version, "chosen" marker, warning colour) opens a menu that explains the source and any problem, offers **Automatic** and every installed version (managers and EOL tags shown), and **Rescan**. The sidebar shows the major (`· v20`, warning colour when it needs a look), the dashboard has a **Node.js versions** card (repositories per release line, end-of-life lines in the warning colour, a short list of repositories to look at).
- Bindings: `NodeVersions()`, `RescanNodeVersions()`, `SetRepositoryNodeVersion(repoID, version)` (installed versions only; `""` = automatic). The choice is persisted in the workspace and not exported (it is machine-specific).

## Consequences

- Version files are honoured even when the user's shell has no auto-switching hook, and a mismatch or missing install is visible before anything runs.
- A command that calls fnm manages its own version; one that calls nvm can still `nvm use` (nvm prepends its version). Commands that call neither always run with the shown version.
- The end-of-life table must be extended when Node.js announces a new release line; unknown newer lines count as supported.
- Shims (asdf, mise, nodenv, Volta) still work: a shim folder that is the default is put first, and a repository with a version file gets that version's real bin folder.

## Reconsider when

- Users want RepoDock to install missing versions (it would run `nvm install` etc. on request, in a run like any other).
- A per-group or workspace-wide default version is needed.
