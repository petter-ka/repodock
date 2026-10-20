// The folders whose schema files are merged into the map. The chosen paths
// and graph options are a per-device convenience (preferences); scanning
// always goes through the backend.
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { errorMessage } from "@/lib/bridge"
import { displayName, type Repository } from "@/lib/contracts"
import { readJSON, writeJSON } from "@/lib/preferences"
import { graphqlApi, type GraphQLScan } from "./api"

const KEY = "graphqlMap.sources"
const EXCLUDED_KEY = "graphqlMap.excluded"

/** Unchecked files per folder. Stored as exclusions so files added later start checked. */
export type Excluded = Record<string, string[]>

function loadExcluded(): Excluded {
  const stored = readJSON<unknown>(EXCLUDED_KEY, {})
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {}
  return Object.fromEntries(Object.entries(stored).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).filter((p): p is string => typeof p === "string")]))
}

/** Which scanned files are drawn; persisted per folder. */
export function useFileSelection(sources: SourceState[]) {
  const [excluded, setExcluded] = useState<Excluded>(loadExcluded)
  const save = useCallback((update: (current: Excluded) => Excluded) => {
    setExcluded((current) => {
      const next = Object.fromEntries(Object.entries(update(current)).filter(([, paths]) => paths.length > 0))
      writeJSON(EXCLUDED_KEY, next)
      return next
    })
  }, [])
  const allPaths = useCallback((root: string) => sources.find((s) => s.path === root)?.scan?.files.map((f) => f.path) ?? [], [sources])

  const isIncluded = useCallback((root: string, path: string) => !excluded[root]?.includes(path), [excluded])
  /** Checks or unchecks some files of one folder. */
  const setIncluded = useCallback((root: string, paths: string[], included: boolean) => save((current) => {
    const set = new Set(current[root] ?? [])
    for (const path of paths) if (included) set.delete(path); else set.add(path)
    return { ...current, [root]: [...set] }
  }), [save])
  /** Draws only these files (across all folders). */
  const only = useCallback((keep: { root: string; path: string }[]) => save(() => Object.fromEntries(
    sources.map((source) => [source.path, allPaths(source.path).filter((path) => !keep.some((k) => k.root === source.path && k.path === path))]),
  )), [save, sources, allPaths])
  const includeAll = useCallback(() => save(() => ({})), [save])

  return { excluded, isIncluded, setIncluded, only, includeAll }
}

export type SourceState = { path: string; label: string; repoId: string | null; status: "loading" | "ready" | "error"; scan: GraphQLScan | null; error: string }

function basename(path: string) {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path
}

export function useRepositories() {
  const [repositories, setRepositories] = useState<Repository[]>([])
  useEffect(() => {
    let alive = true
    graphqlApi.workspace().then((workspace) => { if (alive) setRepositories(workspace.repositories) }).catch(() => {})
    const off = graphqlApi.onWorkspace((workspace) => setRepositories(workspace.repositories))
    return () => { alive = false; off() }
  }, [])
  return repositories
}

export function useSources(repositories: Repository[]) {
  const [paths, setPaths] = useState<string[]>(() => {
    const stored = readJSON<unknown>(KEY, [])
    return Array.isArray(stored) ? stored.filter((p): p is string => typeof p === "string") : []
  })
  const [scans, setScans] = useState<Record<string, Omit<SourceState, "path" | "label" | "repoId">>>({})
  const generation = useRef<Record<string, number>>({})

  const scan = useCallback((path: string) => {
    const run = (generation.current[path] ?? 0) + 1
    generation.current[path] = run
    setScans((current) => ({ ...current, [path]: { status: "loading", scan: current[path]?.scan ?? null, error: "" } }))
    graphqlApi.scan(path)
      .then((result) => { if (generation.current[path] === run) setScans((current) => ({ ...current, [path]: { status: "ready", scan: result, error: "" } })) })
      .catch((err) => { if (generation.current[path] === run) setScans((current) => ({ ...current, [path]: { status: "error", scan: null, error: errorMessage(err) } })) })
  }, [])

  useEffect(() => {
    writeJSON(KEY, paths)
    for (const path of paths) if (!generation.current[path]) scan(path)
  }, [paths, scan])

  const toggle = useCallback((path: string) => {
    setPaths((current) => (current.includes(path) ? current.filter((p) => p !== path) : [...current, path]))
  }, [])
  const add = useCallback((path: string) => setPaths((current) => (current.includes(path) ? current : [...current, path])), [])
  /** Shows only this folder. */
  const only = useCallback((path: string) => setPaths([path]), [])
  const refresh = useCallback(() => paths.forEach(scan), [paths, scan])

  const sources = useMemo<SourceState[]>(() => paths.map((path) => {
    const repo = repositories.find((r) => r.path === path)
    const state = scans[path] ?? { status: "loading" as const, scan: null, error: "" }
    return { path, label: repo ? displayName(repo) : basename(path), repoId: repo?.id ?? null, ...state }
  }), [paths, scans, repositories])

  return { sources, paths, toggle, add, only, refresh }
}
