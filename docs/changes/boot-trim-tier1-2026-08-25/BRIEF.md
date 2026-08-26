# BRIEF — boot-trim Tier 1: rotate the narrative out of three maintained-tier docs

change-id: boot-trim-tier1-2026-08-25
dispatched: S375-bryan, 2026-08-25
base: `origin/main` @ `8731799d`
RULED: bryan, S375 — "ratify tier 1". Direction is settled; this is execution, not deliberation.
DONE-PROBE: `test $(bun scripts/ctx.ts --json 2>/dev/null >/dev/null; wc -c < master-list.md) -lt 90000 && echo PASS || echo FAIL`

---

## The measurement this exists to fix

`scripts/ctx.ts` (landed this session, PR #708) measured a Profile-A boot at **430,367 tokens = 43.0%
of a 1M window, before any work began** — the highest of 43 boots on record, against an earlier-half
mean of 317,195 (**+15%** and rising). Peak session occupancy now routinely hits 88-96%.

Per-document boot cost, measured:

| document | ~tokens | ~% of boot |
|---|---|---|
| `docs/PA-SCRML-PRIMER.md` | 98,044 | 22.9% |
| **`master-list.md` §0** | **62,922** | **14.7%** |
| session baseline (system prompt + tools) | 55,877 | 13.1% |
| **`../scrml-support/pa-base.md`** | **50,194** | **11.7%** |
| **`compiler/SPEC-INDEX.md`** | **43,208** | **10.1%** |
| `pa-scrml-overlay.md` | 27,004 | 6.3% |

The three bolded documents are this dispatch. (The PRIMER is a separate, unratified call; **do not
touch it.** `pa-base.md` lives in a sibling repo and the PA is handling it directly — **not yours.**)

**The structural point, so you do not treat this as tidying:** every maintained-tier doc here is
APPEND-BIASED. Each session appends a banner, a changelog entry, an amendment note. Boot cost is
therefore a function of session count, growing without bound. `hand-off.md` is the only doc in the
repo that solved this — it ROTATES (live file → `handOffs/hand-off-<N>.md`). This dispatch applies
that same rotation to three more docs.

---

## ⚑ THE CARVE-OUT THAT MAKES THIS SAFE — VERIFY IT, DO NOT TRUST ME

`master-list.md` §0.6 asserts *"Per-session narrative is the changelog dated blocks — the ONE
narrative source of truth (DD3 Fork 1, ratified S171 / executed S173)."*

**That assertion is FALSE for 8 sessions.** I checked all 118 session IDs mentioned in §0 against
`docs/changelog.md` and found narrative that exists ONLY in §0 for:

> **S75 · S98 · S235 · S246 · S249 · S275 · S314 · S342**

A blind delete loses those permanently. So:

- **Rule A — duplicated sessions** (110 of 118): the §0 banner is redundant with a real changelog
  block. **Delete from §0.**
- **Rule B — the 8 orphans:** **MOVE the §0 text into `docs/changelog.md`** at its correct dated
  position FIRST, verbatim, then delete from §0. Never delete an orphan.
- **RE-DERIVE the orphan list yourself** before acting (my probe anchored on `^## `/`^### ` headings
  and could have missed a differently-formatted block — if my list is wrong I want to know). Report
  any disagreement with my 8.

---

## Rule C — what STAYS in §0

§0 is a **live dashboard**. The test for every banner and paragraph:

> **Does this state a CURRENT stance, rule, definition, or gate that someone must know to make a
> decision TODAY? → STAYS. Does it report what happened in a session? → GOES.**

Concretely, these STAY (non-exhaustive — apply the test, don't pattern-match this list):
- The **S322 freeze-campaign-PAUSED banner** in full. It is the current operating stance and the
  first thing a booting PA must read. Do not touch a word of it.
- The **V1 = scrml-LANGUAGE 1.0 definition** (the S230 REFRAME) — the DEFINITION half. The
  `**S232 PROGRESS** … **S234 PROGRESS** …` narrative accreted onto that same line is Rule A/B material.
- **§0.1 phase table · §0.2 locks L1-L22 · §0.3 audit deliverables · §0.4 open questions ·
  §0.5 A1a status · §0.6 generated recent-sessions block** — all stay. §0.6 is `@generated`; do not
  hand-edit it.
- Any banner naming a **current gate, ruling, or constraint** (e.g. the review-floor denominator note).

⚑ **The accreted mega-line.** `master-list.md:40` is one ~35k-character line that opens with the V1
REFRAME (keep) and then chains `S232 PROGRESS → S280 PROGRESS` inline (Rule A/B). Splitting it is
the fiddliest part of this job. Do it carefully and re-read the result.

---

## The three tasks

### 1. `master-list.md` §0 (lines ~9-181) — the big one
Apply Rules A/B/C. Leave a single pointer line where the narrative was, e.g.
`> Per-session narrative lives in \`docs/changelog.md\` (ratified S171). This section is the LIVE dashboard only.`
**Target: §0 from 138,601 chars to under ~35,000.** If you land far off that, say so and why rather
than forcing it.

### 2. `compiler/SPEC-INDEX.md` — strip amendment history from the Sections table
Each of the 65 rows has a `Summary` column that has accreted per-session amendment prose
(`**S154 amendment**: … **S111 amendment (2026-05-20)**: …`). **A navigation index needs to answer
"what is §51 and where does it start."** It does not need each section's amendment history.

Rewrite each Summary to the navigational core: what the section covers, plus any **currently-normative**
sub-section pointers a reader needs to find their way (`§51.0.F rule= contract`, `§51.0.M <onTimeout>`).
Delete the dated amendment narrative. **Keep the Quick Lookup section intact** — it is pure navigation
and it is what the PA actually greps.

⚑ `bun run scripts/regen-spec-index.ts` regenerates line ranges + sizes **preserving summaries**, so
your rewrite survives regen. **Run it after your edit and confirm it does not revert you** — that is a
required check, not optional.

### 3. Do NOT touch
`docs/PA-SCRML-PRIMER.md` (unratified) · `../scrml-support/**` (sibling repo, PA-direct) ·
`docs/known-gaps.md` · `compiler/SPEC.md` · anything under `compiler/src/`.

---

## Method

- **Nothing normative may change.** This is a MOVE, not a rewrite. Where you move text, move it
  **verbatim**. Where you compress a SPEC-INDEX summary, you may drop dated narrative but must not
  drop a section pointer or invent a claim.
- **Prove no loss.** For every deleted block, either (a) name the changelog block that carries it, or
  (b) name the commit where you moved it. Report the accounting.
- The gate runs `bun test compiler/tests/{unit,integration,conformance}` — docs-only edits should be
  inert, but `scripts/state.ts --check` and `scripts/facts.ts --check` gate generated content. **Run
  both before you finish** and regenerate if they complain (`state.ts --write`). The FACTS gate has
  caught a stale regen three times in one session before; regen is the LAST step.
- Incremental commits, append to `docs/changes/boot-trim-tier1-2026-08-25/progress.md`, and **commit
  your final report before emitting it** — a sibling dispatch lost its entire report to a 600s stall
  yesterday while its work sat committed and fine.
- **NEVER `--no-verify`. NEVER override `core.hooksPath`.**

## Report

WORKTREE_PATH · FINAL_SHA · FILES_TOUCHED · **the orphan list you derived, and whether it matches my
8** · no-loss accounting (per deleted block: duplicated-where, or moved-in-which-commit) ·
before/after char counts for §0 and SPEC-INDEX · regen-does-not-revert confirmation · **anything in
this brief that is wrong** — the last two dispatches each corrected me on load-bearing points and
both were right.
