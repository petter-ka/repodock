# Release and Distribution

## Targets

- Windows 10/11 x64 — built in CI.
- macOS Intel and Apple Silicon (universal binary) — built in CI.
- Windows ARM64 and Linux — not built yet (planned).

## How to cut a release

1. Make sure `main` is green in CI.
2. On GitHub: **Releases → Draft a new release**, create a tag such as `v0.2.0`, write the notes, and **Publish**.
3. The `Release` workflow (`.github/workflows/release.yml`) starts automatically and, in about 10 minutes:
   - builds Windows (`windows-latest`) and macOS (`macos-latest`, `darwin/universal`) with Wails;
   - runs `go test ./...` on both;
   - attaches the files and `SHA256SUMS.txt` to the release;
   - appends a **Downloads** table with direct links to the release notes (re-runs replace the table instead of duplicating it).

To try the pipeline without a release, run the workflow manually (**Actions → Release → Run workflow**). The files are then available as workflow artifacts only.

## Versioning

The release tag is the version. `vMAJOR.MINOR.PATCH[-suffix]` is recommended. CI writes the numeric part (`1.2.3` from `v1.2.3-beta.1`) into `wails.json` → `info.productVersion`, which becomes the Windows file/product version and the macOS bundle version. The committed `productVersion` is only used for local builds.

## Release artifacts

| File | Contents |
|---|---|
| `RepoDock-<tag>-windows-amd64-installer.exe` | NSIS installer (per-user/per-machine install, Start menu entry, uninstaller) |
| `RepoDock-<tag>-windows-amd64.zip` | Portable `repodock.exe` |
| `RepoDock-<tag>-macos-universal.zip` | `RepoDock.app` for Apple Silicon and Intel (created with `ditto`, preserving the bundle) |
| `SHA256SUMS.txt` | SHA-256 of every file above |

The final application embeds the frontend; no Node.js is needed on the target machine. Windows requires the WebView2 runtime, which ships with Windows 11 and current Windows 10; the installer downloads it if missing.

## Signing (not yet enabled)

Builds are currently **unsigned**: Windows SmartScreen and macOS Gatekeeper show a warning on first launch (the release notes explain how to proceed). To enable signing later:

- macOS: add a Developer ID certificate and notarization credentials as repository secrets, then `codesign --deep --options runtime` the `.app` and `xcrun notarytool submit --wait` the zip before uploading.
- Windows: sign `repodock.exe` and the installer with `signtool` (Authenticode certificate or a cloud signing service).

## Upgrade policy

Persisted workspace data must use a version field. Migrations are one-way and must preserve a backup before changing the existing file.
