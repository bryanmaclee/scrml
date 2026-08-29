# progress — `ruling3-stable-half-2026-08-28`

**Worktree:** `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a8f40f49cb6f8fb3f`
**Branch:** `worktree-agent-a8f40f49cb6f8fb3f` · **Base:** `origin/main` @ `a042f3fd`
**Source carved from:** `worktree-agent-a84d38ac3c1c30a4b` @ `79894418` (READ-ONLY, untouched)

---

## Phase 0 — startup verification (COMPLETE)

| step | result |
|---|---|
| `pwd` | `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a8f40f49cb6f8fb3f` ✔ |
| `git rev-parse --show-toplevel` | == `pwd` ✔ |
| `git merge-base HEAD origin/main` | `a042f3fd08f1…` == `git rev-parse origin/main` ✔ |
| brief fetched from `brief/s383` | ✔ |
| source branch fetched from the shared checkout | `git rev-parse FETCH_HEAD` = `79894418dd17ad4d80cd30730de82ffefbf8b9e1` ✔ |
| `git status --short` | clean (only the staged brief) ✔ |
| `bun install` | 218 packages ✔ |
| `bun run pretest` (plain CWD, NOT `--cwd`) | ✔ — **artifact checked, not exit code**: `samples/compilation-tests/dist/` holds **34** files |

### Topology — the branch base is NOT `origin/main`

`git merge-base a042f3fd 79894418` = **`48f0aaf8`**. `git diff --name-only 48f0aaf8 a042f3fd` over
`compiler/src compiler/tests/unit compiler/tests/conformance scripts` lists 13 files and **none of
them is `ast-builder.js`, `symbol-table.ts`, `lint-e-state-block-statement-form.js`,
`unit-cc-write-at-body-top.test.js` or `c22-bare-variant-codegen.test.js`** — so every file this
carve touches is at the same content on `48f0aaf8` and on `a042f3fd`, and a `git checkout 79894418 --
<file>` is safe for those. Verified per file with `git diff 79894418 -- <file> | wc -l` == 0.

---

## BASELINE — measured here, twice, and it MOVED

Per the brief: never trust a remembered count.

| run | pass | skip | todo | fail |
|---|---|---|---|---|
| `bun run test` #1 on the unmodified tree | 30651 | 216 | 2 | **57** |
| `bun run test` #2 on the same unmodified tree | 30652 | 216 | 2 | **55** |

**The count moved by 2 between two runs of a tree I had not touched.** The set of 55 named failures
from run #2 is the comparison baseline (`baseline-fails.txt`); the final comparison is SET-based.

---

## THE CORPUS DIFFERENTIAL — VERBATIM

### The instrument, and why the repo tool did not fit

`scripts/corpus-emit-differential.ts` hashes **emitted artifacts** and syntax-checks them. The
brief's gate is a **per-file DIAGNOSTIC MULTISET** differential, which that tool does not compute.
So I rolled my own, and say so:

```
bun <scratch>/diag-capture.ts --root <WORKTREE_ROOT> --out <manifest>.json --expect-total 2365
bun <scratch>/diag-diff.ts    --base diag-main.json --head diag-carved.json
```

`diag-capture` enumerates with `git ls-files '*.scrml'` (the definition of "tracked"), asserts the
total against `--expect-total`, records `{code, severity, line, col, message}` per diagnostic across
**both** streams (`result.errors` + `result.warnings`, the S92/S93 partition), records a compile
THROW as data (`__THREW__`) rather than swallowing it, and sorts each file's list so the comparison
is order-insensitive. `diag-diff` refuses to compare (exit 2) on any enumeration disagreement.

**Population: 2,365 tracked `.scrml`. Non-vacuous: 2,180 files carry ≥1 diagnostic, 17,302
diagnostics, 401 distinct codes.**

### Three self-checks before trusting it

1. **DETERMINISM.** Captured `origin/main` TWICE and self-diffed: `files with any delta: 0`. Two
   independent captures of the same tree are byte-identical.
2. **THE GATE BITES ON `col`.** Mutated `colStart + 1` → `colStart + 1 + 100` in BOTH scanners,
   re-captured, diffed: **14 col deltas reported**, `W-STATE-BLOCK-BARE-WRITE-DECL: base-only 14,
   head-only 14`. Mutation reverted, `git diff --stat` empty.
3. **NON-VACUOUS.** See the population figures above.

### THE RESULT — main (`a042f3fd`) vs the carve

```
──────── SUMMARY ────────
files compared          : 2365
files with any delta    : 0
base-only diagnostics   : 0
head-only diagnostics   : 0
per-code delta          :
EMPTY DIFFERENTIAL — the two manifests are identical.
```

**Fully empty. Not "empty apart from the expected `col` moves" — empty including them.**

### ⚑ WHY, MEASURED RATHER THAN SHRUGGED AT — and this corrects the brief

The brief states the F5 fix "legitimately CHANGES diagnostic column values on
`W-STATE-BLOCK-BARE-WRITE-DECL` and `W-CONST-AT-DEPRECATED`" and tells me to expect those deltas.
**On the tracked corpus it changes nothing**, and here is the measurement:

- `W-CONST-AT-DEPRECATED` fires **2×** on the corpus, and **neither fire comes from
  `scanMarkupBodyConstAtDecls`.** Both come from the second emitter, `type-system.ts` (the
  AST-node-gated path). Proven by mutating each branch independently: the `+100` mutation on
  `colStart + 1` did not move them, and a `+1000` mutation on `baseCol + colStart` did not move them
  either. **The scanner this fix touches fires ZERO times on the tracked corpus.**
- `W-STATE-BLOCK-BARE-WRITE-DECL` fires **17×**, all in
  `compiler/tests/parser-conformance/live-phantom-fixture.scrml`. The `+1000` probe on the
  `li === 0` branch moved exactly **3** of them (cols `5, 9, 9` → `1005, 1009, 1009`), so 3 are at
  `li === 0` and 14 at `li !== 0`. The F5 fix leaves `li !== 0` alone by construction, and for the 3
  at `li === 0` the child's `baseCol` is `1`, so `baseCol + colStart == colStart + 1` and the fix is
  a **no-op**.

So the fix is real, is pinned (see the mutation proof), and is simply **inert on the tracked corpus**
— no source has a MID-LINE text child carrying one of these declarations. The empty differential is
the correct result, and the `col`-bite check above is what makes that a measurement rather than a
hope.

### The compile floor

```
corpus-compile-floor — 37 showcase program(s): 32 single-file + 5 multi-file
  known-broken (baselined): examples/09-error-handling.scrml  [E-ERROR-009] …
  PASS — every showcase program compiles clean on HEAD, or is a tracked baselined failure (1).
EXIT=0
```

---

## WHAT LANDED

### 1. `default-logic-exemption.ts` — the extraction (`6e66d232`)

⚑ **THE SHARED-CONSUMER PREMISE — VERIFIED BY GREP, HELD EXACTLY.** On `79894418`,
`git grep -n "default-logic-exemption\|isDefaultLogicBodyTopExempt"` returns importers at
**`compiler/src/symbol-table.ts:216`** and **`compiler/src/ast-builder.js:60`** — two, as the brief
said. On `a042f3fd` the same grep returns **nothing**: the module does not exist on main and the
loader is inlined in `symbol-table.ts` (`:201-223`).

- `symbol-table.ts` is the ORIGINAL home and consumes it for `E-WRITE-NOT-IN-LOGIC-CONTEXT`,
  independent of any ruling → the extraction stands on its own. **LANDED.**
- `ast-builder.js`'s import exists only for the held arm; its own banner at `:53` says
  *"CONSUMED HERE BY THE §40.8 ARM OF `E-CONTROL-FLOW-IN-MARKUP` ONLY"*. **WENT OUT WITH THE ARM.**

One correction the carve made necessary: the module header on `79894418` says the extraction had ONE
held TAB-stage consumer. After this carve there are **TWO** (ruling 2's `E-CALL-NOT-IN-LOGIC-CONTEXT`
and ruling 3's §40.8 arm), so the header says two and points at the new problem statement. The
justification is unchanged and does not depend on the count: **TAB runs before SYM, so
`ast-builder.js` must never import from `symbol-table.ts`.**

Ported with it: the two exemption-machinery tests (`unit-cc-write-at-body-top.test.js`) — the only
coverage either surface had.

### 2. The F5 `col` fix, BOTH sites, + the DO-NOT-SHARE banners (`f0469fa4`)

⚑ **PREMISE VERIFIED.** `grep -n "col: colStart + 1" compiler/src/ast-builder.js` on `origin/main`
returns exactly **`:1944`** and **`:2005`** — the two sibling scanners, as the brief said. The twin
fix is already on main at `lint-e-state-block-statement-form.js:437`; not re-landed.

Non-comment delta of the whole `ast-builder.js` change, verbatim from
`git diff --cached | grep -v '^[+-]\s*//'`:

```
+    const baseCol = child.span && typeof child.span.col === "number" ? child.span.col : 1;
+        const col = li === 0 ? baseCol + colStart : colStart + 1;
-          col: colStart + 1,
+          col,
+    const baseCol = child.span && typeof child.span.col === "number" ? child.span.col : 1;
+        const col = li === 0 ? baseCol + colStart : colStart + 1;
-          col: colStart + 1,
+          col,
```

**Nothing else.** Grep confirms zero remnants of the held machinery in `ast-builder.js`:
`BARE_CONTROL_FLOW_AT_BODY_TOP_RE`, `findControlFlowStatementEnd`, `_DEFAULT_LOGIC_ROOT_NAMES`,
`isStateBlockBody`, `isDefaultLogicBodyTopExempt`, `reachedViaBodyTopArm`, `onlyViaDefaultLogicArm`
— **none present**.

Comment-only banners landed at three sites (`lint-e-state-block-statement-form.js` per brief item 3,
plus the two `ast-builder.js` scanner twins and the import-site note the surviving tripwire points
at). The tripwire at `state-block-bare-write-comment-state.test.js` asserting `ast-builder.js` does
NOT import `maskCommentRegions` **survives and passes.**

### 3. The conformance carve (`61d10d9a`)

See "conformance dispositions" below.

### 4. The multi-line / Allman markup pins (`ca440ace`)

Ported into `compiler/tests/unit/control-flow-in-markup-reject.test.js` — see "a hole this arc
found in MAIN" below.

### 5. The problem statement

`docs/changes/ruling3-grammar-derived/PROBLEM-STATEMENT.md`, per the brief's SPECIFICATION-not-a-gate
directive. Carries the 52-fixture cross-axis matrix, the two-recognizer DO-NOT-MERGE note with the
history in both directions, the four-guard safety property of `findControlFlowStatementEnd`, and the
measured shape table below. **No `.skip`'d tests. No dead code behind a flag.**

---

## CONFORMANCE DISPOSITIONS — decided by RUNNING, not by the `-pos`/`-neg` suffix

With all six of `79894418`'s new cases present, the carved compiler failed **exactly two**.

| case | expected.json requires | result vs carved compiler | disposition |
|---|---|---|---|
| `ctrl-012-bare-control-flow-default-logic-root-pos` | `E-CONTROL-FLOW-IN-MARKUP` ×1 | **FAIL** | **OUT** |
| `ctrl-012-bare-control-flow-deprecated-state-opener-pos` | `E-CONTROL-FLOW-IN-MARKUP` ×1 | **FAIL** | **OUT** |
| `ctrl-012-bare-control-flow-default-logic-root-neg` | zero codes | PASS | **KEPT**, rationale corrected |
| `ctrl-012-default-logic-prose-neg` | zero codes | PASS | **KEPT**, rationale corrected |
| `ctrl-012-default-logic-multiline-prose-neg` | zero codes | PASS | **KEPT**, rationale corrected |
| `ctrl-012-default-logic-non-leading-residual-neg` | zero codes | PASS | **KEPT**, re-aimed |

⚑ **THE BRIEF NAMED A CASE THAT DOES NOT EXIST — see "what the brief got wrong", item 1.**

⚑ **WHY THE FOUR SURVIVORS NEEDED THEIR RATIONALES CORRECTED, AND WHY THAT IS CARVE NOT BUILD.**
As written on `79894418` all four assert — normatively, in the conformance corpus — that ruling 3's
arms EXIST and describe their own scope, and three of them cite the deleted `-pos` sibling. The
carve makes those sentences FALSE. Leaving them is the dormant-gate shape bryan's ruling excluded:
prose that reads as coverage of shipped behaviour, that cannot fail, and that the next session has
to re-derive. Each now states current behaviour and points at
`docs/changes/ruling3-grammar-derived/PROBLEM-STATEMENT.md`.

`ctrl-012-default-logic-non-leading-residual-neg` is **re-aimed rather than dropped**: its
"non-leading" framing was a property of the held arm's bound, and post-carve NO position at that
locus is diagnosed. It now pins the OPEN DEFECT whole — which is precisely what keeps SPEC §34's
"Does NOT fire" row honest, and it is the case a future ruling flips.

Conformance suite: **888 pass / 0 fail** (884 on `origin/main`; net **+4** cases).

---

## COVERAGE REMOVAL — COUNTED

Measured by running `79894418`'s `control-flow-at-default-logic-body-top.test.js` (994 lines)
verbatim against the carved compiler:

```
31 pass · 40 fail · Ran 71 tests
```

| what stops being checked | count |
|---|---|
| unit tests asserting the held arms (the 40 failures) | **40** |
| conformance cases asserting the held arms | **2** |
| **TOTAL checks removed** | **42** |

The other **31** checks in that file pass against the carved compiler. **They are not simply
dropped** — they were audited against what already exists on main:

- **Prose / counter-gate coverage** (Cases 4, 4b, 4c, the round-3 and round-4 §40.8 CONTRAST cases):
  already covered by `ctrl-012-default-logic-prose-neg` +
  `ctrl-012-default-logic-multiline-prose-neg` (kept) and by the pre-existing
  `control-flow-in-markup-reject.test.js` *"prose / identifiers that merely START with a keyword do
  not over-fire"*. **No loss.**
- **The wrapped `${ ... }` form** (Case 3): covered by
  `ctrl-012-bare-control-flow-default-logic-root-neg` (kept) and by two pre-existing unit tests.
  **No loss.**
- **The S203 markup-locus multi-line and Allman shapes**: **NOT covered anywhere on main** — see the
  next section. **PORTED, not dropped.**

The 994-line file itself is NOT landed. Its title, header and roughly 60% of its narrative describe
machinery that is not in the compiler; landing it minus 40 tests would produce exactly the artifact
bryan's ruling excluded. Its durable content is in `PROBLEM-STATEMENT.md`.

---

## ⚑ A HOLE THIS ARC FOUND IN **MAIN**, and it is not in the held arms

`compiler/tests/unit/control-flow-in-markup-reject.test.js` on `origin/main` has 11 tests and
**every fixture puts the whole construct on ONE LINE.** `BARE_CONTROL_FLOW_IN_MARKUP_RE`'s head is
UNBOUNDED and crosses newlines — correct at this locus — and **nothing pinned that.**

The S379 round-3 narrowing (`\([^]*?\)` → `\([^\n]*?\)`) silently re-opened this gate: multi-line and
Allman control flow compiled clean and shipped `if (`, and an inner `${@secret}`, into `<body>`. It
reached a fourth review round undetected.

**MUTATION-PROVEN AT S383, BOTH DIRECTIONS:**

| mutation | result |
|---|---|
| apply the round-3 single-line narrowing to `BARE_CONTROL_FLOW_IN_MARKUP_RE` | **5 of the 7 new tests RED** (the two one-line cases are declared CONTROLS and stay green) |
| the same mutation, against main's pre-existing 11 tests | **all 11 GREEN** — the measurement that makes the hole real rather than asserted |

Restored; `git diff --stat` empty; 18 pass / 0 fail.

---

## MUTATION PROOF — every surviving pin CAN fail

| # | mutation | tests turned RED | notes |
|---|---|---|---|
| M1 | F5 reverted: `const col = colStart + 1` at BOTH scanners | **2** | one per scanner — `F5 — a MID-LINE text child…` and `F5 (mirror) — …`. The *"a write on a LATER line of the child is unaffected"* test stays GREEN, exactly as its own comment declares (it is a CONTROL, not a pin). |
| M2 | `isDefaultLogicBodyTopExempt` fails OPEN (`return true`) | **3** | including **Case 1** and **Case 5** of the LIVE `E-WRITE-NOT-IN-LOGIC-CONTEXT` path — so the extracted module is load-bearing for a SHIPPING diagnostic, not only for the ported unit test. |
| M3 | `unit-cc-exemption-list.json` → `[1, "x.scrml"]` | **1** | the well-formedness pin. The loader's `catch { return [] }` swallows a parse error and one non-string entry empties the WHOLE list — fail-closed, but SILENT, and it un-exempts every file an operator listed. |
| M4 | round-3 single-line narrowing of `BARE_CONTROL_FLOW_IN_MARKUP_RE` | **5** | the ported markup pins; see above. |
| M5 | `colStart + 1` → `+ 100` (both scanners), corpus-wide | **14 diagnostics** flagged by the differential | proves the acceptance GATE itself can fail. |

All five reverted; `git diff --stat` empty after each; suites re-run GREEN.

⚑ **`grep -c "MUTATION-" compiler/src/*.js compiler/src/*.ts` == 0** at the final SHA.

---

## ⚑ WHAT THE BRIEF GOT WRONG

**1. It names a conformance case that does not exist.** The brief lists
`ctrl-012-default-logic-root-neg` as one of "the three `-pos` conformance cases, which assert the
arms fire". There is no case with that id. The nearest is
`ctrl-012-bare-control-flow-default-logic-root-neg`, and — following the brief's own instruction to
read the `expected.json` rather than the suffix — it requires **zero** diagnostics, **passes against
the carved compiler**, and does NOT go out with the arms. Acted on the measurement: 2 cases out, not
3. And the brief undercounted the population — `79894418` adds **six** new `ctrl-012-*` cases, not
three.

**2. The expected `col` deltas do not occur.** The brief says the F5 fix "legitimately CHANGES
diagnostic column values" on the two codes and warns me not to "fix" those deltas away. On the
tracked corpus there are none, for the reasons measured above (the markup scanner fires 0× corpus-
wide; the `<db>` scanner's 3 `li === 0` fires all sit at `baseCol == 1`). The brief's *instruction*
was right — do not chase them — but its *prediction* was wrong, and an agent that assumed a
non-empty differential was expected could have gone looking for a fault that is not there.

**3. It does not mention the third behavioural change on `79894418`, and that change is NOT
landed** — see the deferred item below. Reading only the brief's WHAT LANDS / WHAT IS HELD lists,
one would not know it existed.

**4. Not wrong, but worth stating: `scripts/corpus-emit-differential.ts` does not fit.** It is an
ARTIFACT-hash + syntax-check harness; the brief's gate is a per-file DIAGNOSTIC MULTISET. Rolled my
own, disclosed above with the commands.

---

## DEFERRED / SURFACED TO PA

### ⚑ D1 — a THIRD behavioural change on `79894418` that the brief does not name, deliberately NOT landed

`79894418` also **name-guards the `scanStateBlockBareWriteDecls` call site**:

```js
const childIsStateBlockBody = _STATE_BLOCK_BARE_WRITE_NAMES.has(block.name);
if (childIsStateBlockBody) { scanStateBlockBareWriteDecls(block.children || [], errors, filePath); }
```

On main the call is UNGUARDED, so every whitespace-form `< Name …>` body is told it is a
`<db>`/`<state>` body. Its author traced the effect: it removes **7** `W-STATE-BLOCK-BARE-WRITE-DECL`
warnings from `compiler/tests/parser-conformance/live-phantom-fixture.scrml`, where the enclosing
node is a whitespace-form **`< p>` misparse** — the lint telling an author that bare writes inside a
`<p>` are *"directly in a `<db>`/`<state>` STATE-block body"*, false on the diagnostic's own terms.
The other 10 warnings in that file's real `< db>` body are retained.

**By the brief's own "true regardless of the ruling" criterion it qualifies. I did not land it, for
two reasons that agree:** it is absent from WHAT LANDS, and it would violate the acceptance gate
("the ONLY permitted differences are `col` values… any diagnostic disappearing means the carve took
something it should not have"). Also, **newly-SILENCING 7 warnings deserves its own review, not a
ride-along in a carve.** PA call: land it as its own change with its own differential, or leave it.

### D2 — SPEC text the carve leaves factually wrong (I did not touch SPEC, per MUST NOT TOUCH)

- **`compiler/SPEC.md:19817`**, the §34 `E-CONTROL-FLOW-IN-MARKUP` row: *"**Does NOT fire:** … a
  `<program>`/`<page>`/`<channel>` direct-child default-logic root (the §40.8 auto-lift handles
  it)"*. The **"does not fire" half now matches the compiler again**, so the row is not urgent — but
  **the parenthetical reason is FALSE**: §40.8's own S123 amendment says the auto-lift covers
  DECLARATIONS ONLY, so the locus is covered by neither, and the construct ships as page text at
  exit 0. Pinned as an open defect by `ctrl-012-default-logic-non-leading-residual-neg`.
- **`compiler/SPEC.md:11765`** (§17.4 prose) carries the same conflation: *"the §40.8 default-logic
  auto-lift fires only at `<program>`/`<page>`/`<channel>` direct-child roots, never inside nested
  markup — so without this diagnostic it would ship as raw `for(){}` text"*. **Where the lift FIRES
  and what the lift COVERS are different questions.**
- The §34 row's coverage claim is also **wider than the recognizer**: it says a bare
  `for`/`if`/`while` in a markup body is refused, and the measurement in §1 of
  `PROBLEM-STATEMENT.md` shows a **braceless** `if`, a `switch`, a labelled `for` and a `do`/`while`
  all ship into `<body>` at exit 0 **at the markup locus**.

I corrected the identical false claim in a TEST comment I was already editing
(`control-flow-in-markup-reject.test.js`) and flagged it here rather than editing SPEC.

### D3 — the exemption predicate's suffix-boundary rule is UNEXERCISABLE

`unit-cc-exemption-list.json` is `[]` and `default-logic-exemption.ts` loads it ONCE at module init,
so a test cannot inject entries without writing to compiler source mid-run. Exercising the
`/`-boundary rule needs an **injectable loader**. Named rather than silently `.skip`ped. (Carried
from `79894418`; unchanged by this carve.)

### D4 — four known false fires at the S203 markup locus on `main`

The `pr-mk` row of the cross-axis matrix: `main` fires on 4 markup-locus PROSE fixtures. Round 3
"fixed" them as a side effect of the narrowing that re-opened the real gate, so they are not
separably fixable that way. Pre-existing S203 issue, recorded in `PROBLEM-STATEMENT.md` §2.

### D5 — `E-SWITCH-FORBIDDEN` visibility depends on a neighbouring line

MEASURED at S383: `switch (1) { }` alone at a `<program>` body-top → zero diagnostics, ships as page
text. The same statement with `const k = 1` on the line above → `E-SWITCH-FORBIDDEN` fires and it
does not ship. The declaration lift claims the run and the switch is lexed as a passenger. **The
verdict is a function of the run's accidental composition.** Recorded in `PROBLEM-STATEMENT.md` §1;
not filed as a gap (PA owns `docs/known-gaps.md`).

---

## MAPS CONSULTED

- **`.claude/maps/primary.map.md`** — LOAD-BEARING. Invariant 64 and its Task-Shape Routing row name
  `liftBareDeclarations` (`ast-builder.js:1161`), its NINE `^`-anchored prefix gates, and the fact
  that anything matching no gate reaches `result.push(block)` and is emitted verbatim into `<body>`.
  That is the exact mechanism this carve restores and the problem statement documents. Also carries
  the standing warning that `E-CONTROL-FLOW-IN-MARKUP`'s §34 row claims coverage its emit site
  structurally cannot deliver — independently confirmed here (D2).
- **`.claude/maps/structure.map.md`** — LOAD-BEARING. Its `lint-e-state-block-statement-form.js` row
  states the `maskCommentRegions` carried-state rationale and the `baseCol + colStart` column
  arithmetic at `li === 0` — i.e. the twin of the F5 fix, already landed — which is what let me
  confirm the two `ast-builder.js` sites are the SIBLINGS catching up rather than new machinery.
- **`.claude/maps/error.map.md`** — consulted by targeted grep only. **Not load-bearing** for this
  dispatch: the dispositions were decided by running the suites, and every diagnostic claim here is
  from a compile I executed.
- **PA currency check re-verified independently:** none of `ast-builder.js`, `symbol-table.ts` or
  `lint-e-state-block-statement-form.js` moved between the map stamp and `a042f3fd`.

---

## TEST BASELINE — SET comparison (COMPLETE)

Comparison is `comm` over the sorted failure-name sets, never counts — the baseline count moved by 2
between two runs of the untouched tree, so a count comparison would have been meaningless.

| | pass | skip | todo | fail |
|---|---|---|---|---|
| baseline, `origin/main`, untouched tree | 30652 | 216 | 2 | 55 |
| final, `d24d8185` | **30677** | 216 | 2 | **55** |

```
comm -13 baseline-fails.txt final-fails.txt   → EMPTY   (0 NEW failures)
comm -23 baseline-fails.txt final-fails.txt   → EMPTY   (0 "fixed" — the sets are identical)
```

**The 55 failing tests are byte-identically the same 55.** Zero new, zero disappeared — so not even
the S209 gitignored-`dist` environment artifact this time.

`+25` tests, and the arithmetic closes exactly: **2** ported exemption tests + **12**
comment-state/F5 tests + **7** markup multi-line/Allman pins + **4** conformance cases = 25.

Pre-commit gate on the final code commit: **29329 pass / 0 fail across 1287 files.**
Conformance: **888 pass / 0 fail.** Compile floor: **PASS.**
`grep -rn "MUTATION-" compiler/src/*.js compiler/src/*.ts` → empty.

## COMMITS

```
d24d8185  the problem statement for the held arc, as SPECIFICATION + progress
ca440ace  pin the multi-line + Allman shapes at the S203 markup locus — a MEASURED hole
61d10d9a  four §40.8 conformance cases that hold WITHOUT the arms; two that need them are dropped
f0469fa4  the F5 `col` fix at BOTH sibling scanners, + the DO-NOT-SHARE banners
6e66d232  extract default-logic-exemption.ts as a leaf module
83267046  WIP(ruling3-stable): start at <pwd>
```

---

# FIX ROUND — the S239 adversarial pass (COMPLETE)

Six findings; F1-F5 mine, F6 PA-owned. **All five premises reproduced by execution
before fixing. All five held.** Nothing in this round was accepted on relay.

## F1 (HIGH) — the facts gate was RED on this branch · `c2858af2`, `58991029`

REPRODUCED: `bun scripts/facts.ts --check` exits **1**, "STALE @generated:facts-table",
and `.github/workflows/ci.yml:162` runs exactly that — read at source, confirmed.
Regenerated with `--write`; delta attributes cleanly to this dispatch:
`246,131/192 files -> 246,370/193`, `test files 1,405 -> 1,406`,
`conformance cases 883 -> 887`.

⚑ **I hit this TWICE, and the second time is the procedural lesson.** F4/F5 added
comment lines under `compiler/src/`, which invalidated the first regeneration. The
facts table is a function of the WHOLE TREE, so it must be regenerated **after the
last source edit** — even a comment-only one. Fixing F1 first was the wrong order.

## F2 (HIGH) — the case was ratifying an open defect as correct · `319a63eb`

**REPRODUCED IN FULL BY EXECUTION**, plus a control the review did not ask for:

| # | source | result |
|---|---|---|
| a | `<program>` + `function greet() { return 1 }` ALONE | greet IS lifted — in `case.client.js`, **absent from `<body>`**, `W-DEAD-FUNCTION` + `I-FN-PROMOTABLE` |
| b | the SAME declaration with **ONE prose line above** | greet **absent from the client JS entirely**, ships into `<body>` as literal page text, **ZERO diagnostics** |
| c | prose + `<x> = 0` + a `${@x}` read | the decl ships as page text and the **READ** fails `E-STATE-UNDECLARED` — the compiler blames a correct line about a declaration that IS in the source |
| d | **CONTROL (mine)** — (c) with the prose line deleted | compiles clean, decl not in `<body>` |

So one prose line silently disables the §40.8 auto-lift for the rest of the run.

**SPEC-CONTRADICTING, verified against the normative text rather than relayed:**
`compiler/SPEC.md:394` (§40.8, S123 amendment) names `function name() { … }` /
`fn name(…)` **and** the structural state-decl form `<name> = expr` as members of
the auto-lift set, with no positional qualifier. `SPEC.md:393` says the same in
plainer words.

The case's old description said the declaration "must survive into the emitted
page" — true, and false in the way that matters: what survives is inert source
text. Under §62.2 the corpus is the versioned contract, so that froze the defect
in. **Re-aimed, not split**: the two limbs (the recognizer counter-gate; the
auto-lift defect) are separable in prose, and removing the declaration to split
them would destroy limb 1's fixture, which needs exactly that declaration below
the prose. Gap id left uncited pending the PA-side filing.

## F3 (MEDIUM) — the output property was narrated, not pinned · `3a978a34`

PREMISE VERIFIED at source: `conformance/run.ts:15-22` documents and `:383-394`,
`:607-615` implement `dom` and `domAnchored`.

⚑ **MEASURED, and the gap was exactly the one named:**

| | mutation = a SILENT text-drop at the §40.8 locus (no diagnostic) |
|---|---|
| with `dom` (this commit) | **both cases RED** |
| with `dom` stripped | **both cases GREEN** — 887 pass / 1 fail, the single failure being the unrelated `e-type-026`, which catches it through a code |

⚑ **`dom`, not `domAnchored`, and the reason is measured.** The leaked declaration
and statement are **bare text nodes directly under `<body>`** with no wrapping
element, so no selector addresses them — `domAnchored` with `selector: "body"`
reports **"no match"**, because `runAnchored` receives the body element AS its
root. Whole-tree normalized `<body>` equality is the only instrument that sees
them. The pinned strings were read out of the runner (assert a deliberately-wrong
value, take the reported `got:`), not hand-derived.

For `multiline-prose-neg` the pinned string is *also the evidence for limb 2*: a
compiled function does not appear in `<body>` at all (measured in (a)), so the
presence of its source text in the pin records that it is inert. The assertion
fails in both directions that matter — a text-drop deletes it, a correct auto-lift
fix removes it. **The second is the intended FLIP.**

## F4 (LOW) — the stale reference · `ff0d7e93`

CONFIRMED: the dead symbol occurred **exactly once** in `symbol-table.ts` — the
prose mention itself — the binding having moved to `default-logic-exemption.ts`.
Now points at the module. The dead symbol is deliberately **not** repeated in the
correction note, so a repo-wide grep stays a reliable staleness check; verified
`grep -rn` over `compiler/src/` returns nothing.

## F5 (LOW) — the tripwire was holey, and my banner overstated the case · `ff0d7e93`

CONFIRMED HOLEY **by measurement**: with a namespace import +
`_lintns.maskCommentRegions(...)` planted in `ast-builder.js`, the old regex
`/^\s*import\s*\{[^}]*maskCommentRegions/m` evaluates **FALSE**.
CONFIRMED module-private: `function maskCommentRegions` at `:359`; the module's
only exports are `DIAGNOSTIC_CODE` and `runEStateBlockStatementForm`.

New primary tripwire: **the helper must not be EXPORTED** (plus a guard that the
function still exists, so it cannot go vacuously green against a rename). New
secondary, widened past the old blind spots: `ast-builder.js` must not REFERENCE
the identifier in code (comments stripped) — every way of using it must name it —
plus an assertion that the banners mentioning it still exist, so it cannot pass by
their deletion.

| mutation | primary | secondary | OLD regex |
|---|---|---|---|
| export the helper only, no import anywhere | **RED** | green | green (one step too late) |
| + namespace import & call in `ast-builder.js` | **RED** | **RED** | **FALSE — measured** |

⚑ **AND THE REVIEWER IS RIGHT THAT I OVERSTATED IT — verified by execution, not
conceded.** Re-applying the helper for real (export + import + call in
`scanStateBlockBareWriteDecls`) turns **FOUR** tests in that file RED: the M4
glob-in-a-string regression, the mixed-openers regression, the block-comment
residual, and the tripwire. **It does fail loudly, today.** Corrected in all three
places the claim appeared, to the narrower true statement: those behavioural tests
exist only because this was got wrong twice and measured afterwards, and they cover
only the shapes someone thought to write — the same helper over a scanner or domain
with no glob fixture regresses **silently**, because a lint that stops firing is
invisible unless a test already names that shape. That is the tripwire's actual
job.

## FIX-ROUND VERIFICATION

- `bun scripts/facts.ts --check` → **exit 0**
- `bun scripts/corpus-compile-floor.ts --check` → **PASS**
- Conformance → **888 pass / 0 fail**
- Corpus differential vs `origin/main`, re-run at the fix-round tip:
  ```
  base total: 2365   head total: 2369
  FILES ONLY ON BASE (0):
  FILES ONLY ON HEAD (4):    <the 4 kept ctrl-012 case.scrml>
  INTERSECTION COMPARED: 2365
  files with any delta  : 0
  EMPTY DIFFERENTIAL over the intersection.
  ```
  ⚑ The strict enumeration guard **fired first** (`expected 2365, got 2369`) and
  refused the comparison — correct behaviour, since 4 tracked sources were added.
  Re-run with an explicit set-delta report so an added file cannot hide a change to
  an existing one. **Still zero over every one of main's 2,365 files.**
- Full suite: **30678 pass / 216 skip / 2 todo / 55 fail** vs baseline
  30652 / 216 / 2 / 55. `comm` **both directions EMPTY** — the same 55, again.
  `+26` (the +25 already recorded, plus F5's second tripwire).
- `grep -rn "MUTATION-" compiler/src/` → empty.

## NOTHING IN THIS ROUND WAS FOUND WRONG

All five premises held on reproduction. The one correction is to my own prior work,
not to the review: the "DISAPPEAR rather than fail loudly" claim in F5 was mine, the
reviewer was right to flag it, and measurement confirmed the reviewer rather than me.
