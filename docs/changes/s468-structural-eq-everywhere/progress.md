# progress — s468-structural-eq-everywhere (append-only)

- 2026-10-17 start at /home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-a297eb1130075596e, base 5c43c3b8e (== origin/main).
- Reproducer (executed, base 5c43c3b8e): `~/.cache/scrml-agent-tmp/s468-structural-eq-everywhere/repro/app.scrml`,
  `bun compiler/src/cli.js compile app.scrml -o dist`. Expected: every `==` on Point operands lowers to
  `_scrml_structural_eq`. Actual: typed fn body, plain fn `if`, const derived, markup `${}`, `if=` are all structural;
  the inline handler `onclick=${@msg = (@a == @b) ? "yes" : "no"}` emits
  `_scrml_cs_reactive_get("a") === _scrml_cs_reactive_get("b")` (reference equality — always false for two cells).
- Locus trace: emit-event-wiring.ts Case C routes `assign`/`unary`/`lambda` handler bodies (and fn-shorthand Case A, the
  node-less arrow Case B) through the STRING rewriter (`rewriteBlockBody` -> `emitExprField(null, raw)` ->
  `rewriteExprWithDerived` -> clientPasses). The final client pass, Pass 18 `rewriteEqualityOps`
  (codegen/rewrite.ts), regex-rewrites every `==` -> `===` and `!=` -> `!==`. Every string-fallback caller (28 call
  sites: event wiring, each handlers, variant guards, match arms, engine rules, when-handlers, escape hatches) inherits it.
  Hypothesis "emit-expr.ts / emit-event-wiring.ts == lowering" REFINED: emit-expr's structured `emitBinary` is correct;
  the root is the string pipeline's Pass 18.
- Governing sentence, §45.1: "`==` is scrml's sole equality operator. It performs structural value comparison."
  §45.8: "`==` SHALL perform deep structural comparison for structs and enums." §45.4: "`a == b` (primitives) ->
  `a === b` in JavaScript / `a == b` (structs) -> deep structural comparison function call / `a != b` -> negation of the above".
- Direction of change: semantics-changed (reference eq -> structural eq) for non-primitive operands at string-fallback sites.
- 2026-10-17 second reproducer (adjacent positions) found two MORE raw-text roots: `<each>` per-item text path
  (`emit-each.ts` `rewriteIterValueExpr`) shipped JS LOOSE `it == _scrml_cs_reactive_get("sel")` (no equality pass at
  all); library-module verbatim block (`emit-library.ts`) shipped `export const SAME = { a: 1 } == { a: 1 }` (false).
  Server raw-text passes (`serverPasses`) also have no equality pass, but no server raw-text `==` reached the corpus
  and server-fn match arms / for bodies / ternaries all go through the structured path (repro3) — residual, reported.
- Fix: NEW `compiler/src/codegen/string-equality-lowering.ts` — `lowerEqualityOps` parses the (already JS-shaped)
  text with acorn (expression, else module body; top-level return/await allowed) and rewrites each `==`/`!=`
  BinaryExpression in place with emitBinary's rule (`isStaticallyPrimitiveEstree` = ESTree twin of
  `isStaticallyPrimitive`). Wired into rewrite.ts Pass 18 (unparsed -> legacy `===`), emit-each.ts
  rewriteIterValueExpr and emit-library.ts verbatim block (unparsed -> unchanged). Rule 7: the string pipeline holds no
  ExprNode; acorn's tree is the tree.
- Primitive proof (how `===` survives): both operands must be, on the parsed tree, a non-regex Literal, a
  TemplateLiteral, a Unary/Update/Binary expression (all yield JS primitives), a Logical/Conditional whose branches are
  all such, a non-computed `.length/.size/.byteLength/.name` member, or a nested `_scrml_structural_eq(...)` call.
  Same conservative rule as emit-expr `isStaticallyPrimitive`; anything else (identifiers, cell reads, members, calls)
  takes the helper, which is also correct for primitives.
- Direction: semantics-changed (reference / loose eq -> §45 structural) at raw-text sites. Corpus differential
  (base 5c43c3b8e archive vs head; roots examples,samples,conformance/cases,stdlib; 2840 sources, 8562 artifacts):
  0 compile-outcome changes, 0 diagnostic-code changes, effective syntax delta 0; 227 content diffs = 167 path-noise
  only (project-root string differs between the two checkouts) + 50 real in 30 sources. Every real changed line
  inspected (classify.ts): each is `===`/loose `==` -> `_scrml_structural_eq` (or `(a === b)` paren-wrap of an
  already-primitive pair), plus companion runtime-hash changes in .html/.scrml-client-assets.json and one ADDED
  `_scrml/_global.js` for the library module whose inlined helper reads host globals. Unparsed inputs logged with
  SCRML_EQ_FALLBACK_LOG=1: 10, all in 3 compile-FAILING fixtures or `<each>` predicate text later lowered structurally
  by lowerEachExpr — 0 artifact-producing legacy fallbacks.
- Tests: unit `compiler/tests/unit/s468-string-equality-lowering.test.js` (23); integration
  `compiler/tests/integration/s468-structural-eq-everywhere.test.js` (5; happy-dom with the TREE-SHAKEN emitted runtime;
  all 4 browser tests FAIL on base 5c43c3b8e, verified). 11 pinned `===` expectations in 10 existing test files updated to
  the §45.4 form (each pinned reference/loose equality on a non-provably-primitive operand).

- 2026-10-17T16:45:55 FIX ROUND 1 start at /home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-af1f3d3dba749a434 on s468-structural-eq-everywhere @ 149e62ad5 (S239 review: fix F1, F2, F4; file F3/F5 as gaps).
- 2026-10-17 FIX ROUND 1 — reproduced on 149e62ad5 (executed, happy-dom, reviewer harness `probes/run.mjs`):
  F1 `p6.scrml` `#b` -> "ne" (expected "eq"); emitted `!_scrml_structural_eq(_scrml_cs_reactive_get("a") /* is it, ? */ != _scrml_cs_reactive_get("b"))`.
  F2 `lib/models.scrml` compiled + imported -> `TypeError: makeTag() is not a function` (emitted `export const TAG = makeTag()⏎  (typeof LABEL === "string") && …`).
  F4 `p2.scrml` click `#dialog` -> "close" (expected "stay"). F3 `p8.scrml` -> "false/false" for equal structs (fn + handler; same `===` emission on base 5c43c3b8e).
- Locus F1 HELD: `renderEq` `gap.indexOf(n.operator)`. Fix: `splitAtOperator` tokenizes the gap with acorn's `tokenizer` (comments skipped);
  the operator TOKEN is the split; left text ends at the last token before it, right text starts at the first token after it
  (comments in the gap are dropped — a kept `//` comment at the end of the left text would swallow `, right)`). Rule 7: the gap
  is tokenized by the JS tokenizer, not searched as text. A token miss (internal inconsistency) -> the same fallback as unparsed text.
- Locus F2 HELD: `(${left} === ${right})`. Fix: node-for-node swap `${left} === ${right}` (`===`/`!==` share `==`/`!=`'s
  precedence + associativity). Other new-text sites: the structural form starts with `_scrml_structural_eq(` or `!` — an
  identifier / prefix-only `!` never continues the previous line under ASI; the three callers (rewrite.ts Pass 18,
  emit-each.ts rewriteIterValueExpr, emit-library.ts verbatim block) pass the result through with no wrapping. No other `(` added.
- Locus F4 HELD: `_scrml_structural_eq` struct branch read any object by own enumerable keys. Governing sentences, §45.2:
  "Primitives (number, string, boolean): always comparable with `==`. / Structs: comparable if all fields are comparable. Deep
  structural (recursive field-by-field). / Enums: comparable. … / Maps (§59): comparable." and "**`asIs` values**: `==` generates
  `===` in JS output with compiler warning W-EQ-001." §45.6: "There is no identity comparison operator in scrml." So the values
  `==` compares structurally are primitives / structs / enums / maps; a DOM node, an Event, a host-class instance is not one, and
  §45.2 gives such an (`asIs`) value `===`. Fix: after the built-in value-class branches, an object that is not an array, host
  Map/Set, or Error and whose prototype is not null / a realm's Object.prototype (realm-safe: proto's proto is null — the
  runtime's existing plain-record test, cf. `_scrml_deep_set_copy`) returns false (identity already ruled out by `a === b`).
  Applies to the server inline copy (same text, sliced). Checked: bun:sqlite rows (`all()`/`get()`), JSON.parse, structuredClone
  results are plain records — server-side struct comparisons keep structural semantics.
- Direction: F1 semantics-changed (wrong polarity -> correct); F2 inert in meaning (removes a runtime crash; no paren-related
  precedence change); F4 semantics-changed (non-value host objects: own-key comparison -> identity; scrml values unchanged).
  Not newly-accepting / newly-rejecting (compile outcomes unchanged — see differential).
- Tests (executed): unit `s468-string-equality-lowering.test.js` (+9 F1/F2 tests; 4 primitive-form expectations unwrapped),
  NEW unit `s468-structural-eq-host-identity.test.js` (client + server copies; DOM/Event/host-class identity, struct/enum/map/
  array/Date/Map/Set/Error/foreign-realm/null-proto unchanged), integration `s468-structural-eq-everywhere.test.js` (+3:
  library ASI load, p6 comment shapes in happy-dom, p2 backdrop in happy-dom; library PRIM expectation unwrapped),
  `equality-semantics.test.js` §11 expectation unwrapped. All 18 new/changed assertions FAIL on frozen 149e62ad5 (verified on
  an archive of it). The 11 originally touched test files + host-identity + giti-036 + s440 + map/HAMT + tree-shaking +
  server-eq-helper-import + md suites: 0 fail.
- Pre-commit gate (unit+integration+conformance, --bail): 9ce4f84ba 37265 tests 0 fail; aaae4cb2f 37277 0 fail;
  da39a0370 37280 0 fail. md.js regenerated (`gen-md-shim --check` current).
- security-await-pack classify (archive of 149e62ad5 + round-1 source): PASS 249 / PASS-REFUSED 136 / PASS-500 20 /
  PASS-DENY 8 / UNJUDGED 1 / FAIL 10 — identical per-shape to the frozen head and to base (0 changed, 0 new FAIL).
- Corpus differential (roots examples,samples,conformance,stdlib,ext; 2953 sources; reviewer base manifest 5c43c3b8e vs
  round-1 head): 0 compile-outcome changes, 0 diagnostic changes, effective syntax delta 0. Fix-round delta measured directly
  (frozen-head artifacts vs round-1 artifacts, every file, path/hash-normalised): 260 changed files = 245 hunks of the F4
  helper block (runtime files + server/library inline copies) + 4 paren-wrap removals (callback-prop-absence-safe-forms
  `if((null) === null)`, 27-type-derived-table `if (… .length === … .length)`, giti status `${it.name === "_private" ? …}`,
  gauntlet-r10-vue-datatable `if (typeof av === "number")`) + path noise (ext/giti relative imports name the checkout dir) +
  3 content-hashed chunk filenames renamed. 0 other changes. So the base->head real hunks are the frozen head's set minus
  the paren-wrap form, plus the F4 helper text.
- Gaps: resolved gap's wording corrected (not "structural everywhere" — F3 still open); filed (open, MED):
  g-eq-primitive-by-member-name-s468 (F3), g-eq-001-misses-number-vs-string-s468, g-each-attr-word-form-and-invalid-logic-s468,
  g-eq-asis-operands-structural-s468, g-eq-server-raw-text-loose-eq-s468. Each re-executed; all pre-existing on base.
- Observation, not filed (unchanged by this branch): reviewer p1 `#b3` `e.target == e.currentTarget` on a button click reads
  "diff-node" on both 149e62ad5 and round 1 — handlers are delegated, so currentTarget is not the button.
- Push note: each push of an existing ref re-runs the full suite locally (~12-20 min); the first round-1 push was blocked by the
  FACTS currency gate after the suite (FACTS regenerated in the docs commit). Round-1 code + docs commits pushed together.
