# BRIEF — phase-b2-samples-curate (sPA ss11, item 8)

**Agent:** scrml-js-codegen-engineer · **isolation:** worktree · **model:** opus
**Base SHA:** 0a605d3e · **Land target (sPA-owned):** branch `spa/ss11` via file-delta

## Goal
Curate `samples/compilation-tests/` (**805** `.scrml` files — the SCOPE-MAP says 277 but that count is
stale from 2026-05-05; the corpus grew, trust the live `find` count) per the §D.2 classification scheme:
`still-compiles` / `compile-with-v0next-edits` (EDIT) / `tests-obsolete-shape` (DROP) / `tests-new-shape`
(REWRITE). **DROPS REQUIRE EXPLICIT USER AUTHORIZATION — you produce a dry-run target list, you DELETE
NOTHING.** (memory `feedback_pa_bash_cleanup_dry_run` + S56 destructive-ops directive.)

## Phased, bounded approach (classification is read-only FIRST)
### Phase 1 — mechanical compile-sweep (do this first, commit the report)
Compile ALL 805 with a script. Partition:
- **PASS (clean, exit 0)** -> `still-compiles`. These are already green; LEAVE THEM. This is the bulk.
- **FAIL (non-zero / `E-`)** -> the triage set (Phase 2). Capture each fail's file + top error code.
Write `docs/changes/phase-b2-samples-curate/CLASSIFICATION.md`: counts (pass/fail), and the FAIL list
with error codes. Commit it. This is the single most important deliverable — even if you run out of
time/context after Phase 1, the classification + a partial dry-run is a complete, useful landing.

### Phase 2 — triage the FAIL set ONLY
For each failing file, classify by WHY it fails:
- **EDIT** — valid test of a real current feature, fails only on a deprecated/legacy FORM (arm arrows,
  null/undefined, decl shape, spaced `< db>` opener). Rewrite canonically -> recompile clean. (Same form
  rules as the examples brief: arm `:>` only in arm context; null/undefined->not but preserve `""`/`0`/
  `false`; no-space `<db>` is canonical per S208 ruling.)
- **REWRITE** — tests a shape that CHANGED; the intent is still valid but the canonical shape differs.
  Rewrite to the new shape -> recompile clean.
- **DROP candidate** — tests an OBSOLETE/removed shape with no current analog (e.g. a retired primitive,
  a removed keyword), OR is a dead gauntlet artifact testing nothing meaningful. **Do NOT delete.** Add to
  the dry-run DROP list with a one-line reason each.

### Phase 3 — dry-run DROP list (no deletion)
Write `docs/changes/phase-b2-samples-curate/DROP-DRYRUN.md`: every DROP candidate, full path, one-line
reason. This is what the sPA escalates to the user for authorization. The actual `rm` happens only AFTER
the user authorizes — NOT in this dispatch.

## Constraints
- NEVER delete a sample file. NEVER `git rm`. DROP = list-only.
- Ignore `samples/compilation-tests/dist/` (gitignored build output).
- A sample that compiles clean is DONE — do not "improve" passing samples (no churn on green files).
- Commit incrementally: classification report first, then EDIT/REWRITE in batches, then the drop dry-run.

## Acceptance
- `CLASSIFICATION.md` with pass/fail counts + the fail list.
- All EDIT/REWRITE files recompile clean (0 `E-`).
- `DROP-DRYRUN.md` with candidate list + reasons (NOTHING deleted).
- `git status`: only `.scrml` edits + the two new docs; no deletions, no `dist/`.

## SHARED DISCIPLINE BLOCK
See the dispatch prompt for the startup-F4 verify, path-discipline (no main-absolute writes; stat+read-back),
incremental commits, progress.md, no `--no-verify`. Crash-recovery matters here (805 files) — commit the
Phase-1 classification IMMEDIATELY so a crash leaves a recoverable baseline.
