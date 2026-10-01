# BRIEF — s444-gaps-dd059-061

change-id: s444-gaps-dd059-061

Task: reproduce each on current main by EXECUTION (`bun compiler/bin/scrml.js compile <f> --output-dir <tmp>`, and for runtime shapes inspect emitted JS), then file in docs/known-gaps.md under a new `## §S444b` section following existing entry form (`<!-- @gap id=g-<kebab> sev=HIGH|MED|LOW status=open locus=... prov=dd:<artifact> -->` + `### G-<ID> — <symptom>` + version-stamped reproducer). Four severities only. Do NOT file anything that does not reproduce — report NOT-REPRODUCED.

Sources: scrml-support/docs/deep-dives/browser-persisted-state-dpa-061-2026-09-30.md (§C4 P1, P2, P6) and scrml-support/docs/deep-dives/request-supersede-abort-dpa-059-2026-09-30.md.

1. `!{}` (bare or bound) inside a `when @x changes { … }` body -> E-CODEGEN-INVALID-LOGIC + "statement boundary not detected" warning (P2). Check no existing g-when* entry covers it.
2. SPEC §6.7.4 idiom-table row `when @var changes { localStorage.setItem(key, @var) }` is silently lossy for non-string cells (P1). SPEC-currency gap.
3. Unknown declaration attribute (`<x persist="local"> = …`) silently stops the line being a declaration -> misleading E-STATE-UNDECLARED at use sites (P6).
4. `<request url=… deps=[@page]>` compiled to a one-shot fetch with no re-fetch when `@page` changes (dpa-059). Locate codegen; compare body-form `<request>`; contrast SPEC §6.7.7 re-execution rule.

Then `bun scripts/state.ts --write` and `--check`. Push `gaps/s444-dd059-061`. No PR, no merge.
