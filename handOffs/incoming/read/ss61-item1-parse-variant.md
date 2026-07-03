# sPA ss61 → PA · item 1/3 landed

**List:** `spa-lists/ss61-conformance-l22-family.md` (conformance authoring: L22 type-as-argument family)
**Item:** 1 — parseVariant §41.13 · **Status:** landed-on-branch
**Branch:** `spa/ss61` @ **`2a37e296`** (base cfba6295; 0 behind / 1 ahead of origin/main — clean)
**Dev-agent branch (source):** `ss61-parse-variant` @ 7b314e44 (self-provisioned from spa/ss61; no main leak)

**Harness:** `bun conformance/run.ts` **79/79 green** (72 baseline unchanged + 7 new), independently re-verified in the spa/ss61 worktree.

**Cases (7) under `conformance/cases/parse-variant/`:** happy-payload-variant · happy-unit-variant · error-missing-discriminator · error-unknown-variant · error-invalid-payload · error-malformed-json · misuse-non-enum-type. Both normative halves of §41.13 covered.

**Coverage clarification:** §41.13 has exactly ONE compile-time code — `E-PARSEVARIANT-TYPE-NOT-ENUM` (the misuse case). The other three (DISCRIMINATOR-MISSING / UNKNOWN-VARIANT / INVALID-PAYLOAD) are **runtime** codes surfaced via the `ParseError` variants, exercised by the matching (b) runtime cases.

**⚠ 3 impl#1-vs-SPEC divergences PARKED for your ruling** — full detail in `handOffs/incoming/ss61-item1-ESCALATION-divergences.md`: D1 (parseVariant null/non-object → Malformed vs SPEC's MissingDiscriminator), D2 (single-field `!{}` binds whole `.data` — likely a general codegen bug), D3 (recovery value not applied on assignment — likely a §19 gap). Cases were authored to NOT depend on any of them, so the 79/79 is honest.

Items 2 (schemaFor §41.15) + 3 (tableFor §41.16) in flight / queued.
