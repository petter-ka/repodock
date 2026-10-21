import { describe, expect, it } from "vitest"
import { groupEnvFiles } from "./envFiles"

describe("groupEnvFiles", () => {
  const names = [".env", ".env.local", "apps/web/.env", "apps/web/.env.local", "docker/postgres.env"]

  it("groups by folder, root first, keeping the backend order", () => {
    expect(groupEnvFiles(names)).toEqual([
      { dir: "", files: [{ name: ".env", base: ".env" }, { name: ".env.local", base: ".env.local" }] },
      { dir: "apps/web", files: [{ name: "apps/web/.env", base: ".env" }, { name: "apps/web/.env.local", base: ".env.local" }] },
      { dir: "docker", files: [{ name: "docker/postgres.env", base: "postgres.env" }] },
    ])
  })

  it("filters on the whole path", () => {
    expect(groupEnvFiles(names, "WEB").map((f) => f.files.map((x) => x.name))).toEqual([["apps/web/.env", "apps/web/.env.local"]])
    expect(groupEnvFiles(names, "local").flatMap((f) => f.files.map((x) => x.name))).toEqual([".env.local", "apps/web/.env.local"])
  })
})
