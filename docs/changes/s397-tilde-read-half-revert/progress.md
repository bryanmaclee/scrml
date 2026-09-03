# S397 — `~` arm-body arc: revert the read half, keep the ruled write half

Append-only. Newest entries at the bottom.

---

## 2026-09-03 — 00 · startup gate PASSED

- `pwd` = `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a6d29adb38983d96c` — starts with the required prefix.
- `git rev-parse --show-toplevel` equals it.
- `git status --short` clean at start.
- `git merge-base HEAD origin/main` = `a18c13c7bb60481c57ba64ed20e391de60162ae5` = `git rev-parse origin/main`. Base is CURRENT.
- `bun install` — 218 packages installed.
- `bun run pretest` run PLAINLY from the worktree CWD (not `--cwd`). Artifact VERIFIED to exist:
  `samples/compilation-tests/dist/` holds 34 entries incl. `match-002-block-form-arm-swap.client.js`.
  Exit code deliberately NOT treated as proof.
- BRIEF fetched: `git fetch origin fix/s397-tilde-read-half-revert` +
  `git checkout FETCH_HEAD -- docs/changes/s397-tilde-read-half-revert/`. Read IN FULL.
- `.claude/maps/primary.map.md` read (Task-Shape Routing). Row 1 is exactly this surface:
  locus `compiler/src/codegen/emit-logic.ts`; entry `let-decl` (`:1906-1907`) / `const-decl`
  (`:2051-2052`) -> `node.ifExpr` -> `emitIfExprDecl` (`:4525`); §17.6.2 sugar
  `_emitValueFormSugarArm` (`:4438`). Row 43 routes the corpus differential
  (`bun scripts/corpus-emit-differential.ts`, base-vs-head by hand, `diff` exit 2 == INVALID).

NEXT: pull the seven brief-listed paths from the held branch, base-drift filter applied.

---

## 2026-09-03 — 01 · take-set landed, read half REVERTED, hypothesis HELD

### Base-drift filter — INDEPENDENTLY RE-VERIFIED, brief was right
- `git diff --name-only 8f3c5b74 c2ad6f49` = **12 files**. `conformance/normalize.ts` is
  **NOT** among them. The `+26` against `origin/main` is pure base drift, exactly as the brief said.
  Confirmed material: `normalize.ts` at HEAD carries fix #822 (`assertsFirstMatch`), and taking the
  branch copy would have re-introduced the bug where `{count:1, text:"…"}` silently never evaluated
  the text — which is the very mechanism my re-scoped ctrl-027 depends on.
- `git log 8f3c5b74..origin/main -- <the whole take-set>` = **EMPTY**. Wholesale checkout safe.
- ⚠ BRIEF ERRATUM: the unit-test path is `compiler/tests/unit/g-bare-expr-in-if-arm-rebinds-tilde-context.test.js`
  — the brief omits the leading `g-`. `git checkout` failed on the brief's spelling.

### The measured defect (branch tip, `repro-while`) — the hand-off's "deletes a DOM lift" is FALSE
Confirmed the PA's correction: the loop's `_scrml_lift(() => …createElement("li")…)` is present
and intact at base AND after. No lift is deleted anywhere. The real defect is a BLOCK-SCOPE ESCAPE:

    let _scrml_tilde_4 = [];                    // DEAD — nothing ever reads it
    while (i < 3) {
      let _scrml_tilde_5 = _scrml_note_2(i);    // minted INSIDE the block
      i = i + 1;
    }
    let _scrml_tilde_6 = null;
    if (…) { _scrml_note_2(_scrml_tilde_5); … } // ← READ FROM OUTSIDE ITS BLOCK

### PA revert-locus hypothesis: **HELD**. Not refined, not wrong.
Removing ONLY the `nodeContainsTildeRef` descent into `ifExpr`/`forExpr`/`matchExpr` closed BOTH
symptoms (the escape AND the dead allocation) in one edit, and left the write half fixed.

TRACED, not just located. The mechanism is that the predicate is not merely an answer — both
consumers use it to decide whether to ALLOCATE a `tildeContext` over the whole enclosing statement
sequence: `emitFnShortcutBody` (`emit-logic.ts:4267`) and `emitLogicBody` (`:5407`). Flipping it
true for a node whose only `~` sits inside a bound arm therefore switches every SIBLING statement
in that sequence into §32.2 accumulator mode — `_emitWhileStmtWithTilde` mints the dead array, the
loop-body bare call mints-and-rebinds inside the block, and `emitIfExprDecl` then reads
`opts.tildeContext.var` (now a loop-local name) as the arm's `~` slot.

### Executed proof (`new Function`, strict, runtime stubbed)
    expected per the write-half ruling: label === "pos"
    BASE     -> RETURNED null                                        (silent-wrong: the write-half defect)
    BRANCH   -> THREW ReferenceError: _scrml_tilde_5 is not defined  (the read-half escape)
    AFTER    -> RETURNED "pos"                                       (correct)

### Edits
- `compiler/src/codegen/emit-logic.ts` — widening block removed, replaced with a DO-NOT-RE-ADD note
  that states the gating mechanism and the measured emit, so the gap it leaves is not "fixed" blind.
- `compiler/tests/unit/g-…test.js` — the one read-half test re-scoped from "resolves in the
  ENCLOSING context" to a BOUNDARY PIN asserting the current orphan fallback positively.
  ⚑ NOT `test.failing`. Added two helpers (`blockAfter`, `runEmittedBody`) and a NEW regression
  test that pins the block-scope escape structurally AND BY EXECUTION.
- `conformance/.../ctrl-027/` — re-scoped, NOT deleted (§62.2). The three write-half assertions are
  unchanged and green. The one read-half assertion (`#out-lift-tilde` == "41") now pins the orphan
  fallback (`text: ""`), and a NEW `#out-lift-literal` control (identical shape, literal instead of
  `~`) asserts "41" so that the empty pin is DISCRIMINATING — an empty render is otherwise
  indistinguishable from a dead function, which would be an assertion that asserts nothing.

### Adversarial verification of the new guards (they are not vacuous)
- Re-added the widening by FILE COPY (never `git stash` — shared `refs/stash`): both new unit tests
  went RED. Restored: 12 pass / 0 fail.
- Flipped `#out-lift-literal` to a wrong value: the case went RED with
  `text expected "DELIBERATELY-WRONG", got "41"`. Restored.

### Status
- unit file: 12 pass / 0 fail / 79 expect() calls (was 11 / 62).
- conformance `-t ctrl-02`: 8 pass / 0 fail (ctrl-025, ctrl-026 green).

NEXT: SPEC §32.2.1 read clause -> Nominal / spec-ahead + provenance. Then the full gate table:
corpus differential, R26, full suite.

---

## 2026-09-03 — 02 · SPEC marked, full gate table EXECUTED

### SPEC §32.2.1 — read clause marked Nominal / spec-ahead
Marked at ALL FOUR places the clause is stated, so no unmarked restatement out-claims the
normative section (base Rule 4b):
1. §32.2.1 prose (the "initialization only" paragraph);
2. a status admonition after the read example, carrying `provenance:` for the S397 ruling, what
   ships today, WHY it is not simply implemented, and the dpa-040 bank;
3. the `~`-reference normative bullet — split by status, because its two sentences differ: "an arm's
   result is not readable as `~`" IS implemented (write half), "a read resolves in the ENCLOSING
   context" is NOT;
4. the non-boundary bullet — today an in-arm read resolves to NEITHER the enclosing context nor the
   arm; it orphans.
Plus the §17.6.2 restatement at `SPEC.md:11894`, which now points at §32.2.1 as normative for it.

SPEC-INDEX §32 row carries the two-halves split. `regen-spec-index.ts` run (pre-push totals gate):
37,647 -> 37,784 lines. `facts.ts --write` run; every changed number traces to this arc.

### ⚑ PROBE-VALIDITY SANITY CHECKS RUN BEFORE QUOTING ANY NUMBER
- **PROJECT_ROOT_MARKER hazard (S395's 1021 phantom diffs):** the base side is a `git clone --shared`
  with a REAL `.git` DIRECTORY; the head side is a linked worktree whose `.git` is a FILE — both are
  accepted markers (`chunk-namespace.ts:95`). Proof the hazard did not bite: a marker failure hashes
  ABSOLUTE paths, so it shows up as mass chunk-namespace divergence. **0 of 7415 artifacts differ.**
- **Truncation:** enumerated 1916 base / 1919 head — HIGHER than the 1878 the map cites, so the
  population grew, it was not silently cut.
- **`diff` exit code 2 == NOT A VALID COMPARISON.** Exit was **0**.

### GATE TABLE — every row executed
| gate | result |
|---|---|
| `repro-while` emit — no `let _scrml_tilde_N` declared in the `while` block read from outside | **PASS.** The `while` body is base-identical again (`_scrml_note_2(i); i = i + 1;`). Zero tilde names inside the block. |
| `repro` emit — loop's `_scrml_lift(() => …createElement("li")…)` present and intact | **PASS.** Present at base AND after. (The hand-off's "deletes a DOM lift" is FALSE, as the brief said.) |
| `const label = <liftVar>`, var declared before the `if` | **PASS** on both reproducers: `let _scrml_tilde_4 = null;` before the `if`, both arms assign it, `const label = _scrml_tilde_4;`. |
| dead allocation `let _scrml_tilde_N = [];` gone | **PASS.** Absent after; present only at the S395 tip. |
| `ctrl-025` / `ctrl-026` green | **PASS.** 8 of 8 `ctrl-02*` cases green. |
| corpus differential vs `origin/main` | **PASS. 0 artifact content diffs of 7415 compared.** 0 diagnostic changes, 0 compile-failure delta, 0 syntax delta (all three goggles), 0 load-context changes, 0 bare server-fn delta. The ONLY delta is a source-set +3 — my three conformance cases, named individually in the output. |
| R26 | **PASS.** All 4 `gauntlet-r25/dev-*.scrml` compiled with base and head compilers: 18 artifacts each side, 584K, `diff -r` **ZERO artifact diffs**, error counts identical (20/20). |
| suite `bun run test` + `comm -13` vs base baseline | **PASS — `comm -13` EMPTY.** Failure sets are BYTE-IDENTICAL (53 unique names both sides, `diff` clean in BOTH directions). |

⚠ Raw fail COUNT is flaky and the SET is not: base 56, head 54 / 53 / 53 across three runs, with no
duplicate names. All 53 are pre-existing browser-tier / dev-server / happy-dom tests (14 are
transition-001 alone) — none touches `~` or arm-body codegen. The SET comparison is the reliable
instrument here; the count is not.

### MOVEMENT TABLE — every row EXECUTED, base measured by running the BASE compiler
Base observable results obtained by copying the three case dirs into the base checkout and running
ITS conformance harness, so the base column is executed output and not inference.

| shape | base | after | direction |
|---|---|---|---|
| bare stmt + `lift` in then-arm (`#out-then-lift`) | renders `""` — silent wrong | `"pos"` | **silent-wrong -> CORRECT** |
| bare stmt + `lift` in else-arm (`#out-else-lift`) | `""` | `"neg"` | silent-wrong -> CORRECT |
| stmt + §17.6.10 sugar else (`#out-sugar-else`) | `""` | `"pos"` | silent-wrong -> CORRECT |
| `else if` cascade (`#out-cascade`) | `""` | `"mid"` | silent-wrong -> CORRECT |
| multiple leading stmts (`#out-multi`) | `""` | `"pos"` | silent-wrong -> CORRECT |
| no-else arm (`#out-no-else`) | `""` | `"pos"` | silent-wrong -> CORRECT |
| `let` (not `const`) binding (`#out-let`) | `""` | `"pos"` | silent-wrong -> CORRECT |
| nested `if` value-form decl in arm (`#out-nested-if`) | `""` | `"deep"` | silent-wrong -> CORRECT |
| nested if/else decl in arm (`#out-nested-if-else`) | `""` | `"neg"` | silent-wrong -> CORRECT |
| nested `for` comprehension decl in arm (`#out-nested-for`) | `""` | `"ann"` | silent-wrong -> CORRECT |
| two nested decls in one arm (`#out-two-nested`) | `""` | `"one-three"` | silent-wrong -> CORRECT |
| in-arm `~` read + `lift` (`#out-read`) | `""` | `"ok"` | silent-wrong -> CORRECT |
| in-arm `~` read in ELSE (`#out-read-else`) | `""` | `"else-ok"` | silent-wrong -> CORRECT |
| bindless `!{}` recovery in arm (`#out-recovery`) | `""` | `"found"` | silent-wrong -> CORRECT |
| **`lift ~` in an arm (`#out-lift-tilde`)** | `""` (reads the arm's own `null`-seeded result var) | `""` (orphan fallback) | **NO MOVEMENT** — silent null on both sides. This is the unruled read half; pinned, not fixed. |
| `lift <literal>` in an arm (`#out-lift-literal`, the control) | `"41"` | `"41"` | NO MOVEMENT — proves the empty pin above is orphaning, not a dead function |
| in-arm `~` with a SIBLING `while` (repro-while, executed) | returns `null` — silent wrong | returns `"pos"` | silent-wrong -> CORRECT (and the S395 tip's `ReferenceError` never ships) |
| loop inside an arm (`loopInArm`) | `<resultVar>.push(i)` on the `null` seed — LOUD TypeError | byte-identical | **NO MOVEMENT — stays LOUD** |
| `for`-comprehension body with `~` (`comprehensionBody`) | `.push` on a number — LOUD TypeError | byte-identical | **NO MOVEMENT — stays LOUD** |
| ordinary logic body §32.2 bare stmt + `~` | works | byte-identical | NO MOVEMENT |
| every other corpus file (7415 artifacts) | — | — | **NO MOVEMENT — 0 content diffs** |

**NOTHING MOVES LOUD -> SILENT.** Fourteen rows move silent-wrong -> correct; the rest do not move.
The one row that could have been read as a regression (`#out-lift-tilde`) is base-identical, and it
is the row the boundary pin exists for.

### Deferred / surfaced, NOT closed here
- **The `for`-comprehension `~` pipeline is broken at base and is UNCHANGED by this arc**, deliberately
  (§32.2.1 carves out §17.6.2 arm bodies; a comprehension body is not one, and no ruling covers it).
  Measured: `const out = for (i of xs) { step1(i) lift step2(~) }` emits a DEAD `let _t9 = [];` and
  then `_t10.push(step2(_t10))` where `_t10 = step1(i)` is a NUMBER — a TypeError. Same defect class
  as the one just fixed for arms, one construct over. Loud, so not urgent; real, so worth a ruling.
- **The orphan `~` read is SILENT.** `E-TILDE-001` has zero fire sites, so an adopter writing
  `record(~)` in an arm gets `null` with no diagnostic. Named in SPEC as Nominal; that is the
  §32-enforcement gap, not this arc's to close.
- `docs/FACTS.md` is regenerated against MY tree. ⚑ If PA lands only a subset of these files, the
  numbers will be wrong — re-run `bun scripts/facts.ts --write` after landing.

---

## 2026-09-03 — 03 · FIX ROUND (S239 adversarial pass): 1 HIGH + 1 MEDIUM closed

### FINDING 1 — HIGH — REPRODUCED, then FIXED

`armBody` lives on a SHARED MUTABLE `tildeContext` object, so it propagated into every
nested block inside an arm. The carve-out applied two levels down, where §32.2.1 — as
*this arc's own SPEC change* worded it — says it must not: "directly inside" is ONE level.

Reproduced on `if (@n > 0) { if (@n > 3) { step1(2) @n = step2(~) } lift "ok" }`.
All three states EXECUTED with a writable cell (both observables, not just the label):

| | label | `@n` |
|---|---|---|
| base (sloppy, as the classic script ships) | `null` — silent wrong | `6` — CORRECT |
| round-1 branch | `"ok"` — correct | `0` — **silent wrong** |
| **fixed** | `"ok"` | `6` | 

⚑ So round 1 was a **TRADE between two silent-wrongs**, exactly as the coordinator said.
(Under strict mode base THROWS `ReferenceError` on its own escape; the shipped artifact is a
classic script, so the sloppy row above is base's true observable.)

**Fix:** `_descendOutOfArmBody` (`emit-logic.ts:4364`), called from `_emitIfStmtWithOpts`.
- Returns `opts` UNCHANGED outside an arm body -> the ordinary §32.2 nesting path is
  byte-identical to base (verified: corpus 0 content diffs, and a dedicated
  `ordinaryNestedBlock` probe is byte-identical base vs head).
- Inside an arm the nested block gets a **FRESH context object**, not a mutated one.
  `armBody` is dropped so §32.2 resumes one level down; and because the object is fresh, a
  rebind there **cannot escape** to the arm level. Sharing it would have re-opened the exact
  block-scope-escape class this whole arc exists to close.
- `liftVar` IS inherited, so a `lift` inside a nested `if` still designates the arm's result.

**Scope held.** Loop-in-arm is NOT made to work: `_emitForStmtWithTilde` /
`_emitWhileStmtWithTilde` keep the `!tildeCtx.liftVar` guard, so that shape stays LOUD.
Confirmed byte-identical base-vs-head.

**Guard:** new unit test asserts the nested `~` pipeline AND executes for both observables.
Verified adversarially — simulating a transitive re-widening turns it RED.

### FINDING 2 — MEDIUM — REPRODUCED (I verified before editing; it was an unreproduced claim)

My round-1 text asserted ABSOLUTELY that an in-arm `~` read orphans. **False.**

Measured on `step1(2)` / `const label = if (…) { note(~) lift 7 } else { lift 0 }` /
`return step2(~) + label`:
- my branch emits `note(_scrml_tilde_6)` where `_scrml_tilde_6 = step1(2)` — the read
  **REACHES the enclosing accumulator**;
- base emits `note(_scrml_tilde_7)` — the arm's own `null` seed. So this configuration is a
  **FIX over base**, and my "reverted" framing undersold it in one direction while
  over-claiming in the other.

**The real rule.** `nodeContainsTildeRef` decides whether the ENCLOSING sequence gets a `~`
slot at all, and since S397 it does not descend into a bound value-form's arms:
- only `~` is inside the arm -> no slot -> the read ORPHANS to `null`;
- another statement in that sequence mentions `~` -> a slot exists, the arm inherits it, and
  the read REACHES it — which is what §32.2.1's read clause mandates.

That second case is SAFE because the enclosing mint sits at the same block depth as the `if`.
The reverted widening is what let the slot be a name minted inside a NESTED block.

Corrected in all six places carrying the absolute form: SPEC §32.2.1 status note (now a
two-row table, and it names the adopter-facing point — you cannot tell which row you are in
by looking at the arm), the §32.2.1 normative read bullet, the non-boundary bullet, the
§17.6.2 restatement, the SPEC-INDEX §32 row, the ctrl-027 description + rationale, and the
round-1 unit-test comment (which now points at its sibling test). New unit test pins the
reaching half so the conditional rule is EXECUTABLE, not just prose.

### FINDINGS 4 + 5 — comment-only, as directed

- **4 (cross-arm `mode` leak).** VERIFIED: `if (@n>0) { for (i of xs) { lift i } } else { lift "neg" }`
  emits `.push("neg")` in the loop-FREE else arm — and is **byte-identical at base**, so
  pre-existing, not this arc's regression, and still loud (`null` seed). My precedence comment
  described the loop arm only and read as if the sibling arm were unaffected. Radius now stated.
- **5 (`tildeContext` doc comment).** It was stale in FOUR ways, all pointing at the
  pre-de-conflation model: it said `armBody` means "`var` holds the arm's result" (now the
  opposite), that the flag "travels exactly as far as the object does" (that WAS the HIGH),
  that `~` READ resolution is "unchanged" (it is not), and it cited `:4209` for a site at `:4269`.
  Rewritten.

### FINDING 3 — filed, NOT fixed, per instruction
Comprehension: a value-form decl inside a comprehension destroys the accumulator. Pre-existing
and byte-identical at base; same defect class one construct over; deferred by bryan to a
deliberation this session. Untouched here.

### ⚑ CORRECTION TO MY OWN ROUND-1 REPORT
I reported the corpus differential as "**exit 0**". That was wrong — it was `tail`'s exit
status from a pipeline, not the script's. Re-measured directly: **exit 1**, which the script
documents as "differences found" (my 3 added sources). Exit **2** is the invalid-comparison
code and it did NOT occur. The substance holds (valid comparison); the number I quoted did not.
Same wrong-referent class the brief warned about, self-inflicted.

### GATES — all re-run from scratch, base checkout restored to pristine first
| gate | result |
|---|---|
| `nested2`: `@n` AND `label` both correct | **PASS** — `label="ok"`, `@n=6`, executed |
| round-1 movement rows still hold | **PASS** — re-run, not assumed |
| corpus differential | **PASS — 0 artifact content diffs of 7415.** 0 diagnostic / 0 compile-failure / 0 syntax (3 goggles) / 0 load-context / 0 bare-server-fn delta. Only delta: source-set +3 (my cases). diff exit 1 = differences-found, not 2 |
| R26 | **PASS** — 18 artifacts, 584K, `diff -r` ZERO, error counts 20/20 |
| suite + `comm -13` | **PASS — EMPTY.** Failure set BYTE-IDENTICAL to the base baseline (53 unique both sides) |
| conformance corpus (FULL, not filtered) | **PASS — 897 pass / 0 fail** |
| unit file | 14 pass / 0 fail / 100 expect() calls (round 1: 12 / 79) |

### NESTED-BLOCK MOVEMENT ROWS (new this round, every row executed)
| shape | base | round-1 | after fix | direction |
|---|---|---|---|---|
| nested `if` in arm — arm result | `null` silent-wrong | `"ok"` | `"ok"` | silent-wrong -> CORRECT |
| nested `if` in arm — inner `~` read (`@n`) | `6` correct | `0` **silent-wrong** | `6` | **round-1 REGRESSION, now CLOSED** |
| nested block in an ORDINARY body (no arm) | — | — | byte-identical to base | NO MOVEMENT |
| in-arm `~` read, enclosing body HAS its own `~` | arm's null seed (wrong) | reaches enclosing | reaches enclosing | silent-wrong -> CORRECT |
| in-arm `~` read, enclosing body has NO other `~` | `""` | `""` | `""` | NO MOVEMENT (pinned) |
| cross-arm `mode` leak (`.push` in loop-free else) | loud TypeError | identical | identical | NO MOVEMENT (pre-existing, loud) |

**NOTHING MOVES LOUD -> SILENT.** The one silent-wrong round 1 introduced is closed.

---

## 2026-09-03 — 04 · ROUND 3: the class closed at the ROOT, not per-construct

### The pattern that forced this rework
| round | construct found | my fix |
|---|---|---|
| R1 | sibling `while` (the widening) | reverted the widening |
| R2 | nested `if` inside an arm | `_descendOutOfArmBody`, called from ONE site |
| R3 | `given` guard + `for` + `while` bodies | — |

R2's fix is what generated R3. `armBody: true` rode the shared `tildeContext` object
into every child emitter, so the carve-out was **opt-OUT by default**: correct only where
somebody remembered to strip it, silently wrong in every construct nobody had thought of.
Patching construct N relocates the defect to construct N+1.

### VERIFICATION OF ALL THREE CLAIMS BEFORE ANY EDIT
- **`given` guard — REPRODUCED.** base `step2(_scrml_tilde_6)` correct / `label` null;
  bf1e8c28 `step2(null /* ~ orphaned */)` **silent-wrong** / `label` correct. Exactly the
  coordinator's table.
- **`for` + `while` bodies — RELAYED-UNVERIFIED, and I VERIFIED THEM: both REAL.** Same
  `step2(null /* ~ orphaned */)` in both loop bodies, base correct in both.
- **Reviewer finding 3 (cross-limb read) — REPRODUCED and PRE-EXISTING.** base emits the
  identical `step2(_scrml_tilde_6)` reading a then-limb `let` from the else limb. Not a
  regression.

### THE ROOT FIX
`armBody?: boolean` -> `armBodyStmts?: ReadonlySet<any>` — the IDENTITY of the statements
that ARE the arm's body. Guards ask `_isDirectArmBodyStmt(node, opts)`: not "am I somewhere
under an arm?" but "am I one of the specific statement objects that IS the arm's body?"

**Non-propagating BY CONSTRUCTION.** A nested block's children are different objects, so
they fail the test automatically — every construct today and every one added later, with no
strip site to forget.

⚑ **`_descendOutOfArmBody` DELETED, not extended. ZERO per-construct strip sites remain** —
the stated acceptance for the SHAPE of the fix.

⚑ **Enumerating a CLOSED set is not the same mistake.** `_collectArmBodyStmts` walks the
limbs of ONE if-as-expression; §17.6.8 defines that set and it cannot grow without changing
the grammar. The fragile enumeration was over block-opening constructs, which is open-ended.

### THE FOUR CONSTRUCTS — `@n` is the in-arm `~` read, every row EXECUTED/read from emit
| construct | base | bf1e8c28 (R2 fix) | 008ebb84 (root) |
|---|---|---|---|
| nested `if` | correct | `step2(null)` **WRONG** | **correct** |
| `given` guard | correct | `step2(null)` **WRONG** | **correct** |
| `for` body | correct | `step2(null)` **WRONG** | **correct** |
| `while` body | correct | `step2(null)` **WRONG** | **correct** |

Arm result correct in all four (base had it `null` in all four). R1's `while`-escape and
R2's nested-`if` both still fixed.

⚑ **The `given` / `for` / `while` fixes involved NO construct-specific code.** They pass
because the mechanism generalises. That is the claim, and it is the evidence for it.

### THE GUARD THAT MAKES ROUND 4 UNNECESSARY
1. **Table-driven root gate**, 4 block-opening constructs, 3 of which the fix contains no
   code for. Adding a construct is one line.
2. **Architectural guard** asserting no per-construct strip site exists. It is here because
   the behaviour tests CANNOT catch what actually went wrong three times: every round's fix
   passed its own tests; the SHAPE failed. Checks CODE lines only —
   ⚑ its first run flagged the doc comments that deliberately quote the old mechanism,
   which is the same measure-the-wrong-artifact class this arc keeps meeting; fixed by
   filtering comment lines rather than by deleting the explanation.

Both verified adversarially: simulating a regression to the propagating flag turns **all
five** red (including `given`/`for`/`while`).

### FINDING 3 — resolved BY DELETION
The doc comment that claimed containment went with `_descendOutOfArmBody`.
`_isDirectArmBodyStmt` now carries an explicit **⛔ WHAT THIS DOES NOT GUARANTEE** note: the
context object is still shared across sibling blocks, so a mint in one limb stays nameable
from another — measured byte-identical to base, pre-existing, out of scope, and now stated
rather than implied.

### Stale comments corrected (6 sites)
All still described the boolean mechanism, including the `tildeContext` doc block and
`emitIfExprDecl`'s header. A doc that describes a deleted mechanism is how the next agent
re-adds it.

### GATES — all re-run from scratch, base checkout pristine, nothing reused
| gate | result |
|---|---|
| `given` case: `label` AND `@n` | **PASS** — both correct |
| `for` / `while` bodies | **PASS** — verified real first, then fixed |
| R2 nested-`if` stays fixed | **PASS** |
| R1 `while`-escape stays fixed | **PASS** (unit gate green) |
| guard for a NON-enumerated construct | **PASS** — `given`/`for`/`while` have no fix-specific code |
| corpus differential | **PASS — 0 artifact content diffs of 7415.** 0 diagnostic / compile-failure / syntax (3 goggles) / load-context / bare-server-fn delta. Only delta: source-set +3. **exit 1** = differences-found (valid); exit 2 = invalid, did not occur |
| R26 | **PASS** — 18 artifacts, 584K, `diff -r` ZERO, errors 20/20 |
| conformance (FULL) | **PASS — 897 / 0** |
| suite + `comm -13` | **PASS — EMPTY**; failure set BYTE-IDENTICAL to base baseline |
| types gate | no new emit-logic errors (diffed against base: identical) |
| unit file | **19 pass / 0 fail / 134 expect()** (R2: 14 / 100) |

### Observations filed, NOT fixed (out of scope)
- **`match` inside an arm** hits a pre-existing `E-CG-003` "no lowerable arms" and emits
  `(undefined)`. **Byte-identical to base.** Not this arc's; noted because I probed it as a
  candidate root-gate row and it could not serve as one.
- **Cross-limb / cross-block `~` slot escape** (finding 3) — pre-existing, base-identical.
  Closing it means scoping the accumulator per block, which moves the ordinary §32.2 path
  and needs its own ruling.
- The **for-comprehension** limb from round 1 remains deferred and untouched.

---

## 2026-09-03 — 05 · ROUND 4: the ROOT gate was green on JS that cannot run

### The finding — REPRODUCED, and it is the same class a fourth time
`g-bare-expr-in-if-arm-rebinds-tilde-context.test.js:767` asserted:

    expect(body).toMatch(new RegExp(`${armResult}(\\.push\\(|\\s=\\s)"neg"`))

An **alternation**, so the two LOOP rows passed on emission that throws. Measured, then
EXECUTED:

    let _scrml_tilde_5 = null;
    …
    _scrml_tilde_5.push("ok");     ->  THREW TypeError: null is not an object

**The gate whose entire purpose is proving the carve-out generalises was green on a
function that dies at first call.** An alternation that accepts either shape asserts
NEITHER. My own file comments warn about exactly this measure-the-wrong-artifact class;
this is the fourth time this arc has met it and the second time I authored it.

### Root cause of the BAD GATE: two independent properties conflated in one regex
1. **Does `~` reach the enclosing accumulator from inside a nested block?** — what
   `armBodyStmts` fixed, TRUE for all four constructs, and what this gate is FOR.
2. **Does the arm's result get ASSIGNED rather than `.push`ed?** — a different property,
   governed by the `mode` flip, PRE-EXISTING BROKEN for loop constructs.

Tightening the alternation alone would have turned the loop rows red for a real,
pre-existing crash that is not this arc's to fix. Splitting is the answer.

### What each row asserts NOW
Every row, all four: **(1)** the nested block mints (`let _tN = step1(2)`), the in-arm `~`
read resolves to THAT mint (`step2(_tN)`), and `~ orphaned` appears nowhere. **(2)** the arm
result is a distinct var, seeded before the `if`, read by the declaration.

Then **(3)**, per row via a new explicit `resultForm` field — never an alternation:

| row | resultForm | asserts |
|---|---|---|
| nested if | `assign` | `<armResult> = "ok"` / `= "neg"` present, **and `.push(` absent** |
| given guard | `assign` | same |
| for loop | `push-known-broken` | `let <armResult> = null` + `.push("ok")` + `.push("neg")` present, **and `= "ok"` absent** |
| while loop | `push-known-broken` | same |

The loop rows **PIN** the broken emission exactly rather than tolerating it — they fail if it
moves in EITHER direction, including if it is silently fixed. The row now states what it
pins and names why it is out of scope (the `mode` flip + bryan's unbuilt loop-in-arm ruling).

⚑ Base comparison for honesty: base pushes onto the ESCAPED loop-local `_scrml_tilde_6`;
this pushes onto the in-scope arm result `_scrml_tilde_5`. **Both throw.** Pre-existing class,
not a regression — this version merely removes the additional scope escape.

### Adversarial verification — three separate mutations, each restored by FILE COPY
1. Misclassify the `for` row as `assign` -> **RED** (proves the assign branch is real).
2. Misclassify `nested if` as `push-known-broken` -> **RED** (proves the pin branch is real).
3. Simulate the propagating-flag regression in `_isDirectArmBodyStmt` -> **all five RED**,
   including both loop rows, which now fail on property (1) instead of being masked by the
   alternation. **The architectural guard still bites.**

### Gates
- unit file **19 pass / 0 fail / 144 expect()** (was 19 / 134 — same tests, 10 more real assertions).
- conformance **897 / 0**.
- `git diff` on `compiler/src/codegen/emit-logic.ts` is **EMPTY** — test-file-only round, scope held.
- Corpus differential + R26 deliberately NOT re-run: no compiler code changed.

### Corrections to the review, per the coordinator
- Its HIGH claimed my diff "newly ratifies" §17.6.2's *"the arm body MAY contain … loops"*.
  That line is **CONTEXT in my diff and present verbatim on `origin/main`** — I did not bless
  that shape, the SPEC already did. Pre-existing, filed by PA, entangled with the unbuilt
  Q2(a) loop-in-arm ruling. NOT fixed here.

### Filed, NOT fixed (PA-owned, both byte-identical to base)
- **Server-boundary `lift` in an arm emits `return <expr>`**, making everything after it dead
  code — silent wrong value.
- **Post-decl repoint makes a declaration initialize `~`**, contradicting §32.2's own
  "SHALL NOT initialize" bullet.
- Plus still open from earlier rounds: cross-block `~` slot escape, `match`-in-arm `E-CG-003`,
  the for-comprehension limb, and the loop-in-arm `mode` flip pinned above.
