import { getBackend } from "@/lib/bridge"
import type { JwtSettings } from "@/lib/contracts"

const api = () => getBackend().api

/** JWT tool view of the backend contract (ADR-0020). */
export const jwtApi = {
  settings: () => api().JWTSettings(),
  save: (settings: JwtSettings) => api().SaveJWTSettings(settings),
  generate: (settings: JwtSettings) => api().GenerateJWT(settings),
  decode: (token: string, settings: JwtSettings) => api().DecodeJWT(token, settings),
}
export type { JwtAlgorithm, JwtDecoded, JwtSettings, JwtToken } from "@/lib/contracts"
