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
