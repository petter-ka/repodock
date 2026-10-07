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

## macOS install script

`install.sh` (repository root, served from `main` via raw.githubusercontent.com) is the recommended macOS install path while builds are not notarized:

- It resolves the latest release through the `/releases/latest` redirect (no API rate limit), or uses `REPODOCK_VERSION`.
- It downloads `RepoDock-<tag>-macos-universal.zip` and `SHA256SUMS.txt`, verifies the SHA-256, unpacks with `ditto`, and swaps the bundle into `/Applications` (or `~/Applications`, or `REPODOCK_INSTALL_DIR`). The previous copy is restored if the move fails. It refuses to run while RepoDock is running.
- Downloads made with `curl` carry no `com.apple.quarantine` attribute, so Gatekeeper does not prompt. The trust anchor is the GitHub repository plus the checksum, not Apple notarization.
- The whole script runs inside `main`, so a truncated `curl | sh` download cannot execute partially. `.gitattributes` keeps `*.sh` as LF.

The script depends on the asset names above and on `SHA256SUMS.txt` (`<sha256>  <file>` lines). Keep them stable or update the script in the same change. The per-release notes pin `REPODOCK_VERSION` to that release's tag.

## Signing (not yet enabled)

Builds are currently **unsigned**. Windows SmartScreen and macOS Gatekeeper show a warning on first launch of a browser-downloaded build; the release notes explain how to proceed. On macOS 15 and later, right-click → Open no longer bypasses Gatekeeper: users must use *System Settings → Privacy & Security → Open Anyway*. The macOS bundle is ad-hoc signed by the build (required for Apple Silicon), which does not satisfy Gatekeeper. To enable signing later:

- macOS: add a Developer ID certificate and notarization credentials as repository secrets, then `codesign --deep --options runtime` the `.app` and `xcrun notarytool submit --wait` the zip before uploading.
- Windows: sign `repodock.exe` and the installer with `signtool` (Authenticode certificate or a cloud signing service).

## Upgrade policy

Persisted workspace data must use a version field. Migrations are one-way and must preserve a backup before changing the existing file.
