# progress — probes fix round (ruling-debt + inbox-stranded)

Append-only. Timestamps are UTC-ish local (`date -u`).

## 2026-08-19 — startup
- Worktree verified, `git fetch origin runtime-size-and-probes && git reset --hard FETCH_HEAD` -> base `5a8f2375`.
- `bun install` OK. BRIEF.md archived verbatim (`7e89efa5`).

## 2026-08-19 — ruling-debt rewrite committed (`f12b6c85`)
Single commit carrying F1 + F2 + F3(part 2) + F5 + F9 for `scripts/ruling-debt.ts`:
- **F1** every read accounted (`readErrors[]`): unresolvable support root, missing/unreadable
  `docs/`, unlistable directory, unopenable candidate, queue with zero authoritative table rows.
  Degraded runs print `⛔ COULD NOT ENUMERATE` in the summary line and a `NOT A CLEAN BILL OF
  HEALTH` block naming what failed; the `✓` is suppressed. Exit stays 0 in every state.
- **F2** queue resolved off the canonical checkout — `git rev-parse --path-format=absolute
  --git-common-dir` (exact for a worktree family), sibling-name walk as the no-git fallback,
  `SCRML_DPA_QUEUE` override preserved. Resolved path + origin + table-row count are printed.
- **F3 part 2** advisory line: artifacts carrying `rung:`/`routes-to:`/`requested:` but no
  `authority-needed:`. Measures **9** — matches the review.
- **F5** linkage anchored to dpa-debt.ts's own anchors: an authoritative TABLE ROW
  (`/^\|\s*(dpa-\d+)\s*\|/`) or a `key: value` field line inside a `## dpa-NNN` item WHOSE ID IS
  IN THAT TABLE. Bold-prose `**Artifact:**` lines no longer count.
- **F9** `N of M` (`3 of 822`).

### proofs already captured
- F1 missing-`docs/`: OLD `0 · 0 · 0` + `✓`; NEW `⛔ COULD NOT ENUMERATE` naming the path. exit 0 both.
- F1 unreadable subdir: OLD silently dropped `docs/locked/hidden-ruling.md` and printed clean
  counts; NEW names the EACCES directory. Healthy re-run (chmod 755) finds `2 of 2`, no `⛔`.
- F2 from this worktree: queue resolves to `/home/bryan-maclee/scrmlMaster/scrml/handOffs/dpa-queue.md`.

### next
- F5 fixture proof (prose-only vs table-anchored vs orphan-item), F2 two-sided proof,
  `inbox-stranded` F1, `DPA-SCRML-AMENDMENT.md`, delete `scripts/_OLD-*.ts` scratch copies.
