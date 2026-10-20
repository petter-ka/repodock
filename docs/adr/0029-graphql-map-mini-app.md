# ADR-0029: "GraphQL map" mini app

- Status: Accepted
- Date: 2026-10-19

## Context

Our repositories keep their GraphQL schema as SDL split over many `.graphql` files, often with `extend type` across files. To understand a schema we used [graphql-voyager](https://github.com/graphql-kit/graphql-voyager) (MIT), which needs a single introspection result or a valid stitched schema, a browser, and has no notion of local folders. We want the same "schema as an explorable graph" inside RepoDock, pointed at a repository or folder, as a mini app (ADR-0018).

## Decision

- **Backend** `internal/modules/graphqlscan` (standard library only) only *finds and reads* files: `Scan(root)` walks an absolute folder for `.graphql`, `.graphqls`, `.gql` (case-insensitive), skipping hidden folders and `node_modules`, `dist`, `build`, `out`, `coverage`, `vendor`, `target`, … Limits: 2,000 files, 4 MB per file (larger ones are counted as skipped), 48 MB in total (the scan stops and reports `truncated`). Facade bindings: `ScanGraphQLFiles(folder)`, `BrowseGraphQLFolder()` (native picker).
- **Parsing and merging happen in the frontend** (`modules/graphql-map/model.ts`, using `graphql`'s `parse` only, not `buildSchema`), because the result is presentation data and must tolerate imperfect input:
  - every file is parsed on its own; a syntax error is reported per file (line:column) and the other files still load;
  - definitions and extensions are merged by name across files and folders; duplicate fields/values are ignored (a different type for the same field is a warning); a kind clash keeps the first definition;
  - root types come from `schema { … }` or the conventional `Query`/`Mutation`/`Subscription`; built-in scalars are added; undefined referenced names become "missing" placeholders instead of failing.
- **Graph rules** (`graph.ts`) follow Voyager: start at the chosen root (or all types) and follow field types, union members and interface implementations; optionally collapse Relay connections (`XConnection { edges { node, cursor }, pageInfo }` → `[X]`, hiding Connection/Edge/PageInfo/`Node`); options for leaf (scalar/enum) fields, deprecated fields, A–Z sorting and hiding the root. Additions: input types drawn from field arguments (dashed), and **focus mode** — only the selected type and its neighbours within 1–3 hops, following the selection.
- **Rendering** is built for enterprise-size schemas (measured on GitHub's public schema, 816 types / 2,500 edges on screen: first draw 6.8 s → 1.2 s, zoom frame 400 ms → 40 ms, select 560 ms → 70 ms, DOM 31k → 6k elements):
  - React Flow (`@xyflow/react`) renders only the nodes inside the viewport (`onlyRenderVisibleElements`).
  - Edges are not React Flow edges: `EdgeLayer` draws them on one `<canvas>` under the nodes, in screen space, skipping edges outside the visible area. Endpoints come from node positions and the fixed row metrics (`graph.ts` stores each edge's row offset), so nodes have no handles.
  - **Level of detail**: below zoom 0.45 a node drops its field rows and shows only its name, scaled up as the map zooms out (`--gql-zoom`) so the overview stays legible.
  - Selection lives in a small external store; a node subscribes to its own state only, and dimming unrelated nodes is one CSS rule on the canvas, so a click re-renders only the selected and related nodes. Graph options (not the panel/minimap toggles) rebuild the graph.
  - Layout: dagre (`@dagrejs/dagre`, left to right) up to 80 types synchronously and up to 250 in a Web Worker (a newer request cancels a running one); above 250 a linear-time layered layout (`fastLayout`: BFS ranks from the root, ordered by parent position, crowded ranks wrapped into columns), because dagre needs seconds to minutes there. The last 8 layouts are cached by graph shape, and parsed files are cached by content.
  - The first view fits the graph when that stays readable, otherwise it anchors on the focused type or the root. The module is lazy-loaded, so the graph libraries do not grow the main bundle. The type browser renders only expanded groups.
- **Types do not move**: nodes are not draggable, and pressing on a type never pans the map (`nopan`), so a click always selects a type or field and the layout never changes by accident. The map pans by dragging empty canvas and zooms with the wheel anywhere (also over types).
- **File selection**: every scanned file has a checkbox (Files tab: filter, All/None for the filtered list, per-folder tri-state, "Only" per file; "Show only this file" in a type's "Defined in"; a toolbar button shows "checked / total" and opens the tab). Only checked files are merged and drawn. Unchecked files are still scanned for type names, so a reference into them shows as an *external* type (listed under "In unchecked files", not drawn, with "Check that file") instead of a missing one. Unchecked files are remembered per folder as exclusions, so files added later start checked.
- **UX**: sources menu (registered repositories as checkboxes plus other folders; several folders merge into one schema), root switcher, Focus (F), display options, refresh; a docs panel with search over types and fields (⌘/Ctrl+F or `/`, arrows, Enter), type details (description, fields with arguments and defaults, enum values, members, implementations, "referenced by", defining files with line numbers, copyable SDL), Back history, and a Files tab with per-file parse errors. Selecting a type or field highlights its edges and dims the rest; Esc clears the selection, then closes the tree, before closing the window.
- **Tree view** (`tree.ts`, `TreePanel.tsx`): the selected type or field opens as a tree in a panel left of the map, from a button on the selected card's header and selected row, the docs panel header, the toolbar or T. Two directions: *Fields* goes down (fields, union members, implementations, enum values, level by level) and *Used by* goes up (fields and arguments of that type, unions containing it, interfaces it implements, until the root types). Children come from the model, not the drawn graph, so the tree reaches types the map hides (Relay connections, unchecked options), and they are computed only when a branch opens; a type already above in its branch is a leaf marked as recursive, so cycles stay finite. Branches show 100 children at a time. Clicking a row selects it on the map and in the docs; double-click or Shift+Enter makes it the root (Back returns); arrow keys move and fold, as in a tree view. Kind colours use the app's categorical `--series-*` palette.
- The chosen folders, unchecked files and display options are per-device preferences (`graphqlMap.*` in local storage), like window positions; no schema content is persisted.
- **Mini app windows can be resizable** (amends ADR-0018): `MiniApp` gains optional `height` and `resizable`. A resizable `FloatingWindow` resizes from its corner or with Alt+⌘/Ctrl+arrows, maximizes from a title-bar button or a double-click, and its size and maximized state persist with its position. A mini app can also set `openMaximized`: opening it from the rail always starts it maximized (the GraphQL map does, since a graph needs the room); restoring gives its normal window for that session.

## Consequences

- Any folder the user can read can be scanned; only schema files are read, within the limits above.
- The model is not a validated schema: invalid SDL that parses (e.g. an unknown type) is shown with markers rather than rejected. That is intended for exploration; it is not a schema linter.
- New dependencies: `@xyflow/react`, `@dagrejs/dagre`, `graphql` (all MIT).

## Reconsider when

- Schemas also need to come from a running endpoint (introspection) or from SDL embedded in code (`gql` tags).
- Jumping from a type to its file in the editor is wanted (the facade could open `path:line` in VS Code).
- The fast layout of very large graphs is not tidy enough (ELK in a worker, or incremental layout of the focus neighbourhood only).
