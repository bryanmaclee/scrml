# Dispatch B — U3+U4 / F5+F6: relocate PGO flags + program config to downstream passes

**Authority:** DD #27 `scrml-support/docs/deep-dives/m5-m6-scope-revision-2026-05-21.md`
(F5 / F6 / Cluster C; Pivot 2 ratified S115 — option a); SCOPE
`docs/changes/m5-v0.5-compressed-ladder/SCOPE.md`.
**Estimate:** 6-9h. **Task shape:** compiler-source refactor (relocate computation).

Bundled because F5 and F6 both edit `ast-builder.js` (removing TAB-time computations) —
one dispatch avoids the shared-file merge.

## Goal

Move two classes of TAB-time-cached derivations OUT of `ast-builder.js` into **downstream
pre-codegen passes** that run against EITHER pipeline (live Acorn pipeline now; native
parser at v0.6). This makes the M5 pipeline-swap seam clean — the native parser does not
have to learn codegen-optimizer caches or program-config extraction.

## U3 / F5 — PGO has* flags

**The 4 flags to relocate:** `hasResetExpr`, `hasEqualityExpr`, `hasChunkedMarkupTag`,
`hasForStmt`. **`hasProgramRoot` is NOT moved** — it is consumed inside `ast-builder.js`
itself (`!hasProgramRoot` drives `isPureModuleFile` / `isNonEntryPageFile` logic ~12823-
12845) and its native-parser analogue is Dispatch C's `collectHoisted` concern. Leave
`hasProgramRoot` exactly where it is.

**Current producers in `ast-builder.js`** (verify line numbers in Phase 0):
- `detectResetExprPresence(nodes)` → `hasResetExpr` (~12769)
- `detectEqualityExprPresence(nodes)` → `hasEqualityExpr` (~12775)
- `detectMarkupForStmtChunkPresence(nodes)` → `{ hasChunkedMarkupTag, hasForStmt }` (~12085 / called ~12785)
- all 4 set on the FileAST object at ~12798-12801

**Relocation:**
1. New module `compiler/src/codegen/compute-pgo-flags.ts` (or `compiler/src/compute-pgo-flags.ts` —
   match the convention Phase 0 finds for sibling pre-codegen passes) exporting
   `computePGOFlags(nodes): { hasResetExpr, hasEqualityExpr, hasChunkedMarkupTag, hasForStmt }`.
   Transplant the three detector functions verbatim — same logic, same early-exit
   optimizations.
2. Invoke `computePGOFlags` at a **pipeline-agnostic post-AST / pre-codegen seam** —
   Phase 0 identifies it (likely `api.js` between AST build and Stage-8 codegen, or the
   entry of `codegen/index.ts`). The pass **mutates the fileAST object** with the 4
   flags so existing consumers (`emit-client.ts`, `codegen/index.ts`, `auth-graph.ts`)
   read the same `fileAST.has*` field names — **zero consumer changes**.
3. Remove the 3 detector calls + the 4 field assignments from `ast-builder.js`'s FileAST
   assembly. The detector function bodies move to the new module.
4. The `=== undefined` fall-through guards in consumers STAY (defense-in-depth — and they
   are what runs for any caller that bypasses the canonical path).

## U4 / F6 — `authConfig` / `middlewareConfig`

**Current producer in `ast-builder.js`:** extraction logic ~12304-12403 (authConfig from
`<program auth=>` + `csrf=`; middlewareConfig from `<program middleware=>`); set on the
FileAST at ~12802-12803.

**Relocation:**
1. New module `compiler/src/codegen/compute-program-config.ts` (match Phase 0 convention)
   exporting `computeProgramConfig(nodes): { authConfig, middlewareConfig }`. Transplant
   the extraction logic verbatim.
2. Invoke it at the **same pre-codegen seam** as `computePGOFlags` — fold both into one
   pre-codegen pass invocation site if the seam is shared. Mutates fileAST with
   `authConfig` + `middlewareConfig` — consumers (`auth-graph.ts`,
   `codegen/context.ts`, `codegen/index.ts`) read the same field names unchanged.
3. Remove the extraction block + the 2 field assignments from `ast-builder.js`.

## Constraints

- **Behavior unchanged.** This is a relocation — same logic, same field names on
  fileAST, same consumers. Zero test regressions (pre-commit subset green; report
  full-suite delta).
- Do NOT touch `compiler/native-parser/` (Dispatch C) or the `estreeType` field
  (Dispatch A).
- The two new pass functions must be **pure** (`nodes` in → derived object out) so the
  native parser at v0.6 can feed them its own node stream with no further change.
- If `ast-builder.js` line numbers have drifted, follow the grep — the function NAMES
  (`detectResetExprPresence` / `detectEqualityExprPresence` /
  `detectMarkupForStmtChunkPresence`) are stable anchors.
- Coupled code+test = one logical unit — update any tests asserting on TAB-time flag
  computation in the same commit as the relocation.

## Deliverable / report

WORKTREE_PATH · FINAL_SHA · FILES_TOUCHED · the pre-codegen seam chosen (file:line) ·
confirmation consumers are unchanged · test delta (subset + full suite) · maps-consulted
line.
