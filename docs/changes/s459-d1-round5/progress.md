# progress — s459-d1-round5 (one component scope)

## 2026-10-08 — start
- WT agent-a9259b63b54f02009, branch s459-d1-r5 from worktree-agent-a2dd4a6ac2e78db31 (8e7bd4a2c); merge origin/main (3a4a3639a) = already up to date.
- Reproduced on HEAD (reviewer probes, runprobes.ts): H1 sb2 `#o` 5/5 (want 7/5), sb 50/1 (want 7/1); M1 sh markup L (want S), handler S/L; M2 nd/cb ReferenceError onDismiss/onGo; L1 E-SCOPE-001 for `...n` — ALSO outside components (type-system binds "... n" literally); L2 sq2 silent garbage title.

### Governing sentences (quoted)
- §15.10.1: "A local `let`, `const`, `tilde`, `lin`, `@`, or function declaration with the same name appears earlier
  in the same lexical scope. From the point of declaration onward in the same scope, the local binding shadows the prop."
- §15.11.1: "A local declaration, parameter or loop binder named like the prop is not the prop (§15.10.1 Shadowing)
  and is writable."
- §15.10.1 Greeter example: a component logic block's `const greeting` is read by the markup after it (same scope).
- §5 (SPEC ~L1790): "The attribute quoted-string form is `"`-only (double-quote; single-quote is not an
  attribute-string delimiter)."
- Empirical scope fact (outside components): `<div><span>${ let q = 3 }</span><p>${q}</p></div><p>${q}</p>` compiles
  clean — a plain element creates no scope; a `${}` declaration is read by later markup at file scope.

## 2026-10-08 — step 1: one component scope (H1, M1), callee substitution (M2), rest params (L1) — 59dd549eb
- Locus (PA hypothesis `substitutePropsInLogicStmts` ~2225 keeps `localShadowed` per statement list): HELD, refined —
  the per-list set was correct for a list; the defect was that `substituteProps` (the markup walker) started every
  logic block with `new Set()` and never carried a block's declarations to later siblings.
- Fix: `substituteProps(node, props, propExprMap, bodyScope)` — one mutable component scope threaded through the
  primary root and every secondary root in source order; a logic block's top-level declarations are merged into it;
  at every node the shadowed props are removed from the maps (`scopedPropMaps`), so later blocks, text, attribute
  values, handler expressions and lifted markup all see the local. Writes to the local are never recorded as prop
  writes (no false E-COMPONENT-PROP-WRITE, no lowering onto the caller's cell).
- M2: the call-ref attr CALLEE is looked up in the same prop map; plain-name value -> call-ref renamed; any other value
  -> `expr` whose tree is the call with the substituted callee.
- L1: the claim "later scope check never binds rest params" HELD and is wider — outside components too
  (`function g(...n)` -> E-SCOPE-001 at top level). type-system binds `boundNamesOf(param)` (AST spells it `"... n"`).
- Conformance (executed): component-scope-{later-block-write, markup-handler-write, markup-read, by-value-local-shadows},
  callback-prop-bare-call-form (§15.11.4 example verbatim + onGo(event) top/lift/lambda), rest-param-named-like-prop.
  Commit gate 32653 pass / 0 fail.

## 2026-10-08 — step 2: L2 + L4 — a1e8de5a7
- L2 HELD (HEAD regression from round-4 F4's opener-scan rework; main rendered it). Native `tokenizeAttributeRegion`
  now refuses `'…'` with E-ATTR-001 (diagnostics returned -> parse-markup pushDiagnostic); CE reports E-ATTR-001 under
  its own code (not wrapped in E-COMPONENT-021), the attribute recovers `absent`.
- L4 HELD: three messages reworded (bind prop passed by value -> "Bind it at the call site"; omitted -> "does not
  bind (it omits the prop)"; `bind:n=${@v}` -> "Write `bind:n=@v`").
- Unit s459-d1-round5-component-scope (13). bootstrap-conformance regenerated. Gate 32667 / 0 fail.

## 2026-10-08 — step 3: per-each-body / per-arm / snippet scopes — b70717a8f
- Base flip (git archive 8e7bd4a2c compiler/{src,native-parser} over HEAD tree): all 7 new cases FAIL on base, PASS on head.

## Carried (out of scope, NOT fixed)
- destructured-param / param defaults dropped (`{ n = 5 }`, `k = 2`); destructuring assignment unsupported; C-style
  `for` in component fns; `<each>` in lifted components (reviewer probe lf still fails); block-arrow handler in `<each>`
  never invoked; `<Card id=…>` E-COMPONENT-011 vs §15.5.

## 2026-10-08 — step 4: gates + corpus differential (base 8e7bd4a2c compiler vs head b70717a8f, same corpus)
- Method: `git archive HEAD` -> headtree; same + `git archive 8e7bd4a2c compiler/src compiler/native-parser` overlaid
  -> basetree (no stash, no flip in the worktree); `scripts/corpus-emit-differential.ts capture` on each, then `diff`
  (exit 2 = INCOMPARABLE only because neither scratch tree is a git checkout: revision `<unknown>`; enumeration agrees,
  2493 = 2493 sources).
- Compile outcome: 1 newly failing = single-quoted-attr-in-component-reject (the INTENDED new E-ATTR-001); 3 newly
  passing = component-scope-by-value-local-shadows, rest-param-named-like-prop, **stdlib/math/index.scrml** (its
  rest params were E-SCOPE-001). Code deltas: those 4 only. Text-only: prop-write-unbound-reject (L4 wording),
  stdlib/path + stdlib/time (their rest-param E-SCOPE-001s gone; other errors unchanged). syntax-failing 0 / 0.
- Artifacts: 7260 compared, 7091 identical, 169 differing; 162 differ ONLY by `_scrml_project_root` (the scratch
  tree path, basetree vs headtree — harness artifact, verified by normalizing the path). The 7 real deltas: the 4 new
  component-scope / callback cases (base miscompiles them) and **example 23**: load-new.client.js now wires
  `onAddressInput/onCityInput/onStateInput(event)` to `_scrml_setOrigin*/_scrml_setDestination*` (was a bare
  `onAddressInput(event)` -> ReferenceError on input); load-detail.client.js `onAssign(event)` -> the async
  `_scrml_saveAssignment_68(event)`. StatusPicker's `onTransition(target)` sits in an `<each>` inside a lifted
  component — the carried each-in-lifted-component gap (the button never renders on base or head).
- Gates: core suite (pre-commit, every code commit) 32667 pass / 0 fail; conformance/run.ts 1398/1448 + 50 xfail,
  0 fail (+7 new cases, no new xfail); browser-baseline.ts --check PASS (48 asserted); e2e-render-map 259/0;
  compiler/tests/*.test.js 2239/0; bootstrap-conformance regenerated (--check was stale from the new cases).
- Found, pre-existing, NOT fixed (outside scope): a bare assignment to ANY parameter inside a function body
  (`function g(n) { n = 6; return n }`, top level, no component) emits `const n = 6` -> E-CODEGEN-INVALID-LOGIC
  ("Identifier 'n' has already been declared"): codegen's tilde-decl rebind test does not see parameters.

# Round 6 (PA re-review of a793e24e5 = LAND-WITH-NITS; addendum in BRIEF.md)

## 2026-10-08 — reproduced (reviewer probes s459-rev-d1r5, run on a793e24e5)
- F1: p4/liftnested `#o` 9 (want 7); p5/liftnestedread `.t` L (want S). F4: p6/cbomit + cbomitlambda no E-TYPE-031,
  cbnonfn no diagnostic (`"x"()`). F2: f/metasq.scrml -> E-META-EVAL-002 (naming E-ATTR-001). F3: f/sqspan.scrml
  reported at the def span (2:12). L4: E-COMPONENT-010 said `n="value"` for a bind prop.
- p4/ifleak + fileif (reviewer `?` placeholders): a `${}` inside an `if=` element declares at the enclosing scope —
  consistent with the file-scope rule outside components (no element scope); not in the PA list, left as is.

## step 1 — F1 (040eefc53)
- HELD. `substitutePropsInMarkupFromStmt` now passes `new Set(shadowed)` as the markup's scope; `substituteProps`'
  scope parameter is REQUIRED (the only call site that dropped it was this one — grep of all 8 call sites).
- types-gate was red on the branch (round-4 TS2352 casts in expression-parser `convertParams`): fixed by field
  casts, baseline rewritten (2 component-expander entries gone).
- Conformance component-scope-lift-nested-{write (#o 7/9), read (L, S, t-S, L after the lift)}.

## step 2 — F4 (3d103bfa5)
- HELD. §15.11.4 "an unguarded call to a potentially-absent function-typed prop SHALL be a compile error
  (E-TYPE-031 …)" — implemented as a property of the DEFINITION (the prop is `fn | not` in the body whatever a
  caller passes), reported once per component; every call form (bare call-ref, expr lambda, block arrow via the
  JS-text substituter's new `onCall` hook, body functions). Guard = a region under a test reading the prop
  (if-consequent, `&&` right operand, ternary consequent), marked in the shadow sets (`PROP_GUARD_PREFIX`).
  Lenient by design (any read in the test counts) so it cannot false-positive a real guard.
- §15.11.4 "A type mismatch SHALL be E-TYPE-031": a LITERAL value for a function-typed prop is E-TYPE-031
  (names / expressions are not judged here — no type is known at CE).
- Printer bug found on the way, fixed: a lambda / assignment / conditional as a ternary CONDITION was not
  parenthesized (emit-expr `emitTernary`, `emitStringFromTree`) — `onGo ? onGo() : 0` with a lambda caller emitted
  `() => h() ? … : 0`.
- Found, pre-existing, NOT fixed: a top-level function referenced as a VALUE (not called) is not mangled —
  `${() => h && h()}` emits `h && _scrml_h_3()` -> ReferenceError (outside components too). It bites the guarded
  callback idiom when the caller passes a NAMED function (`if (onGo) …` with `onGo=h` in an arrow); the
  handler-statement form works. The guarded conformance case passes lambdas for that reason.
- Corpus pre-measure: only one corpus file declares an optional function prop
  (samples/compilation-tests/gauntlet-r10-ts-components.scrml) and it already fails E-COMPONENT-021 on base.
- Conformance callback-prop-{optional-unguarded-reject (3), optional-guarded (hhhhh), non-function-reject (2)}.

## step 3 — F2 / F3 / L4 (d017f8db7, one commit to spare a 10-minute hook)
- F2 HELD, intended: a language-wide consequence of round-5 L2 — compile-time `^{ emit(...) }` markup is re-parsed
  by the same native reader, so `'…'` there is E-META-EVAL-002 (naming E-ATTR-001). Pinned:
  meta/emit-single-quoted-attr-reject + clean twin meta/emit-single-quote-inside-attr-clean (`onclick="go('a')"`).
- F3 HELD, refined: the def span's line/col themselves are wrong (start offset right, line/col relative to the
  block) AND the body re-parse reads a normalized copy (indentation stripped, `</>` -> `< / >`), so its offsets
  cannot address the file. The refused bytes are now located in the definition's source range (k-th occurrence)
  and reported at their own line/col (sqspan -> 6:24). Cross-file definitions fall back to the def span.
- L4 HELD: E-COMPONENT-010 for a bind prop: "Bind it at the call site: `<C bind:n=@cell/>`".

## Carried (round 6)
- Two instances of a component with a body-level `let` / function crash or collide ("Cannot declare a let variable
  twice"; a body `function f` is emitted once per instance under one name) — pre-existing on base.

## step 4 — gates + differential (round 6)
- Differential base a793e24e5 compiler (git archive over the HEAD tree) vs head d017f8db7, same 2500 sources: 2 newly
  failing = the two new intended reject cases (callback-prop-non-function-reject, callback-prop-optional-unguarded-reject;
  +E-TYPE-031 only); 0 newly passing; text-only 1 (single-quoted-attr-in-component-reject: F3 span); 165 differing
  artifacts = 162 scratch-path (`_scrml_project_root`) only + the 3 new runtime cases. F4 corpus impact outside the
  new cases: ZERO. The ternary-condition printer fix changed no corpus artifact.
- Gates: core suite 0 fail on every code commit (pre-commit); conformance/run.ts 1405/1455 + 50 xfail, 0 fail;
  browser-baseline --check PASS (48 asserted); e2e-render-map 259/0; compiler/tests/*.test.js 2239/0; types-gate OK;
  bootstrap-conformance current.

# Round 7 (PA review of 270f2812e = DO-NOT-LAND on item 1; addendum in BRIEF.md)

## 2026-10-08 — reproduced (s459-rev-d1r6 probes on 270f2812e)
- Item 1 HELD: all 12 p2 single-instance probes refused E-TYPE-031 (early return `is not` / `!`, else of `is not`,
  `onGo?.()` in a function and an arrow, `if=onGo` + `onclick=onGo()`). My round-6 note "cannot false-positive a
  real guard" was FALSE: the model treated a test that READS the prop as a guard of its consequent only, and the
  bare call-ref was hard-coded unguarded.
- Item 3 HELD: `onGo=${not}` -> E-TYPE-031 "non-function value"; with the check removed the emit was `not()` -> `!()`.
- Item 5 HELD: f/sqcomment.scrml -> 3:19, inside the comment.

## step 1 — the ONE §42 presence-narrowing reader (2ff88ab0d)
- Found the existing reader: type-system `checkOptionalMemberAccess` (E-TYPE-046, §42.3.5) carried its own
  narrowing walker (discriminateCondition / earlyReturnNarrowedCell / markupNarrowedCells / given / match / if /
  ternary). It runs at TS on post-CE ASTs keyed by `@cell` names, so it cannot be CALLED at the expander stage as
  is. Fix: EXTRACTED into `compiler/src/presence-narrowing.ts` (receiver-agnostic: `receiverKey` + `onExpr`), and
  E-TYPE-046 now runs through it; the component E-TYPE-031 check is its second consumer. The bespoke round-6 guard
  model is deleted from both substituters (component-prop-js-substitute.ts restored to 040eefc53).
- Component adapter (`checkOptionalFnPropCalls`, once per DEFINITION): substitute the body with a marker per
  optional function prop (the expander's ONE scope model decides what IS the prop — a shadowing local is never
  marked), parse handler values with the type system's own check view `parseHandlerStatementsForCheck` (an arrow
  yields its body; the body re-parse leaves values as raw text), walk with the shared reader; a call / member hop
  through a marker that is not `?.` and not proven present fires.
- Narrowing forms (§42.3.5 quoted in the module header): optional call; `if=`/`show=`/`else-if=` on the element
  (now covers its OWN other attributes — the element and its handlers exist only while the guard holds) or an
  ancestor; `given`; `match`; early return (any test whose FALSE-facts prove presence: `is not`, `!p`, `== not`,
  `!a || !b`); `is some` / truthy / `!= not` consequent; else of a negated test; ternary branches; `&&` right
  (TRUE-facts of the left); `||` right (FALSE-facts of the left). `narrowsWhen(cond, truth)` composes `!`/`&&`/`||`.
- E-TYPE-046 consequence (same reader, so it widens too — NEWLY ACCEPTING, correct per §42.3.5): `@u && @u.name`,
  `!@u || @u.name`, `if (!@u) return …`, `@u == not` early return, `if=` covering the element's own attributes.
  Measured: base fired E-TYPE-046 twice on `${@u && @u.name}` / `${!@u || @u.name}`, head zero. Pinned in unit.
- Lenient false negatives now CAUGHT: `if (p is not) { p() }`, `!p && p()`, `p || p()`, `p ? 0 : p()`, `p.call()`,
  `if (p()) {}`, `class=${p()}` (conformance callback-prop-absence-unsafe-forms-reject, 7).
  NOT caught (reported, not a call or hop): `run(onGo)` passing the `fn | not` value to a parameter (reviewer
  fn-ref-passed) — E-TYPE-046 has the same boundary; it would need argument typing (§7.5.1 position 3, Nominal).
- `given` / `match` in a component body still fail E-COMPONENT-020/021/035 (carried, pre-existing) — the reader
  handles both, but no component can reach them today.
- Item 2: reported at the offending call — the call's ANCHOR (its attribute value or `${}` block, body-relative
  spans) is located in the source, then it is the i-th call/hop of the prop there.
- Item 3: `not` admitted for an OPTIONAL function prop (refused for a required one); the raw-text substituter now
  groups a `not` value, so `onGo()` -> `(null)()` (valid JS, never reached under a guard).
- Item 4: SPEC §34 E-TYPE-031 row re-measured (`grep -rn '"E-TYPE-031"' compiler/src`): 21 push sites, five
  positions — (d) a literal / `not`-to-required for a function prop, (e) the unguarded optional-function-prop call.
  Notes that scripts/s34-census.ts does not check the count. s34-census --check-new PASS.
- Item 5: the locator is whitespace-insensitive and skips source comments (and treats `//` inside `"…"` as text);
  the fallback span's line/col is computed from the source (the def span's own line/col were wrong).
- Conformance: callback-prop-absence-safe-forms (11 forms × none/some, executed), -absence-unsafe-forms-reject (7),
  -pass-not (executed); non-function-reject +`${not}` to a required prop (3). Unit +5. Gate 32611 / 0 fail.

## step 2 — merge origin/main (437fbde63; main had moved past 49b7fcc1d) — b31be0ec8
- Conflicts: SPEC-INDEX / FACTS / bootstrap-conformance only -> took main's, regenerated by script (--check PASS).
  Gate 32818 / 0 fail.

## step 3 — gates + differential (round 7)
- Differential: base = HEAD tree (b31be0ec8) with the r7 compiler diff (270f2812e..2ff88ab0d, compiler/src +
  native-parser) reverse-applied, i.e. 270f2812e + main; head = b31be0ec8; same 2509 sources. 0 newly failing; 2 newly
  passing (callback-prop-absence-safe-forms, callback-prop-pass-not — refused on base); text-only 2 (the E-TYPE-031
  message + span on the two reject cases); 164 differing artifacts = 162 scratch-path only + 2 real
  (callback-prop-bare-call-form, callback-prop-optional-guarded: an omitted optional prop now lowers as `(null)()` /
  `if((null))` — the `not` grouping, same behaviour). ZERO corpus files outside the new cases changed — including
  no E-TYPE-046 change anywhere in the corpus from the widened narrowing.
- Gates (on 42859836a): core suite 32821 pass / 0 fail (pre-commit); conformance/run.ts 1414/1464 + 50 xfail, 0 fail;
  browser-baseline --check PASS (48 asserted); e2e-render-map 259/0; compiler/tests/*.test.js 2239/0; types-gate OK;
  bootstrap-conformance / FACTS / SPEC-INDEX current; s34-census --check-new PASS.
