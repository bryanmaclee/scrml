# progress — s468-failable-alias-and-match (append-only)

- 2026-10-17 start at /home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-aa39734923a5b0203, base 5c43c3b8e (== origin/main). bun install (puppeteer postinstall failed, non-fatal), pretest OK.

## 2026-10-17 — reproduced on origin/main 5c43c3b8e (executed, happy-dom; probe at ~/.cache/scrml-agent-tmp/s468-failable-alias-and-match/probe.mjs)
LOGIN page: `check(p)! -> AuthErr` fails `.Denied` on a wrong password; `login(p)` binds `ok` then `if (ok) LOGGED IN else rejected`; click "wrong".
Gap 1 (alias through operator / returned fn) — compiled exit 0, wrong password -> "LOGGED IN":
  `const g = p ? check : id; const ok = g(p)` · `const g = check || id` · `const g = id && check` · `const ok = getF()(p)` ·
  `const g = getF(); g(p)` · `(p ? check : id)(p)` · `let g = id; if (p != "") { g = check }; const ok = g(p)` (inner-block tilde write).
Gap 2 (match subject) — `match (p == "" || check(p))`, ternary arm, `&&` right, `??`: refused E-ERROR-002 (fail closed, as filed).
Found while tracing (same family, live miscompiles on base, accepted + LOGGED IN):
  `const g = check; const ok = match g(p) { .Denied :> false  _ :> true }` (walker accepts a direct ident call; TS stamped
  failable only by bare name `fnCanFail.has("g")`) · `if (p != "") { ok = match check(p) { … } }` and
  `[1].map((x) => match check(p) { … })[0]` (expression-position match-expr: never stamped, and the emit-expr bridge
  dropped stamps anyway) -> `_scrml_match_N === "Denied"` compared the error object as a plain value.

## Governing sentences (quoted)
- §19.4.3: "A call to a `!` function SHALL NOT be ignored. The caller MUST do one of the following: 1. **Match** the result … 3. **Catch** with `!{}` …"
- §19.4.3: "Failing to handle the result of a `!` function call in any of these ways SHALL be a compile error: **E-ERROR-002**"
- §19.4.4: "An unhandled `!` function call SHALL be a compile error (E-ERROR-002)."
- §19.4.3 "Carried impl#1 gaps (tracked in `docs/known-gaps.md`, not the language rule)": "impl#1 handles a `match` subject only when the subject IS the call: through an operator its `match` compares the error object as a plain value, so the check refuses that form (`g-match-failable-subject-through-operator-miscompiled-s467`)." — the refusal is labelled an impl gap, not the language rule; the language rule for the widened subject is §19.4.3 item 1 + the reaches-unchanged rule stated in the same paragraph.
- §14.3 "No value holds a function (E-VALUE-FUNCTION-STORED)" — why member/index reads are not judged as function values.

## Locus trace
Entry: type-system.ts visitNode -> checkFailableCallsInValuePositions -> failable-value-calls.ts forEachCallInStatement/Walker.
Gap 1 decision: Walker.expr `call` reported only `callee.kind === "ident"` resolved via resolveName (alias map filled only
for `init.kind === "ident"`, both in the Walker's recordAlias and TS-side checkFailableCallsInValuePositions). HELD (refined:
also the tilde-decl inner-block write records on the inner scope only — the "reassigned in an inner block" carried limit).
Gap 2 decision: the gap's locus says codegen; REFINED — codegen already discriminates when `__matchSubjectFailable` is set; the
decision lives in type-system.ts checkMatchDiagnostics -> resolveFailableCallResultType (direct ident call by bare name) and
the expression-position match-expr is never stamped; codegen/emit-expr.ts emitMatchExpr's bridge dropped the stamp.

## Root (judge by the value, not the spelling)
ONE judgement in failable-value-calls.ts: `failableFnValueOf` (what failable function a value may be — names, ternary, ||/??,
&& right, assign, cast, a call of a function that may RETURN one) + `failableResultCallees` (the failable calls whose result
reaches an expression unchanged). The E-ERROR-002 walk, the alias/returns recording (Walker + TS scopes), the function-returns
fixpoint (type-system `solvedFnReturnsFailable`), and the match stamp (statement match via checkMatchDiagnostics; expression
match via env.onFailableMatchSubject; emit-expr bridge forwards) all read it. A match subject is now an operand (same rule as
`!{}` / `?`); the multi-scrutinee head keeps the direct-call rule (its lowering not widened).

## Direction of change
- gap 1: newly-rejecting (E-ERROR-002 on calls through value-aliases / returned functions / inner-block writes / whole-statement alias calls).
- gap 2: newly-accepting (`match (a || check(p))` etc. — backed by §19.4.3 item 1; the refusal was a declared impl gap) +
  semantics-changed (expression-position `match check(p)` and `match g(p)` now discriminate the error: previously miscompiled).
- security-await-pack classify: before == after (PASS 249, PASS-REFUSED 136, PASS-500 20, PASS-DENY 8, UNJUDGED 1, FAIL 10); 0 changed.

## 2026-10-17 — measured + landed on branch
- Commit 5b7ca8f84 (source + tests): pre-commit gate PASS — 37136 pass / 125 skip / 13 todo / 0 fail (1588 files).
- Corpus (`scripts/corpus-emit-differential.ts`, roots examples,samples,conformance,stdlib,benchmarks; 2847 sources), base =
  `git archive origin/main` (5c43c3b8e; revision "<unknown>" to the tool, hence its INCOMPARABLE provenance finding) vs head:
  compile-failure delta 0 newly failing / 0 newly passing; diagnostic changes 0 code / 0 text; artifact set delta 0;
  167 content diffs, ALL only `const _scrml_project_root = "<checkout path>"` (verified by normalizing that line: 167/167);
  syntax delta 0; bare server-fn sites 29/29. => 0 real sites newly refused; no emitted-code change in the corpus.
  giti / flogence not present on this machine — not measured.
- Added C3 tests (server-function match through `||` discriminates; multi-scrutinee head keeps the direct-call rule).
- known-gaps: both markers flipped to status=resolved with traced locus; parent gap's "still open" note annotated;
  state.ts / facts.ts --write then --check: PASS.
- First push of 5b7ca8f84 FAILED (pre-push hook; output masked by a pipe) — re-pushed with the log captured (see below).

## 2026-10-17 — FIX ROUND 1 start (review of frozen 7ecae57eb: DO-NOT-LAND)
- Worktree /home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-ae657b908d8b68adf, branch s468-failable-alias-and-match
  checked out from origin at 7ecae57eb898fb5a6214b0c00cbf1944700ad86c (asserted). bun install (puppeteer postinstall
  failed, non-fatal) + pretest OK.
- Prior push outcome (unrecorded above): origin/s468-failable-alias-and-match == 7ecae57eb, so the re-push landed.
- Reproduced EVERY review item with the reviewer's harnesses (h2.mjs client, hs.mjs server; wrong + right password) on
  head 7ecae57eb and on base 5c43c3b8e (git archive, own copy at ~/.cache/scrml-agent-tmp/s468-failable-alias-and-match/base):
  F1 n8 (4 shapes) head LOGGED IN / base E-ERROR-002 · F2 n2 "handler inline match ||", n3 "handler ||"/"ternary" head
  LOGGED IN / base E-ERROR-002 · F3 s1 "srv match stmt ||", s2 "stmt ||"/"??"/"ternary"/… head 200 LOGGED IN / base
  E-ERROR-002 · F4 (curried, id(check), apply, IIFE fn-expr, destructure default, param default, closure write, loop
  write-after-use, map/filter/some callback) LOGGED IN on BOTH · F5 n5 "FR nested same-name getF (plain)" head
  E-ERROR-002 / base OK-correct · C: n3 "handler direct" LOGGED IN on both; s2 "stmt direct" 200 LOGGED IN on both.
- NEW (found while reproducing, same class as F1 through a NAME, cases/n9.mjs): `const g = p == "wrong" ? plainDeny : check;
  match g(p)`, `const g = plainDeny || check`, `match getF(p)(p)` (getF may return plainDeny), `match (c ? plainDeny :
  check)(p)`, `let g = check; if (…) { g = plainDeny }; match g(p)` — head LOGGED IN (the stamp marks the subject
  failable because its callee MAY be failable; a plain enum value is classified Ok). Base rejected these (but base is
  fail-open the other way: when the callee IS check, base compares the error object as a plain value). No lowering is
  correct for a subject that may or may not be a failable result.

## 2026-10-17 — FIX ROUND 1: governing sentences (quoted)
- §19.4.3: "A call to a `!` function SHALL NOT be ignored. The caller MUST do one of the following: 1. **Match** the result …"
  and "Failing to handle the result of a `!` function call in any of these ways SHALL be a compile error: **E-ERROR-002**".
  §19.4.4: "An unhandled `!` function call SHALL be a compile error (E-ERROR-002)."
  -> A (refusing operator-widened / not-provably-failable match subjects) changes no meaning: such a subject's call is
  NOT handled by impl#1's match (its lowering cannot discriminate it), so it is the E-ERROR-002 the SHALL requires — the
  same refusal base made, documented as a carried impl#1 gap in §19.4.3 ("impl#1 handles a `match` subject only when the
  subject IS the call … so the check refuses that form").
- B root (refuse a failable function READ AS A VALUE): searched §19.4 (19.4.1–19.4.5), §19.4.3 (incl. "Handler
  references", "Arrow-valued handlers", "Carried impl#1 gaps"), §14.3 (E-VALUE-FUNCTION-STORED), §13.9.6. NO governing
  sentence makes the read illegal:
  · §14.3 :11273 says the opposite for functions in general: "A function still flows PASSED (an argument, a callback, a
    component prop or attribute — wiring) and CALLED (a handler); it is never stored."
  · §13.9.6 "An async-colored function (§13.2) SHALL be bound only by a `function` declaration" is ruled for ASYNC
    functions only (S467 "b it is").
  · §19.4.3 "Handler references (S441 ruling)" makes a failable function passed as an EVENT-HANDLER reference E-ERROR-002
    — handler attributes only ("The rule applies to event-handler attributes only: a component's declared prop … is a
    callback value handed to the component").
  · §19.4.3's general SHALL governs the CALLS a passed function receives; the carried-gaps paragraph names "a failable
    function passed as a value (`items.map(risky)`)" as not yet reached. That governs reporting the call, not refusing
    the read. => STOPPED on the root refusal (ruling request below). Not invented.

## Locus trace (fix round 1)
- F1/F2/F3 root: `failable-value-calls.ts` `Walker.matchSubject` (head: `this.operand(...)`, the reaches-unchanged rule)
  + the stamp from `failableResultCallees` (statement: `type-system.ts` `checkMatchDiagnostics` via
  `failableSubjectCallees`; expression: `env.onFailableMatchSubject`). Codegen `emit-control-flow.ts`
  `isFailableOkMatch` -> every non-`__scrml_error` value is `"Ok"`. HYPOTHESIS (reviewer: "the stamp marks the whole
  subject failable, the lowering treats every non-error value as Ok") HELD. F2 refined: the operator form in a handler
  attribute was ACCEPTED by the widened walk and the handler lowering compared as a plain value (traced to the emitted
  `if (_scrml_match_6 === "Denied")`). F3 HELD (operator form accepted; the server statement lowering does not await).
- F5: `type-system.ts` `solvedFnReturnsFailable` keyed every function-decl (nested included, via `allFnDecls`) BY NAME;
  `resolveFailableReturns` fell back to it whenever the chain hit a function binding. HELD.
- NEW (n9, the F1 class through a NAME): `failableFnValueOf` is a MAY judgement (first failable leaf wins); the head
  stamped `match g(p)` from it, so `const g = c ? plainDeny : check` was stamped and `plainDeny`'s `AuthErr::Denied` read
  as `.Ok`. Same root as F1.

## Fix (rule flipped to "admit only what is provably safe")
- ONE judgement for a match subject: `provableSubjectCallees` — the subject IS a call (parens transparent) whose callee is
  PROVABLY a failable function (`exactFnValueOf`: a `!` function by name, judged by its binding; a `const`/`lin` bound
  to a provable value; a ternary BOTH of whose arms are provable; a cast; a call of a NAME every `return` of which is
  provable, with no unreadable body text). `Walker.matchSubject`: a provable call is handled; a call whose callee MAY be
  failable but is not provable is reported (E-ERROR-002 with a match-specific message); anything else (an operator) is a
  value position — as on base. The same judgement is the only thing that stamps (`checkMatchDiagnostics`,
  `onFailableMatchSubject`), and a stamp is applied only when the error enum resolves (base rule; head had stamped
  `__matchSubjectFailable` without variants).
- Provable facts recorded only for bindings never written again (const/lin) — Walker `LocalScope.exact/exactReturns`, TS
  `failableExactByScope/failableExactReturnsByScope`. A name a function body declares LATER than the current point is
  not provable (`declaredAheadByScope`).
- F5: function declarations are judged BY BINDING. `fnDeclsByScope` (a function body's direct declarations registered
  when its scope is pushed — hoisted; block-level ones when bound; top-level ones on first use), `declReturnFacts(decl,
  root)` walks the body with every free name resolved from the scope that holds the declaration (memoized per decl,
  keyed on the visible bindings + a facts generation; a recursive reference reads "nothing" and is not memoized). The
  by-name fixpoint is gone. `resolveFnBinding` is the one chain walk behind fnFactsIs / IsExact / Returns / ReturnsExact.
- multi-scrutinee head: unchanged (base rule) — executed: its lowering reads each value's own variant, so a mixed alias
  rejects correctly (n9 "multi mixed alias" PASS on base, head and fix).

## Direction of change (fix round 1, relative to BASE 5c43c3b8e)
- operator-widened subjects: inert vs base (refused on base, refused again).
- newly-rejecting vs base: a `match` subject whose callee MAY be a plain function (`const g = c ? plain : check; match
  g(p)`, `let g = check; …; match g(p)`, a returned function that may be plain, the same-name-shadow case where a local
  plain function shares a failable function's name). Base accepted these and miscompiled one branch.
- semantics-changed vs base (kept from the first pass, review-confirmed): a provably-failable subject in an expression
  position (in a block, an arrow, `.map`, an `if`/`while` condition, markup) and through `const g = check` / `getF()`
  now discriminates the error (base: accepted, LOGGED IN).
- the alias half (E-ERROR-002 through modelled value flows): newly-rejecting vs base, unchanged from the first pass
  except F5 (a false refusal removed).

## RULING REQUEST (STOPPED — B root refusal; not implemented)
Question: may a FAILABLE function be read as a VALUE (outside callee position)?
Evidence: 21 shapes in `compiler/tests/integration/security-failable-pack/known-fail.js` (`VALUE`) log in on a wrong
password on base AND this branch: `apply(check)`, `((f) => f(p))(check)`, `[p].map(check)` / `filter` / `some`,
`id(check)(p)`, `const g = id(check)`, curried `mk()()(p)`, `apply2(getF)(p)`, a function-expression IIFE, a
destructuring default `const { g = check } = {}`, a parameter default `function t(p, f = check)`, a closure write, a
write after use in a loop. The check follows a CLOSED set of value flows (`failableFnValueOf`); each round of review
finds a new one — the S467 await (10 rounds) / CPS (5 rounds) signature. No SPEC sentence governs the read (see
"governing sentences" above; §14.3 explicitly allows a function to flow PASSED).
Options:
  (a) RECOMMENDED — the §13.9.6 analogue for failable functions: "A failable function SHALL be referenced only in
      callee position, by a `const` alias of it (`const g = check`), or where the SPEC requires one (`<formFor
      onsubmit=…>`, §41.14.3)." Every other read is E-ERROR-002 (or a new code). Fail closed by construction: a failable
      function can only reach a call through a modelled alias, so the may-judgement becomes complete instead of
      shape-chasing; the returned-function / ternary-alias machinery could then be retired. Handler references are
      already E-ERROR-002 (S441). Component callback props (`<Btn onSave=risky/>`, legal today per S441's last
      sentence) would need a carve-out or a migration — decide with the ruling.
  (b) failable-ness as part of the function's TYPE, propagated through parameters / returns / bindings (the S467 F4
      ruling rejected the analogous "(a) async-as-part-of-the-function-type propagation" for async).
  (c) leave it: document the carried gap (status quo; 21 known live wrong-password shapes, all contrived, 0 corpus sites).
Measured corpus (text scan of every `function NAME(…)!` declaration and every non-callee read of NAME, reviewed by hand;
script `~/.cache/scrml-agent-tmp/s468-failable-alias-and-match/scripts/fnvalue-reads.mjs`): examples/ samples/ stdlib/
benchmarks/ (2847 .scrml, 136 files declare 172 failable functions) + giti (82 .scrml) + flogence (31 .scrml):
  · examples / samples / stdlib / benchmarks: **0** value reads (stdlib hits were doc comments / an object key).
  · giti / flogence: **0** (neither declares a `!` function).
  · conformance/cases: 12 real reads — 6× `<formFor onsubmit=persistSignup/>` (SPEC-REQUIRED failable value, §41.14.3:
    must be exempt under (a)); 3× event-handler references in `handler-failable-reference-pos` (already E-ERROR-002);
    3× component callback prop `onSave=risky` (`handler-failable-reference-component-prop-neg` ×2 — legal today,
    `…-via-component-prop-pos` ×1 — already E-ERROR-002 at the call site). The other 4 hits were false positives
    (button text `>b<`, an `<each … as risky>` alias).
  => under (a) with the formFor carve-out: 0 real (non-test-fixture) sites newly refused; 2 conformance -neg fixtures
     (component callback props) would flip unless props are carved out too.

## 2026-10-17 — S469 resume (fix round 1, agent 2) at /home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-a801c016b9425741f
- Branch `s469-failable-r1` from origin/s468-failable-alias-and-match 623e69f8b. The dead agent's uncommitted round
  brought over with `git apply` of scrml-support/handOffs/s468-wip-patches/s468-failable-alias-and-match/uncommitted.diff;
  every file verified byte-identical (cmp / diff -r) to the old worktree agent-ae657b908d8b68adf.

## 2026-10-17 — THE HANG (found, root-caused, fixed)
- Symptom: the pre-commit gate ran 49 min / ~24 GB RSS (three attempts, commit2-4.log, all stalled at the same point).
- Located by running all 1589 gate files one per process (180 s / 3 GB cap): ONE file over the limit —
  `compiler/tests/integration/bootstrap-conformance-counter/bootstrap-conformance-counter.test.js` (its beforeAll compiles the
  bootstrap's slice-M2 bundle with impl#1). Bisected: `compiler/self-host-v2/link.scrml` alone hangs; it imports `parse.scrml`,
  which hangs alone (236 mutually recursive `fn`s — a recursive-descent parser).
- INPUT SHAPE: a cyclic call graph where function bodies BIND calls of each other (`const v = pJ(k - 1)` in every `pI`).
  Minimal: N `fn`s each binding a call of every other — old code n=4 0.15 s, n=5 0.24 s, n=6 1.0 s, n=7 16.4 s (factorial).
- ROOT CAUSE: `type-system.ts` `declReturnFacts` (new in this round, F5 by-binding returns). Every binding initializer that is a
  call asks what the callee RETURNS (`failableBindingFacts` -> `lk.returns`), which walks the callee's whole body, whose
  bindings ask again. Re-entry was blocked only along the CURRENT path (`declFactsInProgress`), and a result computed through a
  cycle was never memoized — not even for the rest of the same query — so one query re-walked every simple path of the call
  graph. (The memo key `bindings-size:facts-generation` also invalidates on every recorded fact, so cross-query reuse is rare.)
- FIX (root, not the test): a per-top-level-query cache `declFactsQuery` — each declaration evaluated at most once per query;
  reading a cycle-dependent entry marks the reader cycle-dependent (so it is still not memoized beyond the query); the query's
  ROOT is memoized once it completes (nothing is in progress then). Soundness: DFS reachability — a cycle-dependent result lacks
  only what flows through a declaration still in progress, and that declaration's own evaluation adds it. `exact` stays
  fail-closed (a cycle read is "nothing" = not provable).
- After: n=12 0.2 s; link.scrml 1.6 s; the full M2 bundle 9.2 s / 1007 MB (origin/main 8.9 s / 769 MB);
  bootstrap-conformance-counter.test.js 30 s, passes. Regression tests: failable-alias-and-match-s468 section E (14-fn graph
  bounded; failable reachable only through a cycle still E-ERROR-002; a cycle never makes a match subject provable). The first
  E test hangs (killed at 60 s) on the pre-fix type-system.ts.

## 2026-10-17 — commits ce2dad109 (WIP brought over; gate 37358 pass / 0 fail) + 5e9981149 (hang fix; gate 37358 / 0)
- First push of s469-failable-r1 (new ref) blocked by the pre-push generated-doc gate: docs/FACTS.md facts-table STALE
  (line counts). Regenerate after the last content commit.

## 2026-10-17 — imported-failable P0 (g-imported-failable-function-never-checked; S468 hand-off: "imported failable unchecked
   (added to the #1444 round)")
- Governing: §19.4.3 "A call to a `!` function SHALL NOT be ignored"; §19.4.4 "An unhandled `!` function call SHALL be a
  compile error (E-ERROR-002)" — not limited to the calling file's declarations.
- Reproduced on HEAD 5e9981149 (executed, happy-dom): `import { check, AuthErr } from "./lib.scrml"` + `const ok = check(p)`
  -> compiles, wrong password LOGGED IN; `match check(p) { .Denied :> false  _ :> true }` -> compiles, LOGGED IN (unstamped).
- Locus: type-system.ts fnCanFail / fnErrorTypes from this file's function-decls only. HELD.
- Fix: imported decls (api.js importedFnDeclsByFile — renames + re-exports) declared `!` or CPS-split by the route map ->
  fnCanFail (+ fnCpsImplicitFailable). Error enum resolved in the exporting file's scope (resolveImportedFnSignatures ->
  FnSignature.errorEnum); registered in fnErrorTypes only when the importer's registry holds the same enum by name
  (sameEnumShape). Otherwise `importedFailableUnreadableErr`: still failable, but not a provable match subject -> E-ERROR-002
  with its own message (fail closed); `!{}` / `?` handle it.
- Direction: newly-rejecting. Corpus: text scan of every `import {…} from "…scrml"` against `function NAME(…)!` in the
  target: examples/ samples/ conformance/ stdlib/ benchmarks/ compiler/self-host-v2 (2912 files, 259 .scrml import lines)
  + giti + flogence (113 files): **0** sites import a failable function -> 0 newly refused.
- Tests: compiler/tests/unit/failable-imported-s469.test.js (16): 10 fail on HEAD's type-system.ts, all pass after.
- Not covered (named in the gap entry): an imported function's RETURNED facts (`import { getF }` + `getF()(p)`, the VALUE
  class); a render-time call inside `<errorBoundary>` (imprepro imp/imp3: accepted by the rule, still LOGGED IN at run time —
  g-errorboundary-runtime-does-not-catch-returned-error-value-s467, open, separate PR).

## 2026-10-17 — commit 181012c20 (imported failable; gate 37374 pass / 0 fail)

## 2026-10-17 — F3 server statement match unawaited + F2 handler-attribute match (the two direct-form HIGH gaps the
   WIP had filed open — FAIL-CLOSED direction: a wrong-password path left open is not "handled")
- SERVER_STMT locus: codegen/emit-control-flow.ts emitMatchInline `_matchCtx` lacked the async facts the `if` hop's
  `_ifExprCtx` carries (serverFnNames, peer aliases/dispatch objs, syncPeerCalls, hostAsyncFacts). HELD (emitted
  `const _scrml_match_3 = check(p);`). Fix: forward them. Now `await check(p)`; s2 direct shapes PASS. Value-IIFE lowering
  (emitMatchExpr's ctx, :3163) deliberately NOT changed: an `await` there would sit in a sync IIFE.
- HANDLER locus: TWO READERS. TS checks a one-statement handler value on a check-only re-parse
  (`parseHandlerStatementsForCheck`) -> stamps on a copy; codegen lowers value.exprNode (handlerExprNode) or re-reads TEXT
  (`@cell = …` string path in emit-event-wiring Case C; emit-each `buildEachExprHandlerBody`). Probe (new pack family n11, 7
  value forms × top/each/component/if): 14 of 28 LOGGED IN on 181012c20 — wider than the one n3 shape.
- Fix: (1) TS also walks value.exprNode with the provable-subject judgement (stamps only, reports discarded);
  (2) emit-event-wiring: an assign carrying the stamp takes the structured emitExprField path (`hasFailableMatchStamp`,
  emit-control-flow.ts); (3) emit-each: such a row value is lowered from a structuredClone of its node with
  rewriteEachScopeInExprNode (as the statement-list path); (4) FAIL CLOSED in TS: copy stamped but own tree not (component
  body one-statement value — codegen synthesizes its node later; block-bodied arrow) -> E-ERROR-002.
- Pack: 188 -> 226 shapes (n11 28, n12 10 imported multi-file; pack.js loads extra files' client chunks). 181012c20: FAIL 38;
  now FAIL 21 (= the VALUE class only). known-fail.js HANDLER / SERVER_STMT entries deleted; README tables.
- Direction: semantics-changed (one-statement handler `match` on a failable now discriminates; server statement match now
  awaits) + newly-rejecting (component-body one-statement handler match on a failable; block-bodied arrow handler match on a
  failable — the latter was E-CODEGEN-INVALID-LOGIC before, so only the code changes). Corpus: one handler-attribute match in
  the corpus + adopters (non-failable subject).
- Corpus emit differential (scripts/corpus-emit-differential.ts; base = `git archive HEAD` 181012c20, head = working tree;
  roots examples,samples,conformance,stdlib,benchmarks; 2847 sources, 8578 artifacts): compile-failure delta 0/0,
  diagnostic changes 0 code / 0 text, artifact set delta 0, syntax delta 0, bare server-fn sites 29/29. 167 content diffs,
  ALL only `const _scrml_project_root = "<checkout path>"` (normalized: 0 real). The tool's "NOT A VALID COMPARISON"
  verdict is its provenance check (an archived tree has no revision), as in the first pass.
