# BRIEF — s453-transaction-exit-rollback (B1a + B1b, bryan-RULED)

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` FIRST and follow its **Task-Shape Routing** for a
codegen/validator change; then the maps it routes you to for `codegen/` and `validators/`.
Map stamp: commit `d3e660a08`, 2026-10-04. **HEAD is `df6dad5a`** — three landings are PAST the
map stamp and you must factor them in yourself: `54ba3271` (#1271 S451 wrap), `488abeed` (#1270
bootstrap §34 severity — touches `scripts/s34-catalog.ts` and the bootstrap Diag type),
`df6dad5a` (#1272 SPEC currency: §8.1.1, E-SQL-004 loci, E-INTERNAL-DB-HANDLE-UNRESOLVED §34 row,
§19.9.10). Treat all map content as a **verify-against-source hypothesis**. Report in your final
message which map content was load-bearing — "not load-bearing" is a valid and useful answer.

## Context — this work is RULED; you are implementing a decision, not making one

At S450 (peter) a fix for `g-transaction-block-not-recognized-inside-a-function-body` was built and
reviewed twice, then **parked on `hold/s450-transaction-in-function-body` @ `69cdaa98`** because it
needed two rulings and an impl#1 policy exception. bryan has now ruled all three (ledger:
`scrml-support/user-voice-scrml.md` §S449, *"your recs. but on C, lets keep b as a possible opt in
when adopters use PG."*):

- **S435 impl#1 policy exception GRANTED** for this hold — it lands on impl#1.
- **B1a (ruled (a)):** *"`return` / `break` / `continue` out of a `transaction {}` block ROLLS BACK
  — only normal completion commits (§19.10.3 'end of normal completion')."* bryan's instruction,
  verbatim: *"replace the interim E-TRANSACTION-CONTROL-FLOW refusal for those exits with the
  rollback."*
- **B1b:** *"a top-level `transaction` is rejected (§19.10.4 already says `!` functions only)."*

Nothing below is yours to re-decide. What IS yours: the lowering, the diagnostics' exact shape, the
tests, and telling me if any premise here is false (see "Falsifiable premises").

## Starting point — you work on top of the existing hold branch

```
git fetch origin brief/s453 && git checkout FETCH_HEAD -- docs/changes/s453-transaction-exit-rollback/
git fetch origin hold/s450-transaction-in-function-body
```

Your worktree is cut from `origin/main`. Step 1 after the startup gate: bring the hold's work in and
rebase it onto current main.

```
git merge origin/hold/s450-transaction-in-function-body     # or cherry-pick its range; your call
git merge origin/main                                        # must end up based on current main
```

**main has moved ~30 PRs since the hold's base `865065d8`** (#1241–#1272). bryan's note names the
movers in the transaction neighbourhood: **#1251** (the big one — `_scrml_db_guard` wraps every db
handle; a transaction holds a per-request lock; the implicit envelope rolls back on `fail`/`?`;
SPEC §19.10.6 + §8.9.2), plus #1234, #1236, #1239, #1258, #1264 in `emit-server.ts`.

⚑ **bryan's measured claim about #1251, which you should VERIFY rather than assume:** *"The guard
recognises transaction control from statement text, so your `unsafe("BEGIN"/"COMMIT"/"ROLLBACK")`
emission, its `fail` rollback closure and `finally` backstop are covered unchanged — no edit needed
on either side. A `transaction {}` inside a `!` function that ALSO gets the implicit envelope now
NESTS: an owned BEGIN opens `SAVEPOINT _scrml_nest_N`, inner COMMIT → RELEASE, inner ROLLBACK →
ROLLBACK TO + RELEASE."* If that is false after the merge, say so loudly — it changes the arc.

The hold's own record is your best context, read both:
- `docs/changes/s450-transaction-in-function-body/progress.md` (on the hold branch) — the full build
  + two review rounds, including a **corrected false claim** worth internalizing.
- `docs/changes/s450-transaction-in-function-body/BRIEF.md` (on the hold branch).

## What to build

### B1a — `return` / `break` / `continue` leaving the block ROLLS BACK

Today `compiler/src/validators/lint-transaction.ts` REFUSES these with
`E-TRANSACTION-CONTROL-FLOW` (fail-closed, because the semantics were undecided). Now they are
decided: the block rolls back and the exit proceeds.

- Remove `return` / `break`-or-`continue`-targeting-outside-the-block from the refusal, and lower
  them through the **existing** rollback-before-exit machinery the hold already built for `fail` /
  `?` in `compiler/src/codegen/emit-logic.ts` (rollback before the exit at **any depth**, plus the
  `finally` backstop and the never-COMMIT-past-a-rollback guard). Reuse it; do not build a second
  mechanism — if the existing marking pass only handles `fail`/`?`, extend the same pass.
- **Unchanged (keep working):** a `break`/`continue` whose loop is INSIDE the block; a `return`
  AFTER the block; a `fail`/`?` inside a function *declared* within the block (that returns from
  that function, not the block).
- **Normal completion still COMMITs** — that is the whole content of "only normal completion
  commits". A block exited by `return` must NOT commit.

### B1b — a top-level `transaction` is rejected

§19.10.4 already says `transaction` is valid only inside `!` functions. The hold made a
`transaction` in a **non-`!` function** fire `E-ERROR-001`; a block at **top level (outside any
function)** was explicitly left alone and routed. It is now ruled rejected.

### SPEC §19.10 + §34

Rewrite the interim sentences the hold added to §19.10.4 so they state the ruled semantics. The
sentence to replace begins *"**Interim (S450, fail-closed pending a ruling).** Inside a function, a
`return`, a `yield`, or a `break` / `continue` whose target is outside the `transaction` block SHALL
be a compile error"*. §19.10.3 is the home of the commit/rollback contract — make sure the three
exits are named there as ROLLBACK alongside `fail` and a SQL error.

Update BOTH §34 catalog tables (the §19.13 one and the big §34 one) — the hold edited both, they
must stay in agreement. Carry a `> **Provenance:** ruling:user-voice-scrml.md S449 — "your recs" on
S450-peter's routed asks (B1a = (a), B1b)` line inline at the amended section, and `prov=` on any
`@gap` marker you touch (overlay `{{provenance_fills}}`).

⚑ **`compiler/SPEC.md` and the §34 tables are a SHARED surface with a LIVE session** (S452-bryan is
landing SPEC currency fix-ups). Keep your SPEC edits minimal and local to §19.10 / the two
E-TRANSACTION-CONTROL-FLOW + E-ERROR-001 / E-ERROR-007 rows. If a rebase conflicts there, resolve as
a real 3-way (both sides' rows survive) — never a wholesale checkout.

## PA readings — implement these, and FLAG them in your report as readings, not rulings

1. **`yield` stays refused.** bryan ruled `return`/`break`/`continue`. A `yield` is a suspension,
   not an exit — rolling back on it would be wrong and committing on it is undecided. Keep it
   fail-closed under `E-TRANSACTION-CONTROL-FLOW` and keep its SPEC sentence (narrowed to `yield`).
2. **The statement-position-`match`-arm limb of `E-TRANSACTION-CONTROL-FLOW` STAYS.** bryan ruled
   nothing on it, and it guards a live HIGH (`g-stmt-match-block-return-falls-through`: impl#1
   lowers a statement-`match` arm as a nested function, so a `fail`/`?` there returns from the arm
   only and the post-`match` statements run with no transaction open). Both limbs of it — a `fail`/`?`
   in an arm inside the block, and a `transaction` block inside an arm — stay. **Verify this
   independently after your B1a change:** a `return` inside a statement-`match` arm inside the block
   has the SAME swallowing problem, so B1a must NOT silently make that shape legal-and-broken. If
   your change would, keep that shape refused and say so — this is the most likely way this work
   ships a hole.
3. **B1b uses `E-ERROR-001`,** with its §19.10.4 limb restated as "a `transaction` block **outside a
   `!` function**" (covering both a non-`!` function and the top level), rather than minting a new
   code. Cheaper and it keeps one code for one condition. If you find a reason this is wrong, say so.

## Falsifiable premises (I located these; I did not trace all of them — verify, report, correct)

- `compiler/src/validators/lint-transaction.ts` is the sole fire site for
  `E-TRANSACTION-CONTROL-FLOW` / `E-ERROR-007` and the `transaction` limb of `E-ERROR-001`.
- `compiler/src/codegen/emit-logic.ts` holds the rollback-marking + emission for `fail`/`?` and is
  the right home for the three new exits.
- `compiler/src/ast-builder.js`'s shared `parseTransactionBlock()` (from the hold) already parses
  `transaction` in every nested body, so no parser work is needed for B1a/B1b.
- The hold's conformance case `error/transaction-control-flow-neg` asserts the refusal of
  return/break/continue and therefore **must be rewritten** (a positive/runtime case proving the
  rollback), while `error/transaction-stmt-match-arm-fail-neg` and `transaction-nested-neg` should
  survive as-is.

Report, for each: held / refined / wrong.

## Verification — all of it is required

1. **Both prior review rounds' repros, re-run on the MERGED tree.** They are in the hold's
   `progress.md` + the integration tests `compiler/tests/integration/transaction-in-function-body.test.js`
   (real `bun:sqlite`, executed handlers — 14 of them). They must pass against current main, which is
   the point of the merge: #1251 changed the transaction runtime underneath them.
2. **Bite-prove every new/changed diagnostic and every rollback path** — each new test must FAIL on
   the pre-change tree and pass after. A test that cannot fail is not a test (base §8, the unproven
   gate).
3. **Runtime proof for B1a, not emission-inspection.** Execute a handler whose `transaction {}` is
   left by `return` against real `bun:sqlite` and assert the row is **absent** (rolled back), and
   that a normally-completing block's row is **present**. Do the same for `break` and `continue`
   out of the block. Emission-grep alone does not close this.
4. **Phase 3 — R26 empirical.** Recompile real adopter sources on the post-fix baseline:
   `bun compiler/bin/scrml.js compile <src> --output-dir <tmp>` over
   `scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml` plus the in-repo corpus
   (`examples/`, `samples/`). The hold's census measured **top-level `transaction`: 0 uses; in
   functions: 1 (the `gauntlet-s20-sql/sql-transaction-001.scrml` sample, non-`!`)** — re-measure it
   on the merged tree and report the number, since B1b is newly-rejecting and owes a **measured**
   migration (base §8: assumed-zero is not measured-zero). Symptom check is a specific
   grep/shape assertion, NOT "tests pass". **Do not mark DONE without the empirical pass.**
5. **Direction-of-change classification for the whole landing** (base §8 + `pa-profile-pjoliver11.md`):
   per change, state inert / newly-rejecting / newly-accepting / semantics-changed. B1a is
   newly-accepting (a refused shape now compiles) AND semantics-changed (what a transaction does on
   `return`) — both owe a language-surface review, which I run; your job is to make the classification
   explicit and name the migration count.
6. `bun scripts/facts.ts --check` · `bun scripts/state.ts --check` · `bun run scripts/regen-spec-index.ts --check`
   must all PASS at the end (run the `--write` form first where they fail — these gate the PR ~3 min
   into CI otherwise). `bun scripts/s34-census.ts --check-new --base origin/main` too, as the hold did.
7. Local suite: `bun run test` (chains pretest) for a baseline, plus at minimum
   `bun test compiler/tests/{unit,integration,conformance}`.

## Workspace discipline (read in full; these are incident-earned, not boilerplate)

- **STARTUP GATE, first action, before any edit:** `pwd` must be your assigned worktree under
  `.../scrml/.claude/worktrees/agent-<id>/`; `git rev-parse --show-toplevel` must equal it; tree
  clean. Then `bun install` (a worktree does NOT inherit `node_modules` — the hook fails "cannot find
  package 'acorn'" otherwise) and `bun run pretest` **run plainly from the worktree CWD** (⚑
  `bun --cwd <path> run <script>` silently NO-OPS and exits 0 — it needs `--cwd=<path>` with the `=`;
  verify the artifact `samples/compilation-tests/dist/` actually appeared, exit code proves nothing).
  Also assert your base: `git merge-base HEAD origin/main` == `origin/main` before you start.
  **If ANY check fails, STOP and report — do not proceed.**
- **Every Read/Write/Edit uses a worktree-ABSOLUTE path.** A relative path resolves against the
  integration checkout. NEVER `cd` into the main checkout; use `git -C "$WORKTREE_ROOT"` and run
  `bun` from the worktree CWD.
- ⚑ **NEVER `git stash`.** `refs/stash` lives in the COMMON `.git` dir and is shared across every
  worktree — a stash here can be popped into another tree, and the PA's stash can land in yours
  (witnessed S385, both directions in one race). Do base-vs-build flips by **file copy**.
- ⚑ **NEVER a bare `pkill -f` / `killall` on a command string** (e.g. `pkill -f "bun test"`) — every
  checkout shares it and you would silently kill the PA's or a sibling's run, leaving no trace. Kill
  by PID captured at launch, or filter on cwd.
- Scratch goes under `<worktree>/.tmp/`; set `TMPDIR=~/.cache/scrml-agent-tmp/s453-transaction-exit-rollback/`
  per command (⚑ `TMPDIR` must NOT point inside any repo — tests build throwaway projects under it
  and walk UP for `scrml.toml`/`.git`). Delete your scratch before the final report.
- **Commit after every meaningful edit** (WIP commits expected, the branch is the checkpoint) and
  keep `docs/changes/s453-transaction-exit-rollback/progress.md` as an append-only timestamped log:
  what you just did, what is next, blockers. First commit message: `WIP(s453-transaction-exit-rollback): start at $(pwd)`.
  A clean `git status` before you report DONE is mandatory.

## Report back

Final message: worktree path · final commit SHA · files touched · premise verdicts (held/refined/wrong)
· the three PA readings re-stated with your verdict · the measured migration counts · direction-of-change
per change · which maps were load-bearing · anything you deliberately did NOT do. Do **not** open a PR
and do **not** push to main — I review the delta, land it on a feature branch and run the S239
adversarial pass before it merges.
