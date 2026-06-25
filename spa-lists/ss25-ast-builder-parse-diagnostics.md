# sPA ss25 — ast-builder parse + diagnostics (legacy front-end, NOT native-parser)

**Launch:** `read spa.md ss25` · **Branch:** `spa/ss25` · **Worktree:** `../scrml-spa-ss25`

**Fill:** the legacy-pipeline parsing/diagnostic residuals — an inline-struct-return misparse, a diagnostic that misses a `lift`-bearing bare control-flow body, and the deprecated after-`>` engine `:`-shorthand that hard-fails instead of warn-compiling. NEW S221. **Distinct from the native-parser cluster (ss28)** — these are the legacy block-splitter + `ast-builder.js` path (lower hazard, no `.scrml` mirror lockstep).

## Shared ingestion
The **legacy front-end** `ast-builder.js` + block-splitter: how the body-splitter hands segments to `ast-builder.js`, the markup-vs-logic body-mode gates (the `BARE_CONTROL_FLOW_IN_MARKUP` diagnostic), fn return-type parsing, and engine `:`-shorthand placement recognition. **READ FIRST:** `.claude/maps/primary.map.md` Task-Shape Routing (parse front-end) — the legacy-BS vs native-parser fork is load-bearing here; these items are on the LEGACY path. Verify each fire-site against current source (S160/S189 touched §4.14 + the body modes).

## Core files
`compiler/src/ast-builder.js` (`:1518` control-flow gate; fn return-type parse; engine state-child collect) · `block-splitter.js` (engine `:`-shorthand placement; `E-STRUCTURAL-ELEMENT-MISPLACED`) · `engine-statechild-parser.ts`

## Items (least-ingestion-first)

1. **`g-control-flow-in-markup-lift-body-evades-diagnostic`** (MED) `[status=open]` — `E-CONTROL-FLOW-IN-MARKUP` (`ast-builder.js:1518`, gated `block.type==="text"` + `BARE_CONTROL_FLOW_IN_MARKUP_RE`) fires for bare `for(){<li>}` but NOT for `<div> if(c){ lift <p>x</> }</>` — the `lift` keyword evades the text-block gate → silent raw-`lift` source text shipped to the DOM (the silent-accept class S203 meant to close). **Fix:** extend the gate to catch a `lift`-bearing bare control-flow body. Reporter sPA ss15.
2. **`g-inline-struct-return-type-misparse`** (MED) `[status=open]` — `fn f() -> { active: int, … }` (inline struct return type) mis-parses: the body splits into `return active;` + a dangling block → `E-SCOPE-001` on the first field. Workaround: a NAMED return type. **Fix:** the fn return-type parser confuses an inline struct-literal return type with a block body — disambiguate. Pre-existing on main (surfaced by the endpoint-arm agent).
3. **`bug-75`** — after-`>` ENGINE `:`-shorthand fails E2E at the block-splitter (`E-STRUCTURAL-ELEMENT-MISPLACED`) `[status=open; LOW; KEEP-OPEN user-ruled S177]` — a DEPRECATED form should compile-WITH-WARNING (`W-COLON-SHORTHAND-LEGACY-PLACEMENT`) during its window, NOT hard-fail. **Fix:** make the engine after-`>` placement reach `parseEngineStateChildren` so the lint fires + the body compiles byte-identical to the inside-opener form. Verify the inside-opener path it must converge to.

## Progress
`ss25.progress.md`. Land on `spa/ss25`; ping PA inbox per-item. Do NOT advance main / push. **Conformance-sensitive** (parser changes shift fixture ASTs) — run the FULL `bun run test` + re-baseline within-node allowlist for any over-budget fixture in the same land. PA re-integrates (S67 + R26 on real source). If any item turns out to live in the NATIVE parser (`.scrml` mirror), STOP + escalate-to-ss28 (cross-ingestion).
