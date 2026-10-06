# CI/CD

`frontend/package-lock.json` is committed; CI installs with `npm ci` and npm caching. Go tests run on Linux (with `-race`), Windows and macOS because the process module contains OS-specific code.

Release CI should later add:

- `wails doctor` validation;
- Windows packaging;
- macOS packaging/signing;
- Linux packaging;
- artifact checksums;
- license/SBOM generation;
- dependency vulnerability scan.
