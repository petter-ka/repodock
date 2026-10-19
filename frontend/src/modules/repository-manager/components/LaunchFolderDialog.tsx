import { AlertTriangle, CheckCircle2, FolderOpen, FolderPlus, Info, Loader2, Plus } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { errorMessage } from "@/lib/bridge"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { useNotifications } from "@/state/notifications"
import { repositoryApi } from "../api"
import type { FolderCheck, Workspace } from "../domain"
import { useRepositoryActions } from "../hooks/useRepositoryActions"
import { useWorkspaceState } from "../hooks/useStores"
import { workspaceStore } from "../store/workspaceStore"

const NEW_GROUP = "__new__"

const parentOf = (path: string) => path.replace(/[\\/]+$/, "").replace(/[\\/][^\\/]*$/, "").toLowerCase()

/**
 * The group a folder most likely belongs to: the one with the most members
 * living next to it (same parent folder), else the first group.
 */
export function suggestGroup(workspace: Workspace, path: string) {
  const parent = parentOf(path)
  let best = workspace.groups[0]?.id ?? ""
  let bestScore = 0
  for (const group of workspace.groups) {
    const score = workspace.repositories.filter((repo) => repo.groupId === group.id && parentOf(repo.path) === parent).length
    if (score > bestScore) [best, bestScore] = [group.id, score]
  }
  return best
}

/**
 * Asks which group a folder handed to RepoDock on its command line (or a
 * second launch) goes to (ADR-0026). Several folders are offered one by one.
 * `onShow` brings the repositories view forward.
 */
export function LaunchFolderDialog({ onShow }: { onShow: () => void }) {
  const { t, f } = useI18n()
  const { notify } = useNotifications()
  const actions = useRepositoryActions()
  const { workspace, loaded } = useWorkspaceState()
  const [queue, setQueue] = useState<FolderCheck[]>([])
  const [seen, setSeen] = useState(0)
  const [groupId, setGroupId] = useState("")
  const [newName, setNewName] = useState("")
  const [busy, setBusy] = useState(false)
  const newNameRef = useRef<HTMLInputElement>(null)
  const onShowRef = useRef(onShow)
  onShowRef.current = onShow

  useEffect(() => {
    const take = () => repositoryApi.takeLaunchFolders().then((folders) => {
      if (!folders?.length) return
      setQueue((current) => [...current, ...folders.filter((folder) => !current.some((c) => c.path === folder.path))])
      setSeen((n) => n + folders.length)
      onShowRef.current()
    }).catch((error) => notify(errorMessage(error), { tone: "error" }))
    void take()
    return repositoryApi.on("launch:folder", () => void take())
  }, [notify])

  const folder = queue[0]
  // Pick a default group for every new folder (once the workspace is loaded).
  useEffect(() => {
    if (!folder || !loaded) return
    setGroupId(suggestGroup(workspaceStore.getState().workspace, folder.path))
    setNewName("")
  }, [folder, loaded])
  useEffect(() => {
    if (groupId === NEW_GROUP) newNameRef.current?.focus()
  }, [groupId])

  const counts = useMemo(() => new Map(workspace.groups.map((g) => [g.id, g.repositoryIds.length])), [workspace.groups])
  const next = () => setQueue((current) => current.slice(1))
  const canAdd = !!folder?.valid && (groupId === NEW_GROUP ? newName.trim().length > 0 : workspace.groups.some((g) => g.id === groupId))
  const index = seen - queue.length + 1

  const add = async () => {
    if (!folder || !canAdd) return
    setBusy(true)
    try {
      const repo = await actions.addLaunchFolder(folder.path, groupId === NEW_GROUP ? "" : groupId, groupId === NEW_GROUP ? newName : "")
      if (repo) next()
    } finally {
      setBusy(false)
    }
  }
  const openExisting = () => {
    if (!folder) return
    workspaceStore.select(folder.registeredId)
    onShow()
    next()
  }

  return (
    <Dialog open={!!folder} onOpenChange={(open) => { if (!open) next() }}>
      {folder && (
        <DialogContent closeLabel={t.common.close} className="max-w-lg">
          <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); void add() }}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FolderPlus className="size-4 text-primary" /> {t.launch.title}
                {seen > 1 && <Badge className="ml-1 tabular-nums">{f(t.launch.queue, { index, total: seen })}</Badge>}
              </DialogTitle>
              <DialogDescription>{t.launch.description}</DialogDescription>
            </DialogHeader>

            <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary"><FolderOpen className="size-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{folder.name || folder.path.split(/[\\/]/).filter(Boolean).pop()}</p>
                <code className="block truncate text-xs text-muted-foreground" title={folder.path}>{folder.path}</code>
                <p className={cn("mt-1.5 flex items-center gap-1.5 text-xs", folder.valid ? "text-muted-foreground" : "text-destructive")}>
                  {!folder.exists ? <><AlertTriangle className="size-3.5" /> {t.launch.notFound}</>
                    : !folder.valid ? <><AlertTriangle className="size-3.5" /> {f(t.launch.invalid, { problem: folder.problem })}</>
                      : folder.packageJson ? <><CheckCircle2 className="size-3.5 text-success" /> {t.launch.packageFound}</>
                        : <><Info className="size-3.5" /> {t.launch.plain}</>}
                </p>
              </div>
            </div>

            {folder.registeredId && (
              <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs">
                <Info className="size-4 shrink-0 text-primary" />
                <span className="flex-1">{f(t.launch.registered, { name: folder.registeredName })}</span>
                <Button size="xs" variant="outline" onClick={openExisting}>{f(t.launch.openExisting, { name: folder.registeredName })}</Button>
              </div>
            )}

            {folder.valid && (
              <fieldset className="grid gap-1.5">
                <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{t.launch.group}</legend>
                <div className="thin-scrollbar grid max-h-64 gap-1.5 overflow-y-auto pr-0.5">
                  {workspace.groups.map((group) => (
                    <GroupOption key={group.id} checked={groupId === group.id} onSelect={() => setGroupId(group.id)} label={group.name} hint={f(t.launch.members, { count: counts.get(group.id) ?? 0 })} />
                  ))}
                  <GroupOption checked={groupId === NEW_GROUP} onSelect={() => setGroupId(NEW_GROUP)} label={t.launch.newGroup} icon={<Plus className="size-3.5" />}>
                    {groupId === NEW_GROUP && (
                      <Input ref={newNameRef} value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={t.groupDialog.placeholder} aria-label={t.launch.newGroupName} className="mt-2 h-8" />
                    )}
                  </GroupOption>
                </div>
              </fieldset>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={next}>{t.launch.later}</Button>
              {folder.valid && (
                <Button type="submit" disabled={!canAdd || busy}>
                  {busy && <Loader2 className="animate-spin" />}
                  {folder.registeredId ? t.launch.addAnyway : t.launch.add}
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  )
}

function GroupOption({ checked, onSelect, label, hint, icon, children }: {
  checked: boolean
  onSelect: () => void
  label: string
  hint?: string
  icon?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <label className={cn("cursor-pointer rounded-lg border px-3 py-2 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring", checked ? "border-primary/50 bg-primary/10" : "border-border hover:bg-accent/60")}>
      <span className="flex items-center gap-2.5 text-sm">
        <input type="radio" name="launch-group" checked={checked} onChange={onSelect} className="size-3.5 accent-[var(--primary)]" />
        {icon}
        <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
        {hint && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </label>
  )
}
