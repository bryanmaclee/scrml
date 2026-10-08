# progress — s452-spec-fixups

- [x] 1 N-S451-2: §8.1.1 provenance + Ownership note mark `g-impl1-db-resolution-not-nearest-s451` resolved by #1264 (`6003a542f`); residual named (`g-impl1-unscoped-sql-single-db-accepted-s451`). Three E-SQL-004 rows re-pinned by symbol (`generateServerJs`, `generateToolJs`).
- [x] 2 N-S451-3: §34 row for E-INTERNAL-DB-HANDLE-UNRESOLVED (after E-INTERNAL-BODY-TOP-DROPPED); gap `g-impl1-e-sql-004-message-pre-s451-wording-s451` (LOW) filed — both stale messages reproduced at `488abeedc`.
- [x] 3 §19.9.10 status: "The bootstrap builds it" -> lands with the bootstrap's client server-call slice (U1b); self-host-v2 has 0 refs at `488abeedc`.
- [x] gates: regen-spec-index + --check OK; state --write (gap-counts LOW 256->257); facts --write (SPEC lines); s34-census --check-new PASS.
  - NOT included: state.ts `@generated:recent-sessions` in master-list.md is stale on main already (missing the #1271 wrap); left for the PA (PA-owned doc).
