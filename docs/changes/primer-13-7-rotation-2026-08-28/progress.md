# progress — `primer-13-7-rotation-2026-08-28`

**Worktree:** `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a615eac48cfbaf373`
**Base:** `origin/main` @ `a042f3fd08f1da88eb83a24ca5c4225d601ff236` (HEAD == origin/main, verified by `git rev-parse HEAD origin/main`)

---

## F4 startup verification — PASSED

| step | check | result |
|---|---|---|
| 1 | `pwd` under `.../scrml/.claude/worktrees/agent-` | PASS |
| 2 | `git rev-parse --show-toplevel` == WORKTREE_ROOT | PASS |
| 3 | `git merge-base HEAD origin/main` == `git rev-parse origin/main` | PASS — both `a042f3fd` |
| 4 | brief fetched from `brief/s383` | PASS |
| 5 | `git status --short` clean (bar the staged BRIEF from step 4) | PASS |
| 6 | `bun install` | PASS — 218 packages |

---

## Premise re-derivation (the brief asked for this; it does NOT trust its own line range)

Re-derived by grep rather than trusting `1205–1468`:

```
$ grep -n '^## §13\.' docs/PA-SCRML-PRIMER.md
1154:## §13.5 ...
1178:## §13.6 ...
1205:## §13.7 Annotated-AST contracts produced by A1b resolver passes (S65)
1469:## §13.8 Promotion ergonomics ...
```

§13.7 heading at **1205**; next section heading at **1469** ⇒ block = **1205–1468 inclusive**.
`sed -n '1205,1468p' | wc -lc` ⇒ **264 lines / 98,455 chars**. Whole PRIMER: **1,516 lines / 222,802
chars**. 98,455 / 222,802 = **44.19%**. **The brief's range, line count, char count and 44.2% share
all reproduce exactly.**

Block boundary detail: line 1467 is the `---` rule and 1468 the blank that separate §13.7 from §13.8.
Both were carried into the destination so the Phase-3 diff over the brief's exact stated range is
literally empty rather than empty-modulo-trailing-separator.

---

## Phase 1 — destination created

`docs/PA-SCRML-REFERENCE.md` did not exist (verified by `ls`, not assumed). Built by **byte-copy, not
retype**: `sed -n '1205,1468p'` piped to a file, then `cat preamble sep block > dest`. At no point was
the §13.7 text re-authored, reflowed, or read-then-rewritten.

Result: **307 lines / 101,176 chars** = 41-line preamble + 2-line `---` separator + the 264-line block
at lines **44–307**.

---

## Phase 3 — MEASURE BEFORE REMOVING (gate; run BEFORE the deletion was committed)

Side A extracted independently from `origin/main` via git — NOT from the working tree — so a dirty
tree cannot fool the gate.

### Check 1 of 2 — byte-identity diff

```
$ git show origin/main:docs/PA-SCRML-PRIMER.md > $SP/primer-origin-main.md
$ sed -n '1205,1468p' $SP/primer-origin-main.md > $SP/A-from-origin-main.md
$ sed -n '44,307p'    docs/PA-SCRML-REFERENCE.md > $SP/B-from-reference.md
$ diff $SP/A-from-origin-main.md $SP/B-from-reference.md
$ echo "exit status: $?"
exit status: 0
```

**Verbatim diff output: (empty — diff printed nothing, exit status 0).**

Corroborated by size and checksum:

```
   264  98455 A-from-origin-main.md
   264  98455 B-from-reference.md
fed73e87a2cb47a409dbd656ba7f2aa0  A-from-origin-main.md
fed73e87a2cb47a409dbd656ba7f2aa0  B-from-reference.md
```

### Check 2 of 2 — contract-table row-count cross-check

Deliberately counted over the **WHOLE** `PA-SCRML-REFERENCE.md` with no slicing, so a wrong extraction
range would show up here rather than being cancelled out by the same wrong range on both sides.

| metric | A (origin/main PRIMER 1205–1468) | B (whole PA-SCRML-REFERENCE.md) |
|---|---|---|
| table lines (`^\|`) | 27 | 27 |
| data rows (`^\| **`) | **25** | **25** |
| distinct label strings | 24 | 24 |
| `dA-b1` rows | 1 | 1 |

Label sets `diff`ed: **identical**. Labels: `B1` `B2` `B3` `B4` `B5` `B6` `B7` `B8` `B9`
`B10 (Phase 1+2)` `B10 (Phase 3)` `B11`…`B22` `dA-b1 (S156, enum-subset §53.15)`.

⚑ Note for the record: the table is **25 rows / 23 distinct steps**, not 23 rows — `B1` has two rows
(`_record`, `_scope`) and `B10` has two (Phase 1+2, Phase 3). The brief's prose description
"B1–B22 + dA-b1" is accurate as a *step* inventory; it is not a row count.

**GATE PASSED. Deletion authorised.**

---

## Phase 2 — the pointer left behind

PRIMER lines 1205–1468 replaced with a **12-line** stub (the cap was ≤ 12) that keeps the
`## §13.7 …` heading verbatim, links `docs/PA-SCRML-REFERENCE.md`, describes what lives there
(B1–B22 + dA-b1 annotated-AST contracts: field name, node kind, values, read API), and names the
reason (boot-budget rotation, `pa-base v2.16` §2).

The stub's 12 lines include the trailing `---` + blank that separate §13.7 from §13.8, so the
primer's section-separator rhythm is preserved.

**Proof that no other section was touched — `git diff -U0` produced exactly ONE hunk:**

```
$ git diff -U0 docs/PA-SCRML-PRIMER.md | grep '^@@'
@@ -1207,259 +1207,7 @@ Updated row for parseVariant (S65):
$ git diff --numstat docs/PA-SCRML-PRIMER.md
7	259	docs/PA-SCRML-PRIMER.md
```

One hunk, starting at 1207 — the heading (1205) and its following blank (1206) are unchanged
*context*, not re-written lines, and the trailing separator matched too. That is a stronger check
than `--stat`: a stray edit anywhere else in the 1,516-line file would show as a second hunk.

`## §13.7` still present at line **1205**; `## §13.8` follows at **1217**. Acceptance #3 met.

### Post-deletion re-run of the Phase-3 gate

The S375 failure mode is a destination that *stops* carrying the content, so the gate was re-run
after the PRIMER deletion was applied:

```
$ sed -n '44,307p' docs/PA-SCRML-REFERENCE.md > $SP/B2.md
$ diff $SP/A-from-origin-main.md $SP/B2.md
$ echo "exit: $?"
exit: 0
```

Empty. md5 still `fed73e87a2cb47a409dbd656ba7f2aa0` on both sides.

### No leak into the main checkout

`/home/bryan-maclee/scrmlMaster/scrml/docs/PA-SCRML-PRIMER.md` still measures `1516 222802`
(unchanged) and `/home/bryan-maclee/scrmlMaster/scrml/docs/PA-SCRML-REFERENCE.md` does not exist.
All writes went to `WORKTREE_ROOT`-absolute paths or the scratchpad.

---

## Phase 4 — the measured win

| | lines | chars |
|---|---|---|
| `docs/PA-SCRML-PRIMER.md` on `origin/main` @ `a042f3fd` | 1,516 | 222,802 |
| `docs/PA-SCRML-PRIMER.md` on this branch | **1,264** | **125,388** |
| **removed from the boot read** | **252 (−16.6%)** | **97,414 (−43.7%)** |
| `docs/PA-SCRML-REFERENCE.md` (new, not in the boot read) | 307 | 101,176 |

The PRIMER is now **56.3%** of its former size in chars. The block itself was 264 lines / 98,455
chars (44.2%); the net removal is 97,414 chars because the 12-line stub is added back.

⚑ **Line-share and char-share are very different numbers here — 16.6% vs 43.7% — because §13.7 is a
contract table of very long rows.** The overlay's "44.2%" is a CHAR share. Anyone re-measuring this
by line count will think the rotation under-delivered; it did not.

⚑ **NO BOOT-TOKEN FIGURE IS CLAIMED.** `bun scripts/ctx.ts` reads a transcript's own usage records
and can only measure a boot that already happened; it cannot price a future one. Bytes and lines
above are measured. The token effect follows at roughly the ratio the overlay's `{{doc_budget_fills}}`
table records, and the overlay notes the real saving should exceed the byte ratio because an
oversized document is fetched in overlapping chunks and paid for more than once (the PRIMER was read
**five** times at S375) — but that multiplier is not measured here and no number for it is asserted.

**Next honest measurement point:** run `bun scripts/ctx.ts --breakdown` at the END of the first
session that boots against the rotated PRIMER, and compare to the S375 baseline of `~98,044`.

---

## Acceptance

| # | criterion | status |
|---|---|---|
| 1 | `docs/PA-SCRML-REFERENCE.md` exists, §13.7 byte-identical, Phase-3 diff empty | PASS (twice — pre- and post-deletion; md5 match) |
| 2 | PRIMER §13.7 is a stub ≤ 12 lines naming + linking the destination | PASS (exactly 12) |
| 3 | `## §13.7` still exists in the PRIMER | PASS (line 1205) |
| 4 | No other PRIMER section touched | PASS (single `git diff` hunk) |
| 5 | Pre-commit gate green | PASS (docs-only fast path) |
