# s467-error-002-value-position progress (append-only)

- 2026-10-15T03:38:11-06:00 start at /home/bryan/scrmlMaster/scrml/.claude/worktrees/agent-a3dcf79bcce8185ad; base c782dd8b0. bun install + pretest OK.

- 2026-10-15 — LOCUS: hypothesis "type-system.ts E-ERROR-002 checker treats only whole-statement calls" HELD, refined:
  there are TWO whole-statement sites (function-body §19 walker `visitStmt` k==="bare-expr", and visitNode's
  `checkUnhandledFailableBareCall`, which also serves handler values). Neither reads a call nested in a value.
  FIX shape: one structural rule — new `compiler/src/failable-value-calls.ts` (`forEachCallInValuePosition`:
  every ident-callee call in an ExprNode tree except the inline-match subject + a caller-declared handled root)
  + `checkFailableCallsInValuePositions(n)` in visitNode (live scope chain → shadowing resolved), reading each
  logic statement's own ExprNode fields (census of corpus keys: exprNode/initExpr/condExpr/iterExpr/headerExpr/
  scrutineeExprs/resultExpr/propagateOperandExpr/valueExpr/argExprs/defaultExpr).
- SPEC read §19.4–§19.5 in full by offset. Sentences relied on:
  - §19.4.3 "Failing to handle the result of a `!` function call in any of these ways SHALL be a compile error: E-ERROR-002"
  - §19.4.4 "An unhandled `!` function call SHALL be a compile error (E-ERROR-002)."
  - §19.4.3 item 5 "the call that is the right-hand side of the body's single `@var = expr` assignment is handled by the request"
  - §19.6.6 "Within an `<errorBoundary>`, a RENDER-time call to a `!` function without explicit match/propagation SHALL NOT trigger E-ERROR-002"
  - §19.5.4 "`?` SHALL be valid only inside a `!` function body." — §19.5 says NOTHING about `return f()` in a `!` function
    being handled; §19.4.3's list is exhaustive ("in any of these ways"), so `return f()` inside a `!` fn is
    unhandled by the letter and is reported (remedy `const v = f()?; return v`). Measured separately below.
  - §19.9.10 "impl#1 does not implement it" (g-impl1-client-server-call-not-failable-s451): callee classes kept
    exactly as the statement check: declared-! → E-ERROR-002; CPS-split non-! → W-CPS-NEEDS-FAILABLE (not when
    enclosing fn is !); plain server fn → not failable on impl#1 (unchanged).
- Env note: pre-commit hook needs node>=22 (local node 21.6 fails foreign-sealed-scope "under Node" test);
  using a scratch node22 on PATH for commits. Hook also flaked twice on s457 "D — run it" (passes alone) — investigating.
- NEXT: wire is in; measure corpus base vs head; unit tests; SPEC + known-gaps.

## PAUSED (S467)

NOT COMMITTED. The pre-commit hook runs the full suite on the working tree, and with the fix wired in that suite is
red until the fixtures are migrated. --no-verify is not allowed, so nothing was committed or pushed past base
c782dd8b0. The whole working tree (staged) is saved as a patch OUTSIDE the repo:
  /home/bryan/.cache/scrml-agent-tmp/s467-error-002-value-position/s467-wip.patch  (782 lines; `git apply` on c782dd8b0)

DONE (in the working tree / patch):
- compiler/src/failable-value-calls.ts (NEW): `forEachCallInValuePosition(root, rootHandled, cb)`. It finds every call
  with an identifier callee in an ExprNode tree. It skips the subject of an inline match and a root the caller marks
  as handled. It tracks lambda parameters (they shadow) and walks template interpolations through the parser, with
  no regex.
- compiler/src/expression-parser.ts: refactored `walkTemplateInterpolations` and exported `templateInterpolationNodes(lit)`.
- compiler/src/type-system.ts:
  - added `failableFnStack` and `requestBodyDepth` (both push/pop in the function-decl and markup `<request>` cases);
  - added constants VALUE_POSITION_STMT_KINDS / EXPR_NODE_KINDS / STATEMENT_CHILD_KEYS / HANDLED_OPERAND_KEYS;
  - added `checkFailableCallsInValuePositions(n)`, called at the top of visitNode before the switch. It uses the live
    scope chain, so shadowing resolves. Callee classes are the same as the statement check: explicitly `!` → E-ERROR-002;
    a CPS-split server function that is not `!` → W-CPS-NEEDS-FAILABLE (none if the enclosing function is `!` or this
    is a handler); a deferred call → E-DEFER-UNHANDLED-FAILABLE.
- compiler/tests/unit/e-error-002-value-position-s467.test.js (NEW): 37 tests, all passing, including the executed
  wrong-password repro. With `!{ .Denied :> false }`, the wrong password gives "rejected" and the right one gives
  "LOGGED IN". Without a handler, the repro gives E-ERROR-002.
- compiler/tests/unit/reactive-array-mutation-multi-arg-s461.test.js: added an afterAll unregister. This is a
  pre-existing bug on main: s461 left happy-dom registered for the rest of the single bun process, happy-dom drops
  the `Cookie` request header, and s457-string-url-executable-schemes "D — run it" then got 403. I reproduced it on
  base: `bun test compiler/tests/unit` fails 1 on c782dd8b0. The fix is verified on the pair.
- Environment: the hook needs node>=22. A scratch node22 is at ~/.cache/scrml-agent-tmp/node22/node_modules/node-linux-x64/bin;
  commit with PATH=<that>:$PATH.

HALF-DONE:
- The first full-suite run with the fix (no --bail) was still running at pause. 13 failures so far, which are fixtures
  that relied on the gap or possible false positives, each still to be judged:
  - "Bug 18 — scrml:NAME client imports…" (6 tests)
  - "review F1 — a failable ParseError subject beside an IMPORTED enum…" (4 tests)
  - "review F3 + the unit-`Ok` enum…" (3 tests)
  Log: ~/.cache/scrml-agent-tmp/s467-error-002-value-position/gate1.log
- Corpus measurement: the base side is not run yet. The harness is ~/.cache/scrml-agent-tmp/s467-error-002-value-position/measure.mjs,
  and the base tree is extracted at .../base (git archive of c782dd8b0 with node_modules symlinked).

NEXT 3 STEPS:
1. `git apply` the patch if needed, then finish the full suite. For each failing fixture, decide: is it a real unhandled
   value-position call (migrate it with `!{}`/match/`?` and list it) or a false positive (fix the rule)? Note that
   ParseError/parseVariant calls are failable via fnCanFail. Then commit (hook green) and push to
   origin s467-error-002-value-position.
2. Measure base against head: run `bun measure.mjs <base|worktree> <out.json> examples samples conformance/cases stdlib`,
   plus ../giti and ../flogence (put the paths in a file or variable, because the "giti" path trips the worktree guard).
   Diff the E-ERROR-002 counts per file. If any newly refused file is outside the fixtures, stop and report the list.
3. SPEC §19.4.3 "Carried impl#1 gaps" (~line 19232): remove the value-position sentence and keep these residuals:
   block-bodied arrow (escape hatch); inline expression `match` with rawArms; attribute-value expressions; call-ref
   handler args; `!{}` arm bodies; arms of a match with an asIs subject. Add a Provenance line, add the known-gaps
   entry g-unhandled-failable-call-in-value-position-s467 (sev=HIGH, locus=, prov=), then run the remaining gates
   (types:check, bootstrap, commands+lsp, facts, state, spec-index).

## RESUMED (S467, worktree agent-ad788bfdee5d3b1d2, base origin/main 9d7a6cc2a)

- s461 happy-dom fix committed alone (216496762; PR branch s467-test-happydom-unregister was not on origin).
- Patch applied clean; the 15 failures of the no-bail run judged:
  - s454 §4 / §6 (2) — FALSE POSITIVE: an expression-position `!{}` lowers to the guard sentinel
    `<operand>.__GUARD__("!{…}")`; the walker now treats the operand (its postfix chain) as handled
    (`guardCallArmsRaw`), and a statement-level `!{}` root uses the same chain rule ("guard-operand").
  - bug-18 (6) — FIXTURE relied on the gap: `@msg = load()` with `load` declared `! string`. Migrated to
    a named function holding `@msg = load() !{ _ :> "" }`, called from `on mount`. The same handler written
    directly inside `on mount { }` is refused on main by CG (E-SERVER-FN-IN-SYNC-CALLBACK; even the
    statement form `load() !{…}` there gets E-ERROR-002 too) — pre-existing, separate, NOT fixed here.
  - imported-enum F1 (4) — FIXTURE: `const v = parseVariant(raw, LR)` inside a `!` fn, no `?` → `?`.
  - imported-enum F3 (3) — FIXTURE: `show(safeDiv(10, b))` (an unhandled `!` result as an argument);
    the raw value now reaches `show` from the host side (safeDiv/show exported).
- Measured base 9d7a6cc2a vs fix over examples/ samples/ conformance/cases/ stdlib/ giti flogence
  (2951 files): 0 newly refused; net E-ERROR-002 delta 0; one added W-CPS-NEEDS-FAILABLE in
  samples/gauntlet-r13/htmx-forms.scrml (already refused for other codes). `return f()` in a `!` fn: 0 sites.
- Note: the whole-statement `check(p)` reports E-ERROR-002 twice on main (two whole-statement sites) — pre-existing.
- SPEC §19.4.3 carried-gaps paragraph updated + Provenance; gap g-unhandled-failable-call-in-value-position-s467
  filed status=narrowed (residuals listed).

## Fix round 2 (S467, worktree agent-aaaf90c53239473db, branch tip e1c20986e; base origin/main 179f9b346)

S239 review of e1c20986e -> FIX. Harness ~/.cache/scrml-review-s467-e002/h.mjs (a c d e).

- F1+F4 — ONE rule for "handled" (failable-value-calls.ts `Walker.operand`): a call is handled by a
  `!{}` / `?` only when its VALUE REACHES the handler unchanged — parens, an operand `||` / `??` return
  as-is (both sides), the RIGHT operand of `&&`, a ternary arm. Member access / argument / coercing
  operator / the LEFT of `&&` = value position. `check(p).toString() !{…}` (and .constructor, ["variant"],
  paren chain, .ok, .valueOf) now E-ERROR-002; `p != "" && check(p) !{…}` compiles and rejects (executed).
  `match` subject is narrower (direct call only, `matchSubject`): executed — impl#1's match on
  `(p == "" || check(p))` emits `_scrml_match_N === "Denied"` and logs in on base AND branch. Gap filed
  g-match-failable-subject-through-operator-miscompiled-s467. `?` through `||` / ternary executed OK.
- F2 — the walk reaches every expression container (`forEachCallInStatement` + a statement walker):
  function bodies written as values (lambda expr/block bodies; FunctionExpression / ArrowFunctionExpression
  escape hatches — `bodyRaw` parsed with defer-structure.ts `parseStatementText`, the front-end), parameter
  defaults (function-decl string defaults via parseExprToNode; lambda defaults), on mount / on dismount,
  when-changes / when-message / onchange bodies, `!{}` arm values + block bodies (statement and
  expression-position via parseGuardArmsFromRaw), raw inline-match arms (textBodiesOf), C-style for
  init/test/update (cStyleParts), non-handler markup attribute values (call-ref + expr), aliases
  (`const g = check` — per-scope alias map in type-system `resolveFailableCallee`; local alias map in the
  statement walker). g-when-changes-body-failable-call-unchecked resolved by this.
- F3 — boundary carve-out is render-time only: candidates inside a function written in the statement,
  `_onMountEffect` bodies, effect bodies and handlers are never exempt.
  Runtime defect filed: g-errorboundary-runtime-does-not-catch-returned-error-value-s467 (HIGH).
- F5 — `o.v = check(p) !{…}` stays refused; gap g-member-assign-guard-emitted-after-assign-s467.
- F6 — E-ERROR-002 deduped after annotateNodes (same code/span/message): the markup-interp double and
  the whole-statement-in-function double are both gone.
- Round-1 pre-existing items filed: g-onmount-guarded-failable-call-refused-s467 (server → E-SERVER-FN-
  IN-SYNC-CALLBACK, client → E-CODEGEN-INVALID-LOGIC; reproduced on 179f9b346), g-hook-flakes-under-load-s467.
- Harness after: every wrong-password case refused or rejecting except `${ const ok = check() }` inside a
  boundary (SPEC-legal; the runtime gap above).
- Corpus base 179f9b346 vs fix (2951 files): 0 newly refused; net E-ERROR-002 delta 0; the one
  W-CPS-NEEDS-FAILABLE added in samples/gauntlet-r13/htmx-forms.scrml is the round-1 one (already refused).
- Still not reached (SPEC + gap): unparseable text bodies (skipped); a binding reassigned to a failable fn
  in an inner block; a failable fn passed as a value (`items.map(check)`). Handler-call arguments (`onclick=f(check(p))`, every form) added late in round 2.
