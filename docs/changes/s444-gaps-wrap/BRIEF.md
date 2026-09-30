# s444-gaps-wrap — BRIEF (dispatch prompt, task portion)

change-id: s444-gaps-wrap

Task — docs/known-gaps.md only (+ state.ts regen). Entry form: `<!-- @gap id=g-<kebab> sev=HIGH|MED|LOW status=open locus=... prov=<kind>:<pointer> -->` + `### G-<ID> — <symptom>` + body with a version-stamped reproducer. REPRODUCE EACH BY EXECUTION on current main before filing; NOT-REPRODUCED items are reported, not filed. New section `## §S444d`. prov=review:<PR> unless stated.

A. RESOLVE (status=resolved resolved-by=#1191; verify by execution): g-request-deps-attr-ignored-both-forms, g-request-body-client-wrapper-unawaited-one-shot, g-request-refetch-statement-dropped.

B. FILE:
1. impl#1 <request>: two inferred deps changing on one write fire 2 fetches — LOW (review:#1191).
2. impl#1: deps=[page] bare name reports E-SCOPE-001 + E-LIFECYCLE-022 — LOW.
3. impl#1: multi-statement handler inside `${ for … lift <el onclick=${ a; b }> }` drops statements after the first — HIGH? (review:#1191 deferred).
4. impl#1: bare `@` item in multi-statement <each> row handler -> E-CODEGEN-INVALID-LOGIC.
5. impl#1: §6.7.7 SHALL-emit codes with no emitter (E-LIFECYCLE-013, W-011/012/014, E-018..021).
6. impl#1: preprocessWorkerAndStateRefs rewrites `<#k>` inside string literal — LOW.
7. impl#1: class="${<#hunt>.stale ? 'dim' : ''}" -> E-CODEGEN-INVALID-LOGIC.
8. bootstrap: §4.18.3 several standalone display literals; `"a"\n"b"` / literal + `;` get E-UNQUOTED-DISPLAY-TEXT (review:#1195).
9. bootstrap: nested "a ${@n} b" E-BOOTSTRAP-UNSUPPORTED message calls it display-text literal — LOW.
10. bootstrap: runaway display literal before body closer cascades instead of E-CTX-001 — MED.
11. bootstrap: unterminated `:`-shorthand display literal meeting a later `"` indistinguishable — LOW.
12. bootstrap typer: int local into string/bool local initializer unchecked — LOW (review:#1189).
13. CI: ~55 browser/ test failures on main, gate doesn't run browser/ — MED.
14. SPEC: §34 row / §13.2 E-ASYNC-FN-ESCAPES-AS-VALUE "receives an unawaited Promise" over-certain — LOW.

Then `bun scripts/state.ts --write` + `--check`. Push gaps/s444-wrap. No PR, no merge.
