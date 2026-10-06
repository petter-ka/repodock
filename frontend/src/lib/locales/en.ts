// English is the default locale and the source of truth for the message
// shape. Every other locale must provide the same keys (enforced by type).
export const en = {
  app: { name: "RepoDock", subtitle: "Local repository command center" },
  rail: { repos: "Repositories", settings: "Settings" },
  common: {
    cancel: "Cancel", save: "Save", close: "Close", delete: "Delete", rename: "Rename", create: "Create", remove: "Remove",
    refresh: "Refresh", run: "Run", stop: "Stop", restart: "Restart", dismiss: "Dismiss", discard: "Discard", saving: "Saving…",
    light: "Light", dark: "Dark", system: "System", name: "Name", error: "Something went wrong",
  },
  sidebar: {
    count: "{count} repositories", add: "Add repository", filter: "Filter repositories…", newGroup: "New group",
    emptyGroup: "No repositories in this group", noMatches: "No matches", groupActions: "Group actions",
    repoActions: "Repository actions", addHere: "Add repository here", moveTo: "Move to group", renameGroup: "Rename group",
    deleteGroup: "Delete group", running: "{count} running", problem: "package.json problem",
  },
  groupRun: {
    run: "Run group", runWithMode: "Run group ({mode})", stop: "Stop group", mode: "Run mode",
    sequential: "Sequential", parallel: "Parallel",
    sequentialHint: "One repository at a time, in sidebar order. Stops at the first failure.",
    parallelHint: "Start every repository at once. Failures don't stop the others.",
    progress: "{done}/{total} done", queued: "Queued in group run", failedIn: "Failed in group run",
    completed: "Group “{name}” finished", cancelled: "Group “{name}” stopped",
    failed: "Group “{name}” failed at {repo}: {error}",
    status: { running: "Running", completed: "Completed", failed: "Failed", cancelled: "Stopped" },
  },
  transfer: {
    menu: "Workspace actions", exportAll: "Export workspace…", exportGroup: "Export group…", import: "Import…",
    exported: "Exported to {path}",
    imported: "Import complete — groups created: {groups} · repositories added: {added} · already present: {skipped}",
    title: "Import workspace", from: "From {path}", exportedAt: "exported {time}",
    summary: "New groups: {create} · Repositories to add: {new} · Already registered: {existing}",
    nothing: "Everything in this file is already in your workspace.",
    status: { new: "new", missing: "folder not found", existing: "already registered", duplicate: "duplicate in file" },
    existingGroup: "existing group", newGroup: "new group", steps: "steps: {count}",
    missingHint: "Repositories whose folder is not found on this machine are added with a warning; clone them to the same path and refresh.",
    commandsWarning: "Shell commands in this file: {count}. Imported commands can run anything with your permissions — review them before enabling.",
    keepEnabled: "Keep imported sequence steps enabled",
    keepEnabledHint: "Off by default: imported steps are disabled until you review them in the Sequence panel. Nothing runs during import.",
    confirm: "Import",
  },
  groupDialog: { createTitle: "New group", renameTitle: "Rename group", placeholder: "e.g. Frontend apps" },
  confirm: {
    removeRepoTitle: "Remove {name}?",
    removeRepoBody: "Running processes for this repository are stopped. Nothing on disk is deleted.",
    deleteGroupTitle: "Delete group “{name}”?",
    deleteGroupBody: "Its repositories move to “{target}”.",
  },
  welcome: {
    title: "Your local command center",
    body: "Add a repository to discover its package scripts and control its local processes from one place.",
    add: "Add repository",
    consoleHint: "Output from every repository appears in the console below.",
  },
  header: {
    refreshed: "Refreshed {time}", sequence: "Sequence", environment: "Environment", stopAll: "Stop all",
    problemTitle: "package.json could not be read", problemHint: "Showing the last known scripts. Fix the file and refresh.",
    copyPath: "Copy path", copied: "Copied",
  },
  scripts: {
    title: "Scripts", empty: "This package.json has no scripts.", runningHint: "Running", runScript: "Run “{name}”",
    customPlaceholder: "Run a shell command in {name}…", runHint: "Enter to run · ↑ ↓ history",
  },
  process: {
    title: "Processes", pid: "PID", memory: "RAM", cpu: "CPU", procs: "{count} proc", exit: "exit {code}",
    showOutput: "Show only this run's output", clearFinished: "Clear finished", fromSequence: "sequence",
    status: { queued: "queued", starting: "starting", running: "running", stopping: "stopping", exited: "exited", failed: "failed", stopped: "stopped", skipped: "skipped" },
  },
  console: {
    title: "Console", allRuns: "All runs", allRepos: "All repositories", lines: "{count} lines", filter: "Filter output…",
    noOutput: "No output yet", noOutputHint: "Run a script or a custom command to stream its logs here.",
    clear: "Clear console", copy: "Copy visible output", copied: "Output copied", jump: "Jump to latest", following: "Following live output", paused: "Scroll paused",
  },
  sequence: {
    title: "Command sequence", hint: "Ordered startup steps. Foreground steps must succeed before the next one starts.",
    addScript: "Script step", addCommand: "Command step", addEmpty: "Empty step", emptyStep: "Empty step", noop: "(no-op)",
    noSteps: "No steps yet. Add a script, a command, or an empty placeholder.", enabled: "Enabled", background: "Background",
    backgroundHint: "Start and continue without waiting (dev servers, watchers)", moveUp: "Move up", moveDown: "Move down",
    removeStep: "Remove step", label: "Label", commandPlaceholder: "Shell command, or leave empty for a no-op",
    scriptMissing: "Script no longer exists in package.json", saved: "Sequence saved", runSaved: "Save & run",
    cancelRun: "Cancel run", unsavedTitle: "Discard sequence changes?", unsavedBody: "Your edits to the sequence have not been saved.",
    kindScript: "Script", kindCommand: "Command", run: "Run sequence", enabledCount: "{count} enabled",
    status: { pending: "pending", running: "running", started: "started", completed: "done", failed: "failed", skipped: "skipped", cancelled: "cancelled" },
    sequenceStatus: { running: "Sequence running", completed: "Sequence completed", failed: "Sequence failed", cancelled: "Sequence cancelled" },
  },
  env: {
    title: "Environment files", hint: "Local .env files detected in this repository", sensitive: "Sensitive — values may contain secrets. They are never logged or uploaded.",
    noFiles: "No supported .env files found in this repository.", reveal: "Reveal & edit", hide: "Hide values",
    masked: "Values are masked. Reveal to view or edit.", saved: "{name} saved", unsaved: "Unsaved changes",
    unsavedTitle: "Discard unsaved changes?", unsavedBody: "Changes to {name} will be lost.", modified: "Modified {time}",
  },
  settings: {
    title: "Settings", subtitle: "Desktop preferences for RepoDock.", theme: "Theme", themeHint: "Choose how the interface renders.",
    language: "Language", languageHint: "Interface language. English is the default.", shortcuts: "Keyboard shortcuts",
    workspace: "Workspace file", workspaceHint: "Groups and repositories are stored locally in this file.",
    browserMode: "Browser preview — a simulated backend is in use; nothing touches your filesystem.",
  },
  shortcuts: {
    addRepo: "Add repository", focusFilter: "Filter repositories", nextRepo: "Next repository", prevRepo: "Previous repository",
    focusCommand: "Focus command input", clearConsole: "Clear console", saveFile: "Save environment file",
  },
  notices: {
    recovered: "The workspace file was unreadable and was moved to {path}. RepoDock started with an empty workspace.",
    warning: "Startup warning: {message}", mockMode: "Browser preview: using a simulated backend.",
  },
}

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> }
export type Messages = Widen<typeof en>
