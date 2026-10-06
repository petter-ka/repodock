# CI/CD

`frontend/package-lock.json` is committed; CI installs with `npm ci` and npm caching. Go tests run on Linux (with `-race`), Windows and macOS because the process module contains OS-specific code.

## Workflows

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | push to `main`, pull requests | gofmt, vet, Go tests on Linux (`-race`)/Windows/macOS; frontend typecheck, tests, build |
| `release.yml` | GitHub Release published, or manual run | Wails builds for Windows x64 (zip + NSIS installer) and macOS universal; checksums; uploads to the release and adds a download table (see `release.md`) |

`release.yml` needs `contents: write` (declared in the workflow) and uses only the built-in `GITHUB_TOKEN`.

Release CI should later add:

- `wails doctor` validation;
- macOS signing and notarization;
- Windows Authenticode signing;
- Linux packaging;
- license/SBOM generation;
- dependency vulnerability scan.
