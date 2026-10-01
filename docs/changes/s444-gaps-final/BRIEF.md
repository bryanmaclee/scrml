# s444-gaps-final — BRIEF

change-id: s444-gaps-final · branch `gaps/s444-final` · base `464c9ab4d`

Task: docs/known-gaps.md only + `bun scripts/state.ts --write`. New section `## §S444g`. Reproduce each by execution on current main before filing; NOT-REPRODUCED → report only.

1. test harness: conformance/adapters/impl1-ts.ts `run()`/`runServer()` install happy-dom globals (GlobalRegistrator) and never unregister → later Bun.serve + native fetch tests in the same bun process fail order-dependently. MED. prov=review:#1200.
2. impl#1: inside a `match` arm in a `fn`, string literal "pure `fn`" emitted as "pure `function`". HIGH-if-silent. prov=review:#1202.
3. impl#1: E-FN-004 fires on `Date.now()` text inside a string literal in a `fn` body. LOW/MED.
4. impl#1: string containing `(a). Call it` → E-CODEGEN-INVALID-LOGIC in a match arm. MED.
5. impl#1: stylesheet href / .client.js src built from the source filename not HTML-escaped. LOW. prov=review:#1200. Locus emit-html.ts.
6. bootstrap (#1202 deferred): (a) fn writing outer cells compiles clean — E-FN-003 write half (MED); (b) two validators lowering to one HTML attribute keep the first (MED, silent); (c) bind:value + hand-written value= accepted (LOW).
7. bootstrap: dpa-058 B3 ruling owed — LOW status=open; bound top-level scalar with validators refused E-VALIDATOR-DEAD; switch `topLevelValidatorsLower()` in analyze.scrml. prov=ruling-owed:dpa-058-B3.
8. chunk bootstrap anonymous fallback — skip if already on main (it is: filed in §S444f).

Then state.ts --write + --check; push `gaps/s444-final`; no PR.
