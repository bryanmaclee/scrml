# progress — classifyWriteAgainstSpec never consults the declared type

Append-only. Crash anchor for the S337 dispatch.

Startup `pwd`: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a90924554f6a7f288`
Base HEAD at dispatch: `2cc0e4fca07ecc24e4064bd2ba0fc45613f4e491`
Branch: `worktree-agent-a90924554f6a7f288`

---

## 1. Startup (done)

- `pwd` OK (under `.claude/worktrees/agent-`), `git rev-parse --show-toplevel` matches, tree clean.
- `bun install` → 217 packages.
- `bun run pretest` → 13 test samples compiled to `samples/compilation-tests/dist/`.
- **BRIEF.md was NOT in the worktree** — it is committed on `main` after this worktree's base
  (`docs/changes/classify-write-lifecycle-2026-08-10/BRIEF.md`). Read from main (read-only is
  permitted); archived verbatim into this worktree alongside this file.

## 2. Locus verification — the brief's two line numbers, at THIS HEAD

The brief's `:25865` / `:26799` are dpa-023's coordinates. At this HEAD everything below
`checkLifecycleBindingAccess` shifted by **+170** lines.

| dpa-023 | this HEAD | symbol | what it classifies |
|---|---|---|---|
| `:25865` | **`:26035`** | `classifyWriteAgainstSpec` (closure in `checkLifecycleBindingAccess`) | a **re-assignment** write `@cell = expr` |
| `:26799` | **`:26962`** | `classifyResetValueAgainstSpec` (module scope) | a **`reset()`** value (`default=` expr, or the re-evaluated init) |
| — | **`:27020`** | `isInitOfPostType` (module scope) — **a THIRD sibling dpa-023 did not name** | a **declaration initialiser** |

`classifyWriteAgainstSpec` has exactly ONE call site (`:26330`).

## 3. Empirical reproduction — REPRODUCED

Probes compiled through `compileScrml()`. Write and read must be in **separate `${…}` blocks**;
inside a single block the read is scanned in the same statement-text pass as the write and fires
regardless (that is a pre-existing, separate limitation, not this defect).

| # | shape | expected | actual (pre-fix) |
|---|---|---|---|
| S1 | `<u>: (not to User) = not` + `@u.name` | fire | **E-TYPE-001** ✓ machinery live |
| S2 | `@u = < User … >` then `@u.name` | clean | **clean** ✓ correct |
| **S3** | `<v>: (not to User) = not`; `@u = @v`; `@u.name` | fire | **CLEAN** ✗ **THE DEFECT** |
| **S6** | `@u = @u` (self-assign, still `not`); `@u.name` | fire | **CLEAN** ✗ **THE DEFECT** |
| S4 | `@u = 42`; `@u.name` | (type error) | clean — see §5, OUT OF SCOPE |
| S5 | `@u = "hello"`; `@u.name` | (type error) | clean — see §5, OUT OF SCOPE |
| S7 | dpa-023 B6, `@rows = loadRows()` (sync fn returning `number[]`) | — | clean — **DEFERRED rung** |
| S8 | dpa-023 B3, `<rows>: (not to number[]) = loadRows()` | — | clean — **DEFERRED rung** |
| S9 | `given @u => { @u.name }` | clean | clean ✓ §14.12.6.1 intact |

**S3/S6 are the rung-independent defect.** No async anywhere: the RHS's own DECLARED TYPE is
`(not to User)`, which is not `User`, and the cell it names is provably still `not`.

## 4. SPEC is already normative on this — no SPEC edit needed

`SPEC.md:9313` (§14.12.3): *"For Shape 1 reactive cells, transition fires on `@cell = value` where
the cell's initial value is A-shaped and **the written value is B-shaped**."*
`SPEC.md:9315`: *"transitions to `post` on EITHER a **`T`-shaped assignment**… OR a
presence-discrimination"*. `SPEC.md:2249` repeats it for the Shape-4 synthesized case.

The implementation's rule is "the source text is not literally `not`". That is a **conformance
bug against text already in SPEC** — the sibling's SPEC/§34 surface is not needed and is not touched.

## 5. What is OUT of scope, and why (measured, not asserted)

- **S4/S5 (`@u = 42` on a `(not to User)` cell).** Probed: scrml has **no reactive-cell assignment
  type check at all** today — `<n>: number = "hello"`, `@n = "hello"` on a `number` cell, and
  `@u = 42` on a `<u>: User` cell are ALL clean. So a wrong-typed RHS is a separate, broader
  missing check, not this classifier's defect. Routing it through E-TYPE-001 ("accessed before its
  lifecycle transition") would ship a diagnostic that does not name its own root cause.
  → **known-gaps filing, not this dispatch.**
- **S7/S8 (dpa-023's own B3/B6).** `loadRows(): number[]` returns exactly the post-type; the write
  IS `T`-shaped under a synchronous reading. Only the async in-flight rung makes it wrong, and
  dpa-023's own minimal fix needs `σ[c ↦ pending]` plus hoisting `computeAsyncFnNames` out of
  codegen. → **the DEFERRED arc.** This dispatch does not attempt it and does not pretend to.

## 6. The fix (commit `e6afa8ff`)

`classifyWriteAgainstSpec` gains an optional `localStates` parameter and, in the presence branch,
consults the RHS binding's own declared lifecycle type:

- RHS text is `not` → `"pre"` (unchanged).
- RHS is a **bare reference** (`@v` / `v`, whole-text exact match) to a binding whose OWN spec is a
  PRESENCE lifecycle, and that binding is not `"post"` at this point → `"pre"`.
- everything else → `"post"` (unchanged).

Only a presence-lifecycle RHS is decidable here: its pre-type is `not`, so "not yet transitioned"
and "still absent" are the same fact. A variant RHS, or a name the walker does not track, carries no
such proof and keeps the pre-S337 answer — the fix never widens into "reject anything I cannot
prove".

The parser normalises `@v.name` → `@v . name` and `loadIt()` → `loadIt ( )` in state-decl init text,
so neither can be mistaken for a bare reference. Verified by instrumenting the call site.

## 7. Are the two loci genuinely duplicated? — **NO. Shape-duplicated, not fix-duplicated.**

There are **THREE** near-identical presence-branch text comparisons, not two:

| locus | when it runs | information available | gets the fix? |
|---|---|---|---|
| `classifyWriteAgainstSpec` | inside the WALKER, per statement | scope, statement order, live per-binding transition state | **YES** |
| `classifyResetValueAgainstSpec` | `buildCellValueLifecycleMap`, once per cell | none of the above | **no** |
| `isInitOfPostType` | `buildCellValueLifecycleMap`, once per cell | none of the above | **no** |

The refinement asks *"has this bare-reference RHS been discriminated AT THE WRITE POINT?"* — a FLOW
fact. The other two run at map-build time in a single source-order pass with no scope, no statement
order and no transition state, so they provably cannot answer it; deciding it there statically would
assert something stronger than the information available (and for `isInitOfPostType` would make the
answer depend on declaration order). **So the answer is neither "one change applied twice" nor "a
shared helper for the whole classifier".**

What IS shared is the **leaf** absence-literal test, now extracted to
`writeTextIsAbsenceLiteral(trimmedText)` and used at all three sites. That removes the triplication
that caused the drift without pretending the three callers answer the same question. Each of the two
map-build sites now carries a doc comment stating why it does not get the consult.

## 8. Direction-of-change + MEASURED migration — **ZERO**

Newly-rejecting (the reversible direction): a write previously classified `post` can now be `pre`,
so a later member read can newly fire `E-TYPE-001`.

Measured by recompiling the **tracked** corpus base-vs-head — `git ls-files '*.scrml'`, NOT a
directory glob (the suite writes untracked fixtures between runs and moves the denominator):

```
tracked files compared        : 2359
files with a diagnostic DELTA : 0
```

Per-file diagnostic multisets (errors + warnings, sorted) were captured at base (fix stashed) and at
head and compared exactly. **Zero files change. No corpus migration is owed.**

## 9. Verification

- New suite `compiler/tests/unit/lifecycle-write-consults-declared-type.test.js`: **15 tests**,
  **3 fail before the change and pass after** (`@u = @v`, `@u = @u`, the Shape-4 synthesized form).
- Targeted before/after probe table (stash / unstash), 10 fixtures: **exactly two rows flip**
  (`@u = @v` and the Shape-4 form), both clean → `E-TYPE-001`. Every other row is byte-identical,
  including a row that already fired for an unrelated pre-existing reason.
- §14.12 behaviour proved unchanged: `given` guard, `is not` early-return, variant discrimination +
  `transition()`, variant discrimination WITHOUT `transition()` (still
  `E-TYPE-LIFECYCLE-VARIANT-NOT-TRANSITIONED`), variant post-variant write, revert-to-`not`.
- Full gate `bun test compiler/tests/{unit,integration,conformance}`:
  **22304 pass / 70 skip / 1 todo / 0 fail** (1220 files, 443s).

## 10. SURFACED, not fixed — for PA to file (`docs/known-gaps.md` is PA-owned)

1. **`match` presence-discrimination does not transition a Shape-1 cell.** §14.12.6.1 names three
   forms; `given` and `if (x is not) return` work, `match x { not => …, given x => … }` does not —
   the arm body still reads pre-transition and `E-TYPE-001` fires. Measured identically on BOTH
   sides of this change, so pre-existing. `checkArmHasGivenPattern` needs `given <name>` on
   `arm.test` / `arm.variant` and this source form does not surface it. Pinned in the new suite with
   a "flip this expectation when the gap closes" note. **Severity: MED** — it silently withholds one
   of the three normative escape hatches.
   *Independent sub-finding:* a `:struct` post-type additionally hits §18.8.2 `E-TYPE-024` ("match
   over a struct type — not supported"), so for the commonest `(not to SomeStruct)` shape the
   §14.12.6.1 `match` form is unreachable by construction. That is a genuine §14.12.6.1 ↔ §18.8.2
   tension worth a ruling, not just a bug.

2. **No reactive-cell assignment type check exists at any locus.** Measured clean:
   `<n>: number = "hello"`, `@n = "hello"` on a `number` cell, `@u = 42` on a `<u>: User` cell,
   `@u = 42` on a `<u>: (not to User)` cell. This is why S4/S5 were ruled out of scope above — it is
   a much broader hole than the lifecycle classifier and needs its own diagnostic. **Severity: HIGH.**

3. **A write nested inside a `given` body or a function body never reaches the write classifier.**
   `given @v => { @u = @v }` and `function f() { let w = …; @u = w }` both leave `@u` at `pre`
   (measured, pre-existing). Only a TOP-LEVEL `${…}` `state-decl` reassignment classifies. This
   currently fails SAFE (over-firing), which is why it did not surface as a bug, and it is why the
   fix's false-positive surface is nil today — but it means the §14.12.3 write mechanism is
   position-limited in a way SPEC does not say it is. **Severity: MED.**

4. **`classifyResetValueAgainstSpec` / `isInitOfPostType` residuals.** `<u>: (not to User) = @v` and
   a `default=` expression naming another `(not to T)` cell both still classify `post` by text.
   Closing them needs either a second map-build pass or a fixpoint over declaration order — a real
   design choice, not a one-liner. **Severity: LOW** (measured corpus incidence: zero).

## 11. Not touched, per the hard constraints

`compiler/SPEC.md` and the §34 catalog: **not touched, and not needed** — §14.12.3 already says the
written value must be B-shaped, so this is a conformance fix, not a spec change. No new diagnostic
code, so no §34 row. `compiler/src/codegen/emit-client.ts`, `dependency-graph.ts`,
`docs/known-gaps.md`: not touched.
