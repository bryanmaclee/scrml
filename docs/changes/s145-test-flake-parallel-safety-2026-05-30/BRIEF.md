# BRIEF — s145-test-flake-parallel-safety-2026-05-30

> Archived verbatim per pa.md S136. Dispatched S145 (2026-05-30) via `scrml-dev-pipeline`, `isolation: "worktree"`, `model: opus`, background. Agent ID `a200385af9321d410`. From main HEAD `53203851`. Goal: make the 3 parallel-load-flaky tests parallel-safe so the pre-push gate stops forcing `--no-verify` pushes (S144 + S145 both hit it).

---

scrml compiler TEST-INFRA fix (no compiler-logic change). Change-id: `s145-test-flake-parallel-safety-2026-05-30`. Make 3 known parallel-load-flaky tests parallel-SAFE so the pre-push full-suite stops flake-blocking pushes (it has forced `--no-verify` pushes at S144 + S145).

# MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` in full; Task-Shape Routing for test work. Maps reflect HEAD `9ab7aa38` (~37 commits behind); verify against source.
Feedback line in report: maps load-bearing or not.

# STARTUP + PATH DISCIPLINE (BEFORE any other tool call)
S99 path-leak counter = 20; don't make #21.
1. `pwd` MUST start with `/home/bryan/scrmlMaster/scrmlTS/.claude/worktrees/agent-` (else STOP+report, S90). Save WORKTREE_ROOT.
2. `git rev-parse --show-toplevel` == WORKTREE_ROOT. 3. `git status --short` clean. 4. `bun install`. 5. `bun run pretest`. Use `bun run test` for baselines.
PATH (S126): ALL edits via Bash (`perl -i`/`python`/heredoc) on worktree-absolute paths incl. the `.claude/worktrees/agent-<id>/` segment — NOT Edit/Write. Echo path before each write; re-verify via `git diff`. NEVER `cd` outside WORKTREE_ROOT; use `git -C "$WORKTREE_ROOT"`, run bun from WORKTREE_ROOT.

# THE 3 FLAKES (pass in isolation, FAIL under parallel full-suite load)
1. `compiler/tests/.../self-compilation.test.js` — self-host parity: bootstrap `ts.scrml` + `ast.scrml` self-compile. In isolation 22/22 pass; under parallel load they fail (timeout / interference). (Find the exact path via grep.)
2. `compiler/tests/integration/trucking-dispatch-smoke-integration.test.js` — the "two-compile determinism" case (manifest.compiler stable across two consecutive compiles). In isolation 13/13 pass; under parallel load the determinism assertion fails.

# DIAGNOSE FIRST, THEN FIX (do NOT just blindly bump timeouts)
Likely root causes to investigate: (a) SHARED temp/output dirs — two tests writing to the same `/tmp/...` or `samples/.../dist` path concurrently → fs interference / races; (b) tight timeouts on slow self-compile/bootstrap under parallel CPU contention; (c) shared global state / fixtures; (d) the two-compile-determinism test reading an artifact another test is mid-rewrite of. Find the ACTUAL interference root for each (grep the tests for temp-dir creation, output paths, timeouts, shared fixtures; check if they use unique per-test mkdtemp dirs or shared ones).

Fix PROPERLY + minimally, preferring (in order): (1) isolate filesystem — give each test a UNIQUE `mkdtemp` dir (not a shared/fixed path); (2) if the test is order/parallel-sensitive by nature (self-host bootstrap, two-compile determinism), mark it to run SERIALLY (bun:test `test.serial` / a serial describe / a concurrency guard) so it doesn't race the rest of the suite; (3) raise timeouts ONLY where the operation is genuinely slow (self-compile bootstrap) and contention is the cause — with a comment explaining why. **Do NOT weaken or remove any assertion** — the parity + determinism checks must remain exactly as strict. The goal is to remove the RACE, not the check.

# ACCEPTANCE
- Run the FULL suite `bun run test` (parallel, as the pre-push hook does) and confirm 0 fail — repeat it 3 times to confirm the flakes are gone (they're intermittent, so one green run isn't enough; 3 consecutive clean full-suite runs is the bar).
- The 3 tests still pass in isolation (assertions intact).
- No other test regresses; no compiler-source (`compiler/src/`) change — this is test-infra only (test files + possibly a test helper). If you find the flake is actually a real compiler non-determinism bug (not a test race), STOP and report — that's a different (bigger) fix.

# COMMIT DISCIPLINE (S83+S99): commit per edit via `git -C "$WORKTREE_ROOT"`; FIRST commit msg includes verbatim startup `pwd`; NO `--no-verify`; clean `git status` before DONE.

# FINAL REPORT: WORKTREE_PATH · BRANCH · FINAL_SHA · FILES_TOUCHED · per-flake ROOT CAUSE found + the fix applied · the 3x-consecutive-clean-full-suite result (pass counts) · confirmation assertions are unchanged · test-infra-only confirmation (no compiler/src change) · maps line · deferred.
