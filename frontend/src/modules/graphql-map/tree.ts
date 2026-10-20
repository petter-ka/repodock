// Tree view of one type or field (ADR-0029). "down" opens what a type
// contains level by level (fields, union members, implementations, enum
// values); "up" climbs to what uses it (fields and arguments of that type,
// unions containing it, interfaces it implements) until the root types.
// Children are computed lazily from the model, so cycles cost nothing until
// a branch is opened, and a type already above in its branch is a leaf.
import type { SchemaModel } from "./model"

export type TreeMode = "down" | "up"
export type TreeRoot = { type: string; field: string | null }
export type TreeRelation = "type" | "field" | "argument" | "member" | "implementation" | "value" | "memberOf" | "implements"

export type TreeItem = {
  /** unique among its siblings */
  key: string
  relation: TreeRelation
  /** the type the row shows (a field's owner, or the linked type); clicking selects it */
  type: string
  /** field, or enum value; null for a type row */
  field: string | null
  /** argument name, for "argument" rows */
  arg: string | null
  /** the type label on the right ("[User!]!"), empty for type rows */
  label: string
  /** type the row opens into; null for leaves (enum values) */
  next: string | null
  args: number
  deprecated: boolean
}

export type TreeRow =
  | { kind: "item"; path: string; parent: string | null; level: number; item: TreeItem; expandable: boolean; expanded: boolean; recursive: boolean }
  | { kind: "more"; path: string; parent: string; level: number; hidden: number }

/** Children shown per branch before a "show more" row. */
export const TREE_PAGE = 100
export const ROOT_PATH = "r"

export const sameRoot = (a: TreeRoot, b: TreeRoot) => a.type === b.type && a.field === b.field

const link = (relation: TreeRelation, name: string): TreeItem => ({ key: `${relation}:${name}`, relation, type: name, field: null, arg: null, label: "", next: name, args: 0, deprecated: false })

export function downChildren(model: SchemaModel, name: string): TreeItem[] {
  const type = model.types.get(name)
  if (!type) return []
  const items = type.fields.map((f): TreeItem => ({
    key: `f:${f.name}`, relation: "field", type: name, field: f.name, arg: null, label: f.type.label, next: f.type.name, args: f.args.length, deprecated: f.deprecated !== null,
  }))
  for (const member of type.members) items.push(link("member", member))
  if (type.kind === "interface") for (const implementation of model.implementations.get(name) ?? []) items.push(link("implementation", implementation))
  for (const value of type.values) items.push({ key: `v:${value.name}`, relation: "value", type: name, field: value.name, arg: null, label: "", next: null, args: 0, deprecated: value.deprecated !== null })
  return items
}

export function upChildren(model: SchemaModel, name: string): TreeItem[] {
  const items = new Map<string, TreeItem>()
  const add = (item: TreeItem) => { if (!items.has(item.key)) items.set(item.key, item) }
  for (const ref of model.referencedBy.get(name) ?? []) {
    const parent = model.types.get(ref.type)
    if (!parent) continue
    if (ref.field === null) {
      // A union lists its members; an implementation referencing its interface is below it, not above.
      if (parent.kind === "union") add(link("memberOf", parent.name))
      continue
    }
    const field = parent.fields.find((f) => f.name === ref.field)
    if (!field) continue
    const base = { type: parent.name, field: field.name, next: parent.name, args: field.args.length, deprecated: field.deprecated !== null }
    if (field.type.name === name) add({ ...base, key: `f:${parent.name}.${field.name}`, relation: "field", arg: null, label: field.type.label })
    for (const arg of field.args) {
      if (arg.type.name === name) add({ ...base, key: `a:${parent.name}.${field.name}(${arg.name})`, relation: "argument", arg: arg.name, label: arg.type.label })
    }
  }
  for (const iface of model.types.get(name)?.interfaces ?? []) add(link("implements", iface))
  return [...items.values()]
}

export const treeChildren = (model: SchemaModel, mode: TreeMode, name: string) => (mode === "down" ? downChildren(model, name) : upChildren(model, name))

/**
 * The root row. A field root opens into the field's type going down, and
 * into its owner going up. A row name that is not a field (a union member or
 * implementation picked on the map) roots the tree at that type.
 */
export function rootItem(model: SchemaModel, root: TreeRoot, mode: TreeMode): TreeItem | null {
  const type = model.types.get(root.type)
  if (!type) return null
  const field = root.field === null ? undefined : type.fields.find((f) => f.name === root.field)
  if (field) {
    return {
      key: ROOT_PATH, relation: "field", type: type.name, field: field.name, arg: null, label: field.type.label,
      next: mode === "down" ? field.type.name : type.name, args: field.args.length, deprecated: field.deprecated !== null,
    }
  }
  if (root.field !== null && model.types.has(root.field)) return rootItem(model, { type: root.field, field: null }, mode)
  return { ...link("type", type.name), key: ROOT_PATH }
}

/** The visible rows, depth first: open branches only, `shown` children per branch. */
export function flattenTree(root: TreeItem, children: (name: string) => TreeItem[], expanded: ReadonlySet<string>, shown: ReadonlyMap<string, number> = new Map()): TreeRow[] {
  const rows: TreeRow[] = []
  const visit = (item: TreeItem, path: string, parent: string | null, level: number, above: ReadonlySet<string>) => {
    const recursive = parent !== null && item.next !== null && above.has(item.next)
    const kids = item.next !== null && !recursive ? children(item.next) : []
    const open = kids.length > 0 && expanded.has(path)
    rows.push({ kind: "item", path, parent, level, item, expandable: kids.length > 0, expanded: open, recursive })
    if (!open) return
    const inner = new Set(above).add(item.next!)
    const limit = shown.get(path) ?? TREE_PAGE
    for (const child of kids.slice(0, limit)) visit(child, `${path}/${child.key}`, path, level + 1, inner)
    if (kids.length > limit) rows.push({ kind: "more", path: `${path}/…`, parent: path, level: level + 1, hidden: kids.length - limit })
  }
  visit(root, ROOT_PATH, null, 0, new Set([root.type]))
  return rows
}
