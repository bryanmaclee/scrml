# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

Your worktree path is the CWD that `pwd` reports at startup.

## Startup verification (BEFORE any other tool call)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   Else STOP (S90). Save as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` == WORKTREE_ROOT.
3. `git rev-parse --abbrev-ref HEAD` + `--short HEAD` (base `c734ec35` or descendant);
   `git status --short` clean.
4. `bun install`. 5. `bun run pretest`. Baseline via `bun run test`.

If ANY check fails: STOP and report.

## Path discipline
- ALL edits via Bash (`perl -0pi`/`python3`/heredoc/`cp`) on WORKTREE_ROOT-absolute paths
  WITH the `.claude/worktrees/agent-<id>/` segment — NOT Edit/Write (S126). Echo path
  before each write; verify with `git diff` after.
- NEVER main-rooted paths; NEVER `cd` into main. Use `git -C`/`bun --cwd`/absolute paths.

## Commit discipline
- Commit per unit; create+update
  `docs/changes/ss2-payloadbindings-grammar-dedup-2026-06-19/progress.md` per step.
- Coupled code+test = ONE commit. `git status` clean before DONE. NEVER `--no-verify`.

---

# TASK — ss2 item 3 (experiment, LOW): de-duplicate the engine state-child grammar sets

## What this is

A pure-refactor dedup with **ZERO behavior change**. Two literal sets are duplicated
across the type-system and codegen because `type-system.ts` cannot import from `./codegen/*`
(it is upstream of codegen — see the comment at type-system.ts:88-99). Extract them to a
new shared module BOTH layers import.

## The duplication (verified)

1. `compiler/src/type-system.ts:101-106` —
   `TS_ENGINE_STATE_CHILD_RESERVED_ATTRS = {rule, history, internal:rule, effect}`.
   Consumed at type-system.ts:170 (`if (...has(name)) continue;` in the attr walker).
2. `compiler/src/type-system.ts:108-114` —
   `TS_STATE_CHILD_STRUCTURAL_TAGS = {onTimeout, onTransition, onIdle, engine, machine}`.
   Consumed at type-system.ts:10631 and :10657 (structural-tag filter).
3. The codegen reserved-attr notion lives in
   `compiler/src/codegen/emit-variant-guard.ts:1098` — `extractPayloadBindingsFromAttrs`.
   READ it and determine whether it carries its OWN reserved-attr literal/inline set.
4. The standing TODO is at type-system.ts:95-99.

## The change

1. **Create `compiler/src/engine-statechild-grammar.ts`** (OUTSIDE `./codegen/` so the
   type-system CAN import it — this placement is the whole point). Export the canonical
   single source of truth, e.g.:
   - `export const ENGINE_STATE_CHILD_RESERVED_ATTRS: ReadonlySet<string>` =
     `{rule, history, internal:rule, effect}`.
   - `export const STATE_CHILD_STRUCTURAL_TAGS: ReadonlySet<string>` =
     `{onTimeout, onTransition, onIdle, engine, machine}`.
   Document each member's §51.0 provenance in a header comment (carry over the existing
   comment context from type-system.ts:88-114).
2. **type-system.ts**: import both from the new module; DELETE the local `TS_*` literals;
   point the three consumers (:170, :10631, :10657) at the imported sets.
3. **emit-variant-guard.ts** (and/or emit-engine.ts if it has its own copy): if it carries
   a duplicate reserved-attr literal, import `ENGINE_STATE_CHILD_RESERVED_ATTRS` from the
   new module and retire the local copy.

## HARD CONSTRAINT — zero behavior change

- The exported sets MUST be **member-identical** to today's literals. Before unifying the
  codegen reserved-attr set with the TS one, VERIFY they contain the same members. **If
  they DIVERGE** (codegen reserves a different set than the type-system), DO NOT silently
  unify them — that would change behavior. STOP and report the divergence (which members
  differ, both call sites) so the sPA can escalate. A divergence is a latent bug, not a
  dedup target.
- No new/changed diagnostics. No fixture output changes. The full `bun run test` suite must
  be **byte-for-byte green** (same pass/skip counts as the pre-change baseline you record
  at startup).

## OPTIONAL secondary (`entry.payloadBindings` swap) — only if trivially clean

The TODO also suggests retiring the reserved-attrs CONSUMER at type-system.ts:170 by
reading `EngineStateChildEntry.payloadBindings` directly (now populated by SYM PASS 11 /
B15 — symbol-table.ts:560). This is a SEMANTIC inversion (skip-reserved → process-only-
bound), NOT a literal swap. Attempt it ONLY if you can prove byte-identical behavior; if
there is ANY ambiguity or it requires threading the state-child entry into the :170 walker,
DO NOT do it — leave :170 reading the shared imported set and record the payloadBindings
swap as a noted RESIDUAL in your deliverable. The shared-module extraction alone fully
satisfies this item.

## Tests / verification

- Add a tiny `compiler/tests/unit/engine-statechild-grammar.test.js` asserting the exported
  sets' exact membership (regression guard for the SSOT).
- **Full `bun run test`** (incl. browser): identical pass/skip/fail counts to the baseline
  you recorded at startup (this is a no-behavior-change refactor — ANY count delta is a
  regression you must explain or fix).

## DELIVERABLE

Files changed (line ranges), the new module path, confirmation the codegen reserved set
matched (or the divergence report), the payloadBindings-swap disposition (done / residual +
why), the baseline-vs-after `bun run test` counts (must match), HEAD SHA + branch. Commit
to your branch; `git status` clean. The sPA file-deltas your changed files onto `spa/ss2`.

Do NOT push. Do NOT touch main. Do NOT change any diagnostic behavior.
