# unit-id: s468-generated-merge-driver — stop PRs conflicting on generated content (ruled S468 item 1)
Problem: every PR regenerates the same tracked generated content, so ANY two open PRs conflict and every merge to main
re-conflicts every other PR (S468: 9 open PRs all `dirty`). Generated content (find every producer: `grep -rn
'@generated' docs master-list.md compiler/SPEC-INDEX.md` + scripts/facts.ts, scripts/state.ts,
scripts/regen-spec-index.ts, gen-bootstrap-severity, bootstrap-conformance report): docs/FACTS.md (wholly generated?
verify), the `@generated:*` START/END sections inside docs/known-gaps.md, master-list.md, compiler/SPEC-INDEX.md, and
any other generated report (docs/bootstrap-conformance.md?). Read each script's header first.
BUILD a custom git merge driver:
 - `scripts/git-merge-generated.ts` (or .sh) invoked as `%O %A %B %P`: run git's normal 3-way merge on the file
   (`git merge-file`), then for every `@generated` section (and for wholly-generated files, the whole file) DISCARD the
   conflict and REGENERATE that section from the merged working tree using the existing producer scripts' `--write`
   (they read sources — e.g. state.ts reads the @gap markers, so known-gaps' ENTRY hunks must already be merged when the
   count section is regenerated: order matters; document it). Exit non-zero (leave conflict markers) if any conflict
   remains OUTSIDE generated sections — hand-written entries must still need a human/agent 3-way.
 - `.gitattributes` entries mapping the files to `merge=scrml-generated`; an install step in
   scripts/git-hooks/install.sh (and README) that sets `git config merge.scrml-generated.driver …` (merge drivers are
   per-clone config — say so; agents' worktrees share the clone's config).
 - The gap-id union invariant (memory feedback_mixed_generated_doc_conflicts): the driver must never drop an entry;
   add a self-check (union of @gap ids of both sides ⊆ result) that fails the merge loudly.
PROVE IT: construct real conflicting pairs from today's open PRs (e.g. merge origin/s468-cfor-comma-lists into a
branch at origin/main, and #1447 into #1448's branch) in a scratch worktree with the driver installed: generated-only
conflicts resolve with zero markers and `bun scripts/state.ts --check` + `bun scripts/facts.ts --check` + SPEC-INDEX
check pass; a hand-written entry conflict still stops. Also prove the unproven-gate bite: corrupt a section → the
driver regenerates it; drop a gap id → self-check fails.
Tooling only (scripts/, .gitattributes, docs) — no compiler/src. Pre-commit hook; push after every commit.
