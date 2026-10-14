# progress — s466-enum-infer-parseerror

- [x] startup verification; branch cut at f28b58a31
- [x] item 1 — enum-cell inference from qualified-variant initializer — `8adf633a4`
  - type-system.ts `inferEnumFromQualifiedVariantInit` + state-decl hook (structuralForm decls only)
  - unit + browser tests; S465 round-3 pins updated to the S464 ruling
  - corpus (3074 files) base vs item1: 0 newly refused, 0 newly accepted, 0 artifact diffs on clean files;
    3 already-failing files change error set (E-TYPE-025 gone; signup-form unmasks a PRE-EXISTING
    E-CODEGEN-INVALID-LOGIC — identical on base with the cell annotated)
- [x] item 2 — ParseError import-only — `062ef9ced`
  - corpus base vs branch: 0 newly refused (stdlib, examples, giti, flogence, fixtures all clean) — nothing held
- [x] gates: unit/integration/conformance (pre-commit hook, 35810 tests pass), lsp+commands 726 pass,
  types-gate OK, slices 2280 pass, facts (regen `fd554b2c7`), state PASS, spec-index OK,
  bootstrap-conformance current, corpus-compile-floor PASS
- [x] browser suite (not a listed gate): 50 whole-suite failures; the 6 failing files checked
  individually fail IDENTICALLY on base f28b58a31 — pre-existing (env), not this branch
- [ ] push
- [x] push (993b4c155) — S239 review: item 1 CLEAN, item 2 FIX (round 1)

## Fix round 1 (S239 review of 993b4c155)
- merged origin/main 4e8dea5e6 (#1418) — `5548ffb69`; SPEC-INDEX + FACTS regenerated (conflicts were generated docs only)
- `23414782b` — one existence predicate `isKnownErrorTypeName` (registry + compiler-provided Error/SqlError/ServerCallError) for the arm-qualifier check (items 1/2 HIGH); local-only import names (item 3, incl. generic HostError-as-HE annotation leak); parseVariant failure by identity key `scrml:data/ParseError` (item 4); mismatch hint names bare form + import (item 5)
  - first cut also gave the three compiler-provided types VARIANT SETS → `s462-p0-sql-chain-truncation` failed (a `! -> SqlError` caller handler became exhaustive-checked) → narrowed: variant-set lookups unchanged from main; reported as an open fork
  - reviewer probes (37) main vs tip: only intended changes
  - corpus 3079 files origin/main vs tip: 0 newly refused, 0 artifact diffs (3 already-failing files differ, all item 1, as before)
- known-gaps: g-parseerror-builtin-or-import-only-s462 resolved; NEW resolved marker g-impl1-handler-arm-undeclared-qualifier-accepted-s466 with prov=pa-ruled:§34-E-SCOPE-001-…-corpus-measured-0
- `e0bc9c4a3` — types-gate TS2345 (E-ERROR-005 display name) + FACTS / gap-counts regen. First commit attempt bailed on 1 unidentified test under multi-agent load (output truncated); retry passed 35926 tests.
- final gates: hook 35926 pass; lsp+commands 726 pass/0 fail; types-gate OK (182 unchanged); slices 2280 pass/1 todo/0 fail; lint-no-default-arm 0; facts PASS; state PASS; spec-index OK; bootstrap-conformance current; corpus-compile-floor PASS
- final corpus (3079 files) origin/main 4e8dea5e6 vs tip: 0 newly refused, 0 newly accepted, 0 artifact diffs on 1892 clean-in-both
