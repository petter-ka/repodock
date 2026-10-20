#!/usr/bin/env node
// Generates the RepoDock logo: a minimal isometric "R" made of flat polygons.
//
//   node scripts/generate-logo.mjs      (or: make logo; --svg-only skips PNG/ICO)
//
// Writes
//   build/appicon.svg             1024×1024 app icon (Apple template: 824 tile, 100 margin)
//   frontend/src/assets/logo.svg  compact mark (tile + R) for the app rail and favicon
// and, when Chrome is available (set CHROME to its path if it is not found),
//   build/appicon.png             what Wails turns into the macOS .icns
//   build/windows/icon.ico        16–256 px
//
// No dependencies. The R is a straight-edged polygon on a grid (stroke 2,
// height 9), extruded in isometric projection. Every visible face is framed:
// a neon green border band runs around it in the face's own plane, and the
// face's panel sits slightly recessed inside, so the borders have depth.
// Faces turned away from the viewer are dropped and the rest are drawn back
// to front, flat-shaded by one light. The app icon adds a faint glow.
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

// Colours by brightness (0 = facing away from the light, 1 = facing it): the
// blue panels, and the neon green border material that frames every face.
const PANEL = [[0, "#13296f"], [0.35, "#1f40b0"], [0.62, "#3d7bfd"], [0.85, "#a5c8ff"], [1, "#cfe2ff"]]
const BORDER = [[0, "#0d6e0a"], [0.35, "#1fbf12"], [0.62, "#39ff14"], [0.85, "#9dff7a"], [1, "#e2ffd6"]] // neon green
const TILE = { colours: ["#1a1f55", "#0c0f2e"], glow: "#3b82f6" }
const LIGHT = [0.55, -0.25, 0.8] // from the front, slightly right, above

// ---- Vectors, colours, SVG
const add = (a, b) => a.map((x, i) => x + b[i])
const sub = (a, b) => a.map((x, i) => x - b[i])
const mul = (a, k) => a.map((x) => x * k)
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0)
const unit = (a) => mul(a, 1 / Math.hypot(...a))
const n1 = (v) => +v.toFixed(1)
const path = (pts) => "M" + pts.map((p) => p.map(n1).join(",")).join("L") + "Z"
const hex = (c) => "#" + c.map((x) => Math.round(x).toString(16).padStart(2, "0")).join("")
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const mix = (a, b, t) => hex(rgb(a).map((x, i) => x + (rgb(b)[i] - x) * t))
/** Flat shading: the colour of a surface with this normal, from a brightness ramp. */
function shade(ramp, normal, dim = 0) {
  const s = Math.max(0, 0.2 + 0.8 * Math.max(0, dot(unit(normal), unit(LIGHT))) - dim)
  for (let i = 1; i < ramp.length; i++) if (s <= ramp[i][0]) return mix(ramp[i - 1][1], ramp[i][1], (s - ramp[i - 1][0]) / (ramp[i][0] - ramp[i - 1][0]))
  return ramp.at(-1)[1]
}

// ---- Isometric projection: x runs down-right, y down-left, z up.
const C = Math.cos(Math.PI / 6)
const proj = ([x, y, z]) => [(x - y) * C, (x + y) / 2 - z]
const VIEW = [1, 1, 1] // towards the viewer

// ---- The R on a grid (u right, v up; stroke 2, height 9). Rings keep the
// solid on their left: the outline counter-clockwise, the counter clockwise.
const GRID = 52
const OUTLINE = [
  [0, 0], [2, 0], [2, 3.5], [2.5, 3.5], [4.25, 0], [6.5, 0], [4.75, 3.5], // stem, notch, leg
  [6, 4.75], [6, 7.5], [4.5, 9], [0, 9], // bowl with 45° chamfers
]
const COUNTER = [[2, 5.5], [2, 7], [4, 7], [4, 5.5]]
const RINGS = [OUTLINE, COUNTER].map((ring) => ring.map((p) => mul(p, GRID)))
const DEPTH = 2 * GRID

// The letter stands on the right-facing plane (x = 0), reading up-right, extruded back along -x.
const EU = [0, -1, 0], EV = [0, 0, 1], EB = [-1, 0, 0]
const toWorld = ([u, v], w = 0) => add(add(mul(EU, u), mul(EV, v)), mul(EB, w))

const depthOf = (pts) => dot(mul(pts.reduce(add, [0, 0, 0]), 1 / pts.length), VIEW)
const byDepth = (p, q) => p.depth - q.depth // painter's algorithm: farthest first
const shape = (rings) => rings.map((ring) => path(ring.map(proj))).join("")

/**
 * One framed face: a border band of width `band` around its outline, lying
 * in the face's plane, and the panel inside it sunk `recess` into the solid,
 * so the band's inner walls show. `edges` are the panel opening's edges with
 * their outward (in-plane) normals. Drawn panel → visible inner walls → band.
 */
function framedFace({ outline, opening, edges, normal, panelFill }) {
  const sink = mul(normal, -RECESS)
  const walls = edges.flatMap(([p, q, out]) => {
    const inward = mul(out, -1)
    if (dot(inward, VIEW) <= 1e-6) return [] // faces away from the viewer
    const quad = [p, q, add(q, sink), add(p, sink)]
    return [{ d: path(quad.map(proj)), fill: shade(PANEL, inward, 0.12), depth: depthOf(quad) }]
  }).sort(byDepth)
  const seam = (fill) => `fill="${fill}" stroke="${fill}" stroke-width="0.8" stroke-linejoin="round"`
  const band = shade(BORDER, normal)
  return (opening.length ? `<path d="${shape(opening.map((ring) => ring.map((p) => add(p, sink))))}" fill-rule="evenodd" ${seam(panelFill ?? shade(PANEL, normal))}/>` : "") +
    walls.map((w) => `<path d="${w.d}" ${seam(w.fill)}/>`).join("") +
    `<path d="${shape([...outline, ...opening])}" fill-rule="evenodd" ${seam(band)}/>`
}

let RECESS = 6
/**
 * The R as a solid whose every face is framed: each visible wall and the
 * front face carry a light border band, with the face's panel recessed
 * inside it. Faces are drawn back to front; each face is self-contained.
 */
function letter({ band, recess }) {
  RECESS = recess
  const faces = []
  for (const ring of RINGS) {
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length]
      const [du, dv] = unit(sub(b, a))
      const normal = add(mul(EU, dv), mul(EV, -du))
      if (dot(normal, VIEW) <= 1e-6) return // faces away from the viewer (or is seen edge-on)
      const a0 = toWorld(a), b0 = toWorld(b), b1 = toWorld(b, DEPTH), a1 = toWorld(a, DEPTH)
      const length = Math.hypot(...sub(b, a))
      const es = unit(sub(b0, a0)), et = unit(sub(a1, a0))
      const at = (s, t) => add(add(a0, mul(es, s)), mul(et, t))
      const inset = length > 2 * band ? [at(band, band), at(length - band, band), at(length - band, DEPTH - band), at(band, DEPTH - band)] : null
      faces.push({
        depth: depthOf([a0, b0, b1, a1]),
        svg: framedFace({
          outline: [[a0, b0, b1, a1]],
          opening: inset ? [inset] : [],
          edges: inset ? [[inset[0], inset[1], mul(et, -1)], [inset[1], inset[2], es], [inset[2], inset[3], et], [inset[3], inset[0], mul(es, -1)]] : [],
          normal,
        }),
      })
    })
  }
  faces.sort(byDepth)

  // The front face: the glyph outline framed, its panel recessed.
  const frontNormal = mul(EB, -1)
  const opening = RINGS.map((ring) => offsetRing(ring, -band))
  const edges = opening.flatMap((ring) => ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length]
    const [du, dv] = unit(sub(b, a))
    return [toWorld(a), toWorld(b), add(mul(EU, dv), mul(EV, -du))]
  }))
  const front = framedFace({
    outline: RINGS.map((ring) => ring.map((p) => toWorld(p))),
    opening: opening.map((ring) => ring.map((p) => toWorld(p))),
    edges, normal: frontNormal, panelFill: "url(#face)",
  })

  const pts = RINGS.flatMap((ring) => ring.flatMap((p) => [toWorld(p), toWorld(p, DEPTH)])).map(proj)
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
  const faceColour = shade(PANEL, frontNormal)
  return {
    defs: `<linearGradient id="face" gradientUnits="userSpaceOnUse" x1="0" y1="${n1(Math.min(...ys))}" x2="0" y2="${n1(Math.max(...ys))}"><stop offset="0" stop-color="${mix(faceColour, "#ffffff", 0.12)}"/><stop offset="1" stop-color="${mix(faceColour, "#000000", 0.12)}"/></linearGradient>`,
    body: faces.map((face) => face.svg).join("") + front,
    bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  }
}

/** Moves every edge of a ring outwards by `delta` (inwards when negative), keeping edges parallel. */
function offsetRing(ring, delta) {
  return ring.map((p, i) => {
    const e1 = unit(sub(p, ring[(i + ring.length - 1) % ring.length])), e2 = unit(sub(ring[(i + 1) % ring.length], p))
    const n1 = [e1[1], -e1[0]], n2 = [e2[1], -e2[0]]
    return add(p, mul(add(n1, n2), delta / (1 + dot(n1, n2))))
  })
}

function fit([x0, y0, x1, y1], box, cx, cy) {
  const s = Math.min(box / (x1 - x0), box / (y1 - y0))
  return `translate(${n1(cx - ((x0 + x1) / 2) * s)} ${n1(cy - ((y0 + y1) / 2) * s)}) scale(${+s.toFixed(5)})`
}

const TILE_DEFS = `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${TILE.colours[0]}"/><stop offset="1" stop-color="${TILE.colours[1]}"/></linearGradient>
  <radialGradient id="glow" cx="0.5" cy="0.45" r="0.5"><stop offset="0" stop-color="${TILE.glow}" stop-opacity="0.35"/><stop offset="1" stop-color="${TILE.glow}" stop-opacity="0"/></radialGradient>`

// ---- The app icon. `tile` crops to the tile (no margin or tile shadow), for .ico sizes.
function appIcon({ tile = false } = {}) {
  const R = letter({ band: 13, recess: 7 })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="${tile ? "100 100 824 824" : "0 0 1024 1024"}">
<defs>
  ${TILE_DEFS}
  <filter id="tileShadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000" flood-opacity="0.28"/></filter>
  <filter id="edgeGlow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="9"/></filter>
  ${R.defs}
</defs>
<g${tile ? "" : ` filter="url(#tileShadow)"`}><rect x="100" y="100" width="824" height="824" rx="186" fill="url(#bg)"/></g>
<rect x="100" y="100" width="824" height="824" rx="186" fill="url(#glow)"/>
<g transform="${fit(R.bounds, 580, 512, 512)}" filter="url(#edgeGlow)" opacity="0.45">${R.body}</g>
<g transform="${fit(R.bounds, 580, 512, 512)}">${R.body}</g>
</svg>
`
}

// ---- The compact mark: full-bleed tile and the letter.
function mark() {
  const R = letter({ band: 20, recess: 8 })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
<defs>${TILE_DEFS}${R.defs}</defs>
<rect width="64" height="64" rx="14" fill="url(#bg)"/>
<rect width="64" height="64" rx="14" fill="url(#glow)"/>
<rect x="0.5" y="0.5" width="63" height="63" rx="13.5" fill="none" stroke="#ffffff" stroke-opacity="0.14"/>
<g transform="${fit(R.bounds, 46, 32, 32)}">${R.body}</g>
</svg>
`
}

// ---- PNG / ICO output (optional, needs Chrome).
function findChrome() {
  const candidates = [
    process.env.CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean)
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  for (const name of ["google-chrome", "chromium", "chromium-browser"]) {
    if (spawnSync(name, ["--version"]).status === 0) return name
  }
  return null
}

function render(chrome, svg, size, dir) {
  const input = join(dir, `in-${size}.svg`), output = join(dir, `out-${size}.png`)
  writeFileSync(input, svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`))
  spawnSync(chrome, ["--headless", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000", `--window-size=${size},${size}`, `--screenshot=${output}`, pathToFileURL(input).href], { stdio: "ignore" })
  if (!existsSync(output)) throw new Error(`Chrome did not render ${size}px`)
  return readFileSync(output)
}

/** An .ico whose entries are PNGs (supported since Windows Vista). */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i
    header.writeUInt8(size >= 256 ? 0 : size, at)
    header.writeUInt8(size >= 256 ? 0 : size, at + 1)
    header.writeUInt16LE(1, at + 4)
    header.writeUInt16LE(32, at + 6)
    header.writeUInt32LE(png.length, at + 8)
    header.writeUInt32LE(offset, at + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...images.map((image) => image.png)])
}

const icon = appIcon()
writeFileSync(join(root, "build/appicon.svg"), icon)
writeFileSync(join(root, "frontend/src/assets/logo.svg"), mark())
console.log("wrote build/appicon.svg, frontend/src/assets/logo.svg")

if (process.argv.includes("--svg-only")) process.exit(0)
const chrome = findChrome()
if (!chrome) {
  console.log("Chrome not found (set CHROME=/path/to/chrome): skipped build/appicon.png and build/windows/icon.ico")
} else {
  const dir = mkdtempSync(join(tmpdir(), "repodock-logo-"))
  try {
    writeFileSync(join(root, "build/appicon.png"), render(chrome, icon, 1024, dir))
    const small = mark(), large = appIcon({ tile: true })
    const images = [16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: render(chrome, size <= 48 ? small : large, size, dir) }))
    writeFileSync(join(root, "build/windows/icon.ico"), ico(images))
    console.log("wrote build/appicon.png, build/windows/icon.ico")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
