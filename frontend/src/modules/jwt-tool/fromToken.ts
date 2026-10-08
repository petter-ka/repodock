import type { JwtSettings } from "./api"
import { addRole } from "./roles"

/** Claims the Encode form has a field for; everything else becomes extra claims. */
const known = new Set(["id", "userId", "userName", "name", "email", "deviceId", "realm", "resource_access", "channel", "iss", "sub", "iat", "exp"])

const text = (value: unknown) => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "")

/**
 * Encode-form values taken from a decoded token, so it can be re-issued or
 * tweaked. Keys are left alone; the token's roles are added to the
 * catalogue and become the selection.
 */
export function settingsFromToken(settings: JwtSettings, payloadJson: string, algorithm: string): Partial<JwtSettings> {
  let payload: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(payloadJson)
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {}
    payload = parsed as Record<string, unknown>
  } catch {
    return {}
  }

  const access = payload.resource_access as { roles?: unknown } | undefined
  const tokenRoles = Array.isArray(access?.roles) ? access.roles.filter((r): r is string => typeof r === "string") : []
  let roles = { roles: settings.roles, selectedRoles: [] as string[] }
  for (const role of tokenRoles) roles = addRole(roles, role)

  const extra = Object.fromEntries(Object.entries(payload).filter(([key]) => !known.has(key)))
  const patch: Partial<JwtSettings> = {
    id: text(payload.id),
    email: text(payload.userName) || text(payload.userId) || text(payload.name) || text(payload.email),
    deviceId: text(payload.deviceId),
    realm: text(payload.realm),
    channel: text(payload.channel),
    issuer: text(payload.iss),
    subject: text(payload.sub),
    roles: roles.roles,
    selectedRoles: roles.selectedRoles,
    extraClaims: Object.keys(extra).length ? JSON.stringify(extra, null, 2) : "",
  }
  if (typeof payload.exp === "number" && typeof payload.iat === "number" && payload.exp > payload.iat) {
    patch.expiresInDays = Math.round(((payload.exp - payload.iat) / 86400) * 10000) / 10000
  }
  if (algorithm === "RS256" || algorithm === "HS256") patch.algorithm = algorithm
  return patch
}
