import { describe, expect, it } from "vitest"
import { mockGraphQLFiles } from "@/lib/mockGraphQL"
import { ALL_TYPES, buildGraph, defaultGraphOptions, relayInfo } from "./graph"
import { fastLayout } from "./layout"
import { buildModel } from "./model"

const model = () => buildModel(mockGraphQLFiles().map((file) => ({ root: "/r", ...file })))

describe("buildModel", () => {
  it("merges definitions and extensions across files", () => {
    const m = model()
    expect(m.roots).toEqual({ query: "Query", mutation: "Mutation", subscription: null })
    expect(m.types.get("Mutation")!.fields.map((f) => f.name)).toEqual(["changeUserStatus", "createIssue", "closeIssue"])
    expect(m.types.get("Mutation")!.sources.map((s) => s.path)).toEqual(["schema/schema.graphql", "schema/users/user.graphql", "schema/repos/repository.graphql"])
    expect(m.implementations.get("Actor")).toEqual(["User", "Organization"])
    expect(m.types.get("Repository")!.fields.find((f) => f.name === "stars")!.deprecated).toBe("Use stargazerCount.")
    expect(m.types.get("Query")!.fields.find((f) => f.name === "search")!.args[2].defaultValue).toBe("10")
  })

  it("reports a broken file without losing the others", () => {
    const broken = model().files.find((f) => f.path.endsWith("broken.graphql"))!
    expect(broken.error).toMatchObject({ line: 3 })
    expect(model().types.has("Draft")).toBe(false)
  })

  it("flags undefined references as missing and ignores duplicate fields", () => {
    const m = buildModel([
      { root: "/a", path: "a.graphql", content: "type Query { me: Viewer, id: ID }" },
      { root: "/b", path: "b.graphql", content: "extend type Query { id: ID, other: Int }\ninterface Query { x: Int }" },
    ])
    expect(m.types.get("Viewer")!.missing).toBe(true)
    expect(m.types.get("Query")!.fields.map((f) => f.name)).toEqual(["me", "id", "other"])
    expect(m.warnings).toHaveLength(1)
  })
})

describe("buildGraph", () => {
  it("collapses Relay connections and follows reachable types from the root", () => {
    const m = model()
    expect([...relayInfo(m).hidden].sort()).toEqual(["IssueConnection", "IssueEdge", "Node", "PageInfo", "RepositoryConnection", "RepositoryEdge", "UserConnection", "UserEdge"])
    const graph = buildGraph(m, { ...defaultGraphOptions, root: "Query" })
    const names = graph.nodes.map((n) => n.name).sort()
    expect(names).toEqual(["Actor", "Issue", "Language", "Organization", "Query", "Repository", "SearchResult", "User", "UserStatus"])
    const user = graph.nodes.find((n) => n.name === "User")!
    expect(user.rows.find((r) => r.name === "repositories")).toMatchObject({ label: "[Repository]", target: "Repository", relay: true })
    expect(graph.nodes.find((n) => n.name === "Query")!.rows.some((r) => r.name === "node")).toBe(false)
    expect(graph.nodes.find((n) => n.name === "Repository")!.rows.some((r) => r.name === "stars")).toBe(false)
  })

  it("draws input types from arguments when asked", () => {
    const graph = buildGraph(model(), { ...defaultGraphOptions, root: "Mutation", showInputs: true })
    expect(graph.edges.filter((e) => e.role === "input").map((e) => e.target).sort()).toEqual(["ChangeUserStatusInput", "CreateIssueInput", "RepositoryOrder"])
  })

  it("limits a focused graph to the neighbourhood", () => {
    const graph = buildGraph(model(), { ...defaultGraphOptions, root: ALL_TYPES, focus: "Issue", focusDepth: 1 })
    expect(graph.nodes.map((n) => n.name).sort()).toEqual(["Actor", "Issue", "Mutation", "Repository", "SearchResult"])
  })
})

describe("file selection", () => {
  it("marks types from unchecked files as external instead of missing", () => {
    const files = mockGraphQLFiles().map((file) => ({ root: "/r", ...file }))
    const included = files.filter((f) => !f.path.endsWith("search.graphql"))
    const excluded = files.filter((f) => f.path.endsWith("search.graphql"))
    const m = buildModel(included, excluded)
    expect(m.types.get("SearchResult")).toMatchObject({ kind: "union", missing: false, external: { root: "/r", path: "schema/search.graphql" } })
    const graph = buildGraph(m, { ...defaultGraphOptions, root: "Query" })
    expect(graph.nodes.some((n) => n.name === "SearchResult")).toBe(false)
    expect(graph.nodes.find((n) => n.name === "Query")!.rows.find((r) => r.name === "search")!.target).toBeNull()
  })
})

describe("fastLayout", () => {
  it("places every node, roots first, without overlaps", () => {
    const nodes = Array.from({ length: 400 }, (_, i) => ({ name: `T${i}`, width: 200, height: 60 + (i % 7) * 22 }))
    const edges = nodes.slice(1).map((n, i) => ({ source: `T${Math.floor(i / 5)}`, target: n.name }))
    const positions = fastLayout({ nodes, edges, root: "T0" })
    expect(positions.size).toBe(400)
    expect(positions.get("T0")!.x).toBe(0)
    const boxes = nodes.map((n) => ({ ...positions.get(n.name)!, w: n.width, h: n.height }))
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j]
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect(overlap, `${nodes[i].name} overlaps ${nodes[j].name}`).toBe(false)
      }
    }
  })
})
