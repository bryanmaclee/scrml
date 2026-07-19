# sPA ss71 → PA re-integration — conformance authoring: match/exhaustiveness §18

**List:** `spa-lists/ss71-conformance-match-18.md`
**Branch:** `spa/ss71` · **tip:** `c368a712ad9c4e3623975d8426a1e59188eca9e6` (`c368a712`)
**Base:** `origin/main` `85efaf77` (branch is +1 commit; additive-only, all NEW files)
**Harness:** `conformance (impl#1): 445/445 → 469/469` (independently re-verified green post-commit)
**Status:** ✅ COMPLETE — all 12 codes pinned (24 cases: POS reject + clean NEG each). 0 parked.

## ⚠️ NEEDS A RULING (escalated — sPA did NOT decide/fix)

**DIVERGENCE 1 — E-MATCH-012: impl#1 rejects the SPEC-canonical `not`-arm exhaustive form.**
- SPEC §42 (`SPEC.md:23152`): "a `match` on `T | not` without a `not` arm **or** `else` arm SHALL be E-MATCH-012" → a `not` arm is supposed to clear it. §18's canonical `T | not` form (`SPEC.md:8594-8606`) is `{ not :> …  given u :> … }`. §34 resolution (`:18298`) says "add a `<not>` arm OR a wildcard".
- **impl#1 actual:** the `not :>` + `given u :>` form STILL fires E-MATCH-012 **and co-fires E-TYPE-006**. The ONLY value-form shape impl#1 accepts as exhaustive for `T | not` is an `else`/`_` wildcard.
- **Root cause (agent-traced):** `checkUnionExhaustiveness` (`type-system.ts:15611`) counts a union member covered ONLY by an `is-type` pattern or a wildcard, but `extractArmsFromMatchNode` (`type-system.ts:15952-16033`) records a `not` arm — and `.Variant`/`given` present-case arms — as `variant` patterns, so neither the `not` member nor the `T` member is ever counted → E-TYPE-006 co-fires for the uncovered `T`.
- **sPA handling:** POS pinned as designed. NEG authored with `else` (the only impl#1-clean form) instead of the `not` arm the list assumed; the full divergence is documented verbatim in `e-match-012-tnot-else-exhaustive-neg/expected.json`. **PA/user to decide: fix impl#1 (make `not` arm clear it, per SPEC) or amend SPEC §42/§18.** If impl#1 is fixed, add a `not`-arm-clean NEG then; the current `else` NEG stays valid either way.

**DIVERGENCE 2 — doc-currency (minor):** §34 catalog (`SPEC.md:18298`) says E-MATCH-012 emits at `type-system.ts:6478`; actual site is `type-system.ts:16961`. Stale line ref only; code fires. → currency touch.

## Landed items (single commit `c368a712` covers all 12)
All under `conformance/cases/match-codes/`:

| # | Code | POS dir | NEG dir |
|---|------|---------|---------|
| 1 | E-MATCH-012 | `e-match-012-tnot-missing-not-arm-pos` | `e-match-012-tnot-else-exhaustive-neg` (†div1) |
| 2 | E-MATCH-ARM-MARKUP-IN-VALUE | `e-match-arm-markup-in-value-pos` | `e-match-arm-markup-in-value-neg` |
| 3 | E-MATCH-BLOCK-IN-LIFT | `e-match-block-in-lift-pos` | `e-match-block-in-lift-neg` |
| 4 | E-MATCH-EFFECT-FORBIDDEN | `e-match-effect-forbidden-pos` | `e-match-effect-forbidden-neg` |
| 5 | E-MATCH-ON-REQUIRED | `e-match-on-required-pos` | `e-match-on-required-neg` |
| 6 | E-MATCH-ONTRANSITION-FORBIDDEN | `e-match-ontransition-forbidden-pos` | `e-match-ontransition-forbidden-neg` |
| 7 | E-SYNTAX-010 | `e-syntax-010-else-not-last-pos` | `e-syntax-010-else-last-neg` |
| 8 | E-SYNTAX-011 | `e-syntax-011-guard-clause-pos` | `e-syntax-011-plain-pattern-neg` |
| 9 | E-TYPE-006 | `e-type-006-multi-scrutinee-union-pos` | `e-type-006-multi-scrutinee-exhaustive-neg` |
| 10 | E-TYPE-024 | `e-type-024-struct-subject-pos` | `e-type-024-enum-subject-neg` |
| 11 | E-TYPE-025 | `e-type-025-asis-subject-pos` | `e-type-025-enum-subject-neg` |
| 12 | E-TYPE-026 | `e-type-026-match-in-markup-pos` | `e-type-026-match-in-logic-neg` |

**Benign co-fires (documented in-case, in NO notCodes — expected impl behavior, not divergences):**
E-MATCH-ON-REQUIRED POS co-fires W-severity `E-DG-002`; E-MATCH-BLOCK-IN-LIFT POS co-fires `W-PROGRAM-REDUNDANT-LOGIC`. E-TYPE-006 authored via the multi-scrutinee **union** path (enum×enum non-exhaustive fires E-TYPE-020, so a union position is required to route to E-TYPE-006).

## Re-integration notes for the PA
- **Delta is additive** — 49 new files (`conformance/cases/match-codes/` 24 dirs × 2, + `docs/changes/ss71-match-conformance/BRIEF.md`). No existing file touched, no compiler change → clean file-delta / cherry-pick of `c368a712`; confirm `bun conformance/run.ts` → 469 green after.
- **Did NOT touch `spa-lists/`** (PA-owned; main checkout was mid-flight on `spa/ss70`). Please mark ss71 items 1–12 `landed-on-branch c368a712` in `spa-lists/ss71-conformance-match-18.md` + append `ss71.progress.md` at re-integration.
- Base was `origin/main`; if the conformance infra advanced on another branch since, the file-delta still applies cleanly (all-new paths).

*sPA ss71 standing down. Durable output = branch `spa/ss71 @ c368a712` + this ping.*
