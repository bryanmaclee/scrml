- 2026-10-09T14:54:45-06:00 start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a52c99d3b87cb5d14; brief fetched
- 2026-10-09T15:04:31-06:00 is-given gaps closed: ast-builder collectExpr given-after-is; rewrite.ts string fallback; unquoted-attr-value is given; parity test
- 2026-10-09T15:33:40-06:00 validator is-given/is-some parse; W-IS-SOME-DEPRECATED lint (token sink + confirm + TAB emit); hints steer to is given; tests
- 2026-10-09T15:48:44-06:00 fix-is-some rule + registration; corpus migrated (stdlib/examples/samples/conformance/dashboard/docs snippets/self-host-v2; 4 deliberate is-some samples kept); README/tutorial mirrors; SPEC §42/§55/§34/§63.7 + examples; bootstrap is-some parse + W twin; conformance cases x4; SPEC-INDEX/FACTS/bootstrap-conformance/severity regen; known-gaps 2 resolved; inert proof 54/54 units identical (53 byte-identical, 1 after fold) + analyze/parse verified via rule
- 2026-10-09T16:06:24-06:00 addendum Q6 'a': home.scrml:254 + loads.scrml:241 if=(l.weight_lbs) -> if=(l.weight_lbs is given && l.weight_lbs > 0); project compile: same diags, only the two if-conditions differ in client JS; bootstrap front end accepts the form (0 diags)

## FIX ROUND 1 brief

FIX ROUND for s462-is-some-deprecate — the S239 differential review of 3d0b10b7d is FIX-FIRST. Append this message verbatim to docs/changes/s462-is-some-deprecate/progress.md (as "FIX ROUND 1 brief") and commit, then fix on your branch (worktree-agent-a52c99d3b87cb5d14). Same process rules as before (F4 paths, no stash, no pattern pkill, no --no-verify, commit each fix).

F1 (MED, PA-REPRODUCED — silent statement drop, exit 0): the collectExpr `given`-after-`is` continuation fires on a MEMBER access `.is`. Cause per reviewer: `compiler/src/ast-builder.js:6234` (`_isExprAfterRhs = tok.text === "given" && _lastPart === "is"`) and its twin ~:7082 — neither checks that `is` is the operator, not a property name after `.`/`?.`. Repro (PA ran it: main emits the guard, your HEAD emits 0 guards):
```
<program>
<n>: number = 0
${
    function f(o) {
        @n = o.is
        given o :> { @n = 5 }
    }
}
<p onclick=f({is: 1})>${@n}</p>
</program>
```
Also `const k = o.is` newline `given k :> {…}`, and `q = o.is` in a function with a local. Fix structurally: the continuation applies only when `is` is the infix operator (preceding part is not `.` / `?.`, and `is` is not itself a member name / object key). Look for any other shape where `is` is an identifier (e.g. `{ is: 1 }` object key at line end, a local named `is`?) and cover them. Unit tests for each.

F2 (MED): the new `is given` validator scan (`ast-builder.js:~10065-10088`) builds `{name:"is given", args:null}` and consumes two tokens, so the inline-message form `<nick is given("need nick")>` (and `is some("…")`) in a compound/top level is not read as a declaration — the cell vanishes (E-UNQUOTED-DISPLAY-TEXT / E-MARKUP-001 / E-SCOPE-001). The catalog declares arity "0+inline" and `<nick req("need nick")>` works; and the E-VALIDATOR-INLINE-COLON message for `is given: "…"` tells users to write exactly the broken paren form. Make `is given("msg")` / `is some("msg")` parse with the inline message exactly like `req("msg")` (§55.5/§55.10), runtime message resolution included. Conformance case + unit test.

F3 (LOW): (a) `is some` inside a template-literal interpolation in logic (`` const t = `v ${v is some ? 1 : 2}` ``) lowers correctly but gets NO W-IS-SOME-DEPRECATED and `scrml fix` misses it — make the locator see it (or, if it truly cannot without a second reader, file a gap with locus and say why). (b) `given` is missing from keyword-exclusion lists: `compiler/src/meta-allow-list.ts:~467` `JS_RESERVED_WORDS` (has `is`, `some`, not `given` → misleading E-META-001 "'given' is not available inside ^{} meta blocks" for `x is given` in `^{}`), `route-inference.ts:~4529`, `codegen/scheduling.ts:~870`. Add `given` consistently; verify `x is given` in `^{}` now gets the same diagnostic as `x is some` there. (Don't make `is given` legal inside meta — just consistent.)

F4 (LOW, docs): unquoted `<p if=@u is given>` was exit 0 with the test silently dropped at BASE and is now E-ATTR-UNQUOTED-OPERATOR (same as `is some`). Correct, but it is newly-rejecting — say so in progress.md and in the SPEC provenance/direction note (it is a conformance restoration toward `is some`'s existing behaviour), and measure: corpus count of unquoted `if=… is given` sites (expected 0).

F5 (LOW nit): `<mid: string is some>` (typed compound field) gets the expression lint message instead of the validator message — fix the kind selection if cheap.

Report: new FINAL_SHA, per-finding disposition with the proof (repro before/after), tests + gates re-run (pre-commit, conformance, browser-tier, types:check, bootstrap slices).

Address this before completing your current task.
- 2026-10-09T16:50:30-06:00 F1: givenContinuesIsOperator — token-stream check (is = infix operator after an operand; not .is/?.is/key); tests is-given-member-is-s462
- 2026-10-09T17:07:40-06:00 F2: is given("msg")/is some("msg") read via shared collectValidatorCallArgs; unit test + conformance forms/is-given-validator-inline-message; regen bootstrap-conformance + FACTS
- 2026-10-09T17:25:31-06:00 F3a template-literal + ^{} meta sites; F3b given in meta-allow-list JS_RESERVED_WORDS + route-inference (scheduling.ts list is SQL keywords — not applicable); F4 SPEC §42.2.4 direction note (newly-rejecting unquoted if=@u is given -> E-ATTR-UNQUOTED-OPERATOR, conformance restoration toward is some); corpus count unquoted if=…is given = 0 (1 unquoted is some, in docs/changes repro, already rejected at base); F5 typed-opener validator message; gap filed g-typed-opener-validators-drop-the-declaration-s462
- 2026-10-09T17:47:38-06:00 cost gate: a build does no is-some site work unless its text holds is\s+some (validate-emit trucking test had timed out at 34s under load avg 32; re-measured within noise of main; test passes alone 25.6s)

## FIX ROUND 2 brief

FIX ROUND 2 for s462-is-some-deprecate — re-review of 6fbbff738 = FIX-FIRST on one NEW HIGH. Append this message verbatim to progress.md ("FIX ROUND 2 brief") and commit; same process rules. Do NOT merge origin/main yet.

NEW-1 (HIGH, PA-REPRODUCED on 6fbbff738: exit 0, the `g(1)` call absent from client JS): an end-of-line `x is given` swallows the NEXT statement when that line starts with an identifier. Repro:
```
<program>
<x>: string = "a"
<o>: bool = false
<k>: number = 0
${
    function g(v) { @k = 1 }
    function f(a) {
        @o = a is given
        g(1)
        let z = a is given
        console.log(z)
        if (a is given) { g(2) }
        return z
    }
}
<p>${f(@x)} ${@o} ${@k}</p>
</program>
```
`g(1)` and `console.log(z)` vanish; the `is some` spelling keeps both. BASE was E-SYNTAX-045 here, so your change turned an error into a silent statement drop. Reviewer's cause (verify): the ASI newline boundary in both collectors in ast-builder.js (the `endsValue` / `startsStmt` check next to the two `givenContinuesIsOperator()` call sites, ~:6289 / ~:7137) — `endsValue` doesn't treat the `given` of `is given` as ending a value (KEYWORD outside VALUE_KW), so no break and the next line joins the expression; the expression parser then drops trailing content. Fix structurally: the `given` accepted by `givenContinuesIsOperator` ENDS A VALUE in both ASI checks. Tests per collector: a call line, a `console.log` line, an `@cell =` line, a `let` line, and `return` after `x is given`; also the `^{}` meta case (`const has = x is given` then `emit(…)` must give the same diagnostic shape as `is some`). Then sweep: any OTHER keyword that can end an expression and is outside VALUE_KW (`not` is already a value? check) — report.
Re-check the §42.2.4 SPEC sentence "impl#1 parses and lowers `is given` exactly as `is some` in every position" is TRUE after the fix (prove with a both-spellings differential over a battery of positions incl. end-of-line + next statement).

ALSO (LOW): (a) a comment between `is` and `some` (`is /* c */ some`, `is // c⏎ some`) hides the deprecated spelling from the lint + fix — either make the confirmation skip comments (structurally, from tokens) or file a gap; prefer the fix. (b) file a known-gap (pre-existing, both spellings): a LITERAL operand (`"s" is some`, `` `t` is some ``) lowers to just the literal — the test is dropped. (c) conformance `forms/is-given-validator-inline-message` never exercises `is given`'s own message — add a `not`-valued case so its message renders.

Report: new FINAL_SHA, before/after for NEW-1 + each item, gates re-run (pre-commit, conformance, browser-tier, types:check, bootstrap slices).

Address this before completing your current task.
- 2026-10-09T18:43:38-06:00 ROUND 2: NEW-1 fixed (endsPresenceGiven in both collectors' ASI checks + same-line check; collectLiftExpr VALUE_KW gains not; same-line `is some g(1)` now E-STMT-MISSING-SEMICOLON for both spellings — was a silent drop for is some = newly-rejecting, measured 0 corpus); (a) comment between is/some: locator skips COMMENT/comment BLOCK_REF, confirm via token isStart + trivia check, gate regex allows comments; (b) gaps filed g-is-presence-literal-operand-drops-the-test-s462, g-is-presence-in-mixed-text-attr-template-codegen-invalid-s462; (c) conformance forms/is-given-validator-absent-message
- 2026-10-09T19:41:11-06:00 LANDING PREP (re-review #3 = LAND-WITH-NITS). DEFERRED (separate doc pass, not this landing): docs/website/** pages and example/source COMMENTS still teach `is some` (prose and comments are not code sites; the fix rule correctly leaves them).
- 2026-10-09T20:32:28-06:00 CI fix: §34.0 provenance notes on E-EQ-005 (§34+§45.7) and W-IS-SOME-DEPRECATED rows (s34-census --check-new --base 980cb3001 PASS); is-some moved after sql-failable in IMPL1_SAFE_RULES / S66_RULES / fixS66 chain (client-server-call stays right after arm-pipe); fix-s66.test stable list updated; tracking tier (integration+lsp+commands) 5630 pass 0 fail
