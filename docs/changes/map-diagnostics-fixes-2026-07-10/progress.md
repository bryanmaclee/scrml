# progress — map-diagnostics-fixes-2026-07-10

Status: fixes landed on branch; conformance cases authored; full gate verification in progress.

## SPEC read (Rule 4)
- §59 Value-Native Maps in full (esp §59.3 literals/duplicate-key, §59.4 keys/enum-key,
  §59.6 bracket-read (`@m[k]` → `V|not`), §59.7 write/remove + E-MAP-BRACKET-WRITE, §59.11
  code table — W-MAP-* all Info).
- §45.7 Equality error codes (E-EQ-* + the map reuse note).
- §14.10 Bare-variant inference (the position-type-fixes-the-qualifier rule + E-VARIANT-AMBIGUOUS).
- §34 diagnostic-stream partition convention (W-/I- prefix + severity:info → result.warnings).

## Divergence 3 — W-MAP-* severity warning → Info  [FIXED]
- Fire sites: `compiler/src/expression-parser.ts` (W-MAP-STRUCT-KEY-LITERAL ~1779,
  W-MAP-DUPLICATE-LITERAL-KEY ~1789 — pushed as `MapLitDiag` on the map-lit node).
  Surfaced in `compiler/src/ast-builder.js` at TWO sites (~348, ~3440) as `TABError` with
  NO severity field → adapter `normalizeSeverity(undefined,"warning")` reported "warning".
- W-MAP-ITERATION-ORDER already emits `severity:"info"` (`lint-w-map-iteration-order.js:150`) —
  no change needed.
- Fix: at both ast-builder surfacing sites, set `tab.severity = "info"` for `W-MAP-*` codes.
  E-MAP-LITERAL-MALFORMED stays fatal (no severity → error stream).
- Oracle: W-MAP-DUPLICATE-LITERAL-KEY / W-MAP-STRUCT-KEY-LITERAL now `severity=info`.

## Divergence 4 — E-MAP-BRACKET-WRITE inline handler  [FIXED]
- Fire site (pre-fix): `type-system.ts` `reactive-nested-assign` case (~11253) — reads
  node.target/node.path; only fires for logic-statement `@m[k]=v`.
- Gap: an inline `onclick=${@m[k]=v}` is an ExprNode `assign` (target = map-typed `index`),
  never a `reactive-nested-assign` node → escaped the gate, silently miscompiled (COW path).
- Inline-handler scan seam: `type-system.ts` ~8551 (markup event-handler attr loop,
  `handlerAttrToExprNode` + `inferReactiveSiteBareVariants`).
- Fix: new `checkMapBracketWriteInExpr(exprNode, scopeChain, span, errors)` — walks the
  handler ExprNode, fires E-MAP-BRACKET-WRITE on an `assign` whose target is a map-typed
  `index`. Wired at the inline-handler seam. Reuses the exact map/set fix-it message.
- Oracle: `onclick=${@m["DAL"]=4500}` now fires E-MAP-BRACKET-WRITE (was silent).

## Divergence 6 — enum-key bare `.Variant` spurious E-VARIANT-AMBIGUOUS  [FIXED — tractable]
- Root cause (traced): a map LHS (`[City:int]`) is not enum/union, so `bvCtxType` is null;
  the LHS-driven flat walker `inferBareVariantsInExpr(value, null)` hits the no-context branch
  and fires E-VARIANT-AMBIGUOUS on the key `.Dallas` in `.insert(.Dallas,3)` / `.getOr(.Dallas,0)`
  / `@m[.Dallas]`.
- Fix: new `inferBareVariantsAtMapKeyArgs(exprNode, scopeChain, span, errors)` — recognizes a
  key-taking map/set method (`insert`/`getOr`/`remove`/`has`/`update`/`add`; arg[0] is the key)
  and bracket-read `@m[.V]`; resolves the key variant against `mapType.key` (gated on an enum-ish
  key type) and STAMPS the resolved ident (`_bareVariantInferredAtBinaryExpr`) so the flat walker
  skips it. Threaded at the 5 statement sites (let/const-decl, reactive-decl/assign, bare-expr,
  if-cond, return) — the same sites `inferBareVariantsAtCallArgs` covers.
- Codegen already lowers a bare `.Variant` to its string tag (`emit-expr.ts:684`), so the
  enum-key map runs end-to-end once the spurious typer error is suppressed.
- Oracle: `@m.getOr(.Dallas,0)` / `.insert(.Dallas,3)` / `@m[.Dallas]` — no E-VARIANT-AMBIGUOUS;
  a typo key `.Dalas` still fires E-TYPE-063; a non-enum-key map still fires E-VARIANT-AMBIGUOUS.
- Runtime (R26): after `@m.insert(.Dallas, 4500)`, `@m.getOr(.Dallas, 0)`==4500,
  `@m.getOr(.Houston, 0)`==0, `@m.has(.Dallas)`==true.

## Conformance cases (conformance/cases/maps/)
- UPDATED `duplicate-literal-key-pos` — enshrine severity Info (`W-MAP-DUPLICATE-LITERAL-KEY`).
- UPDATED `struct-key-literal-pos` — enshrine severity Info (`W-MAP-STRUCT-KEY-LITERAL`).
- UPDATED `bracket-write-pos` — description no longer flags the inline-handler gap (now closed).
- NEW `bracket-write-inline-handler-pos` — `onclick=${@m[k]=v}` fires E-MAP-BRACKET-WRITE (error).
- NEW `enum-key-rt` — enum-key map `.Variant` resolves (notCodes E-VARIANT-AMBIGUOUS) + runtime half.
- NEW `bracket-read-miss-rt` — GAP-1: `@m["XXX"]` bracket-read miss → `not`, renders empty (DOM).

## Adversarial edge tests (all pass)
typo key → E-TYPE-063 · no-context `let x = .Small` → E-VARIANT-AMBIGUOUS · string-key map bare
variant → E-VARIANT-AMBIGUOUS · remove/has/update keys clean · array bracket-write in handler →
no E-MAP-BRACKET-WRITE · map bracket-read in handler → no fire · standalone `${@m[k]=v}` interp →
E-MAP-BRACKET-WRITE (single, no double-fire).

## Verify
- `bun conformance/run.ts` → all cases pass (post new cases).
- Full gate `bun test compiler/tests/{unit,integration,conformance}` → 0 new failures.
