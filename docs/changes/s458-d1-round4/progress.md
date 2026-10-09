# progress — s458-d1-round4 (D1 declared props: one scope model)

## 2026-10-08 — start
- Worktree `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a2dd4a6ac2e78db31`; reset to 540bc7f1e;
  `git merge origin/main` (c4eb2c589) = already up to date (540bc7f1e already contains it).
- Maps: primary.map.md read (Task-Shape Routing is window-stale for this surface; not load-bearing). The
  load-bearing artifact was `docs/changes/s458-declared-props-d1/progress.md`.

### Governing sentences (quoted)
- §15.10.1 Shadowing: "A local `let`, `const`, `tilde`, `lin`, `@`, or function declaration with the same name
  appears earlier in the same lexical scope. From the point of declaration onward in the same scope, the local
  binding shadows the prop." / "A `for-stmt` loop variable, `match-arm` binding, `when message(binding)`
  parameter, or `propagate-expr` binding shadows props within their respective scopes." / "A `lambda` parameter
  with the same name is in scope. Inside the lambda body, the parameter shadows the prop."
- §17 for/lift normative statements (SPEC.md ~16115): "A keywordless loop binder — `x` in `for (x of
  collection)` — is `const` (§50.8.5); a write to it SHALL be E-ASSIGN-004."

## 2026-10-08 — step 1: ONE binding model (F5, F3, F2)
- Reproduced (executed, happy-dom): F5 `@v` ended 77, b2 read 101; F3 out `8,8,7,7,8,7,7,12,8,8` and `@v`
  became 8 (a by-value prop WRITTEN through a destructured param — worse than the brief's E-ASSIGN-004).
- Root cause confirmed: `let-decl.name` / `for-stmt.variable` may be a DestructurePattern (`shadowed.add(obj)`);
  function-decl params are ENTRIES `{ name: string | DestructurePattern, typeAnnotation?, defaultValue? }` (not
  strings as the type says), so `String(p)` = "[object Object]" bound nothing.
- NEW `compiler/src/binding-names.ts`: `boundNamesOf(binding)` — the one answer for every shape (ident, param
  text, scrml DestructurePattern, ESTree pattern, param entry / LambdaParam, lists) + `declareIn`. Its header
  states the scope rules both paths apply. Consumers: component-expander (let/const/tilde/lin decl, function-decl
  params, for-stmt variable, lambda params), component-prop-js-substitute (every pattern), expression-parser
  `convertParams` (a defaulted / rest destructured lambda param used to bind NOTHING — `name: ""`).
- JS-text path now follows the SPEC's "from the point of declaration onward" (was: whole-block pre-declaration,
  which disagreed with the structured walker: `const a = n; let n = …` / `let n = n + 1`). Function / class
  declaration names shadow from the header (own body included) in both paths. `var` keeps function hoisting.
- F2: keywordless `for (n of xs)` is a binder in the JS path too (member head stays a write target);
  `bindingNamesOfForHeader` returns it.
- Destructuring defaults (`let { a = n } = …`, param `defaultValue` text) are substituted in the enclosing scope
  (they were emitted verbatim from `default` text → a bare prop name).
- Found, NOT fixed (pre-existing, outside components too): a keywordless `for (n of xs)` inside a block-bodied
  arrow emits `for ( n of … )` (no `const`) — an implicit-global write / strict-mode ReferenceError.
- Tests: conformance bind-prop-destructured-local-shadows (F5 b1–b4), prop-substitution-destructured-shadows
  (F3 table), prop-substitution-keywordless-loop-binder (F2) — all executed; unit s458-round4-one-scope-model.

## 2026-10-08 — step 2: markup binders + lift targets in the statement scope (F7, F9)
- Commit 1 gate: 32631 pass / 0 fail (pre-commit hook).
- F7: `<each … as x>` — the binder is never substituted (the last text rewrite of a prop name in the expander,
  `substitutePropsInRawExpr`, is DELETED); inside the each body and its `key=` the binder shadows the prop.
  Mechanism: `scopedPropMaps(props, propExprMap, shadow)` — the prop maps with the shadowed props ABSENT, so
  every downstream path (text, attrs, nested logic, nested each) is covered by construction.
- F9: the `lift-expr` walker substitutes `{ kind: "markup", node }` targets (and `{ kind: "expr" }` targets —
  the old ExprNode-kind check never matched the real LiftTarget shape) in the statement's scope; a `markup` /
  `state` node that is a logic-body child at ANY depth (`if` / `for` bodies) is substituted there too (it was
  only handled at the top level). The top-level second pass over body items is removed (no double substitution).
  The string `props` map is registered per ExprNode map (`stringPropsByExprMap`) so the walker can hand markup
  to `substituteProps`.
- Base flip (540bc7f1e compiler files by copy): all 5 round-4 probes FAIL on base (F2 base: "Left side of
  for-of statement is not a reference"), PASS on head. conformance/run.ts 1386/1436 + 50 xfail, 0 fail.

## 2026-10-08 — step 3: F1 — one parser for scrml expression text
- (Resumed after an API-limit stop; worktree intact.) Commit 2 (F7/F9) gate: 32565 pass / 0 fail.
- Side effect measured + pinned: value-attr-binding-i81 §i81.10 "parametric-snippet prop" — a snippet prop CALLED
  as `row(i)` inside a lift used to ship as a bare unbound call (a ReferenceError at load, which the test pinned as
  "parses"); it is now substituted as in plain markup, where the same call was already E-CODEGEN-INVALID-LOGIC at
  the write gate (on c4eb2c589 too). Test retargeted to assert that refusal (no artifact).
- NEW `parseScrmlTextToEstree` (expression-parser.ts): extractHandledOperands + preprocessForAcorn +
  parseExpression / parseStatements — the expression parser's own front. `substitutePropsInJsSource` parses with
  it. Because the front MOVES text, every candidate identifier token of the original is first renamed to a tag
  (`name__scrmlpropN__`), the tree is analysed with tags read back as names, and each decision is applied to the
  token in the ORIGINAL text (scrml text out, never placeholder text). A candidate the tree does not contain →
  the text is unsubstitutable (refused), never guessed.
- A non-name value landing as an `is` operand is grouped (`("L") is some`); rewrite.ts did not lower a
  parenthesized STRING-literal `is` operand (it spans three code segments) — `lowerParenthesizedStringIsOps`
  pre-pass, located on the literal-blanked text.
- `when @t changes { … }` anywhere in a component body fails the component re-parse with E-COMPONENT-021 on
  540bc7f1e and head alike (pre-existing) — the when-body (asProgram) path is covered by unit only.
- Probe f1 executed: base E-SCOPE-001 + empty output; head `true,none,true`.

## 2026-10-08 — step 4: N1 — one E-ATTR-010 per refused component bind target
- Commit 3 (F1) gate: pass (pre-commit). TAB element-form bind check (which offered a "state field path") is skipped
  on a component call site; CE owns it (one message naming `bind:n=@cell`). A refused bind prop reads `not` in the
  body (recovery: no cascading undeclared-`n` E-SCOPE-001) and is not re-judged from `_callSiteProps`. Unit: 4 forms
  -> exactly `["E-ATTR-010"]`.

## 2026-10-08 — step 5: F4 — attribute strings in a component body round-trip in every form
- Commit 4 (N1) gate: pass; the isComponent-read budget test forced folding the N1 guard into the existing read.
- Root cause (pre-CE, the component re-parse in native-parser/tag-frame.js — the component-def raw itself was
  already correct since round 3): (a) the opener scan did not honour backslash escapes in a string INSIDE an
  expression value (`${label + 'it\'s'}` -> runaway string -> "Unterminated tag"); (b) the quoted attribute-value
  reader ended the value at the first `"` even inside `${…}` (`"${label + "x"}"` -> `${label +`). New helpers
  skipCodeString / skipCodeBraces / skipQuotedAttrValue used by both. Base flip: case fails on 540bc7f1e, passes on head.
  parser-conformance + native suites 2486/0; conformance 1389/1439 + 50 xfail.

## 2026-10-08 — step 6: owner ruling — E-COMPONENT-PROP-WRITE; E-SCOPE-001 row names the unparseable-text case
- Commit 5 (F4) gate: pass. Ruling (PA relay, user-voice S458 "your recs on both D1 codes"): a body write to a prop the
  caller did not bind -> NEW E-COMPONENT-PROP-WRITE (replaces the interim E-ASSIGN-004 reuse); unparseable text
  referencing a prop keeps E-SCOPE-001, its §34 row amended. SPEC: §15.11.1 normative bullet, §15.13.2 paragraph,
  §15.11.7 summary row, §34 catalog row (+ E-SCOPE-001 row), all with the provenance line. s34-census --check-new
  PASS. SPEC-INDEX / FACTS regenerated by script (their --check failed). Pins moved: unit s458-prop-write (6),
  conformance notCodes (5 cases); NEW conformance prop-write-unbound-reject (by-value + unbound bindable, count 2).

## 2026-10-08 — step 7: merge origin/main (24922c0a1) + gates + corpus differential
- Merge: conflicts only in generated SPEC-INDEX.md / FACTS.md -> took main, regenerated by script (--check PASS).
  The merge commit was docs-only to the hook (suite skipped), so the gates were run by hand on the merged tree:
  unit+integration+conformance 30338 pass / 0 fail; browser tier 1432 pass / 48 fail = FAILURE-BASELINE name set
  (browser-baseline.ts --check PASS); conformance/run.ts 1391/1441 + 50 xfail, 0 fail (no new xfail; run after this entry was first written); s34-census --check-new PASS.
- corpus-emit-differential, base = origin/main 24922c0a1 compiler files by file copy, head = this branch, same corpus
  (the harness flags INCOMPARABLE "same revision" because the git rev is shared — expected for a file-copy flip).
  2486 sources; 1 newly failing = prop-write-unbound-reject (the new INTENDED refusal case); 10 newly passing (D1
  cases that main cannot compile); syntax-failing 0/0; server-fn call sites 868/868, bare delta 0; 7143/7190 artifacts
  byte-identical. Every one of the 47 differing artifacts classified: (a) declared-prop root/each/lift attribute leak
  removed (title/item/href/onSave listeners — rounds 1-3), (b) the global `_bindProps` mirror removed (round 3),
  (c) style/descendant-combinator-contraction-text: main emits `don"t` + `class card`, head the correct `don't` /
  `class="card"` (round-3 exprSource fix), (d) the new D1 cases themselves (main miscompiles them; head executed green).
  12 diagnostic-code deltas, all the D1 cases (E-ATTR-011 / E-SCOPE-001 / E-COMPONENT-012/020/021/035 gone). Zero
  unexplained deltas.
