# BRIEF — S468: land-prep #1434 (await P0, branch s467-await-r10) — merge origin/main, re-prove, push

You are a dev agent on the scrml compiler (TS impl#1, Bun). FIRST: Read `~/.claude/agents/scrml-js-codegen-engineer.md`
IN FULL and follow its directives — you are standing in for that agent (its definition was installed on this machine
after the session started, so it could not be dispatched by name).

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (do this before ANY write)
1. `pwd` MUST start with `/home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-`. If not: STOP, report, exit.
   Call that path WORKTREE_ROOT. `git -C "$WORKTREE_ROOT" rev-parse --show-toplevel` MUST equal it.
2. NEVER `cd` into `/home/bmacs/scrmlMaster/scrml` (the main checkout). Use `git -C "$WORKTREE_ROOT"`, `bun --cwd=…`
   (WITH the `=`; `bun --cwd <path> run x` silently no-ops and exits 0), and absolute paths under WORKTREE_ROOT.
   Edit/Write ONLY absolute paths under WORKTREE_ROOT. There is NO path-discipline hook on this machine — you are the guard.
3. NEVER `git stash` (refs/stash is shared across every worktree). Base/build flips by file copy.
4. NEVER `pkill -f` / `killall` on a command string — kill only by a PID you captured.
5. `export TMPDIR=$HOME/.cache/scrml-agent-tmp/s468-await-land` per command (shell state does not persist); never in /tmp,
   never inside a repo.
6. Your worktree was cut from origin/main. Switch it to the PR branch:
   `git -C "$WORKTREE_ROOT" fetch origin s467-await-r10 && git -C "$WORKTREE_ROOT" checkout -B s467-await-r10 origin/s467-await-r10`
   and assert `git -C "$WORKTREE_ROOT" rev-parse HEAD` == `933c6e51aebdbcb2b80ebc6010ba947f3538116f`.
7. `bun install` then `bun run pretest` from WORKTREE_ROOT (plain, not --cwd).
8. **PUSH AFTER EVERY COMMIT** (`git -C "$WORKTREE_ROOT" push origin s467-await-r10`). A dead machine took S466's only
   copy of a branch. Append timestamped lines to `docs/changes/s465-await-imported-server-fn/progress.md` as you go
   (new section `## S468 land-prep`); WIP commits are expected.

## MAPS — REQUIRED FIRST READ
`.claude/maps/primary.map.md` (stamp `41af4153a`, 2026-10-12) — ⚑ 94 commits STALE vs origin/main `5c43c3b8e`.
Treat every map locus as a hypothesis to verify against source. Report whether the maps were load-bearing.

## Task
PR #1434 (`s467-await-r10`, tip 933c6e51a) fixes the await P0 (wrong password accepted; r8–r10; impl#1 enforces
dpa-023 F4 — SPEC §13.9.6: a waiting function is bound only by a `function` declaration, E-ASYNC-FN-ESCAPES-AS-VALUE).
It is 3 commits behind origin/main (`5c43c3b8e`): #1433 (param-default identity, `3ade9bb48`), #1435 (CPS P0:
CPS-split functions keep server logic/values on the server, `0083fc156`), #1436 (S467 wrap docs). Branch protection
is strict, so it must be brought up to date before merge.

1. `git merge origin/main` (a merge commit, not a rebase). Files both sides touched since the merge-base:
   `compiler/SPEC.md`, `compiler/src/codegen/emit-functions.ts`, `compiler/src/codegen/emit-logic.ts`,
   `compiler/src/codegen/emit-server.ts`, `docs/FACTS.md`, `docs/known-gaps.md`. Resolve every conflict as a REAL
   3-way — understand both sides; never `--ours`/`--theirs` a whole file. ⚑ S467 miss: `checkout --ours` on
   known-gaps.md silently dropped six of main's entries. For known-gaps.md resolve only the count hunk, then prove the
   gap-id set == the union of both sides' ids. Regenerate FACTS (`bun scripts/facts.ts --write`), state
   (`bun scripts/state.ts --write`), SPEC-INDEX if SPEC moved (`bun run scripts/regen-spec-index.ts`).
   A clean textual merge is NOT proof — #1435 and this branch both change how server functions are emitted.
2. Re-prove on the MERGED tree (record every number in progress.md):
   a. the await security pack: `bun compiler/tests/integration/security-await-pack/classify.js` → **0 FAIL** (551 shapes
      at r10). Report the PASS / PASS-REFUSED / PASS-500 / PASS-DENY / UNJUDGED counts and every shape whose class moved
      vs the r10 tip.
   b. #1435's guarantees survive: find #1435's tests (`git show --stat 0083fc156`) and run them, plus the CPS conformance
      cases it added — all pass.
   c. #1433's tests pass.
   d. gates: the pre-commit hook on your merge commit (NEVER `--no-verify`; if it fails, report the exact failure and
      stop — do not bypass) · `bun run types:check` · `bun scripts/facts.ts --check` · `bun scripts/state.ts --check` ·
      `bun scripts/gen-md-shim.ts --check` · the spec-index check · the bootstrap slices as CI runs them.
   e. corpus differential vs origin/main (`scripts/corpus-emit-differential.ts`; roots examples, samples,
      conformance/cases, stdlib): report newly failing / newly passing / diagnostic-code changes / artifact diffs
      (normalise root paths).
3. Push. Do NOT open, merge or comment on the PR; do NOT touch main.

## Report (final message)
WORKTREE_PATH · final SHA (== `git ls-remote origin s467-await-r10`) · each conflict: file, what each side did, how you
resolved it · every gate/probe number above · anything newly failing, and whether it is pre-existing on origin/main
(prove it on an origin/main checkout) · whether the maps were load-bearing.
