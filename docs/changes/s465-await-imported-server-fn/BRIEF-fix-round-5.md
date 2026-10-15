# BRIEF — s465-await-imported-server-fn, FIX ROUND 5 (dispatched by S464 PA, 2026-10-12)

## The bug (P0, LIVE ON MAIN)
Gap `g-imported-async-server-fn-not-awaited-s465` (HIGH): an async helper imported from another `.scrml` file is called WITHOUT `await` in server code, so `if (!check(pass, hash))` tests a Promise (always truthy) — a WRONG PASSWORD IS ACCEPTED. Governing sentence: SPEC §13.2 (auto-await; read it in full before editing).

## Where the work is
Branch `origin/auto/s465-await-imported-server-fn` @ `55cdda9d8` (4 fix rounds done by the S465 cloud run). Its `docs/changes/s465-await-imported-server-fn/progress.md` + `BRIEF*.md` carry the full history — read progress.md FIRST. Round 4 closed the class by making the server TEXT path refuse any call it cannot lower from the tree.

## Round-5 review verdict: FIX (the reviewer re-executed every earlier finding on 55cdda9d8: all closed; corpus 0 newly failing). Open findings — treat as CLAIMS: reproduce each before fixing (relayed, PA-unverified; the reviewer's probe files died with the cloud container, so rebuild the shapes):
1. **HIGH** — `firstCallInText` (`compiler/src/.../brace-pair.ts`, PA-located-verify) (a) misses a callee named `of` (it is in NOT_CALLEE_WORDS), and (b) reads `/` after postfix `++`/`--` as a regex start. Either lets a ParseError hatch that holds a call slip to the raw rewriter → un-awaited call. Probe shapes: a hatch containing `of(x)` where `of` is an imported async helper; `i++ / check(a,b)`-style text after a postfix op. **Reviewer's suggested fix (preferred — root, fail-closed): refuse ANY ParseError hatch whose text contains `ident(` rather than trusting the scanner.** Measure the corpus impact of that refusal (compile, don't grep); report the count.
2. **MED** — block-bodied server function VALUES now route through `emitServerFnValueFromText` → tree path, which (a) emits a destructured arrow param as `__destructured__` (ReferenceError; gap `g-tree-path-destructured-arrow-param-s465`) and (b) refuses legal bodies containing `switch`/`try`/`for…in`/`throw` or the word `await` inside a string (E-CODEGEN-INVALID-LOGIC) that base ran. Fix so legal bodies compile and run as on base; destructured params must work. (`switch`/`try`/`throw` are NOT scrml — §7.2.1 — but if they reach this path in legal host positions the regression vs base is the bug; verify which positions and say.)
3. **LOW** — `check(…).then(…)` now throws (500) instead of silently doing nothing. Decide by the SPEC (§13.2/§19.9.8: no Promises in scrml) and report; do not widen.

## Done when
All three fixed or adjudicated by execution, new tests that FAIL without the fix (prove the bite), the pre-commit gate green, a corpus emit differential vs origin/main (report newly-refused / changed counts), branch pushed. Do NOT open or merge a PR; the PA reviews and lands.

## Rules
- Work ON the branch: after startup, `git fetch origin auto/s465-await-imported-server-fn && git switch -c s465-await-r5 origin/auto/s465-await-imported-server-fn`, then `git merge origin/main` (resolve generated docs by regenerating with their scripts). First commit: archive this brief verbatim as `docs/changes/s465-await-imported-server-fn/BRIEF-fix-round-5.md` with message `WIP(s465-await-r5): start at $(pwd)`.
- Commit after each change; append timestamped lines to progress.md. Push your branch to `origin s465-await-r5` when done (and at least once mid-way).
- Keep tool output small (pipe through tail/grep). Scratch goes in `<worktree>/.tmp/`; TMPDIR=~/.cache/scrml-agent-tmp/s465-await-r5/ set per command; delete .tmp before the final report.
- Never `git stash`; never a bare `pkill -f`/`killall`; never `--no-verify`.
- Other PRs are being merged to main while you work; that is expected — merge origin/main again before your final push.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (incidents so far this session: 0)
1. `pwd` must start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` must equal it; tree clean. If not → STOP and report.
2. `bun install`, then `bun run pretest` from the worktree CWD (NOT `bun --cwd <path> run`, which silently no-ops).
3. Every Read/Edit/Write uses an absolute path UNDER your worktree. Never write to `/home/bryan-maclee/scrmlMaster/scrml/<anything not under .claude/worktrees/agent-…>`. Never `cd` into the main checkout; use `git -C <worktree>`.

## Final report
Worktree path, final SHA, files touched, per-finding verdict (held / refined / wrong, with the reproducing command), the corpus counts, deferred items.
