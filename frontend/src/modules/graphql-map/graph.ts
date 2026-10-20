// Turns a schema model into the drawn graph (ADR-0029). The rules follow
// graphql-voyager: start from a root type and follow field types, union
// members and interface implementations; optionally collapse Relay
// connections to plain lists. On top of that: a focus mode (the
// neighbourhood of one type) and input types drawn from field arguments.
import { isComposite, type SchemaModel, type SchemaType } from "./model"

export const ALL_TYPES = "*"

export type GraphOptions = {
  /** root type name, or ALL_TYPES */
  root: string
  collapseRelay: boolean
  showLeafFields: boolean
  showDeprecated: boolean
  showInputs: boolean
  hideRoot: boolean
  sortFields: boolean
  /** when set, only this type and its neighbours within focusDepth are drawn */
  focus: string | null
  focusDepth: number
}

export const defaultGraphOptions: GraphOptions = {
  root: "", collapseRelay: true, showLeafFields: true, showDeprecated: false, showInputs: false, hideRoot: false, sortFields: false, focus: null, focusDepth: 1,
}

export type RowRole = "field" | "member" | "implementation"
export type GraphRow = {
  /** handle id, unique within the node */
  id: string
  role: RowRole
  name: string
  /** the type label shown on the right ("[User!]!"), empty for members */
  label: string
  /** named type after Relay collapsing */
  typeName: string
  /** node this row links to, when drawn */
  target: string | null
  /** input types of the arguments that are drawn */
  inputTargets: string[]
  args: number
  deprecated: boolean
  relay: boolean
}
export type GraphNode = { name: string; type: SchemaType; rows: GraphRow[]; hiddenLeaves: number; isRoot: boolean; width: number; height: number }
export type EdgeRole = RowRole | "input"
/** `sourceY` is the source row's centre, measured from the node's top. */
export type GraphEdge = { id: string; source: string; sourceHandle: string; sourceY: number; target: string; role: EdgeRole }
export type TypeGraph = { nodes: GraphNode[]; edges: GraphEdge[] }

/** Fixed node metrics; TypeNode renders with exactly these sizes. */
export const METRICS = { header: 36, row: 22, section: 20, footer: 20, padding: 6, minWidth: 180, maxWidth: 400 }
const CHAR = 6.7

export type RelayInfo = {
  /** Connection/Edge/PageInfo/Node types hidden from the graph */
  hidden: Set<string>
  /** Connection → node type (drawn as a list), Edge → node type */
  replace: Map<string, { name: string; list: boolean }>
}

/** Finds Relay connections: `XConnection { edges: [XEdge { node, cursor }], pageInfo }`. */
export function relayInfo(model: SchemaModel): RelayInfo {
  const hidden = new Set<string>()
  const replace = new Map<string, { name: string; list: boolean }>()
  for (const type of model.types.values()) {
    if (type.kind !== "object" || !/.Connection$/.test(type.name)) continue
    const edges = type.fields.find((f) => f.name === "edges")
    if (!edges || !type.fields.some((f) => f.name === "pageInfo")) continue
    const edgeType = model.types.get(edges.type.name)
    if (edgeType?.kind !== "object") continue
    const node = edgeType.fields.find((f) => f.name === "node")
    if (!node || !edgeType.fields.some((f) => f.name === "cursor")) continue
    hidden.add(type.name)
    hidden.add(edgeType.name)
    replace.set(type.name, { name: node.type.name, list: true })
    replace.set(edgeType.name, { name: node.type.name, list: false })
  }
  if (replace.size > 0) {
    if (model.types.get("PageInfo")?.kind === "object") hidden.add("PageInfo")
    const node = model.types.get("Node")
    if (node?.kind === "interface" && node.fields.length <= 1) hidden.add("Node")
  }
  return { hidden, replace }
}

function rowsOf(type: SchemaType, model: SchemaModel, relay: RelayInfo | null, options: GraphOptions): { rows: GraphRow[]; hiddenLeaves: number } {
  const drawable = (name: string) => {
    const target = model.types.get(name)
    if (!target || target.external !== null || relay?.hidden.has(name)) return false
    return isComposite(target) || (options.showInputs && target.kind === "input")
  }
  const rows: GraphRow[] = []
  let hiddenLeaves = 0
  const isQueryRoot = type.name === model.roots.query

  for (const field of type.fields) {
    if (field.deprecated && !options.showDeprecated) continue
    let typeName = field.type.name
    let label = field.type.label
    let isRelay = false
    const replacement = relay?.replace.get(typeName)
    if (replacement) {
      typeName = replacement.name
      label = replacement.list ? `[${typeName}]` : typeName
      isRelay = true
    }
    // Relay's `node(id)` / `nodes(ids)` entry points only add noise.
    if (relay && isQueryRoot && (field.name === "node" || field.name === "nodes") && relay.hidden.has(typeName)) continue
    const target = drawable(typeName) && !(model.types.get(typeName)?.kind === "input" && type.kind !== "input") ? typeName : null
    const inputTargets = options.showInputs ? [...new Set(field.args.map((a) => a.type.name).filter((name) => model.types.get(name)?.kind === "input"))] : []
    if (!target && !options.showLeafFields && inputTargets.length === 0) {
      hiddenLeaves++
      continue
    }
    rows.push({ id: `f:${field.name}`, role: "field", name: field.name, label, typeName, target, inputTargets, args: field.args.length, deprecated: field.deprecated !== null, relay: isRelay })
  }

  const linked = (role: RowRole, names: string[]) =>
    names.filter((name) => !relay?.hidden.has(name)).map((name): GraphRow => ({
      id: `${role[0]}:${name}`, role, name, label: "", typeName: name, target: drawable(name) ? name : null, inputTargets: [], args: 0, deprecated: false, relay: false,
    }))
  if (type.kind === "union") rows.push(...linked("member", type.members))
  if (type.kind === "interface") rows.push(...linked("implementation", model.implementations.get(type.name) ?? []))

  if (options.sortFields) rows.sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : 0))
  return { rows, hiddenLeaves }
}

function measure(node: Omit<GraphNode, "width" | "height">) {
  // Room for the kind icon and the tree button of a selected card.
  const header = node.name.length * 7.4 + 88
  const widest = node.rows.reduce((max, row) => Math.max(max, (row.name.length + row.label.length + (row.args ? 3 : 0) + 2) * CHAR + 40), 0)
  // Implementations get a small "implemented by" section heading.
  const extraSections = node.rows.some((row) => row.role === "implementation") ? 1 : 0
  return {
    width: Math.round(Math.min(METRICS.maxWidth, Math.max(METRICS.minWidth, header, widest))),
    height: METRICS.header + node.rows.length * METRICS.row + extraSections * METRICS.section + (node.hiddenLeaves ? METRICS.footer : 0) + METRICS.padding,
  }
}

/** Vertical centre of a row inside its node (TypeNode renders exactly this). */
export function rowCenter(rows: GraphRow[], index: number) {
  const firstImplementation = rows.findIndex((row) => row.role === "implementation")
  const section = firstImplementation !== -1 && index >= firstImplementation ? METRICS.section : 0
  return METRICS.header + section + index * METRICS.row + METRICS.row / 2
}

/** True for types that may be drawn as nodes at all under these options. */
function candidate(type: SchemaType, relay: RelayInfo | null, options: GraphOptions) {
  if (type.builtIn || type.missing || type.external !== null || relay?.hidden.has(type.name)) return false
  return isComposite(type) || (options.showInputs && type.kind === "input")
}

export function buildGraph(model: SchemaModel, options: GraphOptions): TypeGraph {
  const relay = options.collapseRelay ? relayInfo(model) : null
  const cache = new Map<string, ReturnType<typeof rowsOf>>()
  const rows = (name: string) => {
    let entry = cache.get(name)
    if (!entry) {
      entry = rowsOf(model.types.get(name)!, model, relay, options)
      cache.set(name, entry)
    }
    return entry
  }
  const neighbours = (name: string) => rows(name).rows.flatMap((row) => [...(row.target ? [row.target] : []), ...row.inputTargets])

  const focusType = options.focus ? model.types.get(options.focus) : undefined
  const focusing = focusType !== undefined && candidate(focusType, relay, { ...options, showInputs: options.showInputs || focusType.kind === "input" })
  const effective = focusing && focusType.kind === "input" ? { ...options, showInputs: true } : options

  let names: Set<string>
  if (options.root === ALL_TYPES || focusing) {
    names = new Set([...model.types.values()].filter((type) => candidate(type, relay, effective)).map((type) => type.name))
  } else {
    names = new Set()
    const root = model.types.get(options.root)
    if (root && candidate(root, relay, options)) {
      names.add(root.name)
      for (const name of names) for (const next of neighbours(name)) if (model.types.has(next)) names.add(next)
    }
    if (options.hideRoot) names.delete(options.root)
  }

  if (focusing) {
    // Undirected neighbourhood: what the type uses and what uses it.
    const adjacent = new Map<string, Set<string>>()
    const link = (a: string, b: string) => {
      if (!adjacent.has(a)) adjacent.set(a, new Set())
      adjacent.get(a)!.add(b)
    }
    for (const name of names) for (const next of neighbours(name)) if (names.has(next)) { link(name, next); link(next, name) }
    let frontier = [options.focus!]
    const kept = new Set(frontier)
    for (let depth = 0; depth < options.focusDepth; depth++) {
      frontier = frontier.flatMap((name) => [...(adjacent.get(name) ?? [])]).filter((name) => !kept.has(name))
      frontier.forEach((name) => kept.add(name))
    }
    names = kept
  }

  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  for (const name of names) {
    const { rows: nodeRows, hiddenLeaves } = rows(name)
    const base = { name, type: model.types.get(name)!, rows: nodeRows, hiddenLeaves, isRoot: name === options.root }
    nodes.push({ ...base, ...measure(base) })
    nodeRows.forEach((row, index) => {
      const sourceY = rowCenter(nodeRows, index)
      if (row.target && names.has(row.target)) edges.push({ id: `${name}|${row.id}|${row.target}`, source: name, sourceHandle: row.id, sourceY, target: row.target, role: row.role })
      for (const input of row.inputTargets) if (names.has(input)) edges.push({ id: `${name}|${row.id}|${input}|in`, source: name, sourceHandle: row.id, sourceY, target: input, role: "input" })
    })
  }
  return { nodes, edges }
}

/** Root choices that exist in the model, in Voyager's order. */
export function rootChoices(model: SchemaModel) {
  return (["query", "mutation", "subscription"] as const).flatMap((key) => (model.roots[key] ? [{ key, name: model.roots[key] }] : []))
}
