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
