// Groups discovered env file paths ("apps/web/.env.local") by folder for the
// Environment drawer. The backend already sorts them: root first, then
// folders in path order, well-known names first within a folder.

export type EnvFolder = { dir: string; files: Array<{ name: string; base: string }> }

export function groupEnvFiles(names: string[], query = ""): EnvFolder[] {
  const needle = query.trim().toLowerCase()
  const folders: EnvFolder[] = []
  for (const name of names) {
    if (needle && !name.toLowerCase().includes(needle)) continue
    const slash = name.lastIndexOf("/")
    const dir = slash < 0 ? "" : name.slice(0, slash)
    const base = name.slice(slash + 1)
    let folder = folders.find((f) => f.dir === dir)
    if (!folder) folders.push((folder = { dir, files: [] }))
    folder.files.push({ name, base })
  }
  return folders
}
