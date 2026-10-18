# unit-id: s468-bootstrap-failopen-gaps
BOOTSTRAP (compiler/self-host-v2, scrml source). Drain the bootstrap's FAIL-OPEN / security-shaped open gaps — places
where the second implementation silently accepts what SPEC (and impl#1) refuse. Read each entry in docs/known-gaps.md:
1. g-bootstrap-static-executable-values-not-refused-s464 (MED) — E-ATTR-STATIC-EXECUTABLE (S464 rulings incl. "(a)
   Narrow attrs, allow-list"; user-voice §S464).
2. g-bootstrap-braced-nonhandler-value-and-quoted-handler-silently-empty-s462 (LOW) — the handler half is E-ATTR-
   QUOTED-HANDLER (S464 ruling).
3. g-bootstrap-raw-content-not-fail-closed-s462 (MED).
4. g-bootstrap-m2-spread-overrides-write-in-sequence (HIGH) — read it; if it needs a ruling, STOP on it.
5. g-bootstrap-fn-writes-outer-cells-not-refused (MED).
6. g-bootstrap-two-validators-same-html-attr-first-wins (MED).
For each: reproduce on the bootstrap (and show impl#1's behaviour as the reference), quote the governing SPEC sentence,
fix in the bootstrap (by construction where possible — a refusal at the Core/check level, not a printer patch), add
conformance cases or bootstrap tests, flip the marker. Any item whose SPEC is silent → STOP for a ruling, continue
with the rest. Anti-pattern briefing MANDATORY: scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md +
docs/articles/llm-kickstarter-v2-2026-05-04.md. ⚑ Concurrency: the U1c unit is building the bootstrap's server half in
parallel — stay out of print-server / the server-boundary modules; if an item needs them, defer it and say so.
Gates: bootstrap slices as CI runs them, bootstrap-conformance --check, checkCore green.
