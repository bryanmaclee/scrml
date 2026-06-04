# progress — native-each-interp-codegen-2026-06-04 (#2f completion)

## 2026-06-04 — startup
- pwd: /home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a7fd5dbd98946281a
- merged main ff-only; HEAD now at 39b1424a (each-promotion landing) — base confirmed.
- bun install + pretest OK.

## Phase 1 — survey (COMPLETE)
- Root cause CONFIRMED: emit-each.ts logic-child path (line 342-345) reads only `stmt.expr`.
  Under native, makeBareExpr (translate-stmt.js:431-433) sets `expr:""` + populates `exprNode`
  (contract "codegen prefers exprNode"). So native per-item `${...}` hits "empty logic
  interpolation skipped" and the text node is DROPPED.
- Canonical preference logic to mirror: emit-html.ts:1888
  `bareExpr.exprNode ? emitStringFromTree(bareExpr.exprNode) : (bareExpr.expr ?? "")`
  (comment: "Phase 4d Step 8: ExprNode-first; runtime-only string fallback").
  helper: `emitStringFromTree` from "../expression-parser.ts".
- Baseline diff (native vs default) — DIVERGENT on 4 bare-body shapes (brief said 3):
  as-name (${item.name}), empty (${@.name}), key (${item.x}), of-count (${@.}).
  colon-shorthand control: IDENTICAL (uses isShorthand path, not logic path).
- CRITICAL subtlety: legacy ast-builder ALSO populates exprNode on every bare-expr.
  For `@.` the two paths DISAGREE: legacy `.replace`-strip → "@.", exprNode emit → "@ ."
  (space). rewriteContextualSigil only matches "@\." (no space). So I must keep
  expr-non-empty-FIRST (legacy byte-identical) AND apply the existing
  `.replace(/\s*\.\s*/g,".")` dot-normalization to the resolved string in BOTH branches
  so the native exprNode-derived "@ ." normalizes back to "@." before sigil rewrite.

## Phase 2 — fix: PENDING

## Phase 2 — fix (COMPLETE)
- emit-each.ts: import emitStringFromTree; bare-expr branch now resolves
  inner = non-empty(stmt.expr) ? expr : emitStringFromTree(stmt.exprNode), then
  applies the existing /\s*\.\s*/g dot-normalization uniformly.
- Result on the 5 fixtures (native vs default):
  - as-name  (${item.name})  : NOW IDENTICAL (was DROPPED). node --check OK.
  - key      (${item.x})     : NOW IDENTICAL (was DROPPED). node --check OK.
  - colon-shorthand (<li:@.name>): IDENTICAL (always was — isShorthand path).
  - empty    (${@.name})     : STILL BROKEN — but NOT a codegen bug (see below).
  - of-count (${@.})         : STILL BROKEN — but NOT a codegen bug (see below).

## COUPLING STOP — native-parser exprNode drops the @ contextual sigil
- Probed native exprNode via nativeParseFile + emitStringFromTree:
  - `@.name` -> {kind:"ident", name:".name"}        -> emit ".name"  (@ LOST)
  - `@.`     -> {kind:"member", object:{escape-hatch MissingExpr}, property:""} -> emit "." (malformed)
  - `item.name` (named alias) -> {kind:"member", object:{ident item}, property:"name"} -> "item.name" (CORRECT)
- The native parser's EXPRESSION parser drops the `@` of the contextual sigil
  when building the exprNode. Codegen never sees a faithful node, so no
  emit-side change can recover it. (Proof: the `:`-shorthand path carries RAW
  TEXT `@.name` — sigil intact — and emits String(_scrml_each_item.name)
  correctly; only the exprNode-carried logic-body form is broken.)
- This is the brief's STOP boundary: "If the fix appears to need native-parser /
  bridge changes, STOP and report the coupling." The codegen fix is correct +
  complete for every shape where the native parser emits a faithful exprNode.
  The `@.`-rooted shapes need a NATIVE-PARSER fix (preserve the contextual sigil
  in the exprNode) — a SEPARATE dispatch.

## Phase 3 — verification (COMPLETE)
- new tests: native-each-promotion.test.js +3 (24 -> 27 pass, 0 fail).
- legacy each tests (each-block 32 + each-colon-shorthand 20 + engine-body-render 31
  + native-each-promotion 27 = 110 pass / 0 fail) — ZERO regression.
- within-node parity: 1005 pass / 0 fail, NO allowlist change, aggregate divergence
  histogram unchanged (emit-time fix, not AST-shape). PARSE-FAILURE 0.
- DEFAULT-parser byte-identity pre/post fix on as-name/key/of-count: IDENTICAL
  (legacy path preserved).
- node --check exit 0 on every compiled client.js (as-name/key/colon-shorthand).
- full pre-commit gate: 22946 pass / 3 fail. The 3 fails are PRE-EXISTING at base
  39b1424a, untouched by my delta (emit-each.ts + native-each-promotion.test.js +
  progress.md only):
    1. MK2.1 structural-element registry "exactly the 7 SPEC-normative" — the
       39b1424a each-promotion landing added 'each' to STRUCTURAL_ELEMENTS (now 8)
       without updating this test; the landing commit flagged it a SPEC follow-up.
       Pure native-parser registry test, imports zero codegen.
    2-3. TodoMVC §0/§1 browser tests — require pre-built benchmarks/todomvc/dist/
       artifacts (pretest-artifact dependency), unrelated to codegen.
  Commit succeeded (exit 0) — these are in the gate's soft-warn category.

## STATUS: COMPLETE (in scope). Residual @.-sigil-in-logic-body is a native-parser
## defect — surfaced as a coupling STOP, separate dispatch.
