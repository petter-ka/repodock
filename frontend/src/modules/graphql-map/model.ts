// Builds one schema model from many SDL files (ADR-0029). Unlike
// graphql-js's buildSchema this is lenient: each file is parsed on its own,
// a broken file is reported and skipped, definitions and `extend`s are
// merged by name across files and folders, duplicates are ignored, and
// undefined type references become "missing" placeholders.
import { GraphQLError, Kind, parse, print } from "graphql"
import type { ConstDirectiveNode, DefinitionNode, DocumentNode, EnumValueDefinitionNode, FieldDefinitionNode, InputValueDefinitionNode, NamedTypeNode, StringValueNode, TypeNode } from "graphql"

export type TypeKind = "object" | "interface" | "union" | "input" | "enum" | "scalar"
export type SourceFile = { root: string; path: string; content: string }
export type SourceRef = { root: string; path: string; line: number; sdl: string }

/** A type reference: `name` is the named type, `label` the full `[User!]!` form. */
export type TypeRef = { name: string; label: string; list: boolean }
export type SchemaArg = { name: string; description: string; type: TypeRef; defaultValue: string | null }
export type SchemaField = { name: string; description: string; type: TypeRef; args: SchemaArg[]; deprecated: string | null }
export type EnumValue = { name: string; description: string; deprecated: string | null }
export type SchemaType = {
  name: string
  kind: TypeKind
  description: string
  fields: SchemaField[]
  interfaces: string[]
  /** union members */
  members: string[]
  values: EnumValue[]
  sources: SourceRef[]
  builtIn: boolean
  /** referenced but never defined */
  missing: boolean
  /** referenced, and defined only in an unchecked file (that file) */
  external: { root: string; path: string } | null
}
export type FileReport = { root: string; path: string; types: number; error: { message: string; line: number; column: number } | null }
export type RootName = "query" | "mutation" | "subscription"
export type SchemaModel = {
  types: Map<string, SchemaType>
  roots: Record<RootName, string | null>
  files: FileReport[]
  /** interface name → object/interface types implementing it */
  implementations: Map<string, string[]>
  /** type name → "Type.field" (or "Type" for members) referencing it */
  referencedBy: Map<string, { type: string; field: string | null }[]>
  /** kind clashes and conflicting duplicate fields */
  warnings: string[]
}

const BUILT_IN_SCALARS = ["String", "Int", "Float", "Boolean", "ID"]

function typeRef(node: TypeNode): TypeRef {
  switch (node.kind) {
    case Kind.NON_NULL_TYPE: {
      const inner = typeRef(node.type)
      return { ...inner, label: `${inner.label}!` }
    }
    case Kind.LIST_TYPE: {
      const inner = typeRef(node.type)
      return { name: inner.name, label: `[${inner.label}]`, list: true }
    }
    default:
      return { name: node.name.value, label: node.name.value, list: false }
  }
}

const text = (node: StringValueNode | undefined) => node?.value.trim() ?? ""

function deprecation(node: { directives?: readonly ConstDirectiveNode[] }) {
  const directive = node.directives?.find((d) => d.name.value === "deprecated")
  if (!directive) return null
  const reason = directive.arguments?.find((a) => a.name.value === "reason")?.value
  return reason?.kind === Kind.STRING ? reason.value : "No longer supported"
}

function arg(node: InputValueDefinitionNode): SchemaArg {
  return { name: node.name.value, description: text(node.description), type: typeRef(node.type), defaultValue: node.defaultValue ? print(node.defaultValue) : null }
}

function field(node: FieldDefinitionNode | InputValueDefinitionNode): SchemaField {
  return {
    name: node.name.value,
    description: text(node.description),
    type: typeRef(node.type),
    args: node.kind === Kind.FIELD_DEFINITION ? (node.arguments ?? []).map(arg) : [],
    deprecated: deprecation(node),
  }
}

const KIND_OF: Partial<Record<Kind, TypeKind>> = {
  [Kind.OBJECT_TYPE_DEFINITION]: "object", [Kind.OBJECT_TYPE_EXTENSION]: "object",
  [Kind.INTERFACE_TYPE_DEFINITION]: "interface", [Kind.INTERFACE_TYPE_EXTENSION]: "interface",
  [Kind.UNION_TYPE_DEFINITION]: "union", [Kind.UNION_TYPE_EXTENSION]: "union",
  [Kind.INPUT_OBJECT_TYPE_DEFINITION]: "input", [Kind.INPUT_OBJECT_TYPE_EXTENSION]: "input",
  [Kind.ENUM_TYPE_DEFINITION]: "enum", [Kind.ENUM_TYPE_EXTENSION]: "enum",
  [Kind.SCALAR_TYPE_DEFINITION]: "scalar", [Kind.SCALAR_TYPE_EXTENSION]: "scalar",
}

function emptyType(name: string, kind: TypeKind): SchemaType {
  return { name, kind, description: "", fields: [], interfaces: [], members: [], values: [], sources: [], builtIn: false, missing: false, external: null }
}

function pushUnique<T>(list: T[], items: readonly T[], key: (item: T) => string, onDuplicate?: (existing: T, item: T) => void) {
  for (const item of items) {
    const existing = list.find((candidate) => key(candidate) === key(item))
    if (existing) onDuplicate?.(existing, item)
    else list.push(item)
  }
}

// Parsed documents by file, reused while the content is unchanged, so
// toggling files or options does not re-parse a large schema.
type Parsed = { content: string; document: DocumentNode | null; error: FileReport["error"] }
const parseCache = new Map<string, Parsed>()

function parseFile(file: SourceFile): Parsed {
  const key = `${file.root}\0${file.path}`
  const cached = parseCache.get(key)
  if (cached?.content === file.content) return cached
  let parsed: Parsed
  try {
    parsed = { content: file.content, document: file.content.trim() ? parse(file.content) : null, error: null }
  } catch (error) {
    const location = error instanceof GraphQLError ? error.locations?.[0] : undefined
    const message = error instanceof GraphQLError ? error.message.replace(/^Syntax Error: /, "") : String(error)
    parsed = { content: file.content, document: null, error: { message, line: location?.line ?? 1, column: location?.column ?? 1 } }
  }
  parseCache.set(key, parsed)
  return parsed
}

/**
 * `files` are merged into the model. `excluded` (unchecked) files are only
 * scanned for type names, so references into them show as external rather
 * than missing.
 */
export function buildModel(files: SourceFile[], excluded: SourceFile[] = []): SchemaModel {
  const types = new Map<string, SchemaType>()
  const roots: Record<RootName, string | null> = { query: null, mutation: null, subscription: null }
  const reports: FileReport[] = []
  const warnings: string[] = []

  const merge = (definition: DefinitionNode, file: SourceFile) => {
    if (definition.kind === Kind.SCHEMA_DEFINITION || definition.kind === Kind.SCHEMA_EXTENSION) {
      for (const op of definition.operationTypes ?? []) roots[op.operation as RootName] ??= op.type.name.value
      return 0
    }
    const kind = KIND_OF[definition.kind]
    if (!kind || !("name" in definition) || !definition.name) return 0
    const name = definition.name.value
    let type = types.get(name)
    if (!type) {
      type = emptyType(name, kind)
      types.set(name, type)
    } else if (type.kind !== kind) {
      warnings.push(`${name} is defined as ${type.kind} and as ${kind} (${file.path}); the second definition is ignored.`)
      return 0
    }
    const def = definition as DefinitionNode & {
      description?: StringValueNode
      fields?: readonly (FieldDefinitionNode | InputValueDefinitionNode)[]
      interfaces?: readonly NamedTypeNode[]
      types?: readonly NamedTypeNode[]
      values?: readonly EnumValueDefinitionNode[]
    }
    if (!type.description) type.description = text(def.description)
    pushUnique(type.fields, (def.fields ?? []).map(field), (f) => f.name, (existing, next) => {
      if (existing.type.label !== next.type.label) warnings.push(`${name}.${next.name} is ${existing.type.label} and ${next.type.label} (${file.path}); the first is kept.`)
    })
    pushUnique(type.interfaces, (def.interfaces ?? []).map((i) => i.name.value), (i) => i)
    pushUnique(type.members, (def.types ?? []).map((m) => m.name.value), (m) => m)
    pushUnique(type.values, (def.values ?? []).map((v) => ({ name: v.name.value, description: text(v.description), deprecated: deprecation(v) })), (v) => v.name)
    const loc = definition.loc
    if (loc) type.sources.push({ root: file.root, path: file.path, line: loc.startToken.line, sdl: file.content.slice(loc.start, loc.end) })
    return 1
  }

  for (const file of files) {
    const { document, error } = parseFile(file)
    let count = 0
    for (const definition of document?.definitions ?? []) count += merge(definition, file)
    reports.push({ root: file.root, path: file.path, types: count, error })
  }

  const externalKinds = new Map<string, { kind: TypeKind; root: string; path: string }>()
  for (const file of excluded) {
    for (const definition of parseFile(file).document?.definitions ?? []) {
      const kind = KIND_OF[definition.kind]
      if (kind && "name" in definition && definition.name && !externalKinds.has(definition.name.value)) externalKinds.set(definition.name.value, { kind, root: file.root, path: file.path })
    }
  }

  // Root operation types default to their conventional names.
  if (roots.query === null && types.has("Query")) roots.query = "Query"
  if (roots.mutation === null && types.has("Mutation")) roots.mutation = "Mutation"
  if (roots.subscription === null && types.has("Subscription")) roots.subscription = "Subscription"
  for (const key of Object.keys(roots) as RootName[]) if (roots[key] && !types.has(roots[key])) roots[key] = null

  for (const name of BUILT_IN_SCALARS) {
    if (!types.has(name)) types.set(name, { ...emptyType(name, "scalar"), builtIn: true })
  }

  // Every referenced name resolves to a type, so the graph and docs never
  // dangle; unknown names are flagged as missing.
  const referencedBy = new Map<string, { type: string; field: string | null }[]>()
  const implementations = new Map<string, string[]>()
  const reference = (target: string, from: { type: string; field: string | null }) => {
    if (!types.has(target)) {
      const external = externalKinds.get(target)
      types.set(target, external ? { ...emptyType(target, external.kind), external: { root: external.root, path: external.path } } : { ...emptyType(target, "scalar"), missing: true })
    }
    const list = referencedBy.get(target) ?? []
    list.push(from)
    referencedBy.set(target, list)
  }
  for (const type of [...types.values()]) {
    for (const f of type.fields) {
      reference(f.type.name, { type: type.name, field: f.name })
      for (const a of f.args) reference(a.type.name, { type: type.name, field: f.name })
    }
    for (const member of type.members) reference(member, { type: type.name, field: null })
    for (const iface of type.interfaces) {
      reference(iface, { type: type.name, field: null })
      implementations.set(iface, [...(implementations.get(iface) ?? []), type.name])
    }
  }

  return { types, roots, files: reports, implementations, referencedBy, warnings }
}

/** Types whose kind draws them as graph nodes (the rest are leaves). */
export const isComposite = (type: SchemaType | undefined) => type !== undefined && type.external === null && (type.kind === "object" || type.kind === "interface" || type.kind === "union")
