# M5/M6 compressed MD ladder — v0.5 first cut SCOPE

**Status:** scope-locked S115 (2026-05-21). Authority: DD #27
`scrml-support/docs/deep-dives/m5-m6-scope-revision-2026-05-21.md` — all 4 pivots
ratified S115 (compressed MD ladder; Shape α; F5 downstream-pass option a; F7 20-30h
accepted).

**This doc:** decomposes the **v0.5 first cut** of Shape α into dispatchable units.
v0.6 (F1 attrs + F7 state/sql/css + F8 catalog-rename + real M5 swap + M6 deletion) is
NOT scoped here.

---

## Pre-dispatch verification (S115 — Rule-4 check against current source)

DD #27 is a derived doc. Its three retire-class claims were grep-verified against HEAD
`092fa90a` before this decomposition:

| Feature | DD claim | Verified | Verdict |
|---|---|---|---|
| F4 SpanTable | "zero consumers" | `buildSpanTable` only in ast-builder.js; no `.spans` reads downstream | ✅ accurate |
| F5 PGO has* flags | consumers at emit-client / index / auth-graph + `=== undefined` fall-through | refs in 6 files (codegen/index.ts, types/ast.ts, auth-graph.ts, reachability/entry-points.ts, emit-client.ts, ast-builder.js) | ✅ accurate |
| F2 ESTree decorations | "~3 sites, comment-level ghost, ~3-5h" | **`estreeType` referenced across 10 files / ~25+ sites** — substantive READ sites in symbol-table.ts (5: Literal/ArrayExpression/ParseError), expression-parser.ts (8: TemplateLiteral/TemplateInterpFallback), component-expander.ts, ast-builder.js (SqlPlaceholderError/ParseError) — beyond the 3 codegen sites the DD named | ⚠️ **understated — corrected below** |

**F2 correction.** The RETIRE *direction* is sound (`estreeType` is a genuine
legacy-Acorn artifact; rename `estreeType → nativeKind` preserves all values). What the
DD got wrong: the field-rename cascades to **10 files**, not 3, and the 3 codegen
kind-test rewrites are **pipeline-coupled** (`node.kind === "Arrow"` only resolves once
the native parser produces first-class Arrow/Function kinds; the live pipeline produces
escape-hatch nodes). Corrected F2 estimate: **~6-12h**, not 3-5h. Savings vs the M5
agent's 25-35h MD.2 baseline: ~13-29h (still the largest single compression; still well
under baseline). Pivot 1 ratification stands — only the estimate moved.

---

## v0.5 first cut — units

Shape α v0.5 = F2 + F3 + F4 + F5 + F6 + F9. After verification, F4 and F9 carry **no
v0.5 work** (their retirements are realized at M6 deletion). The substantive v0.5 work
is **F2 + F3 + F5 + F6 ≈ 18-31h**.

| Unit | Feature | Nature | Files | Est |
|---|---|---|---|---|
| **U1** | F2 — `estreeType → nativeKind` | downstream-codegen + front-end rename | types/ast.ts + ~9 consumers + dual-mode codegen kind-tests | 6-12h |
| **U2** | F3 — hoisted-collections analogue | native-parser addition | `compiler/native-parser/` (parse-seam + walker) | 6-10h |
| **U3** | F5 — PGO has* flags → downstream pass | downstream-codegen refactor | new `computePGOFlags` pass + ast-builder.js + emit-client.ts + codegen/index.ts | 4-6h |
| **U4** | F6 — authConfig/middlewareConfig → downstream pass | downstream-codegen refactor | new pre-codegen pass + ast-builder.js + codegen/context.ts + auth-graph.ts | 2-3h |
| — | F4 — SpanTable | no v0.5 action | `buildSpanTable` deletion is M6 | 0h |
| — | F9 — forbidden-switch scanner | no v0.5 action | native parser already rejects at keyword site (`parse-stmt.scrml:119-121`); legacy-scanner deletion is M6 | 0h |

### Unit notes

**U1 (F2).** Two parts. (a) Field rename `EscapeHatchExpr.estreeType → nativeKind` in
`types/ast.ts:1858` + all ~9 consumer files — mechanical, values unchanged. (b) The 3
codegen kind-tests (`emit-expr.ts:1154-1155`, `emit-logic.ts:1817`) — pipeline-coupled;
write **dual-mode** for v0.5 (`node.kind === "Arrow" || node.nativeKind ===
"ArrowFunctionExpression"`) so the live pipeline keeps working; the `nativeKind` arm
becomes load-bearing once the native parser is the pipeline (v0.6). `emit-table-for.ts`
sites are writes — rename the key only.

**U2 (F3).** Transplant the ~60-LOC `collectHoisted` walk (`ast-builder.js:12132`) as a
native-parser analogue over the native parser's block-stream + Stmt[] output, at the
parse-seam producer. Collects imports/exports/components/typeDecls/machineDecls/
channelDecls + `hasProgramRoot` boolean (Cluster B — one walk, multiple outputs).

**U3 (F5).** New `computePGOFlags(nodes)` pre-codegen pass — one walk, 4 booleans
(hasResetExpr / hasEqualityExpr / hasChunkedMarkupTag / hasForStmt). Remove the
TAB-time computation from ast-builder.js (`detectMarkupForStmtChunkPresence`). Consumers
already have `=== undefined` fall-through; the pass runs against either pipeline.
`hasProgramRoot` is NOT moved — it stays in U2's collectHoisted (Cluster B).

**U4 (F6).** New downstream pre-codegen pass extracting `authConfig` + `middlewareConfig`
from the program node. Pipeline-agnostic (reads whatever AST the active pipeline
provides). Relocates the extraction out of ast-builder TAB-time; same shape the native
parser feeds at v0.6. Parallel in nature to U3.

---

## Dispatch plan

- **U1, U2, U3, U4 are file-disjoint** — U1 = types/ast.ts + codegen emit-expr/emit-logic/
  emit-table-for + front-end consumers; U2 = `compiler/native-parser/`; U3 = new pass +
  ast-builder.js + emit-client.ts + index.ts; U4 = new pass + ast-builder.js +
  context.ts + auth-graph.ts. **U3 and U4 both touch ast-builder.js** (removing TAB-time
  computations) — bundle U3+U4 into one dispatch to avoid the shared-file merge.
- Proposed: **Dispatch A = U1**, **Dispatch B = U3+U4** (shared ast-builder.js),
  **Dispatch C = U2** (native-parser). A + B + C are mutually file-disjoint →
  parallelizable.
- All three are compiler-source → `isolation: "worktree"` + the 7 mandatory brief
  clauses + maps-first-read.

## Out of scope (v0.6)

F1 (attrs native tokenizer) · F7 (state/SQL/CSS native sub-parsers) · F8 (error-effect +
meta catalog-rename) · the real M5 pipeline swap · M6 deletion (block-splitter +
ast-builder + BPP + Acorn + the statechild re-tokenizers + buildSpanTable +
findForbiddenSwitchInRaw).

## Tags
#m5 #m6 #compressed-md-ladder #v0.5 #scope-locked #DD-27 #S115
