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

   > ⚠ **RETRACTED IN ROUND 2 (S338). The clause "it is why the fix's false-positive surface is nil
   > today" is EMPIRICALLY FALSE and must not be read as a landing claim.** The surface is not nil:
   > the round-1 fix newly rejects a program whose RHS cell is genuinely present, because the write
   > that made it present is the very thing this entry says the walker cannot see. Measured `[]` on
   > `origin/main` @ `23ea2e5c` → `["E-TYPE-001"]` on the branch. **The limitation is real and this
   > entry describes it correctly; the CONCLUSION drawn from it was wrong.** Failing safe for a READ
   > of `@v` does not make it safe once `@v`'s state propagates to a second cell — which is exactly
   > what the fix made observable. Full measurement, the escape hatch, and the disposition are in
   > §R2.2; the behaviour is pinned by test rather than asserted correct.

4. **`classifyResetValueAgainstSpec` / `isInitOfPostType` residuals.** `<u>: (not to User) = @v` and
   a `default=` expression naming another `(not to T)` cell both still classify `post` by text.
   Closing them needs either a second map-build pass or a fixpoint over declaration order — a real
   design choice, not a one-liner. **Severity: LOW** (measured corpus incidence: zero).

## 11. Not touched, per the hard constraints

`compiler/SPEC.md` and the §34 catalog: **not touched, and not needed** — §14.12.3 already says the
written value must be B-shaped, so this is a conformance fix, not a spec change. No new diagnostic
code, so no §34 row. `compiler/src/codegen/emit-client.ts`, `dependency-graph.ts`,
`docs/known-gaps.md`: not touched.

---
---

# ROUND 2 (S338) — the adversarial pass returned DO-NOT-LAND

Append-only continues below. Round 1 is everything above and is NOT edited in place; where round 2
CONTRADICTS a round-1 claim it says so explicitly and names the section (see §R2.5).

## R2.1 Startup

- Startup `pwd`: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a001b2f1400ad6a0c`
- `git rev-parse --show-toplevel` matches; tree clean; `bun install` → 217 packages;
  `bun run pretest` → 13 samples compiled.
- Scratchpad (unique to this agent, per the brief):
  `…/b25a8ac0-1b30-4ff4-91f8-7347376e005a/scratchpad/cwfix-r2/`.
- **The worktree was cut from `main` (`1ad65742`), NOT from the brief's base.** `git reset --hard
  b1154b81` onto `fix/classify-write-land`'s tip before any work. `b1154b81` is NOT an ancestor of
  `main` (main…base = 2 ↔ 3); PA lands by file-delta so no rebase is owed. The brief's stated base
  `e566d0bd` IS an ancestor of `b1154b81` (the FACTS regen sits on top) — both coordinates are
  consistent.
- Comparison ref for every measurement below: `origin/main` @ `23ea2e5c`.
- **This session lost its first analysis pass to an API stall** (2026-08-11 ~06:00). Nothing was
  corrupt; the F4 gate commit `6788044f` survived and the scratchpad probes survived. §R2.2 is the
  re-established measurement. Process correction applied: measurements are banked to this file
  BEFORE any source edit.

## R2.2 The A3 escape-hatch measurement — banked FIRST (2026-08-11T06:22-06:00)

> This section exists because the pre-stall pass reported *"the `given` wrapper is NOT an escape
> hatch for A3"* and died before writing it down. **Re-established, and the completed measurement
> CORRECTS that claim.** Recorded here in full because the correction matters more than the
> original.

### R2.2.1 What A3 is

`BRIEF-round2.md §A3` (reviewer finding F2). The round-1 fix newly REJECTS a program in which the
RHS cell is genuinely present at the write point, because the walker never sees the write that made
it present:

```scrml
type User:struct = { name: string, age: number }
<v>: (not to User) = not
<u>: (not to User) = not
function loadIt() { @v = < User name: "a", age: 1 > }
${ loadIt()
   @u = @v }
${ @u.name }
```

Measured (`scratchpad/cwfix-r2/repro.mjs`, both refs, whole-file diagnostic multiset):

| ref | result |
|---|---|
| `origin/main` @ `23ea2e5c` | `[]` |
| this branch @ `b1154b81` | `["E-TYPE-001"]` on `@u`, line 11 |

So it is a **newly-rejecting FALSE POSITIVE**, confirmed exactly as the brief states.

### R2.2.2 Is it ESCAPABLE? — **YES. One edit, and it is the canonical one.**

The load-bearing question, because a newly-rejecting change WITH a workaround costs an adopter an
edit, while one WITHOUT costs them the feature. Each row is the A3 shape plus ONE candidate edit
(`scratchpad/cwfix-r2/repro-workaround.mjs`, at this branch's HEAD):

| # | adopter edit | result | verdict |
|---|---|---|---|
| W0 | *(unmodified A3 shape)* | `E-TYPE-001@12` | the false positive |
| W1 | `given @v :> { @u = @v }` — guard the **WRITE** | `E-TYPE-001@12` | **does NOT help** |
| **W2** | **`given @u :> { @u.name }` — guard the **READ**** | **CLEAN** | ✅ **the escape hatch** |
| W3 | copy via a local (`let w = @v` ; `@u = w`) | CLEAN | works, but incidental (see below) |
| W4 | drop the annotation on the destination | `E-CTX-003` | not viable (unrelated decl error) |
| W5 | parenthesise the RHS (`@u = (@v)`) | CLEAN | **the F1 bug itself — my fix REMOVES this** |

**W2 is the answer and it is not a workaround — it is the construct §14.12.6.1 already prescribes
for reading a presence-lifecycle cell.** The adopter who hits A3 is pushed toward the canonical
shape, not into a corner. Cost: one edit, in the position the language already governs.

### R2.2.3 The correction to my own pre-stall claim

*"The `given` wrapper is not an escape hatch"* was **true of the WRITE position (W1) and false as a
general statement.** Guarding the READ (W2) works. The pre-stall claim was incomplete in the
direction that would have over-escalated the finding, and I am recording it rather than quietly
replacing it.

### R2.2.4 What W1's failure actually is — PRE-EXISTING, not round-1's doing

W1 fails **identically on `origin/main`** (`scratchpad/cwfix-r2/repro-escape.mjs`, cases E1/E5 →
`["E-TYPE-001"]` on BOTH refs). A write nested inside a `given` body — or a fn body — never reaches
`classifyWriteAgainstSpec` at all, because `walk()` skips `function-decl` (`type-system.ts:26382`)
and a given-body write is classified in a cloned inner state that is discarded. That is round-1
progress §10.3's known gap, measured again here on both refs. **Round 1 created the A3 false
positive; it did NOT create the missing write-position guard.** Both halves have to be stated or the
finding reads as twice as bad as it is.

### R2.2.5 Recommendation on A3 — SHIP, pinned as known-imperfect

Given W2 exists, the brief's disposition holds and I am not arguing against it:
- direction-of-change is newly-rejecting **with** a canonical one-edit escape;
- it fails LOUD (a diagnostic naming the binding and its annotation), whereas the defect the fix
  closes fails SILENT (a member read of a value the compiler's own model knows is absent);
- corpus incidence 0 (§R2.6 — and that zero is low-power, not safety).

I therefore do **not** recommend descoping A3 or narrowing the guard further. The narrowing I
considered and rejected — "refuse to refine when the file contains any write to the RHS cell the
walker cannot see" — trades this false POSITIVE for a false NEGATIVE (a fn that is never called
would then silence the real bug), and choosing between them needs the call-flow fact that the
deferred arc is about. It would be a text-free but still evidence-free shortcut.

### R2.2.6 Incidental finding, NOT actioned — a multi-statement top-level copy already rejects

`scratchpad/cwfix-r2/repro-narrow.mjs` case N1: a top-level `@v = <User …>` followed in the SAME
`${…}` block by `@u = @v`, then `@u.name`, fires `E-TYPE-001` on `@u` — **on BOTH refs**
(`origin/main` and this branch). The single-statement control C1 (write then read the same cell) is
CLEAN on both. So a *walker-visible* write does register for the cell it targets, but the
second-statement copy in a multi-statement block does not clear the destination. Pre-existing,
unrelated to this brief's three items, and NOT chased here. Filed for PA in §R2.7.

## R2.3 The fix — commit `2a9380c4` (2026-08-11T06:38-06:00)

**The structural route the brief demanded is available and I took it.** `state-decl` nodes carry
`initExpr`, the parsed RHS (`safeParseExprToNode`, ast-builder.js). Verified by dumping the node
(`scratchpad/cwfix-r2/probe-ast.mjs`) before writing a line of the fix:

| written RHS | `init` (text) | `initExpr` (tree) |
|---|---|---|
| `@v` | `"@v"` | `{ kind: "ident", name: "@v" }` |
| `(@v)` | `"( @v )"` | `{ kind: "ident", name: "@v" }` |
| `((@v))` | `"( ( @v ) )"` | `{ kind: "ident", name: "@v" }` |
| `@v.name` | `"@v . name"` | `{ kind: "member", object: {ident @v}, property: "name" }` |
| `not` | `"not"` | `{ kind: "lit", litType: "not" }` |

**The parser emits NO node for grouping parens** — there is no `paren`/`group` expression kind in
ast-builder.js — so all three spellings of the same expression are one node. That is why asking the
tree is depth-proof and why paren-stripping could never be: any fixed strip count is beaten by one
more paren. I did **not** need to argue the brief's rejection back; it was right.

### R2.3.1 What changed

- `bareBindingReferenceOf(trimmedText)` → **`bareCellReferenceOf(initExpr)`**. Structural
  `kind === "ident"`, and the `@` sigil is now **required** (closes F8/A2 — in V5-strict a bare `v`
  is a LOCAL identifier, PRIMER §3, and the old `@?` let it resolve against the CELL map).
- **NEW `writeExprIsAbsenceLiteral(initExpr)`** — structural `kind === "lit" && litType === "not"`.
- `classifyWriteAgainstSpec` takes `(initText, initExpr, spec, localStates)`; the call site threads
  `stmt.initExpr`.
- **Dead code DELETED, not documented.** The `localStates?` optional and its `?? "pre"` fallback
  could never execute: the single call site always passes the map, the walker seeds `states` for
  every key in `bindings` (`type-system.ts:25975-25979`), and the lookup only runs after
  `bindings.get(rhsName)` already hit. The brief was right that the doc comment described an
  unexecutable branch.
- `writeTextIsAbsenceLiteral` is **kept** — it is still the leaf for the two map-build sites, and it
  remains the fallback at the write site for a RHS the expression parser could not build a node for
  (`safeParseExprToNode` returns null on parse failure). It is never what DECIDES a refinement, so a
  missing node degrades to the pre-S337 answer rather than to a wrong one.

### R2.3.2 A FOURTH defect, found while fixing F1 — and it is the worst of them

**The paren hole ran in BOTH directions.** The absence test was textual too, so a §6.8
revert-to-absent spelled `@u = (not)` missed `trimmed === "not"` and classified as a **transition**:

```
declare `= not` → write a User → `@u = (not)` → `@u.name`
```
compiled **CLEAN** and read a `not` at runtime. `((not))` likewise
(`scratchpad/cwfix-r2/repro-notparen.mjs`).

This **fails OPEN** — a silent wrong answer — where F1 merely fails to fire. Measured identically on
`origin/main` @ `23ea2e5c`, so **PRE-EXISTING**, not round-1's doing. It is closed here for free by
the same structural consult, because `not`, `(not)` and `((not))` are one `lit` node. One structural
consult retired two text shortcuts on the two branches of the same `if`.

### R2.3.3 Measured, both refs (`scratchpad/cwfix-r2/repro.mjs`, whole-file diagnostic multiset)

| case | `origin/main` `23ea2e5c` | round 1 `b1154b81` | **round 2 `2a9380c4`** |
|---|---|---|---|
| `@u = @v` explicit | `[]` | `[E-TYPE-001]` | `[E-TYPE-001]` |
| **`@u = (@v)` explicit** | `[]` | **`[]`** ✗ | **`[E-TYPE-001]`** ✅ |
| **`@u = ((@v))` explicit** | `[]` | **`[]`** ✗ | **`[E-TYPE-001]`** ✅ |
| `@u = @v` Shape-4 | `[]` | `[E-TYPE-001]` | `[E-TYPE-001]` |
| **`@u = (@v)` Shape-4** | `[]` | **`[]`** ✗ | **`[E-TYPE-001]`** ✅ |
| **`@u = ((@v))` Shape-4** | `[]` | **`[]`** ✗ | **`[E-TYPE-001]`** ✅ |
| **`@u = v` (un-sigiled)** | `[E-SCOPE-001, W:E-DG-002]` | **`+[E-TYPE-001]`** ✗ | **matches main** ✅ |
| **`@u = (not)` revert** | `CLEAN` ✗ | `CLEAN` ✗ | **`[E-TYPE-001]`** ✅ |
| A3 fn-body write | `[]` | `[E-TYPE-001]` | `[E-TYPE-001]` (pinned, §R2.2) |
| B1 variant RHS | `[]` | `[]` | `[]` (unchanged — restriction held) |
| every G-guard row | — | — | **byte-identical to round 1** |

### R2.3.4 F3 is NOT fixed, and the commit body says so

The brief keeps F3 out of scope and I honoured that. But the commit subject —
*"classify the write from the PARSED RHS, not its spelling"* — is true of **half** the function: the
VARIANT branch twelve lines below still matches an unanchored pattern against raw source text. I put
a ⚠ block at the locus and named F3 in the commit body, because a subject claiming "not its
spelling" over a body that still reads spelling is precisely what stops the next reader looking.

## R2.4 Bite proofs — B4, both directions (`scratchpad/cwfix-r2/biteproof.sh`)

Baseline 24 pass / 0 fail. Each mutation applied in isolation, suite run, file restored from HEAD.

| mutation | tests that died | verdict |
|---|---|---|
| **A** drop the sigil requirement | the un-sigiled test, alone | ✅ bites |
| **B** relax `kind === "presence"` → `if (rhsSpec)` | the variant-RHS test, alone | ✅ bites — **this is the restriction that had ZERO coverage in round 1** |
| **C** restore the round-1 TEXT regex | 3 paren tests + the un-sigiled one | ✅ bites (the old regex carried `@?`, so it re-opens F8 too) |
| **D** restore the TEXT absence test | both paren-revert tests, alone | ✅ bites |
| **E** remove the refinement entirely | 7, incl. round 1's core three | ✅ bites |

Restored → **24 pass / 0 fail**, tree clean. **No test stayed green under a corruption it claims to
catch.** The brief's M3 (presence-restriction) and M5 (sigil) gaps are both closed; M6 needed no
proof because the dead code it named is deleted rather than described.

## R2.5 The "migration ZERO" framing — CORRECTED (round-1 §8 superseded on the SAFETY axis)

Round-1 §8 reports a measured corpus delta of **zero** and is **factually reproduced**: per-file
diagnostic multisets over all **2,359** tracked `.scrml` sources, `origin/main` @ `23ea2e5c` vs this
branch @ `94288917` — **0 files changed** (`scratchpad/cwfix-r2/corpus-diag.mjs`, `DIAG-main.json`
vs `DIAG-postC.json`, `diff` reports identical).

**But that zero is VACUOUS as safety evidence, and round-1 §8 let it read as safety.** The
population of the construct this code classifies is **zero**:

- `git ls-files '*.scrml' | xargs grep -l '(not to \|(not -> '` returns **exactly one file**,
  `docs/readme-snippets/tasks-app.scrml:42` — and I read it: `completed_at: (not to timestamp)` is a
  **`type Task:struct` FIELD annotation**, not a Shape-1 reactive cell declaration. A struct field
  never reaches `classifyWriteAgainstSpec`, which classifies `state-decl` WRITES. So the count of
  live reactive-cell presence-lifecycle annotations in the tracked corpus is **0, not 1.**
- (The brief's companion claim — Shape-4 implicit-not cells number 0 files — I did **not**
  independently verify; it is harder to grep for and I am flagging that rather than inheriting it.)

**A zero delta was therefore structurally guaranteed.** The measurement proves **no migration is
owed**. It proves **nothing about correctness**. A fix built before the problem is measured is a fix
whose value is unmeasured — and the four real defects in this round were all found by hand-built
reproducers, not by the corpus, which is the same point from the other side.

## R2.6 Item C — the variant-idiom extraction (commit `94288917`)

Added mid-round by bryan. Six identical constructions of
`` new RegExp(`(?:^|\\.)\\s*${ESC(name)}\\b`).test(text) `` → one module-scope helper,
`variantNameMatchesSourceText`.

**The dispatch said SEVEN sites; there are SIX.** The five coordinates it named (`:26048` `:26052`
`:26978` `:26982` `:27033`) are `origin/main`'s line numbers and enumerate five of the six —
`:27037` was missed. On this branch they sat at `:26237` `:26241` `:27194` `:27198` `:27257`
`:27261`. Reported rather than silently reconciled.

**The three escape helpers were checked BEFORE unifying, because a difference in escaping is a
difference in what matches.** `escapeRe` (local), `esc` (local) and an inline `.replace(…)` are
**byte-identical** — `/[.*+?^${}()|[\]\\]/g` → `"\\$&"` in all three. So unification is safe. `esc`
is now unused and deleted; **`escapeRe` is KEPT** — four other call sites use it for unrelated
patterns.

**INERTNESS PROVEN, not asserted:** per-file diagnostic multisets over all 2,359 tracked sources,
captured pre-C and post-C, **byte-identical, 0 files changed**. Lifecycle suite 24/24 unchanged.

**And the helper is FAITHFUL, NOT CORRECT — its doc comment says so at the locus.** It preserves
both known defects (F3): unanchored, so a string literal `".Published"` clears the guard; and
source-text-reading, so it cannot tell an expression from a comment or a string. The semantic fix is
a separate arc with its own migration. This extraction exists so that fix is **one edit instead of
six**.

## R2.7 SURFACED, not fixed — for PA to file (`docs/known-gaps.md` is OFF LIMITS this round)

The brief forbids touching `docs/known-gaps.md` (a concurrent agent owns it), so every finding below
is reported here for the PA's single filing pass. **F3–F7 are the reviewer's; N1–N3 are mine.**

| id | finding | severity | status |
|---|---|---|---|
| **F3** | `variantNameMatchesSourceText` (was 6 inline sites) is unanchored over RAW TEXT — `@phase = ".Published"`, a string literal, clears the variant guard | HIGH | pre-existing; **named in commit `2a9380c4`'s body + a ⚠ at the locus**; C makes the fix one edit |
| **F4/F5** | `TRANSITION_CALL_RE` / `FIELD_ACCESS_RE` — `log("transition(@u)")` launders the presence guard; `log("@u.name")` fires a false positive | — | pre-existing, same root cause, separate arc |
| **F6** | `transition(@presenceCell)` silently clears the guard though §14.12.3 lists only a `T`-shaped assignment or presence-discrimination | — | pre-existing |
| **F7** | the §14.12 function-parameter lifecycle position (position table says YES) is entirely unenforced on both refs | — | pre-existing, absent rather than mis-implemented |
| **N1** | **the absence-literal test had the SAME paren hole, and it FAILS OPEN** — `@u = (not)` classified as a transition, so the following read compiled CLEAN and read a `not` at runtime | MED→ | **CLOSED this round** (see §R2.3.2); was pre-existing on `origin/main` |
| **N2** | a **multi-statement** top-level block — `@v = <User…>` then `@u = @v` in ONE `${…}` — leaves `@u` at `pre`, so the read fires. Single-statement control is clean. Both refs | MED | pre-existing, **open**, not chased (§R2.2.6) |
| **N3** | guarding a WRITE with `given` does not propagate the transition outward (`given @v :> { @u = @v }`), so the write-position §14.12.6.1 form is inert. Both refs | MED | pre-existing, **open**; it is why F2 has no write-side escape (§R2.2.4) |

Round-1 §10's four entries (match-arm discrimination, no cell-assignment type check, walker reach,
the two map-build residuals) still stand and are **not** superseded — except §10.3's "false-positive
surface is nil" clause, retracted in place above.

## R2.8 Verification — the brief's five points (2026-08-11T07:16-06:00)

### 1. Reproducers on BOTH refs, with the observed multiset — done
§R2.3.3's table. Every A1/A2/A3 case measured on `origin/main` @ `23ea2e5c` and on this branch, by
compiling through `compileScrml()`, not by reading tests.

### 2. `scripts/corpus-emit-differential.ts` vs `origin/main` — **NO DIFFERENCES**

Base captured by swapping `origin/main`'s `compiler/src/type-system.ts` into this worktree (the only
source file that differs), so the comparison isolates exactly this branch's source delta;
`--allow-same-revision` is therefore required and given.

```
VERDICT: NO DIFFERENCES  over 1904 common sources of 1904 base / 1904 head enumerated
                         and 7375 compared artifacts
  compile-failure delta     0 newly failing / 0 newly passing
  diagnostic changes        0 code / 0 text-only
  artifact set delta        0 added / 0 removed
  artifact content diffs    0 of 7375 compared
  syntax delta (effective)  0 new / 0 fixed / 0 message-changed
  bare server-fn sites      base 145 / head 145  (delta 0)
```
Exit **0** — "no differences", NOT exit 2 ("not a valid comparison"). This is also item C's own gate:
**C moved zero bytes.**

**LOW-POWER CAVEAT, stated rather than presented as safety (§R2.5): the corpus contains ZERO live
reactive-cell presence-lifecycle annotations, so green here was structurally guaranteed.** It shows
this branch broke nothing. It is not evidence the fix is right; the reproducers are.

### 3. Direction-of-change — newly-rejecting, and it does NOT widen beyond the governing sentence

`compiler/SPEC.md:9313` re-read at this HEAD, still verbatim: *"For Shape 1 reactive cells,
transition fires on `@cell = value` where the cell's initial value is A-shaped and the written value
is B-shaped."* `:9315` restates it as *"transitions to `post` on EITHER a `T`-shaped assignment …
OR a presence-discrimination on the cell (`given c :> …`, `if (@cell is not) return`,
`match @cell { … }`)"*.

The change only refines the judgment *"is the written value B-shaped?"* — it narrows the writes
counted B-shaped to exclude a bare reference to a still-absent presence cell. **No widening; nothing
to STOP and report.** A useful side-note: `:9315` names `given c :>` explicitly, which is exactly the
A3 escape hatch of §R2.2.2 — the workaround is spec-named, not invented here.

### 4. Bite proofs — §R2.4. Five mutations, all bite, none stayed green.

### 5. `bun run test` on both refs — failure NAME SETS compared, not counts

| ref | pass | fail | skip |
|---|---|---|---|
| `origin/main` type-system | 29,936 | 58 | 216 |
| this branch @ `94288917` | 29,945 | **49** | 216 |

**NEW failures on head: ZERO** (`comm -13` over the sorted name sets is EMPTY).
**Base-only failures: exactly 9**, and all 9 are my own tests failing against a compiler that lacks
the fix — 3 from round 1's S337 set + 6 of round 2's. The 49 shared failures are name-set-identical
on both refs (browser/happy-dom, pre-existing).

⚠ **The brief's stated baseline of "51 pre-existing failures on both refs" does not reproduce here —
I measure 49.** The name sets are identical BETWEEN refs, which is the actual gate, so this is an
environment/run difference (browser tests are happy-dom global-state sensitive), not a regression.
Reporting rather than quietly adopting either number.

### FACTS gate
`docs/FACTS.md` regenerated **after** the last `compiler/src` commit (`94288917`), per the gate's
purpose: `live compiler source` 240,323 → **240,447** lines, 187 files (unchanged).
`bun scripts/facts.ts --check` → **PASS**. No gate was bypassed at any point in this round; the one
`--no-verify` commit I started the session with was immediately reset and remade under the hook
(which skips the suite for docs-only staged changes anyway).
