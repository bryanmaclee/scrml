change-id: s449-auth-session-fail-open

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (path-discipline incidents to date: track yours, report 0 or N)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` equals it; clean tree; `git fetch origin` then `git merge-base HEAD origin/main` == `git rev-parse origin/main` (if behind: `git merge --ff-only origin/main`). Any other failure: STOP and report.
2. `bun install`; `bun run pretest` (plainly from the worktree CWD — `bun --cwd <p> run` silently no-ops).
3. EVERY Write/Edit uses an absolute path UNDER your worktree root. Never `cd` into /home/bryan-maclee/scrmlMaster/scrml (main). NEVER `git stash` (the stash is shared across worktrees) — base/build flips by FILE COPY. NEVER a bare `pkill -f` — kill only PIDs you captured. Scratch goes in `<worktree>/.tmp/` (delete before your final report); `TMPDIR` must NOT point inside any repo.
4. First commit: this prompt verbatim → docs/changes/s449-auth-session-fail-open/BRIEF.md, message `WIP(s449-auth-session-fail-open): start at $(pwd)`. Commit after each meaningful change (WIP commits expected); keep docs/changes/s449-auth-session-fail-open/progress.md append-only with timestamps. Code + its tests = ONE commit. Never --no-verify, never touch core.hooksPath. Foreground commits need a long timeout (the pre-commit hook runs ~2-4 min).
5. MEMORY GATE: sibling agents run full suites on this 15 GB machine concurrently. Before every commit and every full-suite run, check `free -g` "available"; if < 6, wait (poll at most 10 times, 60 s apart, then proceed and note it) — an OOM SIGKILL mid-commit loses the commit.

MAPS — REQUIRED FIRST READ: /home/bryan-maclee/scrmlMaster/scrml/.claude/maps/primary.map.md (stamp 6a592ed5c, 2026-10-02; main has since landed only #1231 (docs/maps/SPEC prose) — read the copy in YOUR worktree). Follow its Task-Shape Routing. Treat map content as a hypothesis; report whether it was load-bearing.

Model: you are on Opus. All loci named below are PA-located-verify: report whether each held, was refined, or was wrong.

## Context
Security is the one impl#1 (TS compiler) area still under active change (S447 TS-accounting ruling). This is a cluster of FAIL-OPEN auth/session gaps in docs/known-gaps.md. A sibling agent is concurrently working protect egress round 9 in compiler/src/codegen/protect-flow.ts — do NOT edit protect-flow.ts, and do NOT change the shape of the emitted line `const _scrml_session_store = (globalThis.__scrml_session_store ??= new Map())` (round 9 may model it); if your fix needs to, stop and report. A second sibling owns compiler/src/codegen/sqlite-file-target.ts and compiler/src/commands/dev.js — do not edit those either.

Governing-sentence gate (mandatory, per item): before changing what compiles or how it behaves, QUOTE the governing SPEC sentence (§52.13 auth, §20.5 session store, §40 program attributes, §4.12 nested program, etc.). If you search and find NO governing sentence, that item is a RULING, not a fix: stop on that item, write it up in progress.md under "RULINGS NEEDED (bryan)" with the fail-closed option as the recommendation and a worked example, and move to the next item.

Direction-of-change: label every change inert / newly-rejecting / newly-accepting / semantics-changed. Newly-rejecting owes a MEASURED corpus migration: compile examples/ samples/ conformance/cases/ docs/readme-snippets/ stdlib/ and report the count + files of programs that newly fail (assumed-zero is not measured-zero). A NON-ZERO count stops that item (it goes to RULINGS NEEDED with the file list) — the PA may only land newly-rejecting changes on its own authority when the corpus count is measured zero. Newly-accepting is out of scope. Mark each newly-rejecting gap you close with `prov=pa-ruled:<one-line reason>` on its `@gap` marker in addition to the existing prov.

## Items — verify each on current origin/main FIRST (reverse verify-before-claim: some may already be closed by later landings, e.g. #1062 funnelled session writes onto one store)
1. **HIGH `g-auth-attr-invalid-or-dynamic-value-compiles-to-no-auth`** — `<program auth="Required">` / `auth=" required"` / `auth=${mode}` / `auth=@mode` (and the `<page>` forms) compile to NO auth check: the author asked for a login and got an open app. Reproducers in `docs/changes/s441-csrf-default-under-auth/repro/`. Locus (PA-located-verify): compute-program-config.ts `getAttrValue`, route-inference.ts Step 8a exact-match, attribute-registry.js `auth` supportsInterpolation:false not enforced. Fail closed: an unrecognized/dynamic `auth=` value is a compile error (the attribute is not interpolable), and no diagnostic path may treat it as a gate (W-AUTH-LOGIN-MISSING / I-AUTH-REDIRECT-UNRESOLVED currently do).
2. **HIGH `g-session-ambient-unlowered-trust-boundary-inversion`** — `@session.<field>` in a server function lowers to `_scrml_body["session"].<field>` (the CLIENT request body) → identity written from attacker-controlled input, exit 0. Locus: compiler/src/codegen/rewrite.ts `rewriteServerAtRef` (special-cases only `currentUser`). Read the DD it cites (scrml-support/docs/deep-dives/gh357-session-binding-accessor-shape-2026-08-04.md) and the SPEC for what `@session` means. Whichever way the SPEC answers (lower to the server session, or reject `@session` in favour of `session.x`), the client-body read must become impossible. If the SPEC is silent on which, the INTERIM fail-closed fix (reject with an error naming `session.<field>`) is in scope as newly-rejecting; the shape choice goes to RULINGS NEEDED.
3. **HIGH `g-session-store-keyed-per-compilation-unit-not-per-program`** — verify first; may be resolved by #1062. If live: one store per program per §20.5.
4. **HIGH `g-session-config-bleeds-from-a-sibling-program-and-drops-the-host-prefix`** (locus compiler/src/codegen/index.ts ~:1867) — verify, then fix.
5. **MED `g-emitted-session-store-opens-sqlite-with-no-busy-timeout-or-wal`** — RELAYED; reproduce, then apply the same pragmas `sqlite-defaults.ts` applies to Bun.SQL handles.
6. **LOW `g-session-destroy-route-has-no-csrf-check`** — only if the gap's stated full fix (gate the route under csrf=auto AND route `session.destroy()` through the CSRF retry helper, emitted whenever destroy is reachable) fits cleanly.

## Verification
- Over HTTP for 1, 2, 3, 4: build the reproducer, serve it, show the before/after request outcomes (302 vs 200; identity column value written).
- Tests per item (positive + negative); conformance cases for any new/changed diagnostic (codes-half + runtime-half).
- `bun test compiler/tests/{unit,integration,conformance}` + `compiler/tests/commands/`.
- Update each gap entry (resolved with evidence + SHA, or the fresh measurement).
- Do NOT open a PR. Push `git push origin HEAD:refs/heads/wip/s449-auth-session-fail-open` after each item.

Final report: worktree path, FINAL_SHA, files touched, per item: verified-live-or-already-closed, governing sentence quoted, direction class, migration count, before/after evidence; RULINGS NEEDED list; test counts; path-discipline incidents.
