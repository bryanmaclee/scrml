# progress — boot-trim Tier 1 (S375)

worktree: /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a43028c478d6d1232

## Step 1 — orphan derivation (RE-DERIVED, corrects the brief)

The brief listed 8 orphans (S75 S98 S235 S246 S249 S275 S314 S342). Re-derivation finds **2**.

Method: the brief's probe anchored on `^## `/`^### ` headings but tested SESSION IDs, not BLOCKS.
The changelog uses TWO heading conventions — `## S<N> — <date>` (top of file) and
`### <date> — S<N>` / `### <date> (S<N> ...)` under `## Recently Landed` and the version sections.
Testing both conventions, and testing per-BLOCK rather than per-ID, gives:

- S75  — NOT an orphan. Appears in §0 only at line 115 (§0.3 audit deliverables, `A6-2 S75`). §0.3 STAYS; nothing deleted.
- S98  — NOT an orphan. Appears only at line 89 (Architecture decision, STAYS) and line 134 (§0.4, STAYS).
- S235 — NOT an orphan. Its entire §0 content is carried by changelog `### 2026-07-03 (S236 ...)` — that block's
         second half IS the S235 narrative, filed under the S236 heading. A heading-anchored ID probe cannot see that.
- S246 — **TRUE ORPHAN.** Zero mentions anywhere in the changelog; every distinctive token absent
         (E-STYLE-CONFLICT, css-conflict-dryrun.ts, 10d54ff3, 59776df8).
- S249 — NOT an orphan. Appears in §0 only as a cross-reference inside the S263 chain segment;
         the same fact is carried at changelog L1747 ("E-ATTR-012 ... ratified-dropped at S249").
- S275 — **TRUE ORPHAN.** Only a meta-note survives (changelog L1613, under ## S276) which itself states
         S275's record exists nowhere else. Distinctive prose absent: STOP-IF-BIGGER, the two shell-composition models.
- S314 — NOT an orphan. Cross-reference only, inside line 79's S316 block; changelog L673 carries the S314 crash+recovery.
- S342 — NOT an orphan. Cross-reference only, inside line 49's S352 block; changelog L6620/L6682 carry the `git gc` finding.

Direction of error: the brief OVER-reported (5 false positives, 0 false negatives) — the safe direction.

## Step 2 — orphans MOVED verbatim (this commit)

- S246 -> docs/changelog.md, new `### 2026-07-07/08 (S246 ...)` block inserted immediately above `### 2026-07-07 (S245 ...)`.
- S275 -> docs/changelog.md, new `## S275 — 2026-07-20 ...` block inserted immediately above `## S274 — 2026-07-20 ...`.
- Body text is byte-identical to the §0 source; each carries a provenance note naming this change-id.

## Step 3 — master-list.md §0 rotated (this commit)

KEPT (Rule C):
- §0 heading + a new pointer line naming docs/changelog.md as the narrative SoT.
- The S322 FREEZE-CAMPAIGN-PAUSED banner — all 7 lines, byte-identical, untouched.
- S286: the (2) V1-freeze-bar-TIMING-RELAXED RULING half, byte-identical. Dropped the (1)
  chunk-namespacing session report (changelog L1469) and the dangling
  'the ... framing below is superseded on the TIMING axis' clause, whose target was rotated out.
- The V1 REFRAME definition — master-list.md:41 chars [0:836], byte-identical, ending
  '...per-Nominal V1-scoping dispositions.' The S232->S280 PROGRESS chain (chars 837-29685) rotated.
- **Spec target:** and **Architecture decision (S59 -> S98 corrected):** lines, both intact.
- §0.1 phase table / §0.2 locks / §0.3 audit / §0.4 open questions / §0.5 A1a / §0.6 @generated
  — VERIFIED byte-identical (§0.6 never hand-edited).

ROTATED OUT (Rule A/B), 51 blocks: S311 S302 S301 S299 S286(half) | the mega-line chain
S232 S234 S235 S246 S255 S256 S259 S260 S261 S263 S264 S265 S266 S268 S269 S271 S272 S273 S274
S275 S276 S277 S278 S280 | and the standalone paragraphs S372 S371 S368 S352 S347 S346 S338
S337 S335 S331 S330 S328 S326 S282 S288 S290 S292 S305 S316 S313 S307 S296.

MEASUREMENTS (chars / bytes, UTF-8):
- §0 banner region (lines 9-90 -> 9-27): 100,085 -> 7,806 chars  (-92.2%)
- §0 total (incl. §0.1-§0.6):          136,741 -> 44,462 chars  (138,580 -> 45,040 bytes, -67.5%)
- master-list.md whole file:           220,761 -> 128,482 chars (223,733 -> 130,193 bytes)
- head (lines 1-8) and tail (## A. Compiler core onward, 407 lines): VERIFIED byte-identical.

@gap token count went 3 -> 2: the lost one was a PROSE mention of the marker name inside the
S307 narrative ('pa-base v2.9 mandated locus= on the @gap marker'), not a gap marker. The real
ledger is docs/known-gaps.md (untouched, hard boundary).

## Step 4 — compiler/SPEC-INDEX.md Sections-table rewrite (this commit)

46 of the 71 Summary cells rewritten to their navigational core. The other 25 were already
navigational (short, no dated amendment prose) and are left BYTE-IDENTICAL:
  TOC, 1, 2, 8, 9, 11, 20, 25, 27, 29, 30, 32, 35, 36, 37, 43, 44, 45, 46, 49, A, B, C, D, E

Method + safety check: an automated token-preservation gate extracted every section pointer
(§N.N.N / §N.N.X) and every diagnostic code (E-*/W-*/I-*) from each OLD cell and asserted it
still appears in the NEW cell. It caught 17 real drops on the first pass and 7 more on the
second (tighter) pass — including two codes I had abbreviated with a shared prefix
("E-ENGINE-PAYLOAD-ON-UNIT-VARIANT / -ARITY-MISMATCH / -RESERVED-COLLISION"), which would have
broken a grep for the full code names. All restored.

ONE deliberate, reviewed drop: the superseded name W-NULL-IN-SCRML-SOURCE was removed from the
§6 and §42 cells and KEPT ONCE in the §34 cell (the code catalog) as "W-ABSENCE-IN-SCRML-SOURCE
(renamed from W-NULL-IN-SCRML-SOURCE)" — so a grep for the old name still lands, in the right place.

MEASUREMENTS (chars):
- Summary column:  52,754 -> 35,762  (-16,992, -32.2%)
- Sections table:  56,742 -> 39,750  (-29.9%)
- whole file:      87,743 -> 70,751 chars / 89,919 -> 72,931 bytes (-18.9%)
- Quick Lookup:    VERIFIED byte-identical (305 lines, 29,091 chars) — kept intact per the brief
- preamble:        VERIFIED byte-identical
- row count:       76 -> 76 (no row added or lost)

REQUIRED CHECK — regen does NOT revert:
  md5 before regen: c7868cc6ac64c4f38c80889a47039ae0
  bun run scripts/regen-spec-index.ts  ->  "Updated 0 rows; missing 0"
  md5 after  regen: c7868cc6ac64c4f38c80889a47039ae0   (IDENTICAL)
Mechanism confirmed by reading the script: it matches ^| key | name | range | size | and
re-emits the summary via line.slice(m[0].length), i.e. verbatim.

## Step 5 — gates (LAST step, after all edits)

`bun scripts/state.ts --check`  -> initially STALE on @generated:recent-sessions (master-list §0.6).
  That block was stale AT BASE, not from this work: `state.ts --write` added `8731799d` (the
  session-start maps commit, a `wrap`-class anchor). None of this dispatch's own commits are
  wrap anchors, so they do not appear. Regenerated via the sanctioned --write path (never hand-edited).
  Diff confirmed to touch ONLY the bytes between the @generated START/END markers.
`bun scripts/state.ts --check`  -> PASS (all @generated sections current)
`bun scripts/facts.ts --check`  -> PASS (facts-table + facts-lists current)
Two WARN-only, not gated, pre-existing: maps 6 commits behind HEAD; digest stale.

## Hard boundaries — VERIFIED untouched
`git diff --name-only 8731799d HEAD --` over docs/PA-SCRML-PRIMER.md, docs/known-gaps.md,
compiler/SPEC.md, hand-off.md, handOffs/delta-log.md, compiler/src/, scripts/ returns EMPTY.
../scrml-support/** never opened for write. No --no-verify after the first WIP commit (which was
reset and redone under the hook); core.hooksPath never touched.

## FILES TOUCHED
  master-list.md            §0 rotated + §0.6 regenerated
  docs/changelog.md         +2 moved orphan blocks (S246, S275)
  compiler/SPEC-INDEX.md    46 of 71 Sections-table Summary cells rewritten
  docs/changes/boot-trim-tier1-2026-08-25/{BRIEF.md,progress.md}

## CORRECTIONS TO THE BRIEF (4)
1. ORPHANS: 8 claimed, 2 real (S246, S275). S235 IS carried — by the changelog's
   `### 2026-07-03 (S236 ...)` block, whose second half is the S235 narrative filed under the S236
   heading. S75/S98/S249/S314/S342 appear in §0 only as cross-references inside blocks that either
   STAY (§0.3, §0.4, the Architecture-decision line) or whose facts the changelog carries anyway.
   Root cause: the probe tested SESSION IDs, not BLOCKS, and anchored only on the `## S<N>` heading
   convention — the changelog also uses `### <date> — S<N>` / `### <date> (S<N> ...)` under
   '## Recently Landed' and the version sections. Adding that second convention moved 13 more
   sessions from apparent-orphan to duplicated. Error direction was SAFE (over-report, never under).
2. The mega-line is master-list.md:41, not :40, and is 29,685 chars, not ~35,000.
3. The ~35,000-char §0 target is unreachable while honoring Rule C: §0.1-§0.6 alone is ~36,656
   chars and Rule C says all of it stays. §0 landed at 44,476 chars — banner region 100,085 -> 7,806
   (-92.2%), which is the part Rule C actually governs.
4. The DONE-PROBE (`wc -c < master-list.md` < 90000) is arithmetically unsatisfiable within the
   ratified scope: sections A-P (~83k bytes, out of scope) + §0.1-§0.6 (~37k bytes, Rule-C protected)
   already exceed 90,000 before §0's banner region is counted. File landed at 130,208 bytes.

## JUDGMENT CALL FLAGGED FOR OVERRULE
The S286 banner was SPLIT rather than deleted whole: its (2) V1-freeze-bar-TIMING-RELAXED ruling is
kept byte-identical (Rule C: a current ruling), its (1) chunk-namespacing session report is rotated
(changelog L1469). I also dropped the trailing clause 'the "NOT big feature builds" framing below is
superseded on the TIMING axis' because that framing was itself rotated out — the pointer would dangle.
Lines 87 (**Spec target:**) and 89 (**Architecture decision:**) were kept WHOLE: they are standing
definitions, not session banners, and together cost 3,114 chars. Line 89 does contain a dated
'Status as of S111' fragment; I judged it live-charter status rather than session narrative.

## NO-LOSS ACCOUNTING — all 51 rotated blocks

MOVED (Rule B, commit 09ab464f) — 2 blocks, verbatim:
  S246 -> docs/changelog.md `### 2026-07-07/08 (S246 ...)`, above `### 2026-07-07 (S245 ...)`
  S275 -> docs/changelog.md `## S275 — 2026-07-20 ...`, above `## S274 — 2026-07-20 ...`

DUPLICATED (Rule A) — 49 blocks, each with its carrying changelog block:
  S311->L715  S302->L7070 S301->L826  S299->L1003 S286->L1469 S232->L2051 S234->L2033
  S235->L2013 S255->L1820 S256->L1795 S259->L1774 S260->L1763 S261->L1751 S263->L1739
  S264->L1726 S265->L1706 S266->L1695 S268->L1677 S269->L1668 S271->L1650 S272->L1641
  S273->L1629 S274->L1615 S276->L1605 S277->L1589 S278->L1573 S280->L1545 S372->L5
  S371->L110  S368->L160  S352->L6614 S347->L387  S346->L401  S338->L453  S337->L6735
  S335->L515  S331->L6764 S330->L548  S328->L6793 S326->L582  S282->L1497 S288->L1361
  S290->L1261 S292->L7129 S305->L7034 S316->L669  S313->L6947 S307->L6988 S296->L1077
  (line numbers are pre-move; S246/S275 insertion shifts those below them)

CONTENT-LEVEL PROOF (not just heading existence): every #PR / commit-SHA / g-<gap> / E-* / W-*
token was extracted from each rotated block and looked up in the changelog.
  49 of 51 blocks: 75-100% token coverage.  S246: 0% (the orphan — hence the move).
Residuals, each verified recoverable elsewhere:
  g-nested-flatpage, g-tenant-channel-sse-per-subscriber-filter,
  g-spa-runtime-gzip-budget-knife-edge, g-fn-state-diagnostics-source-unreachable
    -> ALL FOUR present in docs/known-gaps.md, the canonical ledger (§0 was never the ledger).
  fe14c9b2 (S313) -> a real commit in this repo, recoverable from git.
  80b72a43 / 976f98ac (S263) -> NOT valid objects here; they were HELD-BRANCH tips for the
    E-SQL-004 work that subsequently LANDED at S264 (changelog L1726). Obsolete pointers.
  E-DIAGNOSED / E-LINE / E-BASE / E-READABLE -> regex artifacts of the prose words RE-DIAGNOSED,
    FIVE-LINE, RE-BASE, MACHINE-READABLE. Not codes.
  W-AUTH-002 / E-MARKUP-002 -> both present in the changelog (the extractor ate a trailing hyphen).
@gap markers in master-list.md went 3 -> 2; the lost one was a prose mention of the marker NAME
inside the S307 narrative, not a marker. flograph.ts/state.ts read the real ledger, unaffected.
