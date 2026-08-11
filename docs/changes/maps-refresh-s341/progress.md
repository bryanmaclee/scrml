# progress — maps-refresh-s341

Append-only. Timestamped. What was just done / what is next / blockers.

---

## 2026-08-11 — startup gate

- `pwd` = `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a1e1ac20ad9616656` — PASS.
- `git rev-parse --show-toplevel` matches — PASS.
- `git status --porcelain` clean — PASS.
- `bun install` — 217 packages installed — PASS.
- HEAD = `4f034e13` = `origin/main`. Branch = `worktree-agent-a1e1ac20ad9616656`.

**BRIEF ARCHIVE NOT PRESENT IN WORKTREE.** The brief states it was committed at `177060ac`
"before the worktree was cut". It was not: `177060ac`'s parent IS `4f034e13`, which is this
worktree's HEAD. The archive commit is a CHILD of the worktree base, so
`docs/changes/maps-refresh-s341/BRIEF.md` does not exist on this branch. Recovered the text via
`git show 177060ac:docs/changes/maps-refresh-s341/BRIEF.md` (the object is reachable because the
worktree shares the object store) and confirmed it is byte-identical in substance to the inline
brief. No blocker. Reported as brief-error #1.

## 2026-08-11 — delta re-derivation (Task 2 pre-work)

- `git rev-list --count 8863d457..4f034e13` = **24** — PA measurement REPRODUCES.
- `git merge-base --is-ancestor 8863d457 4f034e13` passes — window is bounded.
- Total changed files = 60; **source-bearing = 28** — PA measurement REPRODUCES EXACTLY,
  including every sub-count in the PA's breakdown.

## 2026-08-11 — stamp-ancestry audit (Task 1 pre-work)

Audited every DISTINCT stamp live in the map set, not just `primary.map.md`:

| stamp | maps carrying it | ancestor of origin/main? |
|---|---|---|
| `616688ea` | primary, structure, dependencies, build, error, test, auth, domain, non-compliance | **NO** — tip of `wrap/s331` |
| `fe14c9b2` | schema | **NO** — tip of `wrap/s302` |
| `97576f35` | infra | **NO** — tip of `wrap/s326-bryan` (already self-documented in-map) |
| `e80b692e` | config | yes |
| `115e8b1b` | migrations | yes |

**Finding beyond the brief:** the brief measured only `primary.map.md`'s last six regens (3/6
orphaned). The LIVE set is worse — **3 of 5 distinct stamps are orphaned**, and `fe14c9b2`
(schema.map.md) is a NEW instance the brief did not catch. It has been orphaned since S302 and
survived the S331 currency pass because that pass reasoned about the stamp's AGE ("the stamp stays
honestly older") and never about its ANCESTRY.

- NEXT: write the stamp rule + restamp all 13 files to `BASE` = `4f034e13`.
- BLOCKERS: none.

## 2026-08-11 — TASK 1 COMPLETE + the bite VERIFIED

- `BASE = git merge-base HEAD origin/main` = `4f034e13` (HEAD == origin/main this pass).
- Source delta `BASE..HEAD` over `compiler/ scripts/ conformance/ stdlib/ lsp/ .github/ package.json`
  is EMPTY **by identity** (BASE and HEAD are the same commit) -> stamp `4f034e13`. No STOP condition.
- MAP-STAMP RULE block written into `.claude/maps/primary.map.md` immediately under the header.
- Invariant 48 AMENDED: it specified only the INBOUND check. Added the OUTBOUND one. This is the
  root cause of the three recurrences — the S331 author ran the inbound check, watched it pass, and
  stamped a branch tip anyway.

**DONE-PROBE: exit 0.**
`git merge-base --is-ancestor 4f034e13 origin/main` -> 0.

**AND THE INSTRUMENT IS UNBLOCKED — empirically, not by argument.** `bun scripts/state.ts` before
this pass printed `watermark 616688ea is NOT an ancestor of HEAD 4f034e13 (diverged/rebased) —
behind-count unavailable`. At this branch tip it prints:

    Maps: maps: 2 commits behind HEAD (watermark 4f034e13, HEAD 0813f11d)

A real number. (The 2 are this branch's own WIP commits — expected.) The pre-dispatch maps-currency
check `{{maps_fills}}` mandates is answerable again.

- Exact instrument locus: `scripts/state.ts:545` guards with `merge-base --is-ancestor <watermark>
  HEAD`; `:547` is the refusal string. The rule written into the map is STRICTER (ancestor of
  `origin/main`), which implies HEAD-ancestry for any HEAD on or descended from main.

- NEXT: finish primary (routing / key facts / tags), then the other 12 maps.

## 2026-08-11 — TASK 2 COMPLETE + final verification

All 13 map files refreshed and restamped. Re-walked: primary, structure, dependencies, domain,
test, error, build, non-compliance. Currency-VERIFIED not re-walked (each with its zero-diff
command in its own header): schema, config, infra, migrations, auth — plus ONE corrected row in
auth (the §6.6.19 position-coverage table, which was true-but-incomplete).

**A REAL BUG CAUGHT IN MY OWN WORK, during the final sweep.** `non-compliance.report.md` ended up
with a DUPLICATED header: my new block was inserted below the old one, leaving line 3 reading
`# generated: 2026-08-09T15:20:00-06:00  commit: 616688ea`. **Line 3 is the line `state.ts`
parses** — so I had reproduced the exact defect this dispatch exists to fix, in the report that
documents it. Removed at `9186d5a6`. Verified: exactly one `^# non-compliance.report.md` line, and
zero `^# updated:`/`^# generated:` lines carrying `616688ea` anywhere in the map set.

Also swept and corrected residual stale figures that survived section-level edits:
807 rows / 880 conformance / 1,334 tests / 37,150 SPEC lines / "1887 source files", and four
"status at `616688ea`" claims in primary, structure, test and domain.

### Final verification

- **DONE-PROBE (verbatim from the brief): exit 0.**
- `bun scripts/state.ts` → `Maps: maps: 12 commits behind HEAD (watermark 4f034e13, HEAD 9186d5a6)`.
  A real number where it previously printed `behind-count unavailable`. The 12 are this branch's own
  commits; **after the squash-merge it will read 1** (the squash itself), which is correct and
  honest — and computable, which is the whole point.
- Every one of the 13 stamps: `git merge-base --is-ancestor <stamp> origin/main` exits 0.
- Every one of the 13 files carries both `## Tags` and `## Links` (verified by `grep -L`).
- `git diff --name-only origin/main..HEAD` = the 13 maps + this progress file. **Nothing outside
  the brief's scope.** No compiler source, no SPEC.md, no known-gaps.md, no master-list.md, no
  hand-off.md.

### Owed to the PA (reported, not edited — all scope-barred)

1. `route-inference.ts:3643-3657` — a stale ORPHANED doc comment live on main, arguing to keep the
   six-entry deny-list the S337 review deleted. Two contradictory doc comments on one function, in
   a confidentiality check. (report N6)
2. `scripts/source-text-regex-census.ts:38,136` — PRINTS a baked `type-system.ts:26048`. Correct
   today; it is the S305 citation-rot class. (report N8)
3. `SPEC.md:7444` (§12.6) — names `SERVER_ONLY_SCRML_MODULES` for a PLACEMENT decision and numbers
   the §12.2 triggers differently. Carried, unchanged, still a normative contradiction. (S331-N2)
4. `route-inference.ts:3438` — cites §6.6.20; the section is §6.6.19. Survived a +125-line rewrite
   of the same function. (S331-N5)
5. `docs/known-gaps.md:7925,7932` — still "the single §18.5 classifier". (report N9)
6. C8 RECLASSIFIED: the four `.claude/maps/*.generated.md` were NEVER tracked by git.
