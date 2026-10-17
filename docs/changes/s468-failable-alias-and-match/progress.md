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
