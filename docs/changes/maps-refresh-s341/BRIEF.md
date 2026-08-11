# BRIEF — maps refresh S341 + the stamp-durability fix

<!-- Archived verbatim per pa-base §5 (brief archival). Committed BEFORE the worktree was cut,
     so this file exists inside the agent's workspace. -->

DONE-PROBE: `git merge-base --is-ancestor "$(sed -n '3p' .claude/maps/primary.map.md | grep -oE 'commit: [0-9a-f]+' | cut -d' ' -f2)" origin/main`

---

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

**Your FIRST action is this gate. If ANY check fails, STOP and report — do not proceed.**

1. `pwd` — it MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   If it is `/home/bryan-maclee/scrmlMaster/scrml` you are in the SHARED CHECKOUT. STOP.
2. `git rev-parse --show-toplevel` MUST equal that same worktree path.
3. `git status --porcelain` MUST be clean.
4. `bun install` — a fresh worktree does NOT inherit `node_modules` (without it the commit hook
   fails with "cannot find package 'acorn'").

**Per-edit path discipline.** Every Read/Write/Edit targets an ABSOLUTE path under your worktree
root. A relative path resolves against the SHARED checkout via the additional-working-directories
list; a shared-checkout absolute path leaks directly. Never `cd` into
`/home/bryan-maclee/scrmlMaster/scrml` — use `git -C "$WORKTREE_ROOT"` and `bun --cwd "$WORKTREE_ROOT"`.
If you are about to write to the shared root, STOP and re-derive the path.

**Gates.** NEVER `--no-verify`, and never override `core.hooksPath` or otherwise disable a hook.
That is not authorized here under any circumstance, including "the hook is slow." Batch your
commits if hook time is a problem.

**Crash recovery.** Commit after each meaningful unit (WIP commits are expected — the branch IS
the checkpoint) and keep an append-only `docs/changes/maps-refresh-s341/progress.md` with
timestamped lines: what was just done, what is next, blockers.

---

## Why this dispatch exists (read this before the task — it changes what "done" means)

`bun scripts/state.ts` reports:

```
Maps: watermark 616688ea is NOT an ancestor of HEAD 4f034e13 (diverged/rebased)
      — behind-count unavailable
```

**The probe is behaving correctly.** It refuses to compute a behind-count from a watermark that
is not on `main`'s history, rather than printing a wrong number. The defect is the STAMP.

**Root cause, PA-verified.** `616688ea` is the tip of the branch `wrap/s331`. That branch was
landed by `gh pr merge --squash` (#495), which creates a NEW commit on `main` (`2391d483`) with a
different SHA. The branch tip is therefore never an ancestor of `main` — by construction, not by
accident.

**It is recurring, and the measurement is the point:** of the last SIX commits that touched
`.claude/maps/primary.map.md`, **THREE** stamped a SHA that is not an ancestor of `main`
(`616688ea` S331, `97576f35` S326, `a3a34d80` S322). The three that survived stamped a SHA that
was already on `main`.

**And the S331 map author already knew.** Its own header line 6 reads: *"`616688ea` is ONE COMMIT
AHEAD of `origin/main` (`8863d457`) — the S331-bryan wrap continuity, DOCS-ONLY (verified …).
Every source claim holds at BOTH."* The correct stamp was sitting in the sentence. It stamped the
branch tip anyway.

**Consequence.** The pre-dispatch maps-currency check that `pa-scrml-overlay.md {{maps_fills}}`
requires before EVERY dev dispatch — "HEAD vs the map's stamp → refresh, or name the post-map
landings" — cannot be computed at all. It does not fail loudly; it returns nothing. This is a
mandatory step that has been silently unanswerable.

---

## TASK 1 — the stamp rule (the durable half; do this even if Task 2 is cut short)

**Rule: the watermark SHALL be a commit that is an ancestor of `origin/main`.**

Concretely, when you write the `# updated: … commit: <SHA>` line:

- Compute `BASE="$(git -C "$WORKTREE_ROOT" merge-base HEAD origin/main)"`.
- Verify the SOURCE delta between `BASE` and your working tip is empty:
  `git diff --name-only "$BASE"..HEAD -- compiler/ scripts/ conformance/ stdlib/ lsp/ .github/ package.json`
  If it is empty, every source claim in the map holds at `BASE` → **stamp `BASE`.**
  If it is NOT empty, STOP and report — the map would be describing source that is not yet on
  `main`, and that is a different problem than the one this dispatch is fixing.
- Record the working tip separately on its own header line as informational
  (`# generated-at: <tip> (informational — not the currency anchor)`), so the provenance is not
  lost. **Do not** let a reader mistake it for the watermark; only ONE line carries
  `commit: <SHA>` and `scripts/state.ts` parses line 3.

**Then write the rule down where the next author will hit it** — a short comment block in
`.claude/maps/primary.map.md` immediately under the header, stating the rule and the one-line
reason (squash-merge orphans a branch-tip stamp). Prose in a map is the right home: this is a
map-authoring invariant, not a compiler rule.

**Verify the bite before you claim it.** After stamping, run the DONE-PROBE at the top of this
file and paste its exit status into your report. A gate that has never been observed to pass is a
hypothesis.

## TASK 2 — the incremental refresh

Refresh the map set incrementally over the window **`8863d457` → `4f034e13`**.

- `8863d457` is the ancestor-of-main SHA at which the CURRENT map content is accurate (it is the
  merge-base of `616688ea` and `main` — verified by the PA). Treat the existing maps as valid at
  `8863d457` and bridge forward from there. Do NOT regenerate from scratch.
- Ancestry is checked and bounded: `git merge-base --is-ancestor 8863d457 4f034e13` passes.
- **The window is small: 24 commits, 28 source-bearing files.** PA-measured breakdown:
  `compiler/src/codegen` 7 · `compiler/tests/unit` 3 · `conformance/cases/{ssr,each,derived}` 2+2+2 ·
  `compiler/tests/integration` 2 · `scripts/{source-text-regex-census,dpa-debt,boot}.ts` 1 each ·
  `compiler/tests/conformance` 1 · `compiler/src/{runtime-template.js,route-inference.ts,name-resolver.ts}`
  1 each · `compiler/SPEC.md` 1 · `compiler/SPEC-INDEX.md` 1 · `compiler/self-host-v2/progress.md` 1.
  **This list is PA-measured and is a starting point, not a boundary — re-derive it yourself and
  report any disagreement with the numbers above.**
- Refresh the non-compliance report (`.claude/maps/non-compliance.report.md`) alongside.

**Landing note:** these maps land via a PR, which will be **squash-merged**. That is precisely why
Task 1 exists. Your stamp must survive that merge.

## SCOPE — do not exceed

- Write ONLY under `.claude/maps/` and `docs/changes/maps-refresh-s341/`.
- Do NOT edit compiler source, SPEC.md, known-gaps.md, master-list.md, or hand-off.md. Another
  session (S340-peter) may be live on an adjacent lane; `docs/known-gaps.md` in particular is
  contended. If the refresh surfaces something that belongs in a ledger, put it in your REPORT —
  the PA files it.
- Do NOT create a PR or merge anything. Commit to your branch and report.

## REPORT — return these fields

1. `WORKTREE_PATH` and `FINAL_SHA` (branch tip after your last commit).
2. `FILES_TOUCHED` (exact list).
3. The stamped watermark SHA + the DONE-PROBE exit status.
4. Whether the PA's 24-commit / 28-file delta measurement reproduced; if not, your numbers and why.
5. Anything the refresh surfaced that the PA should file (gaps, drift, non-compliance) — as text,
   not as an edit.
6. Anything in this brief that turned out to be WRONG. Say so plainly; a brief is a hypothesis.
