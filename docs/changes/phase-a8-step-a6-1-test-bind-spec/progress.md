# A8 / A6-1 — `test-bind` SPEC amendment — progress log

Append-only, timestamped.

## 2026-05-08 (S74) startup

- WORKTREE_ROOT verified: `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a583b8adc952dc805`
- `git rev-parse --show-toplevel` matches.
- `git status --short` clean.
- `bun install` OK (114 packages installed).
- `bun run pretest` OK.
- `bun run test` baseline: **10,308 / 60 / 1 / 0** (NOT 10,349 as BRIEF stated; running it twice gave the same 10,308 stable). Brief estimate stale by 41; final test count target is therefore 10,308 since no source changes.

## Step 1 — read authoritative sources

- Insight 22 verbatim (design-insights.md:1409-1442) — read.
- S67 user-direction "flip conditions are null" (user-voice-scrmlTS.md:5613) — read.
- §19.12 existing (SPEC.md:11301-11357), §19.13 (11360-11375) — read.
- §47 §47.5 §47.7 (SPEC.md:17786, 18033, 18067) — read.
- §34 E-TEST-001..005 (SPEC.md:14351-14355) — read.
- §51.0.K Machine Cohesion footnote (20590-20620) — read for OQ-deferral footnote convention.
- SPEC-INDEX.md row format for §19, §34, §47 — read.

## Step 2 — SURVEY.md authored (4 decisions documented)

- Decision 1: home = §19.12 + §47.5 cross-ref. NO new section.
- Decision 2: handler shape discrimination = by typer (RHS is normal expr).
- Decision 3: NEW E-TEST-006 (vs reusing E-TEST-002).
- Decision 4: OQ deferral notes = §51.0.K-style footnote at end of §19.12.7.
- Decision 5: Position B / S67 forward-compat language confirmed.
- Decision 6: Insight 21 / E-TEST-004 / E-FN-004 explicit-unchanged numbered list.
- Decision 7: worked example shape from BRIEF (canonical scrml, not Jest).

Commit `9c8e072` — WIP(a6-1): SURVEY + progress.

## Step 3 — Path-discipline correction

Initial Edit calls used the main-tree path `/home/bryan-maclee/scrmlMaster/scrmlTS/compiler/SPEC.md` instead of the worktree path. Caught BEFORE commit (git status revealed working tree clean despite my edits being on disk — investigation showed `realpath compiler/SPEC.md` was the worktree but the Edit tool wrote to the main tree's absolute path I provided).

Reverted main-tree SPEC.md (`git checkout -- compiler/SPEC.md` via `--git-dir/--work-tree` against the main repo). Re-applied identical edits to the worktree path `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-a583b8adc952dc805/compiler/SPEC.md`. Verified worktree's `git diff --stat` showed `compiler/SPEC.md | 79 ++++++++++++++` (exactly the expected delta).

NO other files in the main tree were touched. Lesson: when the harness gives a worktree path, ALWAYS use `<WORKTREE_ROOT>/...` for Edit/Write absolute paths, NEVER the bare repo path.

## Step 4 — SPEC.md edits

Commit `8bb0a34` — feat(a6-1): SPEC §19.12.6/.7/.8 + §19.13 + §47.5 + §34 — test-bind declaration spec text.

Sites:
- §19.12.6 — Surface declaration syntax + scope + 3 explicit-unchanged claims (E-TEST-004, E-FN-004, Insight 21).
- §19.12.7 — Dispatch contract: compile-time conditional + 0-byte production cost + §47 cross-ref + Position B forward-compat (S67-style, no flip-condition framing) + S67-style OQ deferral footnote (4 OQs).
- §19.12.8 — Canonical-scrml worked example (multiple binds, both handler shapes, scope-local, engine-bearing).
- §19.13 — +1 row E-TEST-006 (severity Test).
- §47.5 — +1 cross-reference paragraph.
- §34 — +1 row E-TEST-006 (mirrored from §19.13 per existing convention).

## Step 5 — SPEC-INDEX.md edits

Commit `a77bb68` — feat(a6-1): SPEC-INDEX — row notes for §19, §34, §47 + S74 preamble entry.

Sites: §19 / §34 / §47 row notes updated; S74 entry prepended to "Substantive content landings" preamble.
