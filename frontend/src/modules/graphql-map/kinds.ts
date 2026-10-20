import { Asterisk, Box, Braces, Component, FileX2, List, Shapes, TriangleAlert, type LucideIcon } from "lucide-react"
import type { Messages } from "@/lib/locales/en"
import type { SchemaType, TypeKind } from "./model"

export type KindKey = TypeKind | "missing" | "external"

/** Kind colours come from the app's validated categorical palette. */
export const KINDS: Record<KindKey, { color: string; icon: LucideIcon; label: (t: Messages) => string }> = {
  object: { color: "var(--series-1)", icon: Box, label: (t) => t.graphql.kinds.object },
  interface: { color: "var(--series-7)", icon: Component, label: (t) => t.graphql.kinds.interface },
  union: { color: "var(--series-4)", icon: Shapes, label: (t) => t.graphql.kinds.union },
  input: { color: "var(--series-3)", icon: Braces, label: (t) => t.graphql.kinds.input },
  enum: { color: "var(--series-5)", icon: List, label: (t) => t.graphql.kinds.enum },
  scalar: { color: "var(--series-other)", icon: Asterisk, label: (t) => t.graphql.kinds.scalar },
  missing: { color: "var(--destructive)", icon: TriangleAlert, label: (t) => t.graphql.kinds.missing },
  external: { color: "var(--series-other)", icon: FileX2, label: (t) => t.graphql.kinds.external },
}

export const kindOf = (type: SchemaType | undefined): KindKey => (!type || type.missing ? "missing" : type.external !== null ? "external" : type.kind)

/** Order of kind groups in the type browser. */
export const KIND_ORDER: KindKey[] = ["object", "interface", "union", "input", "enum", "scalar", "external", "missing"]
