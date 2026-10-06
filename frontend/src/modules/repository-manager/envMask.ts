const assignment = /^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_.-]*\s*=\s*)(.*)$/

/**
 * Masks dotenv values for display while keeping keys, comments and layout
 * readable. The returned text is display-only and never written back.
 */
export function maskEnv(content: string) {
  return content
    .split(/(\r?\n)/)
    .map((part) => {
      const match = assignment.exec(part)
      if (!match || part.trimStart().startsWith("#")) return part
      const value = match[2]
      return value.length ? match[1] + "•".repeat(Math.min(Math.max(value.length, 4), 16)) : part
    })
    .join("")
}
