import { describe, expect, it } from "vitest"
import type { JwtSettings } from "./api"
import { settingsFromToken } from "./fromToken"

const settings = {
  algorithm: "HS256", id: "old", email: "old@example.com", expiresInDays: 1, issuer: "x", subject: "x", realm: "x", channel: "x", deviceId: "x",
  roles: ["admin", "viewer"], selectedRoles: ["viewer"], extraClaims: "{\"old\":1}", privateKey: "pk", publicKey: "pub", secret: "s",
} satisfies JwtSettings

describe("settingsFromToken", () => {
  it("fills the form from the payload, adding and selecting the token's roles", () => {
    const payload = {
      id: 42, userId: "dev@example.com", userName: "dev@example.com", name: "dev@example.com", deviceId: "ua", realm: "realm-x",
      resource_access: { roles: ["ops", "admin"] }, channel: "channel-x", iat: 1000, exp: 1000 + 7 * 86400, iss: "issuer-x", sub: "subject-x", tenant: "t1",
    }
    expect(settingsFromToken(settings, JSON.stringify(payload), "RS256")).toEqual({
      id: "42", email: "dev@example.com", deviceId: "ua", realm: "realm-x", channel: "channel-x", issuer: "issuer-x", subject: "subject-x",
      roles: ["admin", "viewer", "ops"], selectedRoles: ["admin", "ops"], extraClaims: "{\n  \"tenant\": \"t1\"\n}",
      expiresInDays: 7, algorithm: "RS256",
    })
  })

  it("clears fields the token does not have and keeps expiry/algorithm when unknown", () => {
    const patch = settingsFromToken(settings, "{\"sub\":\"me\"}", "none")
    expect(patch).toMatchObject({ id: "", email: "", subject: "me", selectedRoles: [], extraClaims: "" })
    expect(patch).not.toHaveProperty("expiresInDays")
    expect(patch).not.toHaveProperty("algorithm")
    expect(patch).not.toHaveProperty("privateKey")
  })

  it("ignores payloads that are not objects", () => {
    expect(settingsFromToken(settings, "[1]", "RS256")).toEqual({})
  })
})
