S448 PA dispatch — change-id s448-test-tmp-root. TEST-INFRASTRUCTURE change (bunfig + a test preload + test files). It does NOT change impl#1 compiler behaviour; compiler/src is out of scope except where noted. bryan authorized this S448 ("go on layers 1 and 2").

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE
1. `pwd` must start with /home/bryan/scrmlMaster/scrml/.claude/worktrees/agent- and equal `git rev-parse --show-toplevel`; `git merge-base HEAD origin/main` must equal `git rev-parse origin/main`. Else STOP and report.
2. `bun install`; then `bun run pretest` run plainly from your worktree CWD (NOT `bun --cwd`), and confirm samples/compilation-tests/dist/ was produced.
3. Every Edit/Write uses an absolute path under your worktree root. Never `cd` into /home/bryan/scrmlMaster/scrml. Never `git stash`. Never `pkill -f` on a shared command string (other sessions run the same suite on this machine).
4. First commit `WIP(s448-test-tmp-root): start at $(pwd)`; commit after every change; append timestamped lines to docs/changes/s448-test-tmp-root/progress.md; archive this brief verbatim at docs/changes/s448-test-tmp-root/BRIEF.md in commit 2.

## MAPS — REQUIRED FIRST READ
.claude/maps/primary.map.md (watermark ~464c9ab4d) — follow its routing for test infrastructure. Treat as hypothesis; verify against source.

## The problem (measured by the PA, S448)
On this machine /tmp is on a spinning disk and systemd deletes it at every boot. The last boot spent 1h45m in systemd-tmpfiles-setup deleting ~1M files. The dominant source is THIS REPO'S TEST SUITE: one run of `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance` (the pre-commit hook) leaves ~3,900-6,700 files in ~860 top-level dirs in the temp dir. 529 test files call tmpdir()/mkdtemp; ~100 have no cleanup, and many with cleanup still leak (e.g. compiler/tests/unit/class-dynamic-import-reject.test.js leaves 212 `cdireject*` dirs per run; protect-scalar-egress.test.js, g-sql-row-protect-leak.test.js, route-inference-e-route-002.test.js are other big ones). Every agent commit runs this hook, so the count compounds to ~500k files/day.

## The fix — ONE place, not 529 files
Give bun test a single per-process temp root that is deleted when the process exits, so every test (and every child process it spawns) inherits it via TMPDIR, whether or not the test cleans up after itself.
1. Add a test preload (e.g. compiler/tests/_support/tmp-root-preload.js — choose a name consistent with existing helpers) registered via `[test] preload = [...]` in the root bunfig.toml. Keep bunfig's existing comment block intact and add a short comment explaining the preload and why.
2. The preload: creates `<base>/<pid>-<random>`, sets `process.env.TMPDIR` (and TEMP/TMP for the windows CI job) to it, and removes it recursively (force) on process exit; also on SIGINT/SIGTERM/SIGHUP (then re-raise/exit with the right code). bun's `os.tmpdir()` reads TMPDIR at call time (PA-verified), so this covers tmpdir()/mkdtemp callers.
3. ⚑ `<base>` MUST NOT be inside any git repo or any directory with a scrml.toml ancestor. compiler/src/codegen/chunk-namespace.ts (comment near line 68) and project-root discovery walk UP looking for scrml.toml / .git; tests that build throwaway projects in tmpdir rely on finding NEITHER. A repo-local `.tmp/` would silently change what those tests test. Use `${XDG_CACHE_HOME:-$HOME/.cache}/scrml-test-tmp` (os.homedir() based; works on the windows runner). Verify the chosen base has no .git/scrml.toml ancestor at startup; if it does, fall back to os.tmpdir() (the old behaviour) and print one warning line — fail SAFE for test semantics.
4. Stale-root pruning: on preload start, remove sibling roots older than 24h whose pid is not alive (crash leftovers). Never remove a live process's root — two suite runs on this machine overlap routinely.
5. If TMPDIR is ALREADY set by the caller to something outside /tmp (e.g. an agent pointing it at its own scratch), still create the per-process root UNDER that caller's TMPDIR? Decide: the simplest correct rule is "always use <base>/<pid>-<rand>" unless env SCRML_TEST_TMP_BASE overrides <base>. Document the choice.
6. The suite also contains ~98 hardcoded `"/tmp/..."` strings (git grep -nE "['\"\`]/tmp/" -- compiler/tests). Classify them: most are fake file paths passed to the compiler and never written — leave those. Any that actually WRITE to /tmp: switch to os.tmpdir(). Report the counts (written vs not).
7. Do NOT fix the separate leak of `scrml dev --__dev-child` server PROCESSES (compiler/tests/commands/dev-watcher-churn-starvation.test.js etc.) — out of scope; mention it if you see it.

## Proof (all required; do not report DONE without them)
- Measure /tmp before/after a FULL `bun run test` (and separately the pre-commit subset): count entries owned by you directly under /tmp created during the run, by comparing a listing taken just before against one just after (filter to names created during the window; other processes on this machine also write /tmp, so attribute by the test-name prefixes, e.g. cdireject, scrml-protect-*). Target: ZERO test-created entries in /tmp, and the per-process root gone after exit (and its base dir holding no leftover for your pid).
- Bite proof: disable the preload (comment out the bunfig line) → the same measurement shows the leak returns → restore → zero again. Record the numbers.
- Kill test: start the suite, SIGINT it after ~20s, confirm its root was removed.
- Gates: pre-commit subset 0 fail; top-level compiler/tests/*.test.js; browser/lsp/self-host tiers if they run under the same bunfig (check — CI's `gate` runs unit+conformance+gauntlet and a browser NAME-SET gate; a renamed or newly-failing browser test is a red gate). Compare fail sets against origin/main, not just counts.
- Windows: you can't run the windows job, but reason about the TEMP/TMP + path handling and note it.
- While measuring, set nothing else in /tmp yourself: put your own scratch under <worktree>/.tmp-scratch/ and delete it before reporting.

Report: final SHA, files touched, the measurement table (before / after / bite), the hardcoded-/tmp classification, gate results, anything deferred. Do NOT push or open a PR — the PA lands.
