import { describe, expect, it } from "vitest"
import { mockGraphQLFiles } from "@/lib/mockGraphQL"
import { buildModel } from "./model"
import { downChildren, flattenTree, rootItem, upChildren } from "./tree"

const model = () => buildModel(mockGraphQLFiles().map((file) => ({ root: "/r", ...file })))

describe("tree", () => {
  it("goes down into fields, union members, implementations and enum values", () => {
    const m = model()
    expect(downChildren(m, "User").find((item) => item.field === "repositories")).toMatchObject({ relation: "field", next: "RepositoryConnection", label: "RepositoryConnection!", args: 3 })
    expect(downChildren(m, "SearchResult").map((item) => item.key)).toEqual(["member:User", "member:Repository", "member:Issue"])
    expect(downChildren(m, "Actor").filter((item) => item.relation === "implementation").map((item) => item.type)).toEqual(["User", "Organization"])
    expect(downChildren(m, "IssueState").map((item) => [item.field, item.next])).toEqual([["OPEN", null], ["CLOSED", null]])
  })

  it("goes up through fields, arguments, unions and implemented interfaces", () => {
    const m = model()
    expect(upChildren(m, "User").map((item) => item.key)).toEqual(["f:Query.viewer", "f:Query.user", "f:UserEdge.node", "memberOf:SearchResult", "implements:Node", "implements:Actor"])
    // Implementations are below their interface, so they are not its parents.
    expect(upChildren(m, "Actor").map((item) => item.key)).toEqual(["f:Repository.owner", "f:Issue.author"])
    expect(upChildren(m, "RepositoryOrder")).toMatchObject([{ relation: "argument", type: "User", field: "repositories", arg: "orderBy", next: "User" }])
    expect(upChildren(m, "Query")).toEqual([])
  })

  it("roots a field at its type going down and at its owner going up", () => {
    const m = model()
    expect(rootItem(m, { type: "Query", field: "viewer" }, "down")).toMatchObject({ type: "Query", field: "viewer", next: "User" })
    expect(rootItem(m, { type: "Query", field: "viewer" }, "up")).toMatchObject({ type: "Query", field: "viewer", next: "Query" })
    expect(rootItem(m, { type: "SearchResult", field: "Issue" }, "down")).toMatchObject({ relation: "type", type: "Issue", field: null })
    expect(rootItem(m, { type: "Nope", field: null }, "down")).toBeNull()
  })

  it("lists open branches only and stops at a type already above", () => {
    const m = model()
    const root = rootItem(m, { type: "Query", field: "viewer" }, "down")!
    const children = (name: string) => downChildren(m, name)
    expect(flattenTree(root, children, new Set()).map((row) => row.path)).toEqual(["r"])

    const open = new Set(["r", "r/f:organizations", "r/f:organizations/f:members", "r/f:organizations/f:members/f:edges"])
    const rows = flattenTree(root, children, open)
    expect(rows.find((row) => row.path === "r/f:organizations/f:members/f:edges/f:node")).toMatchObject({ recursive: true, expandable: false, level: 4 })
    expect(rows.find((row) => row.path === "r/f:status")).toMatchObject({ expandable: true, expanded: false })
    expect(rows.find((row) => row.path === "r/f:login")).toMatchObject({ expandable: false })

    const paged = flattenTree(root, children, new Set(["r"]), new Map([["r", 3]]))
    expect(paged.at(-1)).toEqual({ kind: "more", path: "r/…", parent: "r", level: 1, hidden: downChildren(m, "User").length - 3 })
  })
})
