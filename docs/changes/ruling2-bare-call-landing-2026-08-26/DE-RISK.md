# De-risking note — ruling 2 (bare-call migration) landing

Written S376-bryan, 2026-08-26, as next-dispatch prep. **Nothing built here.** These are MEASURED
facts about the held build, so the eventual brief does not carry a guessed premise.

## The held build

`origin/wip/s368-bare-call-build` @ `7d5fe573` — *"WIP(bare-call): progress — SPEC, locus refinement,
conformance parity, full verification"*.

- base `3a7203ff` (2026-08-23) — **42 commits behind `origin/main`** as of 2026-08-26.
- **It has NEVER had its S239 adversarial pass.** That gate is mandatory before landing and is not
  optional because the build is old.

## Files, and which are OCC-safe to pull wholesale

| file | change | intervening writes on main since `3a7203ff` | landing mechanic |
|---|---|---|---|
| `compiler/src/ast-builder.js` | +194 | **2** (`4bf73508`, `4393ef0a`) | **real 3-way merge — NOT a wholesale pull** |
| `compiler/src/symbol-table.ts` | −46 net | 0 | wholesale pull is OCC-safe |
| `compiler/src/default-logic-exemption.ts` | new, +73 | n/a | new file |
| `compiler/SPEC.md` | +5 (a §34 row) | many (hot doc) | per-section reconcile |
| `compiler/tests/unit/bare-call-at-body-top.test.js` | new, +269 | n/a | new file |
| `compiler/tests/unit/c22-bare-variant-codegen.test.js` | ±11 | 0 | wholesale safe |
| 3 × `conformance/cases/call-not-in-logic-context-{pos,neg,prose-neg}/` | new | n/a | new dirs |

## ⚑ The `ast-builder.js` merge is expected CLEAN — hunks are DISJOINT (verify, don't assume)

- main's two intervening commits touch `parsePropsBlock` (~L3655) and `parseLogicBody` (~L13596,
  ~L13667).
- the build's hunks are at the import block (~L42), `TOPLEVEL_AT_WRITE_RE` (~L756), and
  `liftBareDeclarations` (~L1837) — **all above main's lowest touched region**, so there is not even
  a line-shift interaction.

This is a prediction from hunk offsets, not a performed merge. Run the merge and read the result.

## Sequencing constraints (do not drop these)

1. **Ruling 2 and ruling 3 are SEQUENCED, not parallel** — both land in `ast-builder.js`, as does the
   pre-existing comment-flush fix. Whichever goes second clobbers the others.
2. **The bare-call gate is a REJECT gate and MUST NOT be folded into the comment-flush fix** (S375).
3. **SPEC.md §34 collision:** ruling 1's row (`E-STATE-BLOCK-STATEMENT-FORM`, landing on
   `feat/s376-db-locus`) and this build's row both insert into §34. Land ruling 1 first, then rebase
   this one — a §34 insertion also shifts every `SPEC-INDEX.md` line range, so
   `bun run scripts/regen-spec-index.ts` runs on whichever lands second.
4. **Ruling 4 (`TILDE_TOKEN_RE`) is DOWNSTREAM of this build**, not independent — PA-verified on main:
   both forms compile exit 0 today, so the asymmetry does not exist until this lands.

## The ruling this executes

S375, ratified: *migrate the 2 bare-call files INTO CONFORMANCE CASES asserting `E-BARE-CALL` fires.*
Both hits are the comment-branch's own reproducer artifacts — one is bryan's hand-written file — so
them newly-erroring IS the rule biting correctly. "Exempt" would carve out the one thing that tests
the rule; "accept" lands with a red gate.
