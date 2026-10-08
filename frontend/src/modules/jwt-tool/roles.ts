import type { JwtSettings } from "./api"

type Roles = Pick<JwtSettings, "roles" | "selectedRoles">

/** Selected roles always follow catalogue order. */
function ordered(roles: string[], selected: Iterable<string>) {
  const set = new Set(selected)
  return roles.filter((role) => set.has(role))
}

export function filterRoles(roles: string[], query: string) {
  const q = query.trim().toLowerCase()
  return q ? roles.filter((role) => role.toLowerCase().includes(q)) : roles
}

/** Adds a role (selected, since the user just asked for it); existing roles are only selected. */
export function addRole(state: Roles, name: string): Roles {
  const role = name.trim()
  if (!role) return state
  const roles = state.roles.includes(role) ? state.roles : [...state.roles, role]
  return { roles, selectedRoles: ordered(roles, [...state.selectedRoles, role]) }
}

export function renameRole(state: Roles, from: string, to: string): Roles {
  const role = to.trim()
  if (!role || role === from || state.roles.includes(role)) return state
  const roles = state.roles.map((r) => (r === from ? role : r))
  return { roles, selectedRoles: ordered(roles, state.selectedRoles.map((r) => (r === from ? role : r))) }
}

export function deleteRole(state: Roles, name: string): Roles {
  return { roles: state.roles.filter((r) => r !== name), selectedRoles: state.selectedRoles.filter((r) => r !== name) }
}

export function toggleRole(state: Roles, name: string): Roles {
  const selected = state.selectedRoles.includes(name) ? state.selectedRoles.filter((r) => r !== name) : [...state.selectedRoles, name]
  return { roles: state.roles, selectedRoles: ordered(state.roles, selected) }
}

/** Selects or clears the given (e.g. currently filtered) roles. */
export function setRolesSelected(state: Roles, names: string[], selected: boolean): Roles {
  const set = new Set(state.selectedRoles)
  for (const name of names) {
    if (selected) set.add(name)
    else set.delete(name)
  }
  return { roles: state.roles, selectedRoles: ordered(state.roles, set) }
}
