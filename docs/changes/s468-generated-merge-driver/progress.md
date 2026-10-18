# progress — s468-generated-merge-driver (append-only, timestamped)

- 2026-10-17T19:20-06:00 START at /home/bmacs/scrmlMaster/scrml/.claude/worktrees/agent-a2349a6c14f8a2e29,
  branch s468-generated-merge-driver from origin/main 555114695. `bun install` (puppeteer postinstall exited 1 —
  browser download; not load-bearing for tooling work), `bun run pretest` OK.

- 2026-10-17T19:30 PREMISE MEASURED — the brief's "regenerate from the merged working tree" is FALSE inside a
  driver. Scratch repo (git 2.55): during the driver for b.gen, sibling a.txt (changed only by theirs) still read
  `base` in the working tree, MERGE_HEAD absent; same under `git rebase`. merge-ort merges in memory, checks out at
  the end. → design is TWO PHASES: (1) driver = pure function of %O %A %B: mask generated regions, merge hand text,
  regenerate SELF-CONTAINED gap-counts exactly from the merged text (state.ts exported `gapCountsSection`, the ONE
  producer), provisional section-level 3-way for CROSS-FILE content (FACTS, SPEC-INDEX totals+row ranges,
  recent-sessions, bootstrap report) + record pending in `git rev-parse --git-path scrml-generated-pending`;
  (2) `--regen` after the merge completes, auto-run by new post-merge / post-rewrite(rebase) hooks.
- Also measured: a CLEAN textual merge of gap-counts is wrong when both sides add one HIGH (identical change kept
  once) — so gap-counts is ALWAYS regenerated, not only on conflict (unit test pins it against plain merge-file).
- Gap-id invariant refined: brief's literal `ids(A) ∪ ids(B) ⊆ ids(result)` false-fails a deliberate one-side
  deletion; implemented: union minus ids a side deleted (present at base), plus a no-duplication check.
- Generated surface found: known-gaps gap-counts (self), master-list recent-sessions, FACTS facts-table/lists,
  SPEC-INDEX totals + the Lines/Size cells of every Sections row (the rows are hand-written summaries with generated
  cells — masked per-cell), bootstrap-conformance.md (wholly generated). `.claude/maps/*.generated.md` untracked.
- Found: docs/known-gaps.md ~L668-674 carries a STRAY half gap-counts table + lone END marker (residue of a past
  hand-resolved conflict). Harmless to state.ts (first START/first END) and to the driver (unpaired END = hand
  text); left in place — not this unit's to delete, reported.
- 2026-10-17T19:40 PROOFS (scratch CLONE at ~/.cache/scrml-agent-tmp/s468-generated-merge-driver/scratch, its own
  config; main clone config untouched): pair cfor→main and #1447→#1448 resolve with 0 markers, all gates PASS;
  sweep of all 9 open PRs into main: 8 clean + gates PASS + gap-id union preserved; s468-rulings-spec STOPS on its
  hand-written entry hunk (1 conflict, labels HEAD/up/s468-rulings-spec); resolved keep-both + `--regen` → PASS.
  Bites: corrupted gap-counts (HIGH 99999) + FACTS row → regenerated; misfiled @gap inside generated region →
  GAP-ID SELF-CHECK FAILED, merge stops, marker block caught by conflict-marker-gate. Rebase path: post-rewrite
  regen → PASS. SPEC-INDEX pair (rulings into cfor) → plain conflicts, driver clean, regen fixes 29 rows.
- Gap ledger: g-parallel-prs-conflict-on-committed-generated-docs-s460 flipped resolved (option (b)); state/facts --write.
- 2026-10-17T19:55 TRANSITION MEASURED — a merge reads .gitattributes from OURS' working tree: an old PR branch
  merging a main that HAS the `merge=scrml-generated` lines ran the driver 0 times (info/attributes off) vs 2 times
  (on). → install.sh mirrors those lines into the clone's info/attributes as a managed, re-derived block.
- Unit tests strip GIT_* from spawned git env (the pre-commit hook exports GIT_INDEX_FILE; a temp-repo git command
  inheriting it would act on the real index). Verified by running the file with a bogus GIT_INDEX_FILE.
- NOT changed (needs a ruling — gate change): pre-push could refuse while a pending record exists, closing the
  hand-conflict path for gap-counts / recent-sessions (the only paths no pre-push currency check covers).
- Commit 2 (feature) in the hook; commit 3 = ledger flip + this file.

## PAUSED (S468 wrap)

- 2026-10-17 paused on the coordinator's wrap instruction. FEATURE COMPLETE; the only thing outstanding was this report.
- **Done:** scripts/git-merge-generated.ts (the driver + `--regen` + `--pending`); state.ts exports `gapCountsSection`;
  post-merge and post-rewrite hooks (phase 2); install.sh (per-clone driver config + an info/attributes mirror);
  .gitattributes; README; 16 unit tests; the ledger entry g-parallel-prs-conflict-on-committed-generated-docs-s460
  marked resolved. Pre-commit gate on every commit: 37448 pass / 125 skip / 13 todo / 0 fail.
- **Proven (scratch clone, its own config):** all 9 open S468 PRs merged into main. 8 merged with 0 markers and state.ts,
  facts.ts and SPEC-INDEX `--check` all PASS. s468-rulings-spec stops on its hand-written entry hunk. The pair
  #1447 into #1448 is clean. The rebase path passes. A SPEC-INDEX row-range pair merges clean. Two bites shown: a
  corrupted section is regenerated, and a dropped gap id fails the self-check.
- **Next (PA):** land the branch with a file-delta. Then run `./scripts/git-hooks/install.sh` once from the MAIN
  checkout, or run the two `git config merge.scrml-generated.*` lines and the info/attributes mirror by hand.
  Rulings still open: (1) should pre-push refuse while a pending record exists? (2) should two PRs adding ledger
  entries at the same spot be merged by keeping both (a union), which would stop the s468-rulings-spec kind of stop?
  (3) should the stray half table at known-gaps ~L668 be deleted?

## RESUMED (S469, branch s469-merge-driver)

- 2026-10-17T22:03-06:00 RESUMED in worktree agent-a3008128d4bfb5fb7 from origin tip 2d0fb1f78 + the unpushed
  ledger commit (applied from the backup patch) + the PAUSED note above (the uncommitted diff). bun install
  (puppeteer postinstall exit 1 — browser download, not load-bearing), pretest OK. Ruling (2) is answered by the
  S469 brief title ("union gap entries"). Remaining: an idempotent install on the pretest path, a fail-closed
  fallback when bun or the script is unavailable, a UNION of same-spot gap-entry additions, and the bite proofs.
