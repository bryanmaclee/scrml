# S385 `<each>` opener scope check — ROUND 5 progress

## Startup (verified, not assumed)

- `pwd` = `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a67ac1c2e9dec6064`
- `git rev-parse --show-toplevel` — matches. Tree clean at start.
- `git fetch origin fix/s385-each-in-scope-check-r4` + `git reset --hard FETCH_HEAD`
  → `git log --oneline -1` = `e41dc6a3 S385 r4 gates: full suite fail-set byte-identical to origin/main, browser PASS`. Round 4's tip confirmed.
- `bun install` — 218 packages.
- `bun run pretest` run PLAINLY from the worktree CWD (not `bun --cwd`). Artifacts VERIFIED
  by listing, not by exit code: `samples/compilation-tests/dist/` holds 34 entries
  (13 samples × `.client.js`/`.html` + hashed runtime bundles).
- Root `dist/` is absent in the worktree; grepped both test files that mention
  `dist/scrml-runtime` — both are STRING assertions about emitted paths, neither reads
  the filesystem. No symlink needed.

## Round 5 scope (from BRIEF.md, archived verbatim alongside this file)

Round 4's FIX STAYS. This round makes the arc's CLAIMS true and pins what it fixed.

- T1 — pin the F1 regression (lambda/template-literal shapes) that motivated round 4.
- T2 — narrow the over-stated coverage claim; `@name` over a NON-reactive binding is NOT covered.
- T3 — pin two low findings: `key=@<asName>` false negative (typer-vs-codegen divergence)
  and `E-TYPE-004` newly reachable from the `key=` site.

---

## Phase 0 — VERIFY EVERY BRIEFED PREMISE BY EXECUTION, BEFORE EDITING ANYTHING

The relayed-premise rule: a premise handed to me in a brief is UNVERIFIED until I
run it. Four premises were checked. THREE REPRODUCED EXACTLY. ONE DID NOT.

### Gate 5 — the three F-shapes, re-run at `e41dc6a3` (round 4's tip)

Harness: `compileScrml({ write:false })`, E-codes counted across BOTH the
`errors` and `warnings` streams (diagnostic-partition rule).

| shape | expected | measured |
| --- | --- | --- |
| `in=@rows.map(r => \`id-${r}\`)` | 0 errors | **0** — `[]` |
| `in=@undeclaredHidden.map(x => \`${1}\`)` | fires | **1** — `[E-STATE-UNDECLARED]` |
| `in=@totallyUndeclaredName` | fires | **1** — `[E-STATE-UNDECLARED]` |

Round 4's excision is confirmed correct by my own execution. It stays untouched.

### T2 — REPRODUCED. The coverage claim over-states.

Compiled THROUGH THE CLI, not just the API:

```
${ const items = [1, 2, 3] }
<div><each in=@items as r><span>{r}</span></each></div>
```

→ `exit 0`. Zero `E-` diagnostics (2 warnings, 1 lint, none of them an error).
Emitted client, verbatim:

```js
const _items = _scrml_cs_reactive_get("items");   // line 18 -> undefined
if (!_items) { _scrml_each_clear(_mount); return; }  // line 21 -> empty, forever
...
const items = [1, 2, 3];                          // line 42 -> a plain JS const
```

That is VERBATIM the failure mode the arc's own comment block says it closes
("`in=@typo` -> `_scrml_reactive_get("typo")` -> undefined -> the list renders
EMPTY, forever, on a clean exit-0 compile").

CAUSE — located in source, `compiler/src/type-system.ts:7823-7825`:

```ts
const atEntry = scopeChain.lookup(raw.includes(".") ? raw.slice(0, raw.indexOf(".")) : raw)
  ?? scopeChain.lookup(atBase);
if (atEntry) return; // resolves to a cell / loop local / import — in scope.
```

The `?? scopeChain.lookup(atBase)` fallback resolves the BARE name, so any `@x`
whose bare name is bound as a plain `const` / local / value-import resolves and
stays silent.

PRE-EXISTING, NOT INTRODUCED — measured both directions by a FILE-COPY base/build
flip (never `git stash`; `refs/stash` is shared across worktrees):

- `@items` in a plain logic block (`const items = […]; const total = @items.length`)
  is ALSO silent — 0 errors. Same walker, nothing to do with `<each>`.
- The `<each>` reproducer above: `origin/main` 0 E-codes, round-4 build 0 E-codes.
  IDENTICAL. This arc did not cause it and does not close it.

AND THE OBVIOUS FIX IS WIDER THAN IT LOOKS. Gating the `@`-branch on
`kind === "reactive" | "import"` would also newly-reject `@<each-row-local>` —
which the walker's own comment at :7789-7796 says is DELIBERATE ("a `variable`
(the `<each>`/`<tableFor>` `as`-name loop local) … resolves it"). So the gate is
newly-rejecting against a documented-intentional acceptance, not just against
stray consts. Confirms the brief: its own arc, its own ruling. NOT fixed here.

### T3a — REPRODUCED. `key=@<asName>` typer-vs-codegen divergence is real.

`<each in=@rows as x key=@x>`, same source, two harnesses:

- CLI (`write:true`): **FAILED — 1 error**, `E-CODEGEN-INVALID-LOGIC`, stage CG,
  `Unexpected character '@'` at `..., (x, _scrml_each_idx) => @x, ...`
- `compileScrml({write:false})` (the LSP path): **0 E-codes**, silent accept.

`origin/main` is ALSO silent on the `write:false` path — so this is a pre-existing
false negative the arc did not introduce and does not close. Worth PINNING because
the arc's `key=` routing makes a reader assume it is covered.

### T3b — REPRODUCED. `E-TYPE-004` IS newly reachable from the `key=` site.

`<each in=rows as u key=u.email>` over `const rows = ?{\`SELECT id, name FROM users\`}.all()`:

| build | E-codes |
| --- | --- |
| `origin/main` (BASE, by file copy) | `[]` — exit 0 |
| round-4 tip (BUILD) | `[E-TYPE-004]` |

Newly-firing, confirmed by the flip, not inferred from the diff. And the two
neighbouring shapes stay CLEAN on the build, so the new firing is precise:

- `key=u.id` (a column the projection DOES select) → `[]`
- `SELECT *` + `key=u.email` → `[]` (+ `W-SQL-ROW-UNTYPED`, a warning)

The behaviour is CORRECT — `key=u.email` over a projection that never selected
`email` emits `(u, _idx) => u.email` returning `undefined` for every row, which
collapses the reconciler's keys. But it is UNDOCUMENTED at both the comment block
and the test file, so a future imprecision in SQL row-type resolution would
surface as a mystery fatal on `key=`. Documented + pinned this round.

### T1 — DID NOT REPRODUCE. SCOPE CORRECTION, surfaced rather than papered over.

The brief states: "The test file has 14 `expectNoErrors` cases and **none of them
is the F1 shape** — a template literal inside a lambda in an opener."

THE COUNT IS RIGHT AND THE CONCLUSION IS WRONG. There are 14 cases across the two
helpers named `expectNoErrors` / `expectNoErrors2` (§3 and §5). But §10 holds
THIRTY MORE under a third helper, `expectNoErrors3`, emitted from a `SHAPES`
table by a `for` loop — so they carry no literal `expectNoErrors` token at each
call site and a grep for the helper name misses every one of them. §11 adds 14
positive controls under the same table-driven shape. `bun test` on the file at
`e41dc6a3`: **75 pass, 3 todo, 0 fail, 78 tests.**

`git log -S "template-literal-inside-lambda"` → `67009fca`, ROUND 4's own fix
commit. Round 4 pinned its own regression in the same commit that fixed it.

Checked item by item against what the brief asked for:

| briefed pinning case | status at `e41dc6a3` |
| --- | --- |
| lambda, expression body | §10 `lambda-expression-body` — PRESENT |
| lambda, BLOCK body | §10 `lambda-block-body` (+ `-multi-statement`) — PRESENT |
| template literal inside a lambda, `in=` | §10 `template-literal-inside-lambda` — PRESENT, labelled "the exact round-3 false positive" |
| template literal inside a lambda, `key=` | **ABSENT** — the one genuine gap |
| destructured lambda params `([k, v]) => …` | §10 `lambda-array-destructure-param` — PRESENT |
| long method chain | §10 `long-method-chain` (+ template-literal-limb) — PRESENT |
| nested `<each>`, inner opener reads OUTER alias | §10 ×3 — PRESENT |

So T1 is ~95% already landed. I am NOT re-adding 6 duplicate cases to make a
worklist look served — padding a suite is the same defect class as over-claiming
one. I am adding ONLY the genuine gap: §10 has **no `key=` case containing a
lambda at all**, so the F1 shape is unpinned in the `key=` slot specifically —
and `key=` is the slot with the WORSE failure mode (ReferenceError on first
render, not an empty list).

---

## Phase 1 — a SECOND, LARGER coverage hole, found by building T1's positive controls

Not briefed. Found because §11's own discipline was applied to the new `key=`
lambda cases: a no-error assertion is worthless unless a twin with an UNDECLARED
cell in the same shape actually fires. Three of the four new twins fired. ONE DID
NOT, and chasing it produced the biggest finding of the round.

### The walker does not descend into lambda bodies AT ALL

`forEachIdentInExprNode` skips `lambda` bodies. That guard is LOAD-BEARING — it is
exactly what makes `in=@rows.filter(n => n > 1)` silent about the param `n`, and
its absence is what produced round 3's F1 false positive. But the price is total:
**nothing inside a lambda body is scope-checked.** Measured, `write:false`,
E-codes across both streams:

| opener | E-codes |
| --- | --- |
| `in=@rows.filter(n => n > @typoInsideInLambda)` | **`[]` — SILENT** |
| `in=@rows.filter(n => n > typoBareInsideLambda)` | **`[]` — SILENT** |
| `in=@rows.filter(n => n > 1).concat(@typoOutsideInLambda)` | `[E-STATE-UNDECLARED]` — fires |
| `key=r.tags.map(t => t + @typoInsideKeyLambda).join("-")` | **`[]` — SILENT** |

PRE-EXISTING AND NOT `<each>`-SPECIFIC — the same walker, same hole, in plain logic:

| logic block | E-codes |
| --- | --- |
| `const out = @rows.filter(n => n > @typoInsideLogicLambda)` | **`[]` — SILENT** |
| `const out = @rows.concat(@typoOutsideLogicLambda)` | `[E-STATE-UNDECLARED]` — fires |

### Why this one is WORSE than the const-shadow hole

Compiled through the CLI: **exit 0**, and the emitted client contains, verbatim:

```js
const _items = _scrml_cs_reactive_get("rows").filter(n => n > _scrml_cs_reactive_get("typoInsideInLambda"));
```

`_scrml_cs_reactive_get("typoInsideInLambda")` → `undefined`; `n > undefined` is
`false` for every `n`; the filter returns `[]`; **the list renders EMPTY, FOREVER.**

That is the SAME failure-mode row the arc's comment block opens by describing —
reached through a shape `§10` pins as covered.

And it is strictly worse than the const-shadow case: there, `items` at least
EXISTS somewhere in the file. Here `typoInsideInLambda` is declared NOWHERE. It
is the pure undeclared-cell typo SPEC §6.1.2 says SHALL be `E-STATE-UNDECLARED`,
sitting one lambda deep, and this check does not see it.

### What this does NOT mean

§10 and §11 are still SOUND, and I am not weakening them. §10 asserts lambda
shapes do not FALSE-FIRE, which is true and is the property round 4 landed. §11's
twins fire because their undeclared cell is the ITERABLE BASE, outside the lambda
— also true. The defect is that a reader arrives at "lambda shapes: covered" when
the accurate statement is "lambda shapes: covered against false positives; their
BODIES are not checked at all."

That is the over-claim, in the test file as much as in the comment. Both narrowed.

### Not fixed here, same reasoning as the const-shadow hole

Descending into lambda bodies requires binding the params first (that is the whole
reason the guard exists). It is a change to the SHARED walker — every `${…}`, every
condition, every prop — so it is newly-rejecting language-wide, and it owes its own
measured migration and its own ruling. Filed as
`GAP-S385-LAMBDA-BODY-READS-UNCHECKED`.

---

## Phase 2 — what landed

Two code files touched. `git diff --numstat` on the source is **84+42 = 126
insertions, 0 deletions, and ZERO of them are non-comment** — verified by
`git diff -U0 | grep '^+' | grep -vE '^\+\s*//'` returning empty on both commits.
Round 4's fix is byte-for-byte untouched, as directed.

### `compiler/src/type-system.ts` — comment only, +126 lines

Three narrowings, all sited where the claim is actually made rather than in a
footnote:

1. A ⚠ pointer inserted directly under the two-row failure-mode table, because
   that table is what a skimmer reads: the `in=@typo` row is closed ONLY when
   `typo` resolves to nothing.
2. `WHAT THIS COVERS, AND WHAT IT DOES NOT` — the covered set stated explicitly,
   then the two uncovered positions with their measured reproducers, their causes
   located by line, and the reason each is NOT fixed in this arc.
3. `key= PULLS IN E-TYPE-004, WHICH IS NEW AT THIS SITE` — the newly-reachable
   SQL row check, with the base/build numbers and the two clean neighbours that
   bound it.

### `compiler/tests/unit/each-opener-expr-undeclared-read.test.js` — +327/-1

- **Header**: `pin every legitimate opener shape` → `pin the legitimate opener
  shapes`, plus a `WHAT THIS FILE DOES NOT ESTABLISH` block naming both holes.
  The load-bearing sentence: §10's honest summary is "lambda-containing openers
  do not false-fire", NOT "lambda-containing openers are covered".
- **§10, +7 shapes**: the `key=`-slot lambda family. Round 4 pinned the F1 shape
  in `in=` and nowhere else — before this, §10 held **no `key=` case containing a
  lambda at all**. `key=` is a different code path (checked AFTER the scope push,
  ORDERING TRAP C), so a regression could land there with every `in=` case green.
- **§11, +3 controls**: twins for the new families, each with a comment saying
  WHY the undeclared cell sits at the head of the chain — an inside-the-lambda
  twin would not fire, and that absence is pinned in §12 rather than left looking
  like a missing control.
- **§12, NEW**: the coverage boundary. Each hole gets a LIVE CONTRAST case
  (asserting the check fires one position over) plus a `test.todo`. Deliberately
  no "compiles clean" assertion on either broken shape — §5's
  GAP-S385-EACH-KEY-DESTRUCTURE note is the precedent for why that would be the
  suite blessing the failure class.
- **§13, NEW**: the two `key=` surprises. The `key=@x` divergence is RECORDED
  with the note carried inside the asserted object, so the failure output itself
  says "known false negative, here is what to do when it closes". The E-TYPE-004
  case is pinned with both bounding neighbours (`key=u.id`, `SELECT *`).

File: **75 pass / 3 todo → 91 pass / 6 todo, 0 fail.**

## Phase 3 — GATES, with real numbers

### Gate 1 — full suite. 55 fail, and the 55th is CORRECT.

```
30795 pass · 216 skip · 8 todo · 55 fail · 136931 expect() · 31074 tests / 1426 files
```

Round 4 recorded 54. The delta is exactly ONE name:

```
M1 — an if= mount/unmount controller in a swapped region RE-EVALUATES
   > a swapped-in if= mounts on true and unmounts on false (not frozen)
```

**I did not accept "flaky" as the answer.** Round 4's progress calls this test
run-to-run flaky, but that is a relayed premise, so it was checked two ways:

1. **Re-ran the whole suite.** Second run: 30795 pass / 55 fail, and the
   NORMALIZED name sets of the two r5 runs are **byte-identical**. Stable at 55
   on this build, not flapping.
2. **Read the normative record.** The name is **line 13 of the committed
   `compiler/tests/browser/FAILURE-BASELINE.json`** — a DOCUMENTED expected
   failure, one of 48.

So the direction is the reverse of how it looks: **round 4's 54 was the anomalous
run** — it accidentally PASSED a test the checked-in baseline says fails. r5's 55
matches the normative baseline. The other 54 names are byte-identical to r4's
capture (`diff` after stripping the per-test timing suffix returns exactly this
one line and nothing else).

### Gate 3 — `bun scripts/browser-baseline.ts --check`

```
PASS — browser failure name set matches the baseline (48 asserted, 0 of 2 env-excluded observed).
```

This is the gate that adjudicates gate 1's +1 authoritatively, and it says the
browser tier matches its documented baseline exactly.

### types-gate — PRE-EXISTING drift, measured both sides

`bun scripts/types-gate.ts --check` → **4 NEW / 0 GROWN**, at the PRISTINE round-4
tip, BEFORE any r5 edit (measured by file-copying the untouched `type-system.ts`
back in). Three in `compiler/src/codegen/emit-each.ts`, one in
`compiler/src/route-inference.ts` — neither file is touched by this arc, and the
set is byte-identical before and after every r5 edit. Branch-base staleness, not
a regression. Flagged in GAP-DRAFTS.md so it is not misread at landing.

### origin/main moved — and it does not affect the corpus base

r4 measured its base against `d02adb68`; `origin/main` is now `f41589d2`.
`git diff --name-only d02adb68..origin/main` is **5 files, all markdown**
(2 `docs/`, 3 `handOffs/`); `git diff --stat d02adb68..origin/main -- compiler/
stdlib/ examples/ samples/ lsp/ scripts/` is **EMPTY**. So r4's `base.tsv` is
still a valid `origin/main` baseline byte-for-byte and is carried forward rather
than re-measured.

### Gate 2 — corpus differential, 1005 files. ZERO, and it is a MEASURED zero.

```
base       PASS=754 FAIL=251      (origin/main; r4's base.tsv carried forward — see above)
build-r5   PASS=754 FAIL=251
paths identical: YES
NEWLY-FAILING (PASS->FAIL): 0
NEWLY-PASSING (FAIL->PASS): 0
files with a changed diagnostic code set: 0
```

Stronger than the flip count: `build-r5.tsv` is **BYTE-IDENTICAL** to BOTH
`base.tsv` (origin/main) and `build-r4.tsv`. Expected — the r5 source diff is
comment-only — but asserted by `diff`, not by argument.

POSITIVE CONTROL on the measurement chain, because a zero is exactly what a
silently-dead harness also reports:

```
in  slot:  flipped=25  stayed=0  skipped=9
key slot:  flipped=20  stayed=0  skipped=14
```

Zero false-zero suspects in either slot.

### A CLEAN DIFFERENTIAL IS NECESSARY AND NOT SUFFICIENT

Stated here as a finding, not a formality — it is the entire reason this arc
reached round 5. Round 3 measured **0 newly-failing of 1005, positive-controlled**,
the measurement was **CORRECT**, and it still shipped a HIGH false positive,
because no corpus file happens to put a template literal inside an `<each in=>`
lambda.

The general form: **the inputs that would trip a newly-rejecting change are
precisely the ones nobody has written yet.** A differential measures BLAST RADIUS
over artifacts that already exist; it cannot measure the shape space a new
rejection closes. Compounding it here, the corpus is ~100% LLM-authored, so its
ergonomic diversity is far narrower than what a person writing scrml by hand
produces.

So the safety claim for a rejecting change is TWO-PART: (1) differential clean,
AND (2) an enumerated adversarial shape set, each shape a fixture, each asserted.
That is what §10/§11 are, and this round added the `key=`-slot lambda family that
was missing from both.

### Gate 4 — bite proof, BOTH directions, on the FINAL build

The three F-shapes (`compileScrml({write:false})`, E-codes across both streams):

| shape | result |
| --- | --- |
| `in=@rows.map(r => \`id-${r}\`)` | **`[]`** — 0 |
| `in=@undeclaredHidden.map(x => \`${1}\`)` | **`[E-STATE-UNDECLARED]`** — 1 |
| `in=@totallyUndeclaredName` | **`[E-STATE-UNDECLARED]`** — 1 |

Every NEW pinning fixture, compiled standalone before it was written as a test:

| fixture | E-codes |
| --- | --- |
| `key-lambda-expression-body` | `[]` |
| `key-lambda-block-body` | `[]` |
| `key-template-literal-inside-lambda` (the F1 shape in `key=`) | `[]` |
| `key-lambda-array-destructure-param` | `[]` |
| `key-lambda-object-destructure-param` | `[]` |
| `key-lambda-body-reads-a-declared-cell` | `[]` |
| `key-long-method-chain-with-template-literal-limb` | `[]` |
| CONTROL `key-lambda-expression-body` | `[E-STATE-UNDECLARED]` |
| CONTROL `key-template-literal-inside-lambda` | `[E-STATE-UNDECLARED]` |
| CONTROL `key-lambda-array-destructure-param` | `[E-STATE-UNDECLARED]` |
| CONTROL `key-lambda-body-reads-an-undeclared-cell` | `[]` — **the §12 hole**, pinned not hidden |

### WHOLE-FILE BITE PROOF — the strongest liveness evidence in this round

The finished test file was run against the BASE `type-system.ts` (file copy, r4's
fix removed):

```
BASE  : 56 pass · 6 todo · 35 FAIL
BUILD : 91 pass · 6 todo ·  0 fail
```

Every assertion that depends on the fix goes red when the fix is removed. Named
specifically, because these are the cases added THIS round:

- all three new §11 controls (`key-lambda-expression-body`,
  `key-template-literal-inside-lambda`, `key-lambda-array-destructure-param`) FAIL
  on base → LIVE, not vacuous;
- both new §12 CONTRAST cases FAIL on base → the boundary is executable;
- the new §13 `key=u.email` case FAILS on base → confirms E-TYPE-004 is genuinely
  NEWLY reachable at the `key=` site, matching the standalone flip.

Correctly NOT red on base: the seven new §10 shapes (they assert no-false-fire,
and base has no check at all to false-fire) and the §13 `key=@x` divergence record
(it records a PRE-EXISTING false negative, so base agrees).

## Verdict, stated plainly as the brief asked

**The arc covers less than its comment block claimed, and now it says so.** Round
4's fix is correct, precise, and worth landing — the corpus differential is a
measured zero, the adversarial set is real, and the whole-file bite proof is
unambiguous. What was wrong was the CLAIM around it, in three places, and one of
the two holes (`GAP-S385-LAMBDA-BODY-READS-UNCHECKED`) is HIGH severity and sits
on `.filter(…)` — the single most common opener shape an adopter writes.

I am comfortable landing this. The fix is a strict improvement, the narrowed
claims are accurate, and the gap that would have gone unrecorded is now drafted
with a reproducer, a located cause, and a fix sketch. What I would NOT be
comfortable with is landing it under the old comment, which told a future reader
that `in=@typo` was closed.

---

## Gate 1, the named form — clean

`bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail`:

```
23063 pass · 70 skip · 7 todo · 0 fail · 117548 expect() · 23140 tests / 1277 files   [249.6s]  exit 0
```

No `--no-verify` was used on any commit in this round. Every code commit ran the
full pre-commit hook to completion.

## Path discipline — verified, not assumed

- Every write used a worktree-absolute path. Never `cd` into the shared checkout.
- Never `git stash`: all four base-vs-build flips were FILE COPY
  (`type-system.BASE.ts` / `.BUILD.ts` / `.FINAL.ts` held in this agent's own
  scratch dir), and the working tree was verified restored by
  `git diff --numstat` after each flip.
- Scratch paths carry this agent's own id — sibling worktree agents share the
  scratchpad root, so a reused path would race another dispatch.
- Post-hoc leak check on the SHARED checkout:
  `/home/bryan-maclee/scrmlMaster/scrml/compiler/src/type-system.ts` mtime is
  `08:48:33`, ~7 hours BEFORE this session's first artifact (`15:53`), and
  `compiler/tests/unit/each-opener-expr-undeclared-read.test.js` does not exist
  there at all. Nothing leaked.

## Landing surface

`git diff --name-only origin/main...HEAD` excluding `docs/changes/` is EXACTLY:

```
compiler/src/type-system.ts
compiler/tests/unit/each-opener-expr-undeclared-read.test.js
```

Confirming the brief's note: commit `4d60e71b` is already an ancestor of
`origin/main` and is not a stray on this branch. No split needed.
