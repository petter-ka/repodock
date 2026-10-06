import { describe, expect, it } from "vitest"
import { maskEnv } from "./envMask"

describe("maskEnv", () => {
  it("masks values but keeps keys, comments, blanks and line endings", () => {
    const input = "# db\r\nexport DB_URL=postgres://u:p@h/db\nEMPTY=\n\nPORT = 3000"
    const masked = maskEnv(input)
    expect(masked).toBe("# db\r\nexport DB_URL=••••••••••••••••\nEMPTY=\n\nPORT = ••••")
    expect(masked).not.toContain("postgres")
  })

  it("leaves non-assignment lines untouched", () => {
    expect(maskEnv("not an assignment")).toBe("not an assignment")
  })
})
