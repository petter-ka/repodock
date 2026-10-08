import { KeyRound } from "lucide-react"
import type { MiniApp } from "@/lib/module"
import { JwtTool } from "./JwtTool"

/** "JWT tool" mini app: generate test tokens with chosen roles, and decode/verify tokens. */
export const jwtToolApp: MiniApp = {
  id: "jwt-tool",
  icon: KeyRound,
  label: (t) => t.jwt.title,
  View: JwtTool,
  width: 560,
}
