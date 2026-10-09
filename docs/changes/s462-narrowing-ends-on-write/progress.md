2026-10-09T15:18:36-06:00 start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-afa1a44af8bd50417
2026-10-09T15:31:18-06:00 SPEC §42.3.5/§42.6/§42.7/§34 sentence landed; base measurement running
2026-10-09T15:41:08-06:00 impl#1: presence-narrowing endsWithin + narrowing-write-set.ts + type-system wiring + E-TYPE-046 ended-at note; unit test 25 cases green; corpus measure base=24 head=24 (0 new; exposure 12 narrowed reads)
2026-10-09T15:56:17-06:00 conformance: 12 S462 cases (6 reject + 6 pos, incl. E-TYPE-031 prop-assign); locals case dropped — g-etype046-write-lhs-and-fn-param is status=open (xfail needs carried)
2026-10-09T16:11:11-06:00 bootstrap: unresolvable-call limb added (callKeys/hasFnNamed/tUnnarrowCells; unreachable in slice — function values refused); slice m1/m2/m1-lowered/m3/m4/codec green; bootstrap-conformance regenerated (12 new cases NOT-TWINNED: rhs-decl / component-const)
2026-10-09T16:25:05-06:00 docs: known-gaps flip (resolved) + 2 new gaps (deferred-closure, await-yield); SPEC-INDEX + FACTS + gap-counts regenerated (master-list left to PA)
2026-10-09T16:26:38-06:00 verify: types:check OK; browser-baseline --check PASS (48 asserted); todomvc compiles; bootstrap slices green; final report next

## FIX ROUND 1 brief (verbatim, received 2026-10-09)

FIX ROUND 1 for s462-narrowing-ends-on-write — the S239 differential review of 0006c9243 is FIX-FIRST. Append this message verbatim to docs/changes/s462-narrowing-ends-on-write/progress.md ("FIX ROUND 1 brief") and commit; fix on your branch; same process rules (absolute worktree paths, no stash, no pattern pkill, no --no-verify, commit each fix). The ruling is FAIL-CLOSED — every finding below is either a fail-open hole (must close) or a spurious rejection.

Shared preamble for repros: `type User:struct = { name: string }` · `<user>: User | not = { name: "a" }` · `<out> = ""`.

F1 HIGH (PA-REPRODUCED on your HEAD: 0 E-TYPE-046) — a write in a callee's RETURNING branch is dropped from the callee's write set:
`function clear() { if (@out == "") { @user = not; return } }` · `function show() { if (@user is given) { clear(); @out = @user.name } }`. Cause (reviewer): `presence-narrowing.ts:~198` `endsWithin` skips any `if` branch that exits — right for "the rest of this list", wrong when summarising a whole function body; `narrowing-write-set.ts:~163` reuses it. A function's write set is a MAY-write set: the union over EVERY path, exiting branches included. The bootstrap already does this (`stmtEffects` .If concatenates both branches) — match it.

F2 HIGH — name lookup ignores scope: a parameter / local / lambda param named like a file function borrows that function's write set. `function noop() { @out = "x" }` · `function apply(noop) { if (@user is given) { noop(); @out = @user.name } }` · `apply(clear)`; also `const noop = clear; noop()` and the arrow-param form. Cause: `narrowing-write-set.ts:~227` `ctx.writeSets.get(name)` unscoped. Resolve the callee name through scope: only a reference that RESOLVES to the file-level function declaration uses its write set; anything else (param, local, closure var) = "all". This also fixes F5(d) (inner same-named function joined with outer) — resolve to the right declaration.

F3 MED-HIGH — built-in METHOD names trusted on ANY receiver: `const api = { get: clear }; if (@user is given) { api.get(); @out = @user.name }` compiles clean (also `api.clear()`). Cause: `narrowing-write-set.ts:~236` `BUILTIN_METHODS.has(callee.property)` regardless of receiver. Trust a method name only when the receiver is KNOWN to be a built-in kind (string/number/array/map/set/Date/Promise… per impl#1's type info: a literal, a typed cell/field whose declared type is a built-in, the result of a built-in call…); unknown receiver type = "all". Then RE-MEASURE the corpus (same 2,645+ set): this may produce spurious fires where impl#1 can't type the receiver — report the count and every site; do NOT loosen to hit zero without telling me.

F4 MED — function-valued arguments to built-ins outside CALLBACK_METHODS are skipped (fail-open): `JSON.stringify(x, cb)`, `Object.groupBy(xs, cb)`, `String({ toString: wipe })`, JSON.parse reviver, Promise.try. Cause `narrowing-write-set.ts:~263`. Invert the default: ANY argument that is (or may be) function-valued — a function reference, lambda, param of unknown type, or an object literal containing a function — passed to a callee is assumed CALLED (its write set joins the call's, unresolvable → "all"), unless the callee is on a short allow-list of built-ins KNOWN never to call it synchronously. Name lists may only exempt known-safe names; never enumerate dangerous ones (fail-closed rule).

F5 spurious rejections (newly-rejecting correct programs — fix):
(a) match arms leak writes into each other: `if (@user is given) { match @k { .A :> { clear() } .B :> { @out = @user.name } } }` → E-TYPE-046 on HEAD; arms are exclusive. Cause: generic CHILD_KEYS walk `presence-narrowing.ts:~479`. Treat match arms (and `!{}` handler arms, if/else branches) as alternatives: a write in one arm does not end the narrowing for a sibling arm; after the match, the union applies.
(b) `defer { @user = not }` treated as running in place; it runs at scope exit (§19.16) — so it ends nothing within the block (but conservatively: does it matter after the block? state your handling).
(c) `if (wipe() && @user is given) { @user.name }` and the ternary form: a test AFTER a write in the same condition must narrow ("from that point"). Cause: `presence-narrowing.ts:~475-476` keysWithoutEnds(…, condEnds).

Nit: component path comment — "a call cannot rebind a local" is false (`const z = () => { onGo = not }; z()`); it is sound only because every prop write is already E-COMPONENT-PROP-WRITE. Fix the comment to state the real reason.

Divergence to REPORT (do not change the bootstrap unless trivial): impl#1 trusts built-in globals; the bootstrap fails closed on them (`String(1)` / `parseInt` in a narrowed block add E-OPERAND-NOT-NARROWED in the slice). Say whether after F3/F4 impl#1 and the bootstrap agree.

Report: new FINAL_SHA; per finding: before/after with the repro; the re-measured corpus table (new fires per limb, files+lines); gates re-run (pre-commit, conformance, browser-tier, types:check, bootstrap slices). If you exceed ~70% context, commit + progress.md + report what remains.
2026-10-09T17:02:56-06:00 FIX ROUND 1: F1 (mayWriteWithin), F2 (scope-resolved callees), F3 (receiver shapes), F4 (args assumed called), F5a/b/c, else-branch early-return, nit — unit 45 green; types OK; corpus re-measure: 0 new on the 2701 pre-existing files (only the 6 new reject cases fire)
