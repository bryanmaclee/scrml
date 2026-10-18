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
