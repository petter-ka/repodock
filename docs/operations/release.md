# Release and Distribution

## Targets

- Windows 10/11 x64 and ARM64 where supported by the toolchain.
- macOS Intel and Apple Silicon.
- Linux x64 and ARM64 where supported by the chosen packaging strategy.

## Build pipeline

1. install Go dependencies;
2. install frontend dependencies;
3. run formatting and tests;
4. build frontend;
5. run Wails package build;
6. sign platform artifacts;
7. publish checksums.

## Required release artifacts

- Windows installer or signed executable.
- macOS application bundle / DMG.
- Linux AppImage or distribution-specific package(s).
- SHA-256 checksums.

## Upgrade policy

Persisted workspace data must use a version field. Migrations are one-way and must preserve a backup before changing the existing file.
