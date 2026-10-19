# ADR-0026: Open a folder from the command line; one RepoDock per workspace

- Status: Accepted
- Date: 2026-10-19

## Context

Users want `repodock ~/work/new-service` (from a terminal, a script or an editor task) to add that folder, choosing its group, without going through the folder picker. If RepoDock is already open, a second copy must not start: two instances on one workspace file would overwrite each other's changes and fight over process tracking (ADR-0019).

## Decision

- Arguments that are not flags (`-…`) are folders. They are made absolute against the launching directory before Wails starts (`app.AbsoluteArgs` rewrites `os.Args`), because a second launch forwards its arguments without its working directory. A file stands for its folder.
- Wails' single-instance lock is enabled with an ID derived from the workspace file path (so a development instance with `REPODOCK_WORKSPACE` can run beside the installed app). A second launch exits at once and hands its arguments to the running instance, which also comes to the front.
- macOS "open file" events (Finder, `open -a RepoDock <folder>`) go the same way. AppKit also reports command-line paths this way, so a folder handed over again within 5 s is ignored.
- Folders wait in the backend until the frontend fetches them with `TakeLaunchFolders()` (each a `FolderCheck`), and `launch:folder` announces new ones. This works at cold start, before the frontend listens.
- The frontend shows "Add this folder?" over any view. It shows the folder, whether it has a `package.json` or will be a plain folder, an error for missing or unusable folders, and a note with "Open …" when the folder is already registered (adding another record stays possible, ADR-0015). The group is chosen from radio cards, or "New group…" with a name. The suggested group is the one with the most members in the same parent folder. Several folders are offered one by one ("1 of 3"). Adding selects the new repository and switches to the repositories view.

## Consequences

- Only one RepoDock per workspace file can run; launching it again focuses it.
- Folder-type document associations in `Info.plist` (for "Open With" in Finder) are not declared yet; the handler is ready for them.
