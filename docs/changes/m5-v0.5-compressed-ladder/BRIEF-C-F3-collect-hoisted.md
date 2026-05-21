# Dispatch C — U2 / F3: native-parser `collectHoisted` analogue

**Authority:** DD #27 `scrml-support/docs/deep-dives/m5-m6-scope-revision-2026-05-21.md`
(F3 / Cluster B); SCOPE `docs/changes/m5-v0.5-compressed-ladder/SCOPE.md`.
**Estimate:** 6-10h. **Task shape:** native-parser feature addition.

## Goal

Give the scrml-native parser an equivalent of the live pipeline's `collectHoisted` —
a file-level walk that gathers the six hoisted top-level collections plus the
`hasProgramRoot` boolean, so the native parser produces the same file-level surface the
downstream compiler stages (name-resolver, symbol-table, component-expander,
route-inference, dependency-graph, auth-graph, codegen) consume.

This is **BRIDGE-LIGHT** — a ~60-LOC tree-walk transplanted from the live pipeline and
adapted to the native parser's node-kind catalog. Not novel design.

## The live reference (transplant source)

`compiler/src/ast-builder.js` — `collectHoisted(nodes)` (~line 12132, ~60 LOC). It
returns `{ imports, exports, typeDecls, components, machineDecls, channelDecls }` by
walking the AST: `logic` nodes carry pre-filtered `imports`/`exports`/`typeDecls`/
`components` arrays; `engine-decl` nodes → `machineDecls` (recurse `bodyChildren` for
nested engines); `markup`/`state` nodes recurse `children`; `markup` tag `"channel"` →
`channelDecls`; `meta` node bodies → walk for import/export/type/component-def.

`hasProgramRoot` (live: `ast-builder.js:12296`) — `true` iff any top-level markup node
has tag `"program"`.

Read the live `collectHoisted` + the `hasProgramRoot` computation in full before
starting — they are the behavioral contract.

## Phase 0 — survey the native parser's output shape (MANDATORY)

The native parser's output catalog differs from the live AST. Survey before writing:

- `compiler/native-parser/ast-stmt.js` — the StmtKind catalog. Find the native
  productions for: import declaration, export declaration, type declaration,
  component definition, engine/machine declaration.
- `compiler/native-parser/parse-seam.scrml` / `parse-seam.js` — the markup↔JS seam /
  file-level producer. Determine where a file-level `collectHoisted` analogue should
  attach (the DD names `parse-seam.js` as the seam producer).
- `compiler/native-parser/parse-markup.scrml` / `.js` — how the native parser
  represents markup nodes / tags (for `"program"` + `"channel"` tag detection).
- Determine whether the native parser already exposes a file-level node list / block
  stream + Stmt[] the walker can iterate.

Report the mapping (live kind → native kind) in your final report.

## Implementation

1. Author a `collectHoisted` analogue for the native parser. Per native-parser
   convention each file is a **`.scrml` canonical-shape file + a `.js` running shadow**
   (the "ANOMALY-2 shadow discipline" — see `parse-seam.scrml` header). **Author BOTH**:
   the `.scrml` canonical Pillar-5b shape AND the `.js` shadow that runs. Place it in
   `parse-seam.{scrml,js}` if that is the file-level seam, or a new
   `collect-hoisted.{scrml,js}` pair if Phase 0 shows a cleaner home — match the
   directory's existing file-pairing + naming convention.
2. The walker returns `{ imports, exports, typeDecls, components, machineDecls,
   channelDecls, hasProgramRoot }` — Cluster B: one walk, all outputs (`hasProgramRoot`
   folds into the same pass per the DD).
3. Recurse the native parser's structural nodes the same way the live walker does
   (markup children, engine body children for nested engines, meta bodies). Adapt the
   recursion to the native node shape Phase 0 found.

## Constraints

- **No live-pipeline consumer in v0.5.** This is native-parser code that the M5
  pipeline swap (v0.6) activates. It is correct for it to be exercised only by
  native-parser conformance tests in v0.5 — that is Shape α's intent (v0.5 pre-work for
  v0.6). Do NOT wire it into `compiler/src/` or the live FileAST.
- Do NOT touch `compiler/src/` (Dispatches A and B own that tree).
- Verify via the native-parser conformance harness — add conformance cases that feed
  corpus exemplars through the parser and assert the collected surface matches the live
  pipeline's `collectHoisted` output for the same source. ~20 corpus exemplars per the
  DD. Coupled code+test = one logical unit (same commit).
- Match the native parser's existing `.scrml`/`.js` shadow discipline exactly — both
  files, the `.scrml` carrying the canonical shape.

## Deliverable / report

WORKTREE_PATH · FINAL_SHA · FILES_TOUCHED · the live-kind → native-kind mapping from
Phase 0 · where the walker attached (file:line) · conformance test count + result ·
maps-consulted line.
