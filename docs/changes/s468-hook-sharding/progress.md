# s468-hook-sharding progress (append-only)

- 2026-10-17T19:25 start at /home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-a321f808b1d3d32ff; branch
  s468-hook-sharding from origin/main 555114695. bun install (puppeteer postinstall failed — irrelevant to the hook
  tiers), pretest OK. core.hooksPath -> MAIN checkout scripts/git-hooks, so the OLD hook runs on my commits as the
  brief requires. Load avg at start: ~21 on 32 cores. BRIEF.md = COMMON.md + BRIEF-hook-sharding.md concatenated
  verbatim.
- 2026-10-17T19:50 scripts/test-sharded.ts written (enumerate -> LPT plan over per-file junit times, cached at
  ~/.cache/scrml/test-timings.json, EMA; parallel `bun test` per shard; --bail stops all; integrity check that each
  shard ran exactly its assigned file count; TOTAL line). Hook set = 1591 files. Smoke: conformance-only sharded OK;
  first full sharded run (no --bail, plan from conformance-only timings) = 37432 pass / 0 fail / 125 skip / 13 todo,
  37570 tests / 1591 files, 271.6s wall, load 22->20 (my own first-commit hook was running concurrently).
  Longest files (loaded): trucking-dispatch-smoke 112s, corpus-bridge 99s, bootstrap-conformance-counter 94s,
  await-probe-pack 92s — critical path floor ~2 min. Sum of per-file times 1424s.
- Hooks wired: pre-commit + pre-push's full-suite path call the runner unless SCRML_HOOK_SHARDS=1 (or the branch lacks
  the script) -> exact original command. pre-push reads counts from the runner's TOTAL line.
- NOTE: integration tests use repo-relative `compiler/tests/integration/_tmp_<name>` scratch dirs (one per file, so
  no intra-run collision), but two concurrent FULL runs in the same worktree share them -> measurement runs are never
  overlapped with my own commits.
- 2026-10-17T20:15 commit 2 (runner + hooks) landed + pushed; its OLD-hook sequential run: 37432/0/125 skip/13 todo,
  37570 tests / 1591 files, 820s — the same counts the sharded run reported.
- MEASURE attempt 1 (alternating seq/shard, --bail both): round 1 seq 659.1s (load 12.3->8.6, peak RSS 2.5 GB) vs
  shard 127.1s (load 8.6->18.8, peak RSS 7.4 GB), identical counts. Round 2 seq 781.8s OK; round 2 SHARD FAILED:
  `reserved-double-prefix-s457.test.js` "round-5 leak through `scrml serve`" — its health-poll `fetch` went through
  happy-dom (CORS preflight OPTIONS -> 404 "Cross-Origin Request Blocked"). Measurement stopped (my PIDs only).
- ROOT CAUSE: `unit/is-predicate-in-function-expression-1333.test.js` registers happy-dom (GlobalRegistrator) and
  never unregisters, so every LATER file in the same process gets happy-dom's Request/Response/fetch/URL/...; the
  sequential order happened to put it after the files it breaks, the shard plan put it before one. Bite: origin/main
  copy of the file + reserved-double-prefix-s457 in one process -> 1 fail (deterministic); with the fix -> 0 fail.
  FIX (isolation, not skip/pin): afterAll unregister, same shape as transition-css-soft-nav-reachable.test.js.
- SYSTEMATIC SWEEP (not just the one observed): every one of the 1591 files run ALONE followed by a probe file in
  the same process (probe reports non-native web globals, window/document, globalThis key set, cwd, env hash).
  Before fix: exactly one file leaves happy-dom/non-native globals (the one above). After fix: 0 files; all 1591
  files pass alone (exit 0, 0 fail; summed pass = 37432 = suite total) -> no file depends on a predecessor.
  Residue, judged harmless: ~140 files leave scrml-RUNTIME globals (`_scrml_perf_*`, `__scrml_db_scope_als`,
  `__scrml_session_store(s)`, `__scrml_tenant_req_als`, test-local `__get__`...), which the sequential run already
  accumulates in arbitrary combinations; none changes cwd or env.
- Runner: failure report now prints only the failing file sections (tail 150 lines each) + summary; full shard log
  kept under ~/.cache/scrml/test-sharded-runs/<pid>-*/ (pruned after 24h), not $TMPDIR.
