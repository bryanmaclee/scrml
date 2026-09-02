# progress — s395-value-form-sugar-bound

Append-only. Crash-recovery anchor.

## Startup (verified)
- WORKTREE_ROOT = /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-af4227ae4f7a528e9
- `git rev-parse --show-toplevel` == WORKTREE_ROOT: OK
- tree clean at start: OK
- `git merge-base HEAD origin/main` == origin/main == HEAD == 0dc4d0144469b9a1806ed67b32a89db809ab021c: OK
- `bun install`: 218 packages OK
- `bun run pretest` run PLAINLY from worktree CWD: OK — artifact verified by listing
  samples/compilation-tests/dist/ (13 samples compiled, files present, not trusting exit code)
- NOTE: top-level `dist/` absent in worktree. Verified this is a compile OUTPUT dir
  (codegen writes `dist/scrml-runtime.<hash>.js`), not a build input. Not an env gap for
  the unit/integration/conformance gate.
- Brief fetched from origin/fix/s395-value-form-sugar-bound-position into
  docs/changes/s395-value-form-sugar-bound/BRIEF.md and read IN FULL.

## Baseline gate (pre-change), measured
`bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance compiler/tests/*.test.js`
-> **29552 pass / 0 fail / 86 skip / 10 todo**, 1303 files, 193.82s, EXIT=0.

## Defect REPRODUCED at base 0dc4d014 (execution, not report)
`repro-c.scrml` (brief's reproducer C) compiles exit 0 and emits, verbatim:
```
function _scrml_show_2() {
  let _scrml_tilde_3 = null;
if (_scrml_cs_reactive_get("n") > 0) {
  let _scrml_tilde_4 = "pos";
}
else {
  let _scrml_tilde_5 = "neg";
}
const label = _scrml_tilde_3;
  return label;
}
```
Control (`{ lift "pos" }`) emits `_scrml_tilde_3 = "pos";` — assignment, correct.

## LOCUS VERDICT: HELD as to file + pattern, REFINED as to function
Brief said `emit-logic.ts`, fix pattern at `:5001-5024` (§18.5 match block-arm). Both correct.
REFINEMENT (traced by EXECUTION, not symbol search):
- The bound-position emitter is **`emitIfExprDecl` (`emit-logic.ts:4445`)**, reached from the
  `const-decl` dispatch `:2052` / `let-decl` `:1907` via `node.ifExpr`. NOT `_emitIfStmtWithOpts`
  (`:4224`), which is the tilde-active *statement* path. Proved by a temporary
  `SCRML_TRACE_IFEXPR` instrumentation (added, executed, removed by file copy — zero residual diff):
  `[TRACE] emitIfExprDecl name=label consequent: len=1 kinds=[bare-expr] ... nodeKinds=[lit]`.
- There are **THREE** arm-body loops, not one: `emitIfExprDecl` (then-arm) and BOTH branches of
  `emitIfExprAltChain` (`:4394`) — the `else if` consequent and the plain `else`.
- ROOT: `emit-logic.ts:1723-1737`. Under an active `tildeContext` the shared `bare-expr` handler
  emits `let <fresh> = <expr>;` AND rebinds `opts.tildeContext.var` to the fresh var (§32
  pipeline-accumulator semantics). Correct for a `~` pipeline; wrong for a §17.6.2 branch body.

## FIX — ONE helper, THREE call sites
`_emitValueFormSugarArm(body, tildeVar, bodyOpts)`.
SHARED with §18.5: the value-ness predicate `_blockTailIsValueExpr`.
NOT shared (deliberate — sharing it would be a WIDENING): the SHAPE rule. §18.5 = block result is
its LAST expression (tail after N statements); §17.6.1 grammar = `'{' expression '}'`, EXACTLY one.
The same `length !== 1 -> decline` shape test the WORKING interpolation twin `_soleBareExprValue`
(`emit-control-flow.ts`) already uses for this same construct.

## PHASE 1 — bite proof, BOTH directions, by FILE COPY (no `git stash` at any point)
reproducer C, line 21 of `repro-c.client.js`:
- BASE  : `let _scrml_tilde_4 = "pos";`  + `const label = _scrml_tilde_3;`  -> label ALWAYS null
- BUILD : `_scrml_tilde_3 = "pos";`      + `const label = _scrml_tilde_3;`  -> label === "pos"
Restored via `git checkout -- <file>`; `git diff --stat` EMPTY and md5 `bb09eb19...` matches the
FIX copy; RESTORED re-run reproduces BUILD.

## Shape matrix (12 shapes) — base vs build
FIXED (was always-null, now correct): m01 if+else · m03 NO-else (§17.6.4 false path stays the
`= null` seed = `not`, and NO warning is emitted, per §17.6.4/§17.6.10) · m05 else-if chain ·
m07 `let` binding site · m09 compound expr · m11 bare call · m12 fn call.
⚑ m01 is now BYTE-IDENTICAL to m02, m03 to m04, m05 to m06 — i.e. the sugar and the explicit-`lift`
control now emit the same code at the binding site. That is §17.6.10's equivalence, made literal.
m08 (sugar arm + `lift` arm) was the worst base case and is fixed: base emitted
`let _scrml_tilde_4 = "pos"` in the THEN block and `_scrml_tilde_4 = "neg"` in the ELSE block — an
assignment to a name declared in a SIBLING block scope, i.e. an implicit GLOBAL in non-strict
emitted code.
UNCHANGED (correctly declined): m10 multi-statement arm (not the one-expression shape) ·
q01 `@acc = 1` (parses `state-decl`) · q02 `t = "p"` (`tilde-decl`) · q03 `@acc += 1` (bare-expr
with an `assign` node — rejected by `_blockTailIsValueExpr`; without that gate the redirect would
have hijacked a statement as the arm value and bypassed §51.11 machine-write interception).
`node --check`: 15 emitted artifacts, 0 syntax failures.

## Pre-existing, NOT caused by this change (verified by base flip)
`bun scripts/types-gate.ts --check` reports the SAME 9 diagnostics on base `0dc4d014` and on the
fix, byte-identical. None are in `emit-logic.ts`.

## Conformance cases — BOTH halves, both PASS [runtime]
- `conformance/cases/control-flow/ctrl-023-value-form-sugar-bound-position-pos` — WITH `else`
  (+ else-if cascade + `let` binding site + the explicit-`lift` twin as the equivalence control).
- `conformance/cases/control-flow/ctrl-024-value-form-sugar-bound-no-else-pos` — WITHOUT `else`
  (binds `not`, renders nothing, and NO diagnostic of any severity for the missing `else`).
Full conformance run: **891/891 pass** (889 before + these 2). Both report `[runtime]`, i.e. the DOM
assertions executed — not a diagnostics-only pass.
W-LIFT-001 is asserted in `notCodes` on both as a FORWARD guard: `grep -r W-LIFT-001 compiler/src/`
returns ZERO — the code has no emit site today, so the assertion is vacuous now and bites later.

## PHASE 3 — R26 empirical (adopter recompile + SHAPE check)
Detector: `scratchpad/af4227/detect.mjs` — walks emitted client JS for the exact silent-wrong
signature (`let _scrml_tilde_A = null;` followed by an if/else chain whose arm bodies mint a FRESH
`let _scrml_tilde_B = …` instead of writing A).
DETECTOR BITE PROVEN FIRST (it is not a probe that answers a different question):
  - on the BASE matrix artifacts: **16 sites found**
  - on the FIXED matrix + guard probes: **1 site** — and that one is `q03` (`{ @acc += 1 }`),
    the deliberately-DECLINED assignment arm, which is not the sugar.
Adopter run: 47 `dev-*.scrml` across gauntlet rounds r13/r20/r22/r23/r24/**r25**/r27/r28.
There is NO `gauntlet-r26` directory in scrml-support; r27/r28 are the newest rounds present.
  - 5 compile clean / 42 exit non-zero (pre-existing; compile failure is DATA, not a gate here)
  - 47 client JS scanned -> **0 silent-wrong sites**

⚑ HONEST READING OF THAT ZERO — it is NO-REGRESSION evidence, NOT fix-confirmation.
Census (`census.sh`): the bound-position if-as-expression appears **0 times in all 860 adopter
`.scrml` in scrml-support**. It appears in exactly **7** repo files: my 2 new conformance cases and
5 pre-existing `samples/compilation-tests/gauntlet-s19-phase2-control-flow/*` sites — and all 5 of
those write the EXPLICIT `lift` form. That is exactly why the corpus differential measures zero,
and it is the expected shape of adoption for a form that silently produced `null`.
Per the corpus-zero rule: this is BLAST-RADIUS evidence only. It is not evidence about demand.

## PHASE 2 — MEASURED corpus emit-differential (semantics-changed class)
Tool: the repo's own `scripts/corpus-emit-differential.ts` (capture/capture/diff).
Base side is a REAL checkout — `git clone` of the repo into scratch, `git checkout 0dc4d014`,
`node_modules` copied in; `emit-logic.ts` md5 verified identical to the base copy. No `git stash`,
no `git worktree add`, no mutation of any shared git state.

RUN 1 was CONTAMINATED and I am reporting it rather than hiding it: the head capture raced my
conformance-case edit, so the source sets differed (1912 base / 1913 head) and the single reported
"difference" was that source-set delta. It also had NO BITE — the construct was absent on both
sides, so a 0/0 content result proved nothing.

RUN 2 (rigorous): the two new conformance sources were mirrored into the BASE checkout so both
sides enumerate the SAME population, which makes the run simultaneously a measured-zero on the
pre-existing corpus AND a bite proof.

  sources enumerated        base 1914   head 1914     (source set delta 0)
  artifacts COMPARED        7408
  **artifact content diffs  2 of 7408**
  compile-failure delta     0 newly failing / 0 newly passing
  diagnostic changes        0 code / 0 text-only
  artifact set delta        0 added / 0 removed
  syntax delta              0 new / 0 fixed / 0 message-changed (effective, script AND module goggles)
  load-context changes      0
  bare server-fn sites      base 144 / head 144 (delta 0)

THE 2 CHANGED FILES, NAMED:
  1. `conformance/cases/control-flow/ctrl-023-value-form-sugar-bound-position-pos/case.scrml`
     -> `case.client.js`  (3731 -> 3696 bytes)
  2. `conformance/cases/control-flow/ctrl-024-value-form-sugar-bound-no-else-pos/case.scrml`
     -> `case.client.js`  (3668 -> 3641 bytes)
Both are my OWN new cases — i.e. **ZERO pre-existing corpus files changed**.

EVERY changed line inspected (`diff -u`, full output reviewed). Two kinds only:
  (a) `-  let _scrml_tilde_B = <expr>;` / `+  _scrml_tilde_A = <expr>;`  — the specified fix: a site
      that was emitting `null` now emits the specified value. This is the ONLY semantic change.
  (b) downstream gensym RENUMBERING (`_scrml_tilde_10` -> `_scrml_tilde_8`, `_scrml_lifted_10` ->
      `_scrml_lifted_8`, and the matching call sites) — a pure consequence of no longer minting the
      extra temps. No shape change.
⚑ The strongest control is inside ctrl-023 itself: the explicit-`lift` twin `_scrml_lifted_*` keeps
its EXACT shape across the diff (`_scrml_tilde_N = "pos";` on both sides); only its gensym number
moved. Nothing changed for a reason other than the fix. No STOP condition was triggered.

WHY THE PRE-EXISTING ZERO IS REAL AND NOT A TRUNCATED PROBE:
the enumeration cross-check `agrees: true` on both sides (`find -type f -name '*.scrml'` oracle vs
the walk, per-root: examples 71 · samples 877 · conformance 906 · stdlib 53 · benchmarks 7 = 1914,
`onlyInWalk` / `onlyInOracle` both empty), and the harness DID detect the change where the construct
is present (2 of 7408). The zero is a property of the corpus, not of the measurement — verified
independently by the census: all 5 pre-existing bound-position sites in
`samples/compilation-tests/gauntlet-s19-phase2-control-flow/` write the EXPLICIT `lift` form.

## ⚑ NEW DEFECT FOUND, NOT FIXED — surfaced to PA, NOT silently expanded into
Candidate gap name: `g-bare-expr-in-if-arm-rebinds-tilde-context-corrupting-the-result-var`
Severity: HIGH, silent-wrong. Class: IDENTICAL ROOT to the one I just fixed
(`emit-logic.ts:1723-1737`), DIFFERENT shape — so it is NOT closed by this change and it does NOT
reproduce through the sugar.

REPRODUCED BY EXECUTION at base AND at HEAD (unchanged by my fix — I verified both sides):
```scrml
const label = if (@n > 0) {
    log("a")
    lift "pos"
} else {
    lift "neg"
}
```
emits (HEAD, i.e. still broken):
```js
let _scrml_tilde_3 = null;
if (_scrml_cs_reactive_get("n") > 0) {
  let _scrml_tilde_4 = _scrml_log("client", "p01.scrml:5", "a");   // bare-expr REBINDS tildeCtx.var
  _scrml_tilde_4 = "pos";        // the explicit `lift` now writes the WRONG var
}
else {
  _scrml_tilde_4 = "neg";        // assigns a name declared in a SIBLING block scope
}
const label = _scrml_tilde_3;    // never written -> ALWAYS null
```
TWO limbs, both silent, exit 0, zero diagnostics:
 (a) the explicit `lift` in the same arm writes the fresh temp, not the result var;
 (b) the SIBLING arm assigns to a name not in scope there — in the emitted non-strict IIFE that is
     an IMPLICIT GLOBAL, not a ReferenceError, so it fails silently rather than loudly.
Same for a genuine §32 pipeline arm (`fmt(@n)` then `lift ~`) -> `_scrml_tilde_4 = _scrml_tilde_4;`.

WHY IT IS OUT OF SCOPE HERE: the brief scopes this dispatch to the SUGAR (`'{' expression '}'`).
This shape is the OTHER §17.6.1 production — `'{' statement* lift-stmt statement* '}'`, the
canonical explicit-`lift` arm — so it is arguably the higher-severity half of the class.
WHY I DID NOT HALF-FIX IT: giving each arm its own `tildeContext` object would close limb (b) only,
leaving limb (a) — removing the louder symptom while the silent-wrong survives. Closing it properly
requires ruling on a §32-vs-§17.6 interaction (does a bare-expr inside an if-as-expression ARM body
participate in the `~` pipeline accumulator at all?). That is a design ruling, not a codegen call.
WHY THE CORPUS DOES NOT CATCH IT: it needs a BARE-EXPR (typically a bare call) before the `lift`.
`samples/.../phase2-if-as-expr-intermediate-014.scrml` has a statement-then-`lift` arm and is FINE,
because its statement is a `let`-decl, which does not rebind. Only a bare-expr does.

## OUT-OF-SCOPE GUARD — verified by execution at HEAD, NOT widened
The brief forbids "fixing" the DERIVED-CELL binding. Confirmed my change did not accidentally
widen it (that would be the exact failure mode the brief warns about):
  `const <label> = if (@n > 0) { "pos" } else { "neg" }`        -> EXIT 1, E-CODEGEN-INVALID-LOGIC
  `const <label> = if (@n > 0) { lift "pos" } else { lift "neg" }` -> EXIT 1, E-CODEGEN-INVALID-LOGIC
Both halves still fail LOUD, which is the safe direction. §17.6.3 names only `const`/`let` binding
sites; a derived state cell is an UNSPECIFIED shape and making it work is bryan's ruling, not mine.
The brief's stated ASYMMETRY also independently reproduced (I executed it rather than relaying it):
  `const <label> = match @level { .Low :> "green"  .High :> "red" }` -> EXIT 0. Works.

## Surfaced defect RE-VERIFIED AT HEAD (executed, not relayed)
Re-ran the p01/p02 probes against the FIXED build: both are byte-identical to base. My change
neither fixes nor worsens them. The finding above is an executed observation on the shipped build.

## Adversarial self-review of the change (each item EXECUTED, not reasoned-only)
1. **Auto-await parity.** The §18.5 site wraps its RHS in `_awaitMatchArmServerCalls`; mine does
   not. CHECKED whether that makes the sugar arm diverge from its explicit-`lift` twin for a
   server-fn call. It does NOT: `{ loadRows() }` and `{ lift loadRows() }` both emit
   `<result> = await _scrml_fetch_loadRows_3();` inside an `async`-coloured function, byte-identical.
   The auto-await is supplied UPSTREAM (the i87 §13.2 classifier threaded at the `case "if-stmt"`
   dispatch), not by that wrapper. Adding it would have been redundant.
2. **Call-site completeness.** `emitIfExprAltChain` is private with exactly 2 call sites (`:4492`
   recursive, `:4562` from `emitIfExprDecl`); both take the new `tildeVar` arg. 3 sugar call sites,
   as designed. Verified by grep across `compiler/src/`.
3. **`declaredNames` threading** — not needed: the helper emits an ASSIGNMENT and declares nothing.
4. **`~` in a sugar expression** — `_makeExprCtx(bodyOpts)` keeps the RHS byte-identical to what the
   bare-expr handler produced, so the only delta is the assignment target. Deliberate: it is what
   makes the Phase-2 differential a clean 2-of-7408.

## ⚑ SECOND SHAPE SURFACED, NOT FIXED (unspecified, and I did not widen into it)
A NESTED if-as-expression as an arm body:
```scrml
const label = if (@n > 0) {
    if (@n > 3) { "big" } else { "small" }
} else { "neg" }
```
Base AND head both emit the inner arms as fresh `let _scrml_tilde_4/5 = …`, so when the OUTER
condition is true `label` is null. exit 0, zero diagnostics. Diffed base-vs-head directly: the ONLY
difference is the outer `else` arm (correctly fixed by this change); the nested limb is BYTE-
IDENTICAL, i.e. unchanged, not worsened.
NOT FIXED ON PURPOSE: §17.6.1 enumerates expression position as (1) the RHS of a `const`/`let` and
(2) a direct expression operand. An `if` as the sole content of an ARM BODY is NEITHER, so whether
the §17.6.2 sugar sees a nested if-as-expression as "exactly one expression" is UNSPECIFIED. Making
it work is a widening and bryan's ruling. Reported, not built.

## FINAL VERIFICATION

### Gate tier (the pre-commit gate: unit + integration + conformance + top-level)
                        pass    fail   skip  todo   files
  BASE  (0dc4d014)     29552      0     86    10    1303
  HEAD  (this branch)  29554      0     86    10    1303
Delta: **+2 pass, 0 fail** — the +2 are exactly my two new conformance cases.
This gate also ran (and passed) inside the pre-commit hook on every non-docs commit.
No `--no-verify` was used. `core.hooksPath` was not touched (it is unset; the hook is
`.git/hooks/pre-commit`).

### Whole tier including the browser/dev-server tier (`bun run test`, 1439 files)
Compared WHOLE-SUITE base-vs-head (not isolated files — happy-dom leaks global state
between files, so a per-file rerun is not a valid comparison):
  BASE  30927 pass / 59 fail / 216 skip / 11 todo
  HEAD  30930 pass / 55 fail / 216 skip / 11 todo
  **NEW failures in head: 0** (failure-SET comparison, not counts)
  FIXED in head: 4, and the breakdown matters —
    · 2 are MY OWN new conformance cases, which FAIL on base and PASS on head:
      `ctrl-023-value-form-sugar-bound-position-pos` and
      `ctrl-024-value-form-sugar-bound-no-else-pos`, both `[runtime]`.
      **This is the conformance-case BITE PROOF: they are genuine regression guards,
      not tests written to pass whatever the compiler happens to do.**
    · 2 are `TodoMVC — dist not compiled` / `dist files exist`, an ENV asymmetry of the
      scratch base CLONE (it has no `benchmarks/todomvc/dist`), NOT a real fix. Reported
      rather than counted as a win.
The 55 pre-existing failures are all browser / happy-dom / `scrml dev` watcher / engine-runtime
tests. None touch if-as-expression. They fail identically on base.

### Security invariant (codegen remit) — checked on my own construct
For a sugar arm whose expression is a SERVER-fn call, the emitted `.client.js` contains only the
fetch shim (`_scrml_fetch_loadRows_3` -> `POST /_scrml/__ri_route_loadRows_1`). The server fn BODY
(`return "rows"`) is ABSENT from the client bundle. Sugar and explicit-`lift` route identically.
