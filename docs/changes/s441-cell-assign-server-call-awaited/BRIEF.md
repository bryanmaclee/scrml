change-id: s441-cell-assign-server-call-awaited

HIGH silent-wrong-data fix: `@cell = serverFn()` is emitted as a fire-and-forget async IIFE, so the next statement reads the OLD value and successive writes race (arrival order decides the final value). Base: origin/main (cf62b4154 or later).

CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (incident counter: 0 this session)
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`; `git rev-parse --show-toplevel` == pwd; tree clean; `git merge-base HEAD origin/main` == `git rev-parse origin/main`. Else STOP and report.
2. `bun install`; `bun run pretest` plainly from the worktree CWD (`bun --cwd … run` silently no-ops).
3. Every Edit/Write: absolute path UNDER your worktree. Never `cd` into /home/bryan-maclee/scrmlMaster/scrml (main). NEVER `git stash`. NEVER `pkill -f`/`killall` on a shared command string. Scratch under your worktree or /tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/3d8eae9f-f153-45e9-9c40-317c40f0c614/scratchpad/s441-cell12/, never a drive root.
4. First commit: this prompt verbatim → `docs/changes/s441-cell-assign-server-call-awaited/BRIEF.md` + `progress.md`; message `WIP(s441-cell-assign-server-call-awaited): start at $(pwd)`. Commit after each meaningful change (code + its test together, never split). Append timestamped progress lines.
5. Pre-commit hook = core suite: commit FOREGROUND, long timeout; never `--no-verify`, never touch core.hooksPath; `git commit -F <file>` for backtick/`${}` messages.

MAPS — REQUIRED FIRST READ: `.claude/maps/primary.map.md` (stamp fb21983a; verify against source). Report whether load-bearing.

A SIBLING agent is concurrently fixing un-awaited server calls in inline-handler / `on mount` bodies and async-helper escape (emit-event-wiring.ts, emit-reactive-wiring.ts, local-async-fns.ts, emit-expr.ts, emit-server.ts). Stay out of those files unless the root genuinely lives there — if it does, STOP and report before editing, so the PA can sequence.

GOVERNING SENTENCE: SPEC §13.2 (compiler/SPEC.md ~7898): "The compiler SHALL insert `await` at every call site where a server-generated fetch call is made." RULING (bryan S440 JS-WAT #12, /home/bryan-maclee/scrmlMaster/scrml-support/user-voice-scrml.md): "`@cell = serverFn()` fired detached is fixed in impl#1 as a §13.2 conformance restoration — an explicit S435-policy exception ('silent wrong data in the most common server-call shape adopters write')."

GAP: `g-cell-assign-server-call-fired-detached` in docs/known-gaps.md (read in full, plus its named siblings `g-failable-cell-load-fire-and-forget-stale-read-dead-return` and `g-reactive-write-member-server-call-no-autoawait`). PA-reproduced: `@out = double(21); console.log(@out)` logs `0`; `@out = double(1); @out = double(2); @out = @out + 100` logs `100` and ends `4`. Emitted `(async () => _scrml_cs_reactive_set("out", await _scrml_fetch_double_5(1)))().catch(…)` inside an already-async function, while `const a = double(1)` IS awaited. Locus hypothesis (PA-located, NOT traced — verify, report held/refined/wrong): compiler/src/codegen/emit-client.ts, the whole-result `_scrml_reactive_set(name, await stub())` → async-IIFE rewrite. Find WHY the IIFE exists (it may exist for a context that is NOT async — top-level init, a sync callback); the fix is to await in place wherever the enclosing function is (or is made) async, and to keep correct behavior where it genuinely cannot be. Check the two siblings: if they share the root, fix them in the same mechanism; if not, report.

Also consider (report, fix if same root): the same shape in other write forms — `@x.field = serverFn()`, `@x += serverFn()`, `@list = [...@list, serverFn()]`, `reset`-adjacent writes, and inside `if`/loops (body-split/CPS paths, §19.9.3).

BEFORE CODING: reproduce on base; version-stamped reproducers into `docs/changes/s441-cell-assign-server-call-awaited/repro/` (compiler SHA + command + expected vs actual). Prove by EXECUTION (run the emitted server+client, or a harness like existing integration tests that exercise server stubs) that the value is stale / order-dependent, then fixed.

TESTS: unit/integration for each shape; a conformance case (codes + runtime halves) pinning read-after-write ordering.

PHASE 3 — EMPIRICAL (do NOT mark DONE without it): recompile examples/*.scrml, docs/readme-snippets/tasks-app.scrml, and /home/bryan-maclee/scrmlMaster/scrml-site (into scratch, not its dist/); grep emitted client JS for the symptom `(async () => _scrml_cs_reactive_set(` (and variants) — report the command + count before/after (remaining ones must each be justified). Then `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail` (0 fail) + `bun conformance/run.ts` (pass/total vs base). Direction-of-change: this should be SEMANTICS-CHANGED toward the contract (same source, now correct) — report the artifact diff summary over the corpus so the PA can see exactly which emitted files changed.

`git push -u origin HEAD`. REPORT: worktree, branch, FINAL SHA (== pushed tip), files touched, locus verdict, why the IIFE existed, repro before/after, sibling verdicts, empirical grep before/after, corpus artifact-diff summary, suite numbers, deferred. `git status` clean before DONE.
