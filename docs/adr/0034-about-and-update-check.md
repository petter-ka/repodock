# ADR-0034: About page with the version and an update check

- Status: Accepted
- Date: 2026-10-21

## Context

Builds are distributed as GitHub releases (see `docs/operations/release.md`), but the app did not show which version it was, nor whether a newer one existed or what changed. The security baseline says the core makes no external network requests.

## Decision

- **Version**: `internal/app.Version` is the release tag, set by the release workflow with `-ldflags "-X github.com/example/repodock/internal/app.Version=<tag>"`; local and `wails dev` builds report `dev`. `AppInfo()` adds the Go build's VCS stamp (commit, commit time, modified), platform and Go version.
- **Settings → About** shows them, a GitHub button and **Check for updates**.
- **The update check is the only network request, and only on that click** (`internal/modules/updates`): one `GET https://api.github.com/repos/petter-ka/repodock/releases?per_page=20` with a `RepoDock/<version>` User-Agent, 15 s timeout, 4 MB response limit. Nothing about the workspace, repositories or environment is sent. The result is not stored on disk.
  - Drafts are ignored; releases are ordered by semver (prereleases before their release). The **latest** is the newest stable release (prereleases count when running one, or when none is stable). `updateAvailable` compares it with the running version; a `dev` build is not comparable and only shows the latest release.
  - Release notes are cut at the `<!-- repodock-downloads -->` marker the release workflow appends, so the download table is replaced by an **Open release** link.
  - Rate limiting (HTTP 403/429 with `X-RateLimit-Remaining: 0`), 404 and malformed answers become readable errors.
- **Changelog**: the most recent releases are listed (new ones and the newest open by default). Notes are Markdown, read by a small parser (`modules/settings/markdown.ts`: headings, lists, paragraphs, quotes, code, emphasis, links, tables as text) into data that React renders as text — no HTML from the notes reaches the DOM.
- **Links** open in the default browser through `OpenExternalURL(url)`, which accepts `https` URLs only; the webview never navigates away.

## Consequences

- The security baseline gains one explicit, user-triggered exception (see `docs/security/threat-model.md`).
- Unauthenticated GitHub API calls are limited to 60 per hour per IP address; a manual check never comes close.

## Reconsider when

- Users ask for automatic checks (it would be an opt-in setting, at most once a day) or in-app installation of updates.
