# BRIEF — s452-effect-summary (archived verbatim at dispatch)

CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (path-discipline incidents to date are non-zero).
1. `pwd` MUST start with /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent- ; `git rev-parse --show-toplevel` == pwd; clean tree. `git fetch origin main`; `git merge-base HEAD origin/main` MUST equal `git rev-parse origin/main` (else `git merge --ff-only origin/main`; if that fails STOP). Expected base ≥ 6538da913 (#1279).
2. Every Read/Write/Edit uses an ABSOLUTE path under YOUR worktree root; never write under /home/bryan-maclee/scrmlMaster/scrml/ outside it; never `cd` into the main checkout.
3. NEVER `git stash`; NEVER `pkill -f`/`killall`.
4. `bun install`, then `bun run pretest` from your worktree cwd. Scratch under "$WT/.tmp/" (delete at end). TMPDIR if set → ~/.cache/scrml-agent-tmp/s452-effect-summary.
5. First commit: archive THIS ENTIRE PROMPT verbatim as docs/changes/s452-effect-summary/BRIEF.md (body `start at $(pwd)`); progress.md append-only, updated after every step. ONE COMMIT PER MIGRATION STEP (M0, M1, M2, M3 — each green on its own, code + tests together). Never --no-verify. Pre-commit timeout 300000. Run git commands singly. Push after EACH step (crash anchor).
6. Push as `feat/s452-effect-summary` (normal push). Do NOT open/merge a PR.

MAPS — REQUIRED FIRST READ: .claude/maps/primary.map.md (stamp d3e660a08; post-map: #1274 bootstrap rulings, #1279 bootstrap pipe lint; #1280 bootstrap determinism is about to land — it touches compiler/self-host-v2/link.scrml, slice-m2/lowered.js and scripts/bootstrap-conformance.ts; avoid those files, and expect to merge main once more). Report whether load-bearing.
AUTHORING scrml: read /home/bryan-maclee/scrmlMaster/scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md (read-only) and mirror the surrounding bootstrap idiom exactly.
CONCURRENCY: other live dispatches are in impl#1 (compiler/src/) and the corpus — stay inside compiler/self-host-v2/ (+ its tests and docs/changes/s452-effect-summary/).

TASK — bryan RATIFIED dpa-066 Approach B (user-voice-scrml.md §S452 "all your recs", item 3, at /home/bryan-maclee/scrmlMaster/scrml-support/ — read it verbatim). THE DESIGN IS THE DEEP-DIVE: /home/bryan-maclee/scrmlMaster/scrml-support/docs/deep-dives/bootstrap-effect-summary-dpa-066-2026-10-04.md — read it IN FULL first (the walker inventory W1–W11, the summary record, per-dimension knowledge/unknowability, the rule → query map, the migration M0–M6 ~:347). Ratified sub-decisions: (3.1) one summary per callable, closed over the call graph by SCC; (3.2) per-dimension unknowability; (3.3) computed in analyze after binding, attached to Core's Fn/ServerFn, re-verified by check (replacing C-S1's and C11's walkers — do that in the step the DD assigns; if the DD assigns it to M4+, leave it); (3.4) "returns a value" in the summary; (3.5) NO effect variables; (3.6) G7 closed in M3 with a test; (3.7) W2 retired in M4 — NOT in this dispatch.

SCOPE: M0, M1, M2, M3 exactly as the DD defines them (M0 shadow + differential test over every slice program and every conformance-counter case; M1 writes as queries, messages byte-identical; M2 placement as queries; M3 binder decisions move to a post-summary rules pass, W8/W9/W1 deleted, G7 closed). STOP after M3. If the DD is wrong about the code (a walker it names doesn't exist or does something else), correct it in progress.md and proceed only if the step is still well-defined; otherwise STOP and report.

Invariants for every step (DO NOT report a step done without them):
- Every existing diagnostic: same codes, same messages (byte-identical), same spans, same order — prove with the M0 differential harness over all slice programs + all counter cases (except where G7's fix newly fires E-ERROR-012 in M3 — list those).
- Counter (`bun scripts/bootstrap-conformance.ts --json` vs main): PASS ≥120, zero bucket moves except G7-explained ones.
- All slices green by path (m1, m1 lowered, m2, m3, m4, codec), severity `--check`, counter doc regenerated + `--check`.
- No regex over source text (Rule 7); fail-closed on any unknown dimension.
- Report measured line deltas (deleted vs added) per step.
FINAL REPORT (<600 words): per step: SHA, what was replaced (walker → query), line delta, differential result; G7 test; counter; anything deferred or contradicted in the DD; `git status` clean.

---

start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-aa218604988ae3314
