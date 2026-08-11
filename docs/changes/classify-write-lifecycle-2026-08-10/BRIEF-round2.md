# BRIEF — classify-write §14.12.3 fix round 2 (S338-bryan)

**Dispatched:** 2026-08-11 · **Base:** `fix/classify-write-land` @ `e566d0bd` · **main:** `c5499773`
**Prior round:** 1. An adversarial S239 pass returned DO-NOT-LAND with 8 findings (2 NEW, 5
pre-existing, 1 latent) and 2 hollow tests.

---

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4)

FIRST action, before anything else:

1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`.
   If it is `/home/bryan-maclee/scrmlMaster/scrml` you are in the SHARED CHECKOUT: **STOP and report.**
2. `git rev-parse --show-toplevel` MUST equal that worktree path.
3. `git status --short` MUST be clean.
4. `bun install` (a fresh worktree does NOT inherit `node_modules`).
5. `bun run pretest` — then use `bun run test`, never bare `bun test`, for baselines.

Every Read/Write/Edit uses a WORKTREE-ABSOLUTE path. NEVER `cd` into the main checkout; use
`--cwd "$WORKTREE_ROOT"` and `git -C "$WORKTREE_ROOT"`. About to write to
`/home/bryan-maclee/scrmlMaster/scrml/...` → STOP and re-derive. Echo your startup `pwd` in your
first commit (`WIP(classify-write-r2): start at <pwd>`).

**Scratchpad:** use a path unique to you — `/tmp/claude-1000/-home-bryan-maclee-scrmlMaster-scrml/b25a8ac0-1b30-4ff4-91f8-7347376e005a/scratchpad/cwfix-r2/`.
A sibling agent deleted another agent's worktree today by sharing a generic path.

**Crash recovery:** commit after EACH meaningful change (WIP commits expected); keep
`docs/changes/classify-write-lifecycle-2026-08-10/progress.md` current, append-only, timestamped.
Your branch + that file are the entire recovery surface.

---

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` and follow **Task-Shape Routing** for the type-system shape.
Map stamp: commit `616688ea`, 2026-08-09 — **HEAD is well past it**. Treat map claims as
hypotheses to verify against source. Report which map content was load-bearing, "none" included.

---

## THE NORTH STAR — read this before you touch code

Five adversarial reviews across two branches today found the same shape every time:

> **A text-level shortcut standing in for a structural one.**

Your branch is *about* replacing exactly such a shortcut, and it reintroduced one. The reviewer's
own suggested remedy ("strip one balanced paren layer before the regex") is a **milder strain of
the same disease** and is REJECTED — `((@v))` needs two layers and the next shape needs three.

**Consult the parsed RHS `ExprNode`, not the RHS source text.** The pipeline already produces it.
If a locus makes that genuinely impossible, say so with evidence rather than reaching for a
better regex.

---

## PART A — THE FIX

### A1 — F1 (NEW, MED): the guard is defeated by parentheses. `type-system.ts:25891-25893`

`bareBindingReferenceOf` is `/^@?([A-Za-z_$][A-Za-z0-9_$]*)$/` anchored on the whole trimmed RHS
**source text**, so the declared-type consult only happens when the RHS is spelled exactly `@v`.

Reproducer (verified: fires without the parens, silent with them):

```scrml
type User:struct = { name: string, age: number }
<v>: (not to User) = not
<u>: (not to User) = not
${ @u = (@v) }
${ @u.name }
```
Expected `["E-TYPE-001"]`, observed `[]`. Also defeated: `((@v))`. Correctly fires for `@u=@v`,
`@u = @v;`, extra whitespace, and both comment forms. The Shape-4 implicit form
(`<v>: User` / `<u>: User` / `@u = (@v)`) has the identical hole.

**Fix structurally** — resolve the RHS through the parsed expression node and test for an
identifier binding. Do not paren-strip.

### A2 — F8 (NEW, LOW/latent): the sigil is optional, conflating namespaces

`/^@?(…)$/` makes `@` optional, so a bare `v` resolves against the cell map. In V5-strict, `v` is a
LOCAL identifier and does NOT denote `@v` (PRIMER §3 — "Bare names in expressions are LOCAL
identifiers only"). Measured: `${ @u = v }` with undeclared `v` → base `["E-SCOPE-001"]`,
head `["E-SCOPE-001","E-TYPE-001"]`. Currently unreachable in a clean program, but it is wrong and
it is untested (bite-proof M5 stays GREEN when the sigil is made mandatory).

### A3 — F2 (NEW, MED): false positives, and the landing record denies they exist

```scrml
type User:struct = { name: string, age: number }
<v>: (not to User) = not
<u>: (not to User) = not
function loadIt() { @v = { name: "a", age: 1 } }
${ loadIt()
   @u = @v }
${ @u.name }
```
base `[]` → head `["E-TYPE-001"]`, and `@u` genuinely holds a `User`. Reproduces identically with
the write in a markup handler.

The limitation is real and documented (§10.3 — writes inside fn bodies never reach the classifier).
The error is the CONCLUSION drawn from it: `progress.md §6` claims *"the fix's false-positive
surface is nil today."* **That is empirically false and must not ship as written.** It fails safe
for reads of `@v`; it does not fail safe once `@v`'s state propagates to a second cell.

**You are NOT required to fix the walker's reach** (that is a larger arc). You ARE required to
correct the claim, state the residual honestly, and cover it with a test that pins current
behaviour as known-imperfect rather than asserting it is correct.

### A4 — correct the "migration ZERO" framing

The zero **reproduces** — I had it independently re-measured over all 2,359 tracked sources
(7375/7375 artifacts byte-identical; the single content diff was the reviewer's own worktree path
baked into an import specifier). But it is **vacuous as safety evidence**: population count of the
construct this code classifies is **0 live annotations** in the corpus — all 8 `(not to `/`(not -> `
grep hits are prose in comments and `docs/website` articles, and Shape-4 implicit-not cells number
**0 files**. A zero delta was structurally guaranteed.

Say that plainly in `progress.md`: the measurement proves **no migration is owed**; it proves
**nothing about correctness**. *A fix built before the problem is measured is a fix whose value is
unmeasured.*

---

## PART B — TESTS (two are hollow; the suite otherwise compiles real sources, which is good)

Your existing tests build inputs by COMPILING real `.scrml` via `compileScrml` — keep that. The
g-263 branch's suite asserts against hand-built AST objects and could not see four defects; yours
does not have that disease. Two specific gaps:

- **B1 — the `kind === "presence"` restriction has ZERO coverage (bite-proof M3 stays GREEN).**
  It is called load-bearing in both the doc comment and `progress.md §6`. Relaxing it to
  `if (rhsSpec)` is a real behaviour change: presence LHS + variant RHS
  (`<phase>: (.Draft to .Published)`, `<u>: (not to User)`, `@u = @phase`, `@u.name`) →
  head `[]`, mutant `["E-TYPE-001"]`. Add that test.
- **B2 — no un-sigiled-RHS test (bite-proof M5 stays GREEN).** Cover A2.
- **B3 — add the A1 paren cases** (`(@v)`, `((@v))`) in both the explicit and Shape-4 forms.
- **B4 — bite-proof everything you add**, both directions: corrupt the implementation, confirm RED,
  restore, confirm GREEN. Report any test that stays green under a corruption it claims to catch.

**Dead code note:** the `localStates?` optional and the `?? "pre"` fallback at the same call site
are **unreachable** — the walker seeds `states` for every key in `bindings`, so the fallback fires
only when the lookup already hit. The doc comment describes a branch that cannot execute (bite-proof
M6 stays green because the code is dead, not because the test is bad). Either make it reachable or
delete it and the comment. **A wrong in-source rationale is worse than none — it stops the next
reader looking.**

---

## OUT OF SCOPE — do NOT do these

- **`docs/known-gaps.md` — DO NOT TOUCH IT.** A concurrent agent is writing it. The PA will file
  F3–F7 in one pass. Report them in `progress.md` instead.
- **F3** (`type-system.ts:26144`, HIGH, pre-existing) — the variant branch's
  `new RegExp('(?:^|\\.)\\s*Published\\b').test(rhsSourceText)` is unanchored over raw text and a
  string literal `@phase = ".Published"` clears the guard. **Do not fix it in this round** — it is a
  separate arc with its own migration. **DO name it in your commit body**, because the commit title
  claims the opposite for a function where half the body still does exactly that.
- **F4/F5** (`TRANSITION_CALL_RE` :26002, `FIELD_ACCESS_RE` :26020) — a string literal
  `log("transition(@u)")` launders the presence guard; `log("@u.name")` fires a false positive.
  Same root cause, pre-existing, separate arc.
- **F6** — `transition(@presenceCell)` silently clears the guard though §14.12.3 lists only
  `T`-shaped assignment or presence-discrimination for presence-progression. Pre-existing.
- **F7** — the function-parameter lifecycle position (§14.12 position table says "YES") is
  **entirely unenforced** on both refs. Pre-existing, absent rather than mis-implemented.

---

## VERIFICATION — DO NOT REPORT DONE WITHOUT THIS

1. Every A1/A2/A3 reproducer compiled on YOUR branch and on `origin/main`, with the observed
   diagnostic multiset both sides. Not "tests pass."
2. `scripts/corpus-emit-differential.ts` vs `origin/main` — report N-of-M changed and classify each.
   State the low-power caveat (0 live annotations in the corpus) rather than presenting green as safety.
3. Direction-of-change: this is **newly-rejecting**, and the governing sentence exists —
   `compiler/SPEC.md:9313` verbatim: *"For Shape 1 reactive cells, transition fires on `@cell = value`
   where the cell's initial value is A-shaped and the written value is B-shaped"* (restated `:9315`,
   `:2249`). Confirm it still reads that way; if your fix widens beyond it, STOP and report.
4. Bite proofs for every new test, both directions.
5. `bun run test` on both refs — compare failure **NAME SETS**, not counts. Baseline for reference:
   51 pre-existing failures on both refs, name sets byte-identical, all browser/happy-dom.

**Report:** files touched, final SHA, what landed vs deferred and why, every locus in this brief
that turned out WRONG (they are PA-located-verify, not traced), and anything you think is wrong here.
**You are explicitly authorized to argue against this brief** — including against my rejection of the
paren-stripping fix, if you can show the structural route is genuinely unavailable at that locus.
