Compiler-source fix: impl#1 wrongly rejects the SPEC-canonical `not`-arm exhaustive `match` form for `T | not`. This aligns impl to SPEC (SPEC is already correct; impl is the bug). Auto worktree-isolation is broken this session, so a worktree is PRE-MADE for you.

═══════════════════════════════════════════════════════════════════════
STEP 0 — ENTER YOUR PRE-MADE WORKTREE (first action)
═══════════════════════════════════════════════════════════════════════
    cd /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ematch012
Verify (all must hold; if any fails STOP + report, do NOT edit):
  pwd == `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ematch012`
  git rev-parse --show-toplevel == that same path (NOT the main checkout)
  git branch --show-current == `fix/e-match-012-tnot-exhaustive`
  git rev-parse --short HEAD == `e6a6cae4` (already based on origin/main — do NOT reset/fetch)
Then `bun install` (worktree needs it for the pre-commit hook). PATH DISCIPLINE: every edit worktree-absolute; NEVER `cd` to the main checkout; commit after each meaningful change; keep an append-only `progress.md`.

═══════════════════════════════════════════════════════════════════════
THE BUG (surfaced by sPA ss71, root-cause already traced — verify then fix)
═══════════════════════════════════════════════════════════════════════
For a `match` on a `T | not` union, SPEC says a `not` arm (OR an `else`/`_` wildcard) makes it exhaustive and clears `E-MATCH-012`:
  - SPEC §42 `SPEC.md:23152` ("a `match` on `T | not` without a `not` arm OR `else` arm SHALL be E-MATCH-012")
  - §18 canonical form `SPEC.md:8594-8606` (`{ not :> …  given u :> … }`)
  - §34 resolution `SPEC.md:18298` ("add a `<not>` arm OR a wildcard")

**impl#1 actual (the bug):** the `not :>` + `given u :>` (or `.Variant`/is-type present-case) form STILL fires `E-MATCH-012` AND co-fires `E-TYPE-006`. The ONLY value-form shape impl#1 accepts as exhaustive for `T | not` is an `else`/`_` wildcard.

**Root cause (ss71 sPA traced — confirm it):** `checkUnionExhaustiveness` (`type-system.ts:15611`) counts a union member as covered ONLY by an `is-type` pattern or a wildcard. But `extractArmsFromMatchNode` (`type-system.ts:15952-16033`) records a `not` arm — and `.Variant`/`given` present-case arms — as `variant` patterns. So neither the `not` member nor the `T` member is ever counted → `E-TYPE-006` co-fires for the uncovered `T`, and `E-MATCH-012` fires. The `E-MATCH-012` fire site is `type-system.ts:16961` (NOT `:6478` as the stale §34 catalog line-ref says — see the doc-currency touch below).

═══════════════════════════════════════════════════════════════════════
PHASE 0 — REPRODUCE FIRST (verify-before-claim; do NOT skip)
═══════════════════════════════════════════════════════════════════════
Construct a `T | not` value-match with a `not` arm + a present-case arm (`given`/`.Variant`/is-type) and compile it on your (pre-fix) worktree base: `bun compiler/bin/scrml.js compile <file> --output-dir /tmp/em012`. Confirm it fires `E-MATCH-012` (+ likely `E-TYPE-006`). Grep the existing landed conformance case `conformance/cases/match-codes/e-match-012-tnot-else-exhaustive-neg/expected.json` — it documents this divergence verbatim; use its POS/NEG source shapes as your reference. If it does NOT reproduce, STOP + report NOT-REPRODUCED with the empirical output (do not fix a ghost).

═══════════════════════════════════════════════════════════════════════
THE FIX
═══════════════════════════════════════════════════════════════════════
Make `checkUnionExhaustiveness` recognize that, for a `T | not` union: a `not` arm covers the `not` member, and a present-case arm (`.Variant` / `given u` / is-type T) covers the `T` member. When BOTH members are covered → exhaustive → NO E-MATCH-012, NO E-TYPE-006. You decide the exact mechanism (extend the arm-classification in `extractArmsFromMatchNode` to distinguish `not`-arm vs present-arm, and/or teach `checkUnionExhaustiveness` to count them) — match the existing code's shape. Keep it minimal + localized.

═══════════════════════════════════════════════════════════════════════
ADVERSARIAL SOUNDNESS GUARD (this is exhaustiveness — do NOT over-accept)
═══════════════════════════════════════════════════════════════════════
Your fix must NOT wrongly accept a genuinely non-exhaustive match. Verify all of these still behave correctly:
  - `T | not` with a `not` arm but NO present-case arm (missing the T case) → MUST still fire the non-exhaustive error (E-TYPE-006 / E-MATCH-not-exhaustive), NOT clear.
  - `T | not` with a present-case arm but NO `not` arm → MUST still fire E-MATCH-012.
  - `T | not` with BOTH (`not` + present) → clean (the fix's target).
  - `T | not` with `else`/`_` wildcard → still clean (unchanged).
  - A plain enum match (no `not`) exhaustiveness → unchanged (don't regress E-TYPE-020/006 for enum×enum).
  - Multi-scrutinee / product-pattern matches (ss71 landed §18.19) → unchanged.

═══════════════════════════════════════════════════════════════════════
TESTS + CONFORMANCE + DOC-CURRENCY
═══════════════════════════════════════════════════════════════════════
- ADD a conformance NEG case `conformance/cases/match-codes/e-match-012-tnot-not-arm-exhaustive-neg/` (a `T | not` match with a `not` arm compiles CLEAN — asserts no E-MATCH-012 / no E-TYPE-006). Read `conformance/README.md` for the `expected.json` schema. Keep the existing `else` NEG + missing-arm POS untouched.
- ADD unit tests in the type-system/exhaustiveness test file covering the 3 core shapes above (not-arm-clean / not-arm-only-still-fires / present-only-still-fires).
- DOC-CURRENCY (minor, bundle it): §34 catalog `SPEC.md:18298` says E-MATCH-012 emits at `type-system.ts:6478`; the actual site is `type-system.ts:16961`. Update that stale line-ref in SPEC.md (single-line edit).
- FULL gate green: `bun run test` == 0 fail before DONE. Pre-commit runs the core subset (~2-5 min; foreground commits may exceed the harness timeout but finalize — verify HEAD moved). Never `--no-verify`.

═══════════════════════════════════════════════════════════════════════
BRIEF ARCHIVAL + REPORT
═══════════════════════════════════════════════════════════════════════
Write this brief verbatim to `docs/changes/e-match-012-tnot-exhaustive/BRIEF.md` + `progress.md`, commit with the fix. Report: WORKTREE_PATH + FINAL_SHA; FILES_TOUCHED; the exact mechanism you used; the Phase-0 repro output; the 6-shape adversarial-soundness results (verbatim); full-suite pass/fail; and confirm `git status` clean + all committed on `fix/e-match-012-tnot-exhaustive`. I run an independent adversarial review before landing.
