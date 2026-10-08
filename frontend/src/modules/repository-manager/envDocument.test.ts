import { describe, expect, it } from "vitest"
import { addEnvEntry, diffEnv, envTimestamp, keepPreviousAsComments, parseEnv, removeEnvLine, renameEnvKey, setEnvValue } from "./envDocument"

const sample = "# db\r\nexport DB_URL=\"postgres://u:p@h/db\"\r\nPORT = 3000 # dev only\r\n\r\nNAME='app'\r\n"

describe("parseEnv", () => {
  it("parses assignments with quotes, export and inline comments", () => {
    expect(parseEnv(sample)).toEqual([
      { line: 1, key: "DB_URL", value: "postgres://u:p@h/db", quote: "\"" },
      { line: 2, key: "PORT", value: "3000", quote: "" },
      { line: 4, key: "NAME", value: "app", quote: "'" },
    ])
  })
})

describe("editing", () => {
  it("rewrites only the edited line and keeps layout, comments and CRLF", () => {
    expect(setEnvValue(sample, 2, "4000")).toBe(sample.replace("PORT = 3000 #", "PORT = 4000 #"))
    expect(setEnvValue(sample, 1, "x")).toBe(sample.replace("\"postgres://u:p@h/db\"", "\"x\""))
    expect(renameEnvKey(sample, 4, "APP_NAME")).toBe(sample.replace("NAME=", "APP_NAME="))
  })

  it("quotes values that would not survive unquoted", () => {
    expect(setEnvValue("A=1\n", 0, "has # hash")).toBe("A=\"has # hash\"\n")
    expect(setEnvValue("A='1'\n", 0, "it's")).toBe("A=\"it's\"\n")
    expect(setEnvValue("A=\"1\"\n", 0, "say \"hi\"")).toBe("A=\"say \\\"hi\\\"\"\n")
    expect(parseEnv(setEnvValue("A=\"1\"\n", 0, "say \"hi\""))[0].value).toBe("say \"hi\"")
  })

  it("rejects invalid keys", () => {
    expect(renameEnvKey("A=1\n", 0, "1BAD")).toBe("A=1\n")
  })

  it("adds and removes lines", () => {
    expect(addEnvEntry("", "A", "1")).toBe("A=1\n")
    expect(addEnvEntry("A=1", "B", "2")).toBe("A=1\nB=2")
    expect(addEnvEntry(sample, "B", "2")).toBe(`${sample}B=2\r\n`)
    expect(removeEnvLine(sample, 2)).toBe("# db\r\nexport DB_URL=\"postgres://u:p@h/db\"\r\n\r\nNAME='app'\r\n")
    expect(removeEnvLine("A=1\nB=2", 1)).toBe("A=1")
  })
})

describe("diffEnv", () => {
  it("reports added, changed and removed keys", () => {
    expect(diffEnv("A=1\nB=2\nC=3\n", "A=1\nB=20\nD=4\n# comment\n")).toEqual([
      { kind: "changed", key: "B", before: "2", value: "20" },
      { kind: "added", key: "D", value: "4" },
      { kind: "removed", key: "C", before: "3" },
    ])
  })

  it("ignores comment and formatting-only edits", () => {
    expect(diffEnv("A=1\n", "# note\nA=1\n")).toEqual([])
  })
})

describe("keepPreviousAsComments", () => {
  const note = "# RepoDock: previous value, replaced 2026-10-08 10:20"

  it("comments out the old line above each changed value and appends removed ones", () => {
    const saved = "# db\nexport DB_URL=\"old\"\nPORT=3000\nGONE=1\n"
    const draft = "# db\nexport DB_URL=\"new\"\nPORT=3000\nNEW=2\n"
    expect(keepPreviousAsComments(saved, draft, "2026-10-08 10:20")).toBe(
      `# db\n${note}\n# export DB_URL="old"\nexport DB_URL="new"\nPORT=3000\nNEW=2\n${note}\n# GONE=1\n`,
    )
  })

  it("keeps CRLF and files without a trailing newline", () => {
    expect(keepPreviousAsComments("A=1\r\nB=2", "A=9", "2026-10-08 10:20")).toBe(`${note}\r\n# A=1\r\nA=9\r\n${note}\r\n# B=2`)
  })

  it("leaves the draft alone when nothing existing changed", () => {
    expect(keepPreviousAsComments("A=1\n", "A=1\nB=2\n", "x")).toBe("A=1\nB=2\n")
  })

  it("formats a local timestamp", () => {
    expect(envTimestamp(new Date(2026, 9, 8, 9, 5))).toBe("2026-10-08 09:05")
  })
})
