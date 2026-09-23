# s422-e-assign-004 — E-ASSIGN-004 for EXPLICIT `const` reassignment at statement position

Append-only, timestamped.

---

## 2026-09-19T08:32:05-06:00 — startup verification + premise re-verification

Worktree: `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a3a79912044e8f7a6`
origin: `git@github.com:bryanmaclee/scrml.git` (scrml, NOT scrml-support) — check 1 PASS
`git rev-parse --show-toplevel` == `pwd` — PASS. `git status --short` clean — PASS.
`bun install` → 218 packages. `bun run pretest` → 13 test samples compiled;
`samples/compilation-tests/dist/` has 34 entries (artifact verified, not just exit code).

### Premise re-verified (quoted globs + control)

```
grep -rn 'E-ASSIGN' compiler/src/                 →  0
grep -rn 'E-SCOPE-001' compiler/src/              →  123   (control)
```

Repo-wide non-markdown `E-ASSIGN` references (excluding node_modules / worktrees):
- `lsp/handlers.js:188` — `code.startsWith("E-ASSIGN-")` prefix routing → `scrml/type-system`
- `compiler/tests/unit/gauntlet-s19/phase3-wrapup.test.js:11,12` — comments only
- three `samples/compilation-tests/gauntlet-s19-phase3-operators/*.scrml` — comments only

**Confirmed: building from scratch.** The LSP prefix filter already routes `E-ASSIGN-*`
to `scrml/type-system`, which independently confirms `compiler/src/type-system.ts` is the
intended fire site.

### Behaviour measured (my own execution, not relayed)

Four shapes compiled with `compiler/src/cli.js compile` / `api.compileScrml`:

| shape | source | diagnostics | emitted JS |
|---|---|---|---|
| A — top-level `${}` | `const x = 1` / `x = 2` | **none** (with `--no-validate-emit`) | `const x = 1;` / `const x = 2;` → **duplicate declaration, INVALID JS** |
| B — inside `function f()` | `const x = 1` / `x = 2` | **none** | `const x = 1;` / `x = 2;` → valid JS, **runtime `TypeError: Assignment to constant variable.`** |
| C — `let` control | `let x = 1` / `x = 2` | none | `let x = 1;` / `x = 2;` — correct, must stay |
| D — bare-assignment binding (OUT OF SCOPE) | `count = 1` / `count = count + 1` | none | `const count = 1;` / `const count = count + 1;` — duplicate decl |
| E — compound | `const x = 1` / `x += 2` | none | `const x = 1;` / `x += 2;` → runtime `TypeError` |

**Divergence from the brief's measurement, surfaced:** the brief says the shape emits
`const x = 1;` / `x = 2;`. That is true only for shape **B** (inside a function body).
At TOP-LEVEL `${}` (shape A) the second statement lowers to a second `const x = 2;` —
a duplicate declaration — which `--validate-emit` (default-on) catches as
`E-CODEGEN-INVALID-LOGIC` with the message *"This is a compiler defect (codegen produced
malformed output). Please report it."* — i.e. an adopter's `const` reassignment is today
reported as a COMPILER BUG. Both shapes are silent-failure defects; A is misdiagnosed,
B is a genuine silent runtime crash.

### AST shapes (dumped via `runBlockSplitter` + `runTAB`)

- `const x = 1` → `const-decl name="x"`
- `x = 2` at statement position → **`tilde-decl name="x"`** (ast-builder.js ~9900, the
  keywordless bare-assignment production) — same node kind top-level and in-function
- `x += 2` at statement position → **`bare-expr`** wrapping an `assign` ExprNode (op `+=`)
- `count = 1` (fresh bare assignment) → also `tilde-decl` — **this is the collision point
  with dpa-047 call 1, and the gate is drawn precisely here** (see next entry).

---

## 2026-09-19T11:45:00-06:00 — SCOPE WIDENED mid-dispatch; implementation landed (`fdeac1fd`)

bryan ruled dpa-047 call 1 while this dispatch was in flight. Verbatim:
*"confirmed. bare naming is const, mutation needs let. widen it."*

So a binding created WITHOUT `let` is a `const` binding whether the keyword is
written or not, and `let` is the only escape. All six reassignment shapes refuse.

### Where the check lives

`compiler/src/type-system.ts`. Chosen because `lsp/handlers.js:188` ALREADY routes
`E-ASSIGN-*` to `scrml/type-system` — the infrastructure was built expecting the
check to land there, it just never did.

One gate: `ScopeEntry.isConst`, set when a naming statement CREATES a binding
without `let`. Two fire sites:

- `case "tilde-decl"` — statement-position `x = expr`. The parser surfaces this
  ONE node kind for both "creates the binding" and "reassigns it"; which applies
  depends on whether the name is already bound.
- `case "bare-expr"` with an `assign` ROOT — compound assignment (`x += 1`), which
  is excluded from the tilde-decl production. Bounded to the ROOT node so a nested
  `f(x = 2)` (expression position, the other half of §50.8.5) does not fire.

### ⚑ The defect the pre-commit hook caught — and why the matrix could not see it

A first cut rebound the name with `isConst: true` on EVERY bare assignment,
including one that merely REASSIGNED an existing `let`. That converted the `let`
into a `const`, so:

```
let x = 1 ; x = 2                 clean
let x = 1 ; x = 2 ; x = 3         E-ASSIGN-004   ← FALSE POSITIVE
let ids   ; ids = 1 ; ids = 2     E-ASSIGN-004   ← FALSE POSITIVE
```

The discriminator was the SECOND reassignment, not the binding form. **`let` is
the only escape the ruling grants; an escape that expires after one use is not an
escape.** Caught by the hook on `stdlib/compiler/meta-checker.scrml:296`, which
declares one `let ids` and assigns it three times.

The nine-row acceptance matrix passed while this was live, because every row
assigned exactly once. Repeated reassignment is now pinned explicitly at both
statement positions, plus the literal meta-checker shape.

Fix: `bindOrRejectBareAssignment` — the ONLY path that binds is a genuinely new
name. An already-bound name is a reassignment either way: fire if immutable,
never rebind. (Not rebinding also matters for the const case — shadowing would
silence every reassignment after the first.) The `_bareAssign` SQL-init
const-decl routes through the same helper for the same reason.

### E-MU-001 — NOTHING CHANGED

An earlier revision suppressed E-MU-001 wherever E-ASSIGN-004 fired. **Removed.**
bryan ruled call 3 at S422 — *"lint first, hard error later if its the right
move."* — putting unused-binding on its own lint arc. A lint beside a hard error
is coherent, so there is nothing to arbitrate. E-MU-001's severity, population and
`_`-prefix hatch are untouched; the `TSError.varName` plumbing the filter needed
was reverted too. `x = 1; x = 2` co-fires both, and that is pinned.

### Compound assignment — included, on the SPEC's own words

SPEC §50.12 (`SPEC.md:28201`): *"`+=`, `-=`, `*=`, `/=`, `%=` are currently
statement-only in scrml."* So a compound assignment IS statement-form, and
§50.8.5's closing sentence puts statement-form inside this error. Excluding it
would leave an identical silent runtime `TypeError` unfixed.

---

## 2026-09-19T12:03:48-06:00 — verification, measurement, SPEC (`a344547d`)

### Acceptance matrix — both statement positions

Top-level `${}` and function bodies lower through DIFFERENT codegen paths, so
every row is measured at both. Command: `bun <scratch>/matrix-ve.js`, which drives
`compileScrml` with `validateEmit: true` (the compiler default).

| # | shape | BEFORE (at `5c021b0e`) | AFTER |
|---|---|---|---|
| 1 | `const x = 1` ; `x = 2` | top `E-CODEGEN-INVALID-LOGIC` / fn clean | **E-ASSIGN-004** both |
| 2 | `const x = 1` ; `x += 1` | clean both | **E-ASSIGN-004** both |
| 3 | `const x = 1` ; `x = x + 1` | top `E-CODEGEN-INVALID-LOGIC` / fn clean | **E-ASSIGN-004** both |
| 4 | `x = 1` ; `x = 2` | top `E-MU-001` / fn `E-CODEGEN-INVALID-LOGIC` | **E-ASSIGN-004** both |
| 5 | `x = 1` ; `x += 1` | clean both | **E-ASSIGN-004** both |
| 6 | `x = 1` ; `x = x + 1` | `E-CODEGEN-INVALID-LOGIC` both | **E-ASSIGN-004** both |
| 7 | `let x = 1` ; `x = 2` | fn clean | fn **clean** |
| 8 | `let x = 1` ; `x += 1` | clean both | **clean** both |
| 9 | `let x = 1` ; `x = x + 1` | fn clean | fn **clean** |

Plus repeated reassignment (`let x = 1; x = 2; x = 3; x = 4`) clean, and
`const`/bare repeated reassignment firing once PER reassignment.

### Row 6 — `E-CODEGEN-INVALID-LOGIC` is gone, verified

E-ASSIGN-004 fires at stage TS, which aborts before CG runs. The adopter no
longer sees *"This is a compiler defect ... Please report it."* for their own
source. Actual `scrml compile` output now:

```
error [E-ASSIGN-004]: `x` at line 3 is declared `const` and cannot be reassigned.
  Use `let` if the variable needs to be updated after initialization.
      1 | ${
      2 |     x = 1
 >    3 |     x = x + 1
  stage: TS
```

### MEASURED migration population — by COMPILING, not grepping

Command: `bun <scratch>/measure.js` — compiles EVERY `.scrml` under `examples/`,
`stdlib/`, `samples/`, `compiler/tests/fixtures/`, `benchmarks/`, `docs/` one at a
time through `compileScrml` and reads the diagnostic stream.

**1503 files scanned, 1502 compiled, 1 pre-existing crash**
(`samples/gauntlet-s19-phase4/nested-comments.scrml` — "Maximum call stack size
exceeded", identical BEFORE and AFTER, unrelated).

**E-ASSIGN-004 population: 1 file / 1 occurrence.**

```
  1  samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-assign-expr-to-const-081.scrml
```

That file's own first line is `// assigning to a const — E-ASSIGN-004`. It is the
NEGATIVE FIXTURE that exists to trigger this error. **Real-adopter migration
population is ZERO.**

Harness validated against the "measuring nothing" failure mode: the same run
produced **5308 diagnostics across 184 distinct codes**, 1290/1503 files with at
least one, including the binding-machinery neighbours `E-SCOPE-001` (151),
`E-MU-001` (4), `W-ASSIGN-001` (2). The probe was live.

⚑ `stdlib/compiler/meta-checker.scrml` — the file that caught the false positive —
is **NOT** a migration hit. It is `let ids` legally reassigned. stdlib is out of
the migration population entirely.

### R26 delta — per file, both sides against the same db state

BEFORE = `compiler/src/type-system.ts` at `035f19e0` (zero E-ASSIGN), AFTER = the
committed build. Both runs started from a clean tree (`git status --short` empty);
`write: false`, so no tracked `.db` was mutated by either side and the
`examples/23-trucking-dispatch/dispatch.db` drift caveat does not apply.

```
=== PER-FILE DIAGNOSTIC DELTA: 1 file(s) changed of 1503 ===
  samples/compilation-tests/gauntlet-s19-phase3-operators/phase3-assign-expr-to-const-081.scrml
      E-ASSIGN-004: 0 -> 1

=== AGGREGATE DELTA BY CODE ===
  +1  E-ASSIGN-004
```

Zero collateral across every `examples/` app.

### SPEC — four sites + one

`§50.8.5` Trigger read *"...left-hand side of an assignment **expression**"* while
its own closing sentence four lines below extended to statement form. The narrower
of the two is what got implemented — which is to say, nothing did.

| site | line | change |
|---|---|---|
| §50.8.5 **Trigger** | 28024 | "...of an assignment, in either statement or expression position" + what makes a binding `const` + compound-assign + the property-mutation carve-out + worked examples for all six + the `let` escape |
| §34 catalog | 20060 | "`const` variable as assignment **target, statement or expression position**" |
| §50.9 normative | 28101 | rewritten + 3 new SHALLs (bare naming is const; compound assign; property mutation is NOT) |
| §50.11 code ref | 28245 | same phrasing fix |
| §50.3.5 | 27869 | + "A binding is `const` when it was created without `let`..." |

`E-ASSIGN-003`'s rows are expression-phrased and correct — untouched.

### Tests

`compiler/tests/unit/e-assign-004-const-reassign.test.js` — 41 tests: six reject
rows x two positions, three accept rows x two positions x single-and-repeated, the
meta-checker three-assignment shape, uninitialised `let`, loop mutation, and eight
non-fire boundaries (property mutation through a const, function parameters,
reactive cells, inner-let shadowing, sibling scopes, loop accumulators, expression
position, destructured const).

`compiler/tests/unit/gauntlet-s19/phase3-wrapup.test.js` — header updated: the
"tilde-decl semantic question (needs spec ruling)" it recorded got its ruling.
B1 (E-ASSIGN-003) remains deferred.
