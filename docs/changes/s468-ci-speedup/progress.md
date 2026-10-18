# s468-ci-speedup — progress (append-only)

- 2026-10-17 start: WIP(s468-ci-speedup) at /home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-ae01353de7cb9b0cf,
  branch s468-ci-speedup from origin/main a46405246. BRIEF.md = COMMON.md + BRIEF-ci-speedup.md verbatim.
- Baseline (run 39078887384, PR #1446): gate 1185 s (unit+conformance 463, host-global 309, browser 114,
  bootstrap slice 107, snippet 63, e2e-render-map 55); tracking 659 s (integration+lsp+commands 488,
  browser 82, bootstrap-conformance 67); windows 788 s (unit+conformance 655, e2e 79).
- Branch protection (read-only check): required_status_checks.contexts = ["gate"], app_id 15368
  (GitHub Actions), strict=true, enforce_admins=true. NOT changed.
- Timing survey (60 CI runs, s464..s468): gate 750-1269 s; tracking 472-929 s; windows 493-943 s. Queue delay
  (run created -> first job start) 3-43 s in every run sampled — the "25+ min pending" was not reproduced in
  this window. CI bun = 1.4.3 (setup-bun resolves engines ">=1.3.13" to latest) — has `--shard` + `--timings`.
- tracking failures in the window: 4/60, ALL `§2 stopping scrml dev mid-respawn … SIGTERM`
  (compiler/tests/commands/dev-child-dies-with-parent.test.js), always "the edit never produced a respawned
  child" after ~15.5 s. windows failures 5/60 (bind-address 20 s timeout, §4 seeded fuzz 5 s timeout, S27
  §51.11 timer audit) — windows is non-required; listed, not touched.
- Flake root cause (traced): dev.js logs "Serving …"/"Watching for changes…" and only THEN snapshots each
  source (`watchFile` -> `snapshotOf`) and registers the dir watch. The test (another process) edits the entry
  on seeing "Serving"; an edit that lands before the snapshot is baked into the snapshot and never seen.
  PROVEN by forcing it: a scratch copy of the OLD test that edits right after spawn fails deterministically
  with the CI message; the same forcing on the NEW test passes. Fix = test re-edits (750 ms cadence) until a
  respawned child exists. FIXED, not moved. (dev.js log-before-watch ordering is a real but minor UX
  inaccuracy — deferred, out of the tooling-only scope.)
- Merge queue: owner.type = "User", public; GraphQL `repository.mergeQueue(branch:"main")` = null. GitHub
  merge queues require an ORGANIZATION-owned repo -> NOT available. Not enabled.

## PAUSED (S468 wrap)
DONE (committed on s468-ci-speedup):
- db82533ba WIP start (BRIEF.md verbatim + this log).
- 7c5a25463 dev mid-respawn SIGTERM flake FIXED in compiler/tests/commands/dev-child-dies-with-parent.test.js
  (root cause + forced-race proof above). Local: 3/3 green; forced pre-snapshot edit: old FAILS with the CI
  message, new passes.
- (this commit) WIP .github/workflows/ci.yml rewrite + scripts/ci-shards.ts — NOT YET RUN IN CI:
  * jobs: checks · unit (i/3) · integration (i/3) [integration+lsp+commands PROMOTED, incl. security-await-pack]
    · browser (gauntlet + browser NAME-SET gate, once) · slices (self-host-v2 slices + e2e-render-map)
    · host-global (4 legs by --modes: default,test | esm,library | embed | build) · gate = AGGREGATOR
    (`if: always()`, needs all blocking jobs, fails on any non-success incl. skipped/cancelled, then
    `bun scripts/ci-shards.ts reconcile` proves each sharded suite is an exact partition of its test files)
    · tracking (bootstrap count/severity only; bootstrap check de-duped vs the blocking PR step)
    · windows (non-required; runs on push main / nightly schedule / dispatch / PRs touching path-handling
    paths, decided in-job from the PR merge commit's two parents, fail-closed).
  * concurrency group now includes event_name (nightly vs push on main don't cancel each other).
  * scripts/ci-shards.ts reconcile verified locally on lsp (2 legs): exact partition -> exit 0; a dropped leg
    -> exit 1 with each missing file named. Enumeration matches bun: 1284 unit+conformance files (= CI's
    "Ran 28724 tests across 1284 files").
MEASURED: baseline gate 1185 s (run 39078887384); 60-run survey above. Merge queue: NOT available
(user-owned repo; mergeQueue = null) — not enabled. Branch protection read only, unchanged (contexts ["gate"]).
NEXT:
1. Open PR "ci(S468): parallel gate + sharded tests + security tests gate merges" from s468-ci-speedup (do NOT merge).
2. From its run: per-job times, aggregator wall time, reconcile totals (unit expect 1284 files / ~28.7k tests;
   integration+lsp+commands vs tracking's old count). Download test-report-* artifacts ->
   `bun scripts/ci-shards.ts merge-timings scripts/ci-test-timings.json <each timings.json>`; commit; rebalance
   host-global legs / shard counts from measured times.
3. Bite proof: branch s468-ci-bite-proof off this branch + a failing test in compiler/tests/lsp/ (the pre-commit
   hook does not run lsp, so no --no-verify needed; the now-required integration job does) -> DRAFT PR ->
   record `gate` red -> close PR + delete branch.
4. Watch for: snippet-gate / facts / compile-floor now run without pretest (none reads samples dist per grep);
   unit shards run without pretest (windows always did). Deferred: dev.js logs "Serving/Watching" before the
   watch exists (minor, compiler/src, out of scope); windows-only flakes (bind-address 20 s, §4 seeded fuzz 5 s,
   S27 §51.11 timer audit) — non-required job, untouched.
No scratch bite-proof branch/PR was created.

## S469 resume
- Resumed at /home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-a535997af4314ccf6, branch s469-ci-speedup from
  origin/s468-ci-speedup 747b8675f; merged origin/main ee827e697 (31 commits, none touching .github/ or
  scripts/ci-shards.ts) as 4c58d03e1 (pushed). Maps read (stamp 5c43c3b8e): NOT load-bearing for a workflow change.
  PR #1455 scripts/test-sharded.ts is still OPEN and is a LOCAL multi-process runner (memory/slot/timeout machinery);
  CI legs are separate runners, so they keep bun's native --shard + --timings (same LPT-by-duration idea) — no
  logic duplicated, nothing to import.
- Local recheck: bun 1.4.3 --shard/--timings/--update-timings/--reporter=junit on lsp 2 legs + reconcile = exact
  partition; an absent scripts/ci-test-timings.json is tolerated by bun.
- Baseline refreshed: main push run 39129462417 (ee827e697) — gate 18m52s; unit+conformance 1288 files / 28815
  tests (444 s); tracking integration+lsp+commands 342 files / 7413 tests (700 s).
- host-global legs: hand-written mode list replaced by `--mode-shard i/4` in scripts/host-global-scan.ts (legs =
  ALL_MODES round-robin, complete by construction); unknown --modes names now exit 2 (previously a typo silently
  compiled with default options under the wrong label).
- First real run, PR #1459 (run 39137191221, 40d42f25f): ALL GREEN. `gate` concluded 331 s after the run was
  created (was 1132 s on main run 39129462417) — 5.5 min vs 18.9 min. Critical path = integration 1/3 (309 s,
  unbalanced: no timing table yet). Per job (s): checks 110 · unit 127/163/163 · integration 309/209/161 ·
  browser 133 · slices 152 · host-global 114/75/84/128 · gate 16 · tracking 114 · windows 709 (non-required;
  ran because ci.yml is in its path filter). Runner time 2767 s incl. windows (baseline run 2594 s incl.
  windows); ~2058 s on a PR that does not trigger windows. Queue delay 3-4 s for every job.
- Coverage (reconcile in that run, same SHA): unit+conformance 1289 files (expected 1289) / 28830 tests —
  the UNSHARDED windows run of the same SHA: 1289 files / 28828 tests; integration+lsp+commands 343 files
  (expected 343) / 7436 tests (old tracking on ee827e697: 342 files / 7413 tests in bun's own count). Every
  old-gate step is present in exactly one new job (step-by-step diff of main's ci.yml vs this one); the
  self-host-v2-lexer filter now runs inside the integration suite. Nothing dropped.
- Rebalanced: scripts/ci-test-timings.json committed (1632 per-file timings merged from the run's 6 shard
  artifacts via `ci-shards.ts merge-timings`); integration 3 -> 4 legs (~620 s of test time vs ~410 s unit).
- PA update (S469): repo transferred to the scrml-lang ORGANIZATION (owner.type Organization verified; rulesets
  []; required_status_checks contexts ["gate"] strict; GraphQL mergeQueue(main) = null = not configured yet).
  ADDED `merge_group:` trigger: every blocking job + `gate` run unconditionally on it (no event `if:` on
  any of them — verified by parsing the YAML); tracking + windows skip merge_group (non-blocking; they run on
  the queue's push to main). PR-base steps fall back to merge_group.base_sha. Settings untouched.
- Bite PRs opened: #1461 (failing lsp assertion), #1462 (slices forced skipped).
- Run 2 (39142073562, e08348f3e, 17 jobs): green, but WAITED ~19 min for runners (first ubuntu job started
  at +1136 s, with three other runs in flight right after the org transfer; the Free org plan allows 20
  concurrent jobs). Durations once running: integration 4 legs 123-222 s, unit 140-162 s, host-global 79-134 s,
  slices 186 s, gate 11 s; runner time 2803 s incl. windows 610 s. A 17-job fan-out is the wrong shape under
  a 20-job org cap, so the legs drop to unit 2 · integration 2 · host-global 2, and each test leg runs
  `bun test --parallel` (worker processes, implies --isolate). Local check (32 cores, --parallel=4): unit+conf
  1288 files / 28815 tests 0 fail in 106 s; integration+lsp+commands 342 files / 7413 tests 0 fail in 120 s;
  junit under --parallel reconciles as an exact partition. 11 jobs a run (9 blocking + gate + tracking), plus
  windows when the path filter matches.
- Bite proofs DONE (both throwaway PRs closed, branches deleted): #1461 (failing assertion in
  compiler/tests/lsp/workspace-l2.test.js) -> run 39139592294 "integration: failure" -> gate FAIL; #1462
  (slices `if: false`) -> run 39140391972 "slices: skipped" -> gate FAIL ("failure, cancellation and skip all
  count"). Coverage note: the CI file count can exceed a local enumeration because pull_request runs test the
  PR MERGED with current main (run 1 included compiler/tests/unit/s468-identity-read-raw-text.test.js from main).
- Run 3 (39146319438, c8cf901fc, `--parallel` legs): RED, and the bite worked as designed. integration 1/2
  failed with two 5 s per-test TIMEOUTS under CPU contention (emit-block-analysis "(e) byte-determinism"
  5000.66 ms, expr-node-corpus-invariant "12-snippets-slots" 6994 ms) and `gate` failed. unit 2 legs under
  --parallel passed (201/239 s) but were no faster than 3 serial legs (127-163 s). VERDICT: --parallel REJECTED
  on 4-vCPU runners (a required gate must not buy speed with load-sensitive timeouts). Final shape: unit 3 ·
  integration 3 (timing-balanced) · host-global 2 (194/157 s measured) · checks · browser · slices = 11
  blocking jobs + gate + tracking (+ windows when the path filter matches) — 13-14 jobs, down from 17.
