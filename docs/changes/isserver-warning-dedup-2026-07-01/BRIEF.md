# BRIEF — isServer-block warning double-fire dedup (S234, 2026-07-01)

The S233 hand-off reports: the isServer-block warning family DOUBLE-FIRES because `annotateNodes`
visits a state-decl twice — `W-AUTH-001` + the two S233 codes `W-SERVERLOAD-UNGATED` +
`W-SSR-PRERENDER-UNSCOPED` each emit twice. Family-wide. This is a diagnostic-noise defect (not a
correctness bug): the same warning appears twice on one decl.

## R26 REVERSE-DIRECTION MANDATE (S138) — reproduce BEFORE fixing
This symptom is HAND-OFF-REPORTED, not PA-reproduced. **Phase 0 = reproduce it empirically** before
any fix:
1. Construct a minimal `.scrml` that fires each of `W-AUTH-001`, `W-SERVERLOAD-UNGATED`,
   `W-SSR-PRERENDER-UNSCOPED` and COUNT the occurrences per code in the diagnostic stream. >1 = the
   double-fire. Fire-sites to study: `W-AUTH-001` at `compiler/src/route-inference.ts:4094`; the two
   new codes at `compiler/src/type-system.ts:9592` + `:9613`; `annotateNodes` def at
   `type-system.ts:6976`, invoked at `:20030`.
2. If a code does NOT double-fire after genuine effort, do NOT force a fix — file **NOT-REPRODUCED**
   in your report with the empirical per-code count table + the most-likely reason (e.g. the S233
   observation was of a transient state, or the codes fire once each). Verify against base 495a041b.
3. If it DOES double-fire: root-cause the double-visit (is `annotateNodes` walking the decl twice, or
   is it two independent fire-sites for the same condition?) and dedup **the family** — either make
   `annotateNodes` visit once, or dedup the emitted diagnostics by (code, node-span) at the family's
   emission point. Prefer the ROOT fix (single-visit) over a downstream de-dup filter if the root is
   a clean double-walk; if the two fires are genuinely two paths, a (code,span) de-dup is acceptable —
   state which and why.

## Scope guard
Diagnostic-dedup ONLY. Do NOT change which conditions fire the warnings, the messages, or any
codegen — only that each fires ONCE per decl. Add a regression test asserting single-fire per code.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
Worktree under `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-<id>/`.
1. `pwd` MUST start with that prefix (else STOP — S90). Save as WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` == WORKTREE_ROOT; `git status --short` clean.
3. `bun install`; `bun run pretest` (gitignored dist for the browser suite).
Edits via **Bash** (perl/python3/heredoc) on worktree-absolute paths incl. the `.claude/worktrees/agent-<id>/`
segment — NEVER Edit/Write, NEVER a main-rooted path, NEVER `cd` into main (use `git -C "$WORKTREE_ROOT"`).
First commit message includes verbatim `pwd` (S99).

# MAPS — read `.claude/maps/primary.map.md` first (Task-Shape: compiler-source bug fix). Maps ~5 commits
stale (HEAD 495a041b vs map 04e7a1bb) — verify against live source. Report: "Maps consulted: …; load-bearing: <line>" or "not load-bearing".

# COMMIT + REPORT
Incremental commits (`git -C "$WORKTREE_ROOT"`). Full `bun run test` GREEN before DONE (regression test
passes + zero regressions); never `--no-verify`. Report: WORKTREE_PATH · FINAL_SHA · FILES_TOUCHED ·
the empirical reproduce result (per-code count before/after) · root-cause · REPRODUCED-and-fixed OR NOT-REPRODUCED.
