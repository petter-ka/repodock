import { describe, expect, it } from "vitest"
import { addRole, deleteRole, filterRoles, renameRole, setRolesSelected, toggleRole } from "./roles"

const state = { roles: ["admin", "viewer", "editor"], selectedRoles: ["editor"] }

describe("roles", () => {
  it("filters case-insensitively", () => {
    expect(filterRoles(state.roles, " EDI ")).toEqual(["editor"])
    expect(filterRoles(state.roles, "")).toEqual(state.roles)
  })

  it("adds a new role selected, and only selects an existing one", () => {
    expect(addRole(state, " auditor ")).toEqual({ roles: ["admin", "viewer", "editor", "auditor"], selectedRoles: ["editor", "auditor"] })
    expect(addRole(state, "admin")).toEqual({ roles: state.roles, selectedRoles: ["admin", "editor"] })
    expect(addRole(state, "  ")).toBe(state)
  })

  it("renames keeping selection, refusing duplicates", () => {
    expect(renameRole(state, "editor", "writer")).toEqual({ roles: ["admin", "viewer", "writer"], selectedRoles: ["writer"] })
    expect(renameRole(state, "editor", "admin")).toBe(state)
  })

  it("deletes, toggles and bulk-selects in catalogue order", () => {
    expect(deleteRole(state, "editor")).toEqual({ roles: ["admin", "viewer"], selectedRoles: [] })
    expect(toggleRole(state, "admin").selectedRoles).toEqual(["admin", "editor"])
    expect(toggleRole(state, "editor").selectedRoles).toEqual([])
    expect(setRolesSelected(state, ["viewer", "admin"], true).selectedRoles).toEqual(["admin", "viewer", "editor"])
    expect(setRolesSelected(state, ["editor"], false).selectedRoles).toEqual([])
  })
})
