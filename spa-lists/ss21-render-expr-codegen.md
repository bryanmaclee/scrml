# sPA ss21 — render + expression codegen (emit-lift / emit-html / emit-expr / display-mode)

**Launch:** `read spa.md ss21` · **Branch:** `spa/ss21` · **Worktree:** `../scrml-spa-ss21`

**Fill:** the "green compile, wrong render" residual cluster the S220 each-codegen waves (ss17/ss20) surfaced + deferred — the markup-text/interp lowering on sibling render paths (tableFor / if-chain / request-lift) plus the loud expr-serializer paren case. NEW S221 · **fireable now** (disjoint from server-fn surface — safe parallel with ss22/ss23/ss24).

## Shared ingestion
The **markup/expression emit-codegen family**: `emit-lift.js`'s `emitCreateElementFromMarkup` (markup-text-child `${...}` lowering), the display-mode interpolation gate (the single-`if=` fix from ss20 item-1, here extended to sibling node-kinds), `emit-expr.ts`'s `binaryOperandNeedsParens` (the ss20-era paren-serializer), and the `<errors>` reactive-emit path. Same understanding the ss17/ss20 agents built. **READ FIRST:** ss20 landing (`emit-lift.js` + `compiler/src/codegen/emit-each.ts` @ `8a0e9e3d`) + the ss20 deferred-findings block in `docs/known-gaps.md` (these 4 are literally "ss20 item-N deferred finding").

## Core files
`compiler/src/codegen/emit-lift.js` · `emit-html.ts` · `emit-expr.ts` (`binaryOperandNeedsParens`) · the `<errors>` emitter + `dist/scrml-runtime.js` (derived-cell subscribe path)

## Items (least-ingestion-first)

1. **`g-request-lift-bare-if-condition`** (LOW) `[status=open]` — bare `${ if (<#id>.loading) { lift } }` reads the §36 `_scrml_input_state_registry`, not the live `_scrml_request_<id>` → condition never reactive. **Fix:** thread `requestIds` into `emit-lift.js` (same threading as the landed D1 `g-request-lift-nested-interp-mangle`). Smallest — a known threading pattern.
2. **`g-tablefor-column-slot-literal-interp`** (MED) `[status=open]` — `<tableFor>` single-column slot renders literal `${@row.name}` (emit-lift markup-text-interp class on the EACH path; brief-excluded from ss20). MASKED by a weak `js.toContain("row.name")` at `compiler/tests/unit/r28-bug-2-tablefor-column-row-access.test.js:207`. **Fix:** extend emit-lift interp-lowering to the tableFor each-column slot path **+ STRENGTHEN that test to value-assert** (not substring).
3. **`g-if-chain-branch-display-null-interp`** (MED) `[status=open]` — `if=`/`else-if=`/`else` CHAIN branch (separate node kind, brief-excluded from ss20) carrying reactive `${@x.field}` over a null cell has the same first-mount null-access the ss20 item-1 single-`if=` fix gated. **Fix:** extend the item-1 display-mode gate to the if-chain branch node kind. (Read the landed `g-if-guard-inner-effect-not-gated` fix first — same shape.)
4. **`g-unary-left-of-exponent-no-paren`** (MED) `[status=open]` — `-@a ** 2` emits `- _scrml_reactive_get("a") ** 2` → loud `E-CODEGEN-INVALID-JS` (JS rejects a unary left-operand of `**`). Distinct from the silent paren-ternary (this is LOUD). **Fix:** a precise `**`-left-operand-unary case in `emit-expr.ts binaryOperandNeedsParens` — do NOT blanket-wrap unary (over-parenthesizes `a + -b`). **S215 adversarial: must not regress other expr shapes.**
5. **`g-errors-anchor-not-reactively-clearing`** (MED) `[status=open]` — a `_scrml_reactive_subscribe` on a DERIVED cell never fires (derived recompute fans out only effects via `_scrml_trigger`, not subscribe callbacks) → the `<errors>` anchor DOM doesn't reactively clear when the field becomes valid. **Locus:** the `<errors>` emitter + the runtime subscribe-vs-effect path for derived cells (`dist/scrml-runtime.js`). Heaviest ingestion (runtime reactivity) — ordered last.

## Progress
`ss21.progress.md`. Land on `spa/ss21`; ping PA inbox per-group when ready. Do NOT advance main / do NOT push. PA re-integrates (S67 file-delta + R26 + within-node allowlist re-baseline if any fixture AST shifts + FULL `bun run test`). #4 + #2-test-strengthen mandate the S215 adversarial pass.
