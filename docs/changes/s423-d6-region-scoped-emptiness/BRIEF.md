# BRIEF — D6 gets a region-scoped emptiness signal, so `S-EMPTY-WITH-DATA` can finally fire

**change-id:** `s423-d6-region-scoped-emptiness`
**dispatched by:** S423-peter · 2026-09-19 · base `origin/main` @ `3b66030a`
**gap:** `g-e2e-render-map-populated-seed-is-inert-so-d6-has-no-live-subject` (HIGH, `status=narrowed` — LIMB 1 closed in #978, **LIMB 2 is this arc**)

---

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` FIRST and follow its **Task-Shape Routing**; then
`.claude/maps/test.map.md` (this tier's rows). The maps are stamped `787d4cb4`; HEAD is
`3b66030a` (4 commits). Treat map content as a **verify-against-source hypothesis**, and report
whether the maps were load-bearing for this task — **"not load-bearing" is a valid, wanted answer.**

## FIRST STEP — fetch this brief into your worktree

Your worktree is cut from `origin/main`, where this brief does not exist yet:

```
git fetch origin fix/s423-d6-region-scoped && git checkout FETCH_HEAD -- docs/changes/s423-d6-region-scoped-emptiness/
```

Any "rebase onto HEAD" instruction resolves to `origin/main`. Assert your base:
`git merge-base HEAD origin/main` MUST equal `origin/main`.

## STARTUP VERIFICATION + PATH DISCIPLINE (F4)

1. `pwd` MUST start with `.../scrml/.claude/worktrees/agent-` — if not, STOP and report.
2. `git rev-parse --show-toplevel` MUST equal that worktree root. Tree clean.
3. `bun install` (worktrees do NOT inherit `node_modules`; without it the hook fails on `acorn`).
4. Run `pretest` **from the worktree CWD** — `bun --cwd <path> run pretest` SILENTLY NO-OPS and
   exits 0 (S376). Verify it produced `samples/compilation-tests/dist/`.
5. Every Read/Write/Edit uses a worktree-ABSOLUTE path. NEVER `cd` into the main checkout; use
   `git -C "$WORKTREE_ROOT"`.
6. ⛔ **NEVER `git stash`** — `refs/stash` is shared across every worktree (S385). Do base-vs-build
   flips by FILE COPY.
7. ⛔ **NEVER a bare `pkill -f`/`killall` on a command string** — every checkout shares it (S376).
   Kill by PID captured at launch.
8. Commit after each meaningful unit (WIP commits expected) + keep an append-only
   `docs/changes/s423-d6-region-scoped-emptiness/progress.md`.

---

## THE SYMPTOM, AND IT IS MEASURED — not inferred

`D6` / `S-EMPTY-WITH-DATA` is the detector **the whole e2e-render-map tier exists for**: it answers
*"data was seeded and the render showed nothing"* — the board-bug class. **It has never fired on any
corpus cell.** Limb 1 (#978) made the seed actually reach the app's chunk-scoped cell; the seed is now
live on two apps. D6 stayed dark anyway, because its emptiness question is asked of the **whole
`body`**, and page chrome answers it.

**PA-measured by execution on `3b66030a`** (`bun compiler/tests/e2e-render-map/observe-one.js <relpath> populated`):

```
examples/25-triage-board.scrml#populated
  state=renders-clean  smells=[]  seed: {"name":"tasks","reason":"written","wrote":true}, domChanged=true
  hasRenderedContent(body) = true          <-- off 52 chars of page chrome
  three <ul class="task-list">, each containing ONLY <div data-scrml-each-mount=...>, all EMPTY
```

So: a seed that demonstrably moved the DOM, three list regions that rendered **nothing**, and the cell
scores `renders-clean` with zero smells.

## THE DISCRIMINATOR I FOUND — use it, but verify it yourself

A `[data-scrml-each-mount]` element **survives in the DOM only when that `<each>` rendered nothing**;
when items render, the runtime consumes the slot. Measured across both live-seed apps:

| app | each rendered? | surviving `[data-scrml-each-mount]` | all empty? |
|---|---|---|---|
| `examples/03-contact-book.scrml#populated` | yes — 2 items, 68 chars | **0** | n/a |
| `examples/25-triage-board.scrml#populated` | nothing | **3** | **yes, 3/3** |

⚑ **THIS IS A HYPOTHESIS ABOUT THE RUNTIME, PA-LOCATED-VERIFY.** I measured two apps; I did NOT read
the runtime's reconciliation code to confirm *why* the slot disappears. **Verify it in
`dist/scrml-runtime.js` / `_scrml_reconcile_list` before building on it**, and report whether it held,
needed refining, or is wrong. If it is wrong, the fallback shape is the gap's original wording — scope
the emptiness question to the each CONTAINER — and you are authorized to take it.

There is a second emission shape you must handle: an SSR'd each renders as a comment-delimited range
`<!--scrml-each:ID--> … <!--/scrml-each:ID-->` (25-triage's OUTER each over a literal array uses it;
the INNER per-column each uses mount divs). A predicate that only understands one shape is half a fix.

## WHAT TO BUILD

1. **A region-scoped emptiness signal for D6** in `compiler/tests/e2e-render-map/render-detectors.js`.
   `D6` currently reads `if (obs.seeded && !hasRenderedContent(body))`. It must ALSO fire when a seed
   was applied and **the seeded list regions rendered nothing**.
2. ⚑ **STRICTLY ADDITIVE — this is the acceptance bar, not a preference.** The change may only make
   D6 fire on cells where it is silent today. **No cell that is red today may go green**, and no cell
   may change state for any reason other than a new `S-EMPTY-WITH-DATA`. Prove it with a full-tier
   before/after (below), not by reading the diff.
3. **Choose fail-QUIET on ambiguity, and say why in a comment.** If no each-region is identifiable,
   keep today's body-global behaviour rather than firing blind. A detector that cries wolf gets
   ignored and then deleted (`pa-base` §8, the absorbed escape hatch). My lean — and it is a lean, not
   a ruling — is to fire only when **every** identifiable each-region is empty, so a two-list app with
   one legitimately-empty list does not false-fire. If your measurement says otherwise, take the other
   shape and defend it with the population count.
4. **Give D6 a fixture of its OWN** under `compiler/tests/e2e-render-map/fixtures/`, so the detector's
   only live subject is not "an example app that happens to be broken this week". Today's subject
   exists because `seed-fixtures.js` seeds `column: "todo"` into an app whose columns are
   `["Inbox","Doing","Done"]` — zero matches under §45 strict `==`. **That fixture is WRONG and it is
   tracked separately** (`g-e2e-render-map-seed-fixtures-are-wrong-in-three-of-four-entries`).
   ⛔ **DO NOT "fix" `seed-fixtures.js` in this arc** — correcting it deletes the live subject before
   the detector that needs it exists.
5. **A test that BITES.** Not "D6 fires on the subject" — prove the test goes RED when the fix is
   reverted, and record that mutation in `progress.md`. A green test that cannot fail is the thing
   this tier keeps producing (S416: `detector-validation`'s G4 passed against a script with no
   machinery to exercise).

## MEASUREMENTS OWED BEFORE YOU REPORT DONE

- **Full-tier before/after.** Run the tier on a clean base and on your branch; diff the per-cell
  states across all 438 cells. Report: cells that changed state, in which direction, and the
  populated-cell subtotal. **A state change in any direction other than `→ S-EMPTY-WITH-DATA` is a
  finding against your own fix.**
- **`bun test compiler/tests/e2e-render-map/`** green, including `detector-validation.test.js`.
- **The population count on the narrowed surface** (`pa-base` §8, coverage-removal blind spot): if any
  part of your change makes a check look at LESS, count the sites it stops inspecting and report the
  number.
- The pre-commit subset (`bun test compiler/tests/{unit,integration,conformance} --bail`) — ⚑ this
  clone carries **5 pre-existing failures** (the S254 path-model cluster); compare the failure
  NAME-SET against the base, never the count.

## SUCCESS IS THE CLASS CLOSING, NOT THE CELL

Done means: **D6 can fire, a real board-bug-shaped cell makes it fire, the firing is pinned by a
bite-proven test, and nothing else in the tier moved.** If you find that the detector still cannot see
the class after your change, say so plainly and report what the residual is — a narrowed gap is a good
outcome; a green report that leaves D6 dark is not.

## OUT OF SCOPE — do not touch

- `seed-fixtures.js` (see 4 above) · the three wrong fixtures · compiler source (`compiler/src/`) ·
  `.github/` · anything under `docs/known-gaps.md` (the PA files gaps).
- ⚑ The three surviving mount slots in 25-triage share ONE `data-scrml-each-mount` id. That may be a
  real compiler defect and it is **NOT this arc** — it is only testable once a task actually matches a
  column. Note it in `progress.md` if you learn anything; do not chase it.

## REPORT BACK

Workspace path · final commit SHA · files touched · whether my mount-slot hypothesis held / was
refined / was wrong · the before/after tier table · the bite proof · anything you deferred.
