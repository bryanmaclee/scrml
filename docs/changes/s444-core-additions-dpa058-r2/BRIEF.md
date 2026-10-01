# BRIEF — s444-core-additions-dpa058-r2

change-id: s444-core-additions-dpa058-r2. Continue feat/s444-core-additions-dpa058 (tip 16221b99a) + merge origin/main.
READ FIRST: docs/changes/s444-core-additions-dpa058/progress.md (D2, D4, B1–B6).

## Findings to fix (S239 review of 16221b99a — reviewer-reproduced)
F1 (HIGH) — `novalidate` misses `<slot/>` content: a declaration `renders <form><slot/>…</form>` used as
`<wrap><*f/></wrap>` (or a bound validated input passed as slot content) renders `<form><input required minlength="3">`
with NO novalidate — violates dpa-058 ruling (3). Cause: `expansion()` in analyze.scrml returns [] for `.MSlot`.
Fix traversal to include slot content; test + mutation RED.
F2 (MED, regression) — `structuralOwner()` runs before `declNamed()` and matches lowercase, so a USER declaration named
`timer`/`page`/`render`/`column`/`errors`/`empty`/`match`/`api`/`db`/`channel`/`defaults` (and `Page`/`Timer`) is
refused E-BOOTSTRAP-UNSUPPORTED at its use. A user declaration must win over the refusal list. Test each name + mutation.
F3 (MED) — index type never checked: `function p(i: string) { @rows[i].qty = 2 }`, `@rows["0"]`, `@rows[0.5]`,
`@rows[-1]` type-check. Index must be `int` (find + quote the SPEC sentence); negative int LITERAL → compile error if
SPEC admits it, else keep the runtime throw (D4) with an accurate message. Tests + mutation.
F4 (LOW) — `Date.now()` restriction bypassed via a helper (`<let t:number=(h())/>`, `${h()}`, `title=h()`, and
`fn f() { return h() }` gets no E-FN-004). Fix at least: fn calling a transitively impure function → E-FN-004
(§33.3 / §48 — quote); initializer/markup host-call refusal applies transitively. Minimal sound version OK; report scope.
F5 test gaps: (a) `.MStateView` novalidate look-through → add state-arm test; (b) `setAt` boundary `>=` vs `>` → exact-
boundary test.
F6 LOW: two `bind:value` on one element → error; hand `minlength="1"` overriding `length(>=3)` → error (fail-closed);
`@xs = @ys.filter(…)` on `[free, remove]` message says "locked" → "replace not granted".
PENDING bryan (do NOT implement): B3 — bound top-level scalar with validators gets attributes vs E-VALIDATOR-DEAD.
Structure code so flipping it is one site.

## Verification
All slices, lowered m1, lexer, lint, mutations.js (all RED), bite matrix, top-level compiler/tests/*.test.js, gate.
Push `git push -u origin feat/s444-core-additions-dpa058-r2`.
