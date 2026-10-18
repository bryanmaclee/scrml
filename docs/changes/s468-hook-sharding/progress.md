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

## PAUSED (S468 wrap)

**Done.** `scripts/test-sharded.ts` (enumerate the hook's file set; LPT plan over measured per-file junit times
cached at `~/.cache/scrml/test-timings.json`, EMA, shared by worktrees; one `bun test` per shard; `--bail` stops all
shards; per-shard file-count integrity check; TOTAL line; failure report = failing file sections, full log kept under
`~/.cache/scrml/test-sharded-runs/`). pre-commit + pre-push full-suite path wired to it; `SCRML_HOOK_SHARDS=1` (or a
branch without the script) runs the exact original single-process command. README updated.

**Measured so far (NOT the brief's 5x5 — incomplete).** Shared box, ~10 agents.
| run | wall | load start->end | peak RSS | counts |
|---|---|---|---|---|
| hook seq (commit 1) | 867.9s | ~21 | - | 37432 pass / 0 fail / 125 skip / 13 todo, 1591 files |
| hook seq (commit 2) | 820.4s | - | - | same |
| shard (pre-measure, cold plan) | 271.6s | 22->20 | - | same |
| round 1 seq | 659.1s | 12.3->8.6 | 2.5 GB | same |
| round 1 shard | 127.1s | 8.6->18.8 | 7.4 GB | same |
| round 2 seq | 781.8s | 18.8->10.2 | 2.6 GB | same |
| round 2 shard | 127.2s | 10.2->19.1 | 7.7 GB | FAIL (bail) — the happy-dom leak below |
Speed-up ~5-6x (≈2 min vs 11-14 min). Shards balanced 110-125s each; critical-path floor ~70-110s (trucking-dispatch-smoke,
corpus-bridge, bootstrap-conformance-counter, await-probe-pack).

**Tests isolated.** One: `unit/is-predicate-in-function-expression-1333.test.js` left happy-dom registered ->
afterAll unregister (bite-proven against reserved-double-prefix-s457). Systematic 1591-file alone+probe sweep after
the fix: 0 files leak non-native web globals / window / cwd / env; every file passes alone. No pins, no skips.

**Open concern for the owner.** Peak RSS 7.4-7.7 GB per sharded run vs 2.5 GB sequential (8 shards); with ~10 agents
committing at once that peak is real memory pressure, though GB·s per commit is lower (≈940 vs ≈1650). Recommendation:
keep min(cores/2, 8) but cap N by available memory (≈1 GB/shard) — not done; brief fixed the default formula.

**Next.** (1) Re-run measure.sh (alternating seq/shard, --bail, load + peak RSS recorded) 5x5 on the fixed branch;
need zero flakes + identical counts every run. (2) Decide memory cap. (3) Final report. Scratch harness:
`~/.cache/scrml-agent-tmp/s468-hook-sharding/{measure.sh,rss.sh,probe/}`.

## RESUMED S469 (branch s469-hook-sharding from origin/s468-hook-sharding 68dad3bf7)

- 2026-10-17T22:05 resumed at /home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-a3f36bec616a6c6e4; carried the
  uncommitted PAUSED note; bun install (puppeteer postinstall fails, irrelevant), pretest OK. Load ~9 at start, 25 GB
  available. The shared timing cache ~/.cache/scrml/test-timings.json was ABSENT (first run re-planned by file size —
  the cold fallback works: conformance-only 5 shards, 50.8s, all green).
- 2026-10-17T22:20 runner bounded + memory-aware:
  * N default = min(cores/2, 8, floor((MemAvailable - SCRML_HOOK_MEM_RESERVE_MB[2048]) / SCRML_HOOK_SHARD_MEM_MB[3072])),
    >= 1. MemAvailable read from /proc/meminfo (counts reclaimable cache; os.freemem() fallback). The header line
    prints how N was derived.
  * Every shard spawned `detached` (setsid) = its own process group; ALL kills are `kill(-pgid)` of that group only
    (never by name). Per-shard wall timeout (SCRML_HOOK_SHARD_TIMEOUT_S, 1200) and RSS ceiling summed over the group
    (sampled 1s from /proc, SCRML_HOOK_SHARD_MEM_MB 3072) -> SIGKILL the group, --bail the rest, hook FAILS with
    "TIMED OUT" / "KILLED AT THE MEMORY CEILING", last file header, the shard's assigned files and the tail of output.
    Backstop: coreutils `timeout --kill-after=10 (T+60)` wraps each shard, so a shard is bounded even if the runner
    is SIGKILLed. Runner SIGINT/SIGTERM/SIGHUP kill every shard group. Leftover processes in a finished shard's group
    (a server a test never stopped) are killed at shard exit.
  * BUG FIXED from the S468 runner: a shard killed by a signal the runner did NOT send (kernel OOM killer) was
    classified "stopped" -> no failure, no integrity error -> hook exit 0. Now outcome "signal" = FAIL.
  * Table gains peakMB per shard + a "peak RSS, all shards together" line (the measurement source).
  * Bites (scratch tests outside the repo): hang test + --shard-timeout=8 -> exit 1 at 8.0s "TIMED OUT", other
    shards OK, no leftover PID. 16 MB/20 ms allocator + --shard-mem=1000 -> killed at 1379 MB sample, exit 1
    "KILLED AT THE MEMORY CEILING". External kill -9 of a shard's bun -> exit 1 "KILLED BY A SIGNAL THIS RUNNER DID
    NOT SEND". SIGTERM to the runner -> exit 130, the shard's timeout+bun PIDs gone.
  * Port/global isolation re-checked: every server-starting test in the hook set binds port 0 or a freePort()
    (bind 0, read, close — a TOCTOU window shared with today's 10-agent concurrent sequential runs, not new);
    fixed-number "ports" in the set (3000/7878/8181/4242/4321) are compile-input strings or fakes, never bound.
- 2026-10-17T22:45 commit 84f0e48c5 (bounded runner) landed + pushed (old-hook sequential run on it: 599s, green).
- 2026-10-17T23:00-23:35 MEASURE on the unchanged tree 84f0e48c5, `bash scripts/git-hooks/pre-commit` end-to-end
  (incl. the md-shim check), default N, peak RSS = the runner's own group sampler (sequential: same sampler over the
  hook's process group). Box shared with other agents; load 4.5 -> 11.6 over the series.
  | run | N (derived) | wall | peak RSS total | max shard | result |
  |---|---|---|---|---|---|
  | shard 1 (timing cache cold) | 6 (22.2 GB avail) | 172.3s | 4975 MB | 1858 MB | 37432 pass / 0 fail / 125 skip / 13 todo, 1591 files |
  | SEQUENTIAL (SCRML_HOOK_SHARDS=1) | 1 | 599.6s | 2781 MB | - | same |
  | shard 2 | 5 | 143.8s | 5852 MB | 1925 MB | same |
  | shard 3 | 6 | 121.8s | 6805 MB | 1931 MB | same (expect() calls 1222725 vs 1222724 — one extra expect, no pass/fail change) |
  | shard 4 | 5 | 138.5s | 6150 MB | 2271 MB | same |
  | shard 5 | 6 | 121.9s | 6848 MB | 1936 MB | same |
  | shard 6 (after bite restore) | 6 | 124.2s | 6695 MB | - | same |
  6/6 sharded runs + the sequential run: identical pass/fail/skip/todo/test/file counts, 0 (fail) lines. Speed-up
  ~4.3-4.9x warm (600s -> 122-144s); the cold-cache run was the slowest (172s, shards 53-172s unbalanced) and
  re-balanced itself by run 3 (shards within ~5s of each other). N varied 5/6 with MemAvailable (20-22 GB), by design.
  The one-expect() difference is a test that counts expects conditionally (timing-dependent poll); it never changed
  a pass/fail/skip outcome in 7 runs — noted, not chased.
  Memory: peak total 5.0-6.8 GB sharded vs 2.8 GB sequential; worst single shard 2271 MB, under the 3072 MB
  ceiling (1.35x margin) and under the sequential process's own 2781 MB peak.
- BITE (hook level): compiler/tests/unit/zz-s469-bite.test.js (`expect("sharded").toBe("bitten")`) -> hook EXIT 1
  in 138s: "[s1] (fail) s469 deliberate bite", "===== shard 1 FAILED (exit 1)" with the file path + the assertion
  diff, "FAILED shard(s): 1 (failed)", "✗ Tests failed". Removed -> hook EXIT 0, 125s, totals identical (run 6).
- 2026-10-17T23:55 `bun run test` (= `bun test compiler/tests/`, single process, ALL tiers incl. browser): 40131 pass /
  51 fail / 171 skip, 1769 files, 729s. All 51 are OUTSIDE the hook set except one: 49 in compiler/tests/browser/
  (fail ALONE too — e.g. browser-transitions.test.js alone: 2 pass / 14 fail; this worktree's puppeteer postinstall
  failed), 1 in e2e-render-map, and unit/s457-url-scheme-runtime-guard.test.js — passes alone (49/0) and in every
  hook run, fails only after the browser tier in one process: reproduced with `bun test compiler/tests/browser
  <that file>` (neither the runner nor this branch's test edit is in that set) -> pre-existing cross-tier pollution,
  not this unit's. Not chased (outside the hook's set; flagged for the owner).
- DONE. Hook default = sharded, bounded, memory-aware; SCRML_HOOK_SHARDS=1 = the original command.
