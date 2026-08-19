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

## 2026-08-19 — ruling-debt proofs complete (two-sided, all four findings)

**F2 · four runs, one shell invocation so the live queue could not drift.**
The two queue files are genuinely different artifacts: `277,273 B` (worktree,
`c2fd356b…`) vs `323,140 B` (canonical, `9deb4751…`).

```
1. OLD · default            3 ruling-shaped · 0 referenced · 3 BANKED OUTSIDE
2. OLD · pinned canonical   3 ruling-shaped · 2 referenced · 1 BANKED OUTSIDE   <- same probe,
3. NEW · default            3 of 822 · 1 referenced · 2 BANKED OUTSIDE             same instant,
4. NEW · pinned canonical   3 of 822 · 1 referenced · 2 BANKED OUTSIDE             two answers
```
OLD 1≠2 (the bug). NEW 3==4; only the printed ORIGIN differs (`canonical checkout` vs
`SCRML_DPA_QUEUE override`). NEW's `1 referenced` vs OLD-pinned's `2` is the F5 tightening,
not a regression — see fixture A.

**F5 · three fixtures, OLD vs NEW.**
```
A  queue names fx-ruling.md ONLY in prose        OLD 1 referenced · 0 OUTSIDE ✓   NEW 0 · 1 OUTSIDE
B  table row dpa-900 + `artifact:` field line    OLD 1 referenced · 0 OUTSIDE ✓   NEW 1 · 0 OUTSIDE ✓
C  `artifact:` field line, NO dpa-900 table row  OLD 1 referenced · 0 OUTSIDE     NEW 0 · 1 OUTSIDE
```
A is the reviewer's fixture: a passing prose mention permanently silenced the probe. C is the
shape the operator hit live today — dpa-033 ratified into the fenced detail block and not the
table row, where `dpa-debt` correctly still read it ADVISORY. B proves no false positive on a
correctly-banked artifact.

**F1 · four degraded states, all exit 0, none prints `✓`.**
```
missing docs/          OLD "0·0·0 ✓ every ruling-shaped artifact is reachable"   NEW ⛔ names the path
unreadable subdir      OLD silently dropped docs/locked/hidden-ruling.md         NEW ⛔ names EACCES dir
queue with no table    OLD confident counts                                      NEW ⛔ names the queue
healthy re-run         (chmod 755) NEW 2 of 2, no ⛔ — no false alarm
```

**F9** `3 of 822`. **F3 part 2** advisory = 9 artifacts, matching the review.

### next
`inbox-stranded` F1 (`git()` swallows non-zero exits), then `DPA-SCRML-AMENDMENT.md`,
then delete the `scripts/_OLD-*.ts` scratch copies and run `boot.ts`.
