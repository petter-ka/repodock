import { Check, Pencil, Plus, Search, Trash2, X } from "lucide-react"
import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tooltip } from "@/components/ui/tooltip"
import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { JwtSettings } from "./api"
import { addRole, deleteRole, filterRoles, renameRole, setRolesSelected, toggleRole } from "./roles"

type Roles = Pick<JwtSettings, "roles" | "selectedRoles">

/**
 * The role catalogue: search doubles as "create" (Enter adds the typed
 * role), each row toggles inclusion in the token and can be renamed or
 * deleted inline.
 */
export function RolesEditor({ value, onChange }: { value: Roles; onChange: (next: Roles) => void }) {
  const { t, f } = useI18n()
  const [query, setQuery] = useState("")
  const [editing, setEditing] = useState<{ role: string; text: string } | null>(null)
  const shown = useMemo(() => filterRoles(value.roles, query), [value.roles, query])
  const selected = useMemo(() => new Set(value.selectedRoles), [value.selectedRoles])
  const typed = query.trim()
  const canAdd = typed !== "" && !value.roles.includes(typed)

  const add = () => {
    if (!typed) return
    onChange(addRole(value, typed))
    setQuery("")
  }

  const editError = editing && editing.text.trim() !== editing.role && value.roles.includes(editing.text.trim()) ? f(t.jwt.roleExists, { role: editing.text.trim() }) : ""
  const commitEdit = () => {
    if (!editing) return
    if (!editError && editing.text.trim()) onChange(renameRole(value, editing.role, editing.text))
    setEditing(null)
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); add() }
              if (event.key === "Escape" && query) { event.stopPropagation(); setQuery("") }
            }}
            placeholder={t.jwt.searchRoles}
            aria-label={t.jwt.searchRoles}
            spellCheck={false}
            className="h-8 pl-8 font-mono text-xs"
          />
        </div>
        {canAdd && <Button size="xs" variant="outline" onClick={add}><Plus /> <span className="max-w-[140px] truncate">{f(t.jwt.addRole, { role: typed })}</span></Button>}
      </div>

      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>{f(t.jwt.rolesSelected, { selected: value.selectedRoles.length, total: value.roles.length })}</span>
        {shown.length > 0 && (
          <span className="ml-auto flex gap-2">
            <button onClick={() => onChange(setRolesSelected(value, shown, true))} className="rounded px-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{t.jwt.selectShown}</button>
            <button onClick={() => onChange(setRolesSelected(value, shown, false))} className="rounded px-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{t.jwt.clearShown}</button>
          </span>
        )}
      </div>

      <ul aria-label={t.jwt.roles} className="thin-scrollbar max-h-52 overflow-auto rounded-lg border border-border bg-background">
        {value.roles.length === 0 && <li className="px-3 py-3 text-xs text-muted-foreground">{t.jwt.noRoles}</li>}
        {value.roles.length > 0 && shown.length === 0 && <li className="px-3 py-3 text-xs text-muted-foreground">{f(t.jwt.noMatch, { query: typed })}</li>}
        {shown.map((role) => (
          <li key={role} className="group/role flex items-center gap-2 border-b border-border px-2 py-1 last:border-b-0">
            {editing?.role === role ? (
              <>
                <Input
                  autoFocus
                  value={editing.text}
                  onChange={(event) => setEditing({ role, text: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitEdit()
                    if (event.key === "Escape") { event.stopPropagation(); setEditing(null) }
                  }}
                  onBlur={commitEdit}
                  aria-label={f(t.jwt.editRole, { role })}
                  aria-invalid={!!editError}
                  title={editError || undefined}
                  spellCheck={false}
                  className={cn("h-7 min-w-0 flex-1 font-mono text-xs", editError && "border-destructive focus-visible:ring-destructive")}
                />
                <Button size="icon-sm" variant="ghost" aria-label={t.common.save} disabled={!!editError} onMouseDown={(event) => event.preventDefault()} onClick={commitEdit} className="text-success"><Check /></Button>
                <Button size="icon-sm" variant="ghost" aria-label={t.common.cancel} onMouseDown={(event) => event.preventDefault()} onClick={() => setEditing(null)} className="text-muted-foreground"><X /></Button>
              </>
            ) : (
              <>
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1">
                  <input type="checkbox" checked={selected.has(role)} onChange={() => onChange(toggleRole(value, role))} className="size-3.5 shrink-0 accent-[var(--primary)]" />
                  <span onDoubleClick={() => setEditing({ role, text: role })} className={cn("truncate font-mono text-xs", selected.has(role) ? "text-foreground" : "text-muted-foreground")}>{role}</span>
                </label>
                <span className="flex opacity-0 transition group-hover/role:opacity-100 group-focus-within/role:opacity-100">
                  <Tooltip label={f(t.jwt.editRole, { role })}>
                    <Button size="icon-sm" variant="ghost" aria-label={f(t.jwt.editRole, { role })} onClick={() => setEditing({ role, text: role })} className="text-muted-foreground"><Pencil /></Button>
                  </Tooltip>
                  <Tooltip label={f(t.jwt.deleteRole, { role })}>
                    <Button size="icon-sm" variant="ghost" aria-label={f(t.jwt.deleteRole, { role })} onClick={() => onChange(deleteRole(value, role))} className="text-muted-foreground hover:text-destructive"><Trash2 /></Button>
                  </Tooltip>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
