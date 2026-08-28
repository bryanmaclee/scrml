# BRIEF — rotate PRIMER §13.7 into `docs/PA-SCRML-REFERENCE.md` (the S375 tier-2 cut, RATIFIED S383)

**Dispatched:** S383-bryan, 2026-08-28. **Base:** `origin/main` @ `a042f3fd`.
**change-id:** `primer-13-7-rotation-2026-08-28`

**bryan ruled this session, verbatim: *"ratify the 13.7 cut."*** This was named tier 2 at S375 and
deliberately left to the operator; it is now ratified. This dispatch executes it.

**This is a MOVE with a pointer left behind — not a deletion, not a rewrite, not a summarisation.**
Every byte of §13.7 survives, at a new address. If you find yourself condensing, paraphrasing,
"modernising" or dropping a row because it looks stale, **stop** — staleness is not the criterion
here and is not yours to judge in this dispatch.

---

# THE RULE THIS EXECUTES

`pa-base v2.16` §2, ratified S375: *a maintained-tier document SHALL have a size budget, and the
overflow ROTATES into the write-once tier.* The overlay's `{{doc_budget_fills}}` table sets
`docs/PA-SCRML-PRIMER.md`'s budget at **40k** boot tokens and names the destination
`docs/PA-SCRML-REFERENCE.md`.

**PA-MEASURED THIS SESSION, so you do not have to take it on faith:** §13.7 spans PRIMER lines
**1205–1468** = **264 lines / 98,455 chars of 222,802 total = 44.2%** of the file. That reproduces
the overlay's figure exactly. The PRIMER is the single largest read in a Profile-A boot, and §13.7
was referenced **zero** times at S375.

---

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4 — hard gate)

Worktree root: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-<id>/` = `WORKTREE_ROOT`.

## Startup — BEFORE any other tool call
1. `pwd` — MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   If it is under any other repo, **STOP and report** (S90 CWD-routing). Save `WORKTREE_ROOT`.
2. `git rev-parse --show-toplevel` == `WORKTREE_ROOT`.
3. **Assert your base:** `git merge-base HEAD origin/main` == `git rev-parse origin/main`.
   ⚑ **S346: a worktree is cut from `origin/main`, NOT from the dispatching checkout's HEAD.**
4. **Fetch this brief into your tree** — it is on a branch, not on `main`:
   ```
   git fetch origin brief/s383
   git checkout FETCH_HEAD -- docs/changes/primer-13-7-rotation-2026-08-28/
   ```
5. `git status --short` clean.
6. `bun install` — the pre-commit hook needs it even for a docs-only change.

This is a **docs-only** change: no `bun run pretest` needed, no browser fixtures.
Use `bun run test` only if you want a full baseline; the pre-commit subset is the gate.

## Path discipline
- Apply edits via **Edit/Write on `WORKTREE_ROOT`-absolute paths.** (S314: the old Bash-only rule is
  retired and now actively wrong — the `path-discipline.sh` PreToolUse hook guards Edit/Write, and
  Bash writes are the one surface it cannot see.)
- **NEVER `cd` into the main checkout.** Use `git -C "$WORKTREE_ROOT"`, `--cwd=`, absolute paths.
- ⚑ **NEVER a bare `pkill -f` / `killall`** — every checkout shares the command string.
- First commit message includes your verbatim `pwd`: `WIP(primer-13-7): start at <pwd>`.

# COMMIT DISCIPLINE
Commit after each phase — do not batch. Your branch + `progress.md` are the crash-recovery anchor.
`git status` clean before DONE. **NEVER `--no-verify`**, and never override `core.hooksPath` (S283).

---

# THE WORK

## Phase 1 — create the destination

Create `docs/PA-SCRML-REFERENCE.md`. It does **not** exist today (PA-verified). Give it:

- A title and a one-paragraph purpose: this is the **write-once reference tier** for PRIMER content
  that is durable, occasionally load-bearing, and too large to sit in a mandatory boot read.
- The write-once frontmatter the overlay's `{{scope_truth_anchor_and_archive}}` requires:
  `status: current` · `last-reviewed: 2026-08-28` — this is a MOVE, so the content's status is
  whatever it was in the PRIMER: current.
- Provenance: rotated out of `docs/PA-SCRML-PRIMER.md` §13.7 at S383 under `pa-base v2.16` §2, on
  bryan's ratification of the S375 tier-2 cut. Name the measured figure (264 lines / 44.2%).
- Then **§13.7 verbatim**, its heading preserved so the string `§13.7` still appears at the
  destination and a reader arriving from a citation lands on the right thing.

## Phase 2 — leave the pointer

Replace PRIMER lines 1205–1468 with a **short stub** (target ≤ 12 lines) that keeps the
`## §13.7 …` heading and its title, states that the content rotated to
`docs/PA-SCRML-REFERENCE.md` at S383 with a link, gives a one-sentence description of what lives
there (the B1–B22 + dA-b1 annotated-AST contracts produced by the A1b resolver passes: field name,
node kind, values, read API), and names the reason (boot-budget rotation, `pa-base v2.16` §2).

⚑ **The stub is not optional and is the load-bearing half of this dispatch.** PA-MEASURED: there are
**208 inbound `§13.7` citations** across `docs/` and `scrml-support/` (worktrees excluded). The live
ones include **`docs/known-gaps.md` (12 citations)** and — load-bearing — the canonical dev agent's
own definition at **`../scrml-support/agents/scrml-js-codegen-engineer.md`**, which every codegen
dispatch reads. **The stub is what keeps all 208 resolving.** Do NOT go and edit those 208 citations;
the pointer is the fix, and rewriting them is out of scope.

## Phase 3 — ⚑ MEASURE BEFORE REMOVING (this is a gate, not a formality)

`pa-base` §2, and the S375 lesson that produced it: *a rotation moves content out of the read path;
if the destination does not already carry it, the move is a **DELETION** wearing a filing clerk's
clothes.* At S375 a document asserted its narrative lived elsewhere and that assertion was **FALSE
for 8 sessions**.

Before the PRIMER deletion is committed, **prove the move is complete, by execution:**
- Extract the §13.7 block from `origin/main`'s PRIMER (lines 1205–1468) to a temp file.
- Extract the corresponding block from your new `PA-SCRML-REFERENCE.md`.
- **`diff` them and show the output is empty** (modulo only the deliberate frontmatter/preamble you
  added above the block). Paste the command and its output in `progress.md`.
- Independently: count the table rows in §13.7 on both sides (the B1–B22 + dA-b1 contract table) and
  confirm the counts match. Two independent checks, because a single diff can be fooled by a bad
  extraction range.

**If the diff is not empty, do not commit the deletion.** Fix the destination and re-run.

## Phase 4 — measure the win

Report the before/after: PRIMER line count and char count on `origin/main` vs on your branch, and
the resulting share of the file removed. State it as a measurement, not an estimate.

⚑ **Do NOT claim a boot-token figure you did not measure.** `bun scripts/ctx.ts` reads a session
transcript's own usage records; it cannot tell you what a *future* boot will cost. Report bytes and
lines, which you can measure, and say that the token effect follows at roughly the ratio the
overlay's table records — do not invent a number.

---

# ACCEPTANCE

1. `docs/PA-SCRML-REFERENCE.md` exists and carries §13.7 **byte-identical** (Phase 3 diff empty).
2. `docs/PA-SCRML-PRIMER.md` §13.7 is a stub ≤ 12 lines that names the destination and links it.
3. The heading `## §13.7` still exists in the PRIMER, so the section number resolves.
4. No other PRIMER section is touched. `git diff --stat` shows exactly two files.
5. Pre-commit gate green.

# WHAT TO REPORT
`WORKTREE_PATH`, `FINAL_SHA`, files-touched, **the Phase-3 diff command and its verbatim output**,
the row-count cross-check, the Phase-4 before/after measurement, and **anything this brief got
wrong.**
⚑ **The brief being wrong is an expected outcome** — the last five dispatches on this project each
out-measured the PA on at least one premise. The line range 1205–1468 was measured on
`origin/main` @ `a042f3fd`; **re-derive it by grep before you cut** (`grep -n '^## §13\.' docs/PA-SCRML-PRIMER.md`)
rather than trusting the number, because a line range is exactly the kind of figure that rots.

# MUST NOT TOUCH
- Anything under `compiler/` — a sibling dispatch owns `compiler/src/`, and the PA owns
  `compiler/SPEC.md` + `compiler/SPEC-INDEX.md` this session.
- `docs/known-gaps.md`, `hand-off.md`, `master-list.md`, `handOffs/delta-log.md`,
  `docs/changelog.md` — PA-owned.
- The 208 inbound citations. The stub is the fix.
