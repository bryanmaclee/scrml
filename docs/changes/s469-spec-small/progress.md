# s469-spec-small — progress

SPEC-only lane (compiler/SPEC.md + docs/known-gaps.md). Branch `s469-spec-small`, cut from origin/main @ d80739b7c.

## Items

- [x] 2 — E-LIFECYCLE-020 / -021 §34 rows cited `§28.4` (Compiler Settings has no §28.4) → §6.7.7, §6.7.10.
- [x] 1 — §6.7 examples (34 non-struck `scrml` blocks, §6.7.1a–§6.7.11): `;` added per F1 (a) + F3 (i); amendment note at the §6.7 head. §66.19 untouched.
- [x] 3 — gap exists: g-impl1-duplicate-function-silently-overrides-s469; no change.
- [x] 2b — sibling §34 rows E-LIFECYCLE-010…-019 (not 016) and -022 cited §28.x → §6.7.5/§6.7.6/§6.7.7/§6.7.9 + §6.7.10 (PA: yes); touched rows given emitter/not-yet-emitted notes (§34.0).
- [x] 5 — PA: register, not alias. New §34.2 "Bootstrap Parse Diagnostics" (32 `E-PARSE-*` codes, informative, Error). E-PARSE-001 row untouched (commas lane). severity.scrml NOT regenerated (generated bootstrap file; `gen-bootstrap-severity.ts --check` now reports it stale — owner's call).
- [ ] 4 — HELD until s469-boot-semicolons lands — §19.4.5 legacy `|` arm "accepted (Info)" wording made exact.
- [x] 6 — already done by batch-5 (§7.5, §34 row); no change.
- [ ] 7 — HELD until s469-boot-semicolons lands — interim note: the bootstrap's remaining newline-sensitive rules.

## Probes

Probe sources live in the session scratchpad (`sm/`), run against main @ d80739b7c with `scripts/scrml-boot.ts`
and `compiler/src/cli.js`.
