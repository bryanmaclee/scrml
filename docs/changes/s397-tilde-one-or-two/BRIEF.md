# S397 — can the loop-expression form express every `fn` accumulator shape?

## WHY THIS EXISTS

bryan is ruling **the fork under the fork on `~` (SPEC §32): is `~` ONE thing or TWO?**

- **§32.2** — `~` is *the value of the preceding unbound expression statement*. A single value, read-once, `lin`.
- **§48.5.1 / §49.6.1** — `~` is *the array of lifted values* a `lift` appends to across loop iterations, read via `return ~` / `let result = ~`.

Both normative at HEAD. An accumulator is a fold over a loop; it is not the value of any one statement.

**The PA recommended ONE thing**, with the accumulator role replaced by making a loop-whose-body-lifts
a **value-producing expression** (`const items = for (n of names) { lift item(n) }`) — bryan's own
ratified Q2(a) limb generalized past arm bodies.

**bryan: *"run the fn accumulator shapes through it before I rule."*** That is this dispatch. **This is
a MEASUREMENT + ANALYSIS dispatch. Change NO compiler behaviour. Build nothing.**

## THE QUESTION, STATED SO A NEGATIVE RESULT IS A WIN

For every `fn`-body accumulator shape that exists in SPEC or the corpus: **can the loop-expression
form express it?**

⚑ **A shape that CANNOT be expressed is the most valuable result you can produce.** It kills the
one-thing proposal cleanly and saves a ratification. **Do not soften it, do not invent a workaround
to rescue the proposal, and do not report a strained re-expression as "expressible."** If a
re-expression changes what the code MEANS, changes its evaluation order, or requires the author to
write materially worse code, that is a FAILURE for that shape and must be reported as one.

## THE SHAPE MATRIX — start here, then add what the corpus and SPEC actually contain

For each: (a) compile it at HEAD and report what it does TODAY (read the emitted JS, never §32's
self-description — §32 describes a checker that does not run); (b) write the loop-expression
re-expression; (c) verdict: EXPRESSIBLE / EXPRESSIBLE-BUT-WORSE / NOT EXPRESSIBLE, with the reason.

1. **Pure** — `fn f(xs) { for (x of xs) { lift g(x) } return ~ }` (§48.5.1's own example)
2. **Statements before the loop** — `const pre = setup()` then the loop then `return ~`
3. **Reads `~` then computes** — `… for … lift … } const n = ~.length  return n`
4. ⚑ **TWO loops, ONE accumulator** — `for (x of xs) { lift g(x) }  for (y of ys) { lift h(y) }  return ~`.
   **This is the shape the PA expects to break it.** Under one-thing, two loops are two values and the
   author must concatenate; under the accumulator role they append to one slot. Report exactly what
   the re-expression costs.
5. **Conditional lift (a filter)** — `for (x of xs) { if (p(x)) { lift g(x) } }  return ~`
6. **Nested loops both lifting** — does the inner lift reach the outer accumulator?
7. **`while` accumulator** — §49.6.1, and note §49.4.4 calls this the SOLE exception permitting a
   `while` in expression position. What happens to that exception under one-thing?
8. **Early return / partial accumulation** — a `return` inside the loop, or a `return ~` on one path
   and something else on another
9. **Statements AFTER the loop but before the read**, and statements after the read
10. **`lift` inside a `fn` called from a loop** — §48.5's E-FN-008 boundary: does one-thing change
    where that boundary sits?

**Then go find the real ones:** grep the corpus (scrml, scrml-native, 6nz, scrml-support, flogence,
giti) for `return ~` / `= ~` / `~.` inside `fn` and `function` bodies, and add every distinct shape
you find. A prior dispatch measured **10 `~`-reading scopes across 3,404 files** — the population is
small enough to enumerate EXHAUSTIVELY rather than sample. Do that.

## WHAT ONE-THING WOULD ALSO CHANGE — report, do not decide

- **§32.6's all-or-nothing elision** would be DELETED (nothing to elide). Confirm nothing else depends on it.
- **§35.8 unification** would become possible (`~` as a plain `lin`; `TildeTracker` deleted; both
  `name === "~"` exclusions at `type-system.ts:18586` / `:19259` removed). Sanity-check that claim.
- **§49.4.4's "sole exception"** would dissolve into the general rule. Confirm or refute.

## ⚑ AN EMPIRICAL FACT THAT IS ALREADY SETTLED — do not re-litigate it, but do confirm it

**Markup-accumulation `lift` never touches `~` at all.** PA-verified this session: a
`for (x of @items) { lift <li>…</li> }` emits **zero** `_scrml_tilde` — it uses `_scrml_lift_target`
/ `_scrml_lift()`. So §32.2's *"a `lift` statement SHALL initialize `~`"* is **already unimplemented**
for markup lift, and the compiler already treats the two as different mechanisms. Confirm it, then
factor it in: only the loop-VALUE-accumulator ties `~` to arrays.

## SCOPE — hard

- **No `compiler/src/` edits.** No prototype. Measure and analyse only.
- ⚑ **Sibling agents are or were live.** Do NOT write `compiler/src/type-system.ts`,
  `compiler/src/codegen/emit-expr.ts`, `compiler/src/codegen/emit-logic.ts`, `compiler/SPEC.md`,
  `compiler/SPEC-INDEX.md`, `conformance/cases/**`, `docs/known-gaps.md`, `docs/changelog.md`,
  `hand-off.md`, `handOffs/`, `docs/pr-reviews.md`. Reading all of them is fine.
- Your entire write surface is `docs/changes/s397-tilde-one-or-two/`.

## OUTPUT

`docs/changes/s397-tilde-one-or-two/FINDINGS.md`. **Lead with the verdict:** is there a shape the
loop-expression form cannot express? Then the matrix, then the three knock-on confirmations.

## WORKSPACE RULES

- Startup gate: `pwd` starts with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`;
  VCS toplevel equals it; clean tree; `git merge-base HEAD origin/main` == `origin/main`. Else STOP.
- `bun install`. Run `pretest` PLAINLY from the worktree CWD — ⚑ `bun --cwd <path> run <script>`
  silently no-ops and exits 0.
- Get this brief: `git fetch origin research/s397-tilde-one-or-two && git checkout FETCH_HEAD -- docs/changes/s397-tilde-one-or-two/`
- ⚑⚑ **NEVER `git stash`** — `refs/stash` is shared across every worktree including the PA's.
- ⚑ **Never a bare `pkill -f` / `killall`.**
- ⚑ **A research dispatch has no natural crash anchor** — commit each shape's verdict as you get it.
  A timeout holding everything in your head loses 100%.
- Never `--no-verify`.

## MAPS

Read `.claude/maps/primary.map.md` first. ⚑ Two prior dispatches confirmed the `~`/§32 surface has
**zero map rows** — expect no routing help here specifically and report it as a third confirmation.
