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
