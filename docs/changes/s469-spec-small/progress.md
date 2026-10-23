# s469-spec-small — progress

SPEC-only lane (compiler/SPEC.md + docs/known-gaps.md). Branch `s469-spec-small`, cut from origin/main @ d80739b7c.

## Items

- [x] 2 — E-LIFECYCLE-020 / -021 §34 rows cited `§28.4` (Compiler Settings has no §28.4) → §6.7.7, §6.7.10.
- [x] 1 — §6.7 examples (34 non-struck `scrml` blocks, §6.7.1a–§6.7.11): `;` added per F1 (a) + F3 (i); amendment note at the §6.7 head. §66.19 untouched.
- [ ] 3 — impl#1 duplicate function names: gap entry.
- [ ] 4 — §19.4.5 legacy `|` arm "accepted (Info)" wording made exact.
- [ ] 5 — stray arm comma code: E-PARSE-ARM vs E-PARSE-001 (owner question).
- [ ] 6 — E-PARAM-TYPE-REQUIRED rule + §34 row.
- [ ] 7 — interim note: the bootstrap's remaining newline-sensitive rules.

## Probes

Probe sources live in the session scratchpad (`sm/`), run against main @ d80739b7c with `scripts/scrml-boot.ts`
and `compiler/src/cli.js`.
