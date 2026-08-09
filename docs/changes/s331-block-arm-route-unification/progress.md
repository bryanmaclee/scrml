# progress — s331 §18.5 block-arm route unification

Append-only. Timestamped. What was just done · what is next · blockers.

---

## 2026-08-09 — dispatch start

**Startup (F4).** `pwd` = `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a2b2da62c54942840`.
`git rev-parse --show-toplevel` == pwd. Tree clean. Branch `worktree-agent-a2b2da62c54942840`.
`bun install` + `bun run pretest` both exit 0.

**BRIEF LOCATION CORRECTION (report this).** The dispatch prompt said the BRIEF is "committed on this
branch, so it exists inside your worktree". It is NOT. It lives on `fix/s331-block-arm-route-unification`
(`88a0193a`), which this worktree was not cut from. This worktree's base is `05787a42` (S333-peter wrap),
**two sessions NEWER than the BRIEF's stated base `b4fb2f1f`**. Recovered the BRIEF with
`git checkout fix/s331-block-arm-route-unification -- docs/changes/s331-block-arm-route-unification/BRIEF.md`.
Deliberately did NOT take that commit's `docs/known-gaps.md` half (PA-owned shared doc).

Base-drift check on the three named loci: `git log b4fb2f1f..HEAD` over `emit-logic.ts`,
`emit-control-flow.ts`, `emit-event-wiring.ts` reports exactly one commit — `d2e27ba7` (#476, E-SQL-006
`.prepare()` compile-time), which touched `emit-logic.ts` (+25/-?) but on the server-fn emit path, not
§18.5. Treating the BRIEF's line numbers as approximate.

**REPRODUCED, before any source change.** Reproducer extended from the BRIEF's to cover all FOUR value
positions in one file (the BRIEF's own reproducer only carried two — derived + local-decl; `return match`
and markup-interp were described in the table but not present in the source). Also had to WIRE `selfRef`
and `retPos` to callers — as written they tree-shake out under `W-DEAD-FUNCTION` and emit nothing.

Compiles clean: 0 errors, 2 warnings (redundant-logic, SPA-inferred), 1 lint. Both defects present:

- **Defect A** — derived position emits `}\na; }` — bare expression statement, no `return`. IIFE falls
  off the end.
- **Defect B** — tilde/local-decl route emits `const a = 1;` for source `a = 1`, and `const a = a + 1;`
  for the self-referencing form (TDZ).

**NEW OBSERVATION not in the BRIEF, and it sharpens the diagnosis.** The derived position and the
markup-interp position are BOTH described in the BRIEF as "raw-string" and both as correct-or-not
together. They are not the same route and they do not agree:

    derived      : `if (…) { let a = 0; for (…) {\n  a = 1;\n}\na; }`      <- no return
    markup-interp: `if (…) { let a = 0; for (…) {\n  a = 1;\n} return a; }` <- return present

Same source text, same arm, two different lowerings. So the BRIEF's 4-row table is really 4 distinct
routes, not 3.

**Next:** trace the four emission sites and verify each named locus (held / refined / wrong).

---

## 2026-08-09 — root causes located (measured, not inferred)

Method: temporary `SCRML_DEBUG_TILDE`-gated `console.error` instrumentation at three sites
(`_emitForStmtWithTilde`, the `const-decl`/`tilde-decl` case, `planBlockArmLift`), compile the
reproducer, read the dump, revert the instrumentation (`git checkout --`; tree verified clean).

### The real structural model — it is a 2x2, not "three routes"

A §18.5 block arm reaches codegen in one of TWO INPUT representations, and is consumed in one of TWO
OUTPUT shapes. All four cells exist:

|  | output (i) IIFE `return <tail>` | output (ii) local-decl `<tilde> = <tail>` |
|---|---|---|
| **(a) `arm.structuredBody`** — parsed AST node array; parser already segmented | **R2** emit-control-flow.ts:2320-2362 | **R4** emit-logic.ts:4742-4788 |
| **(b) `arm.result`** — raw source string; segmentation must be RE-DERIVED from text | **R1** `emitIifeBlockArmBody` (emit-control-flow.ts:2090) | **R3** `_emitBlockArmValueFromString` (emit-logic.ts:4636) |

The BRIEF's four value POSITIONS map onto these cells; position is not itself the variable. In the
reproducer: derived cell -> R1; `return match` and markup-interp -> R2; local decl -> R4. R3 was not
exercised by the reproducer at all.

**`planBlockArmLift` is called EXACTLY ONCE in the whole reproducer compile** — by R1, the position that
fails. R2 and R4 never call it. So the premise that it is "the ONE classifier every value-position path
routes through" is FALSE at the segmentation level: R2/R4 get segmentation free from the parser and only
share the leaf PREDICATE `_blockTailIsValueExpr`. #470 unified the predicate; it did not and could not
unify segmentation, because only the (b) routes have a segmentation problem to solve.

### Defect A — root cause: `_splitBlockStatements` (emit-logic.ts:4496), NOT a per-position bug

The splitter separates on `;` and `\n` at depth 0. It does NOT treat the `}` that closes a
block-bodied statement as a segment boundary. So `for (…) { a = 1 } a` never splits; it stays ONE
segment whose head is `for`, `_blockTailIsValueExpr` correctly says "statement head", and the tail is
classified void. Measured directly:

    planBlockArmLift("let a = 0; for (const i of @items) { a = 1 } a")
      -> segments ["let a = 0", "for ( const i of @items ) { a = 1 } a"], lifted=false

Confirmed by a direct probe of the exported function across ten inputs: the one-line `for`/`if`/`while`/
bare-nested-block-then-tail forms ALL return `tail=null`; inserting a `\n` or `;` before the tail makes
every one of them lift correctly. So the trigger is not "a block statement precedes the tail" — it is
"a block statement precedes the tail AND no `;`/newline separates them". That is a segmentation defect
in ONE shared function, and it serves both (b) routes.

R2/R4 are immune because the parser hands them `[let-decl, for-stmt, bare-expr]` already split.

### Defect B — root cause: an unthreaded `declaredNames`, NOT a wrong node kind

`a = 1` inside the nested block parses as a **`tilde-decl`** node (`{kind:"tilde-decl", name:"a",
init:"1"}`). emit-logic.ts:1961 already carries the correct reassignment guard:

    if (node.kind === "tilde-decl" && … && opts.declaredNames?.has(node.name)) return `${node.name} = ${rhs};`

The guard is right. Its INPUT is empty. Measured dump, one line per decl emission:

    DECL {"kind":"tilde-decl","name":"a","init":"1",      "declared":[]}     <- R4, emits `const a = 1`
    DECL {"kind":"tilde-decl","name":"a","init":"a + 1",  "declared":[]}     <- R4, emits `const a = a + 1` (TDZ)
    DECL {"kind":"tilde-decl","name":"a","init":"1",      "declared":["a"]}  <- correct route, emits `a = 1`

Why R4 alone is empty: R2 emits its arm body through `emitLogicBody(arm.structuredBody, opts)`
(emit-control-flow.ts:2321), and `emitLogicBody` opens `const declaredNames = opts.declaredNames ?? new
Set()` and threads that ONE set through every statement — so the arm's own `let a = 0` registers `a`
before the nested `a = 1` is emitted. **R4 hand-rolls the same loop** (emit-logic.ts:4746-4768,
`emitLogicNode(stmt, bodyOpts)` per statement) and its `bodyOpts` is `{...opts, tildeContext}` — it
never creates a set, so at top level `declaredNames` is `undefined` and every guard keyed on it is dead.

`_emitForStmtWithTilde` is **NEVER CALLED** during the reproducer compile (instrumented: zero hits), so
it is not on the path despite being the obvious-looking suspect.

### Locus verdicts vs the BRIEF

- emit-logic.ts ~4721-4747 `arm.structuredBody` branch, "prime suspect for Defect B" — **HELD**, with a
  refinement: the defect is not the `emitLogicNode`/tail-redirect logic itself but the MISSING
  `declaredNames` set in the `bodyOpts` that feeds it (built at :4691).
- emit-control-flow.ts `emitIifeBlockArmBody` — **REFINED**: it is the CARRIER of Defect A, but the bug
  is one level down in `_splitBlockStatements`, which it reaches via `planBlockArmLift`.
- emit-event-wiring.ts ~1193 derived-cell path, "prime suspect for Defect A" — **WRONG.** The derived
  cell's block-arm lowering does not happen there; it goes through `emitMatchExpr` ->
  `emitIifeBlockArmBody` in emit-control-flow.ts. Nothing in emit-event-wiring.ts needed to change.
- `_blockTailIsValueExpr` / `planBlockArmLift` "the ONE classifier" — **WRONG as stated.** It is the one
  leaf PREDICATE, shared by all routes. It is NOT the one segmenter: only R1/R3 segment at all.

### Scoping call — arguing against the BRIEF's prescribed shape

The BRIEF prescribes collapsing to ONE emission route. Measurement says that is the wrong instrument
for these two defects, and it trips the BRIEF's own STOP-IF-BIGGER condition:

- The (a)/(b) INPUT axis cannot be collapsed without either re-parsing every raw string into nodes or
  stringifying every node array. Both MOVE behaviour on R2, which is correct today on both axes — the
  BRIEF's constraint 1 (raw-string positions stay byte-identical) forbids exactly that.
- The (i)/(ii) OUTPUT axis is ALREADY factored the way the BRIEF wants: `planBlockArmLift`'s contract is
  "callers own the emission shape, only classification is shared."
- Neither defect is caused by there being multiple routes. A is one wrong shared segmenter; B is one
  route not opening the shared bookkeeping the others open. Both are single-choke-point root fixes.

**Chosen shape:** fix A in `_splitBlockStatements` (serves both (b) routes at once); fix B by giving R4
the same per-arm `declaredNames` set R2 gets from `emitLogicBody`. Then VERIFY all four positions agree
on both axes. If any axis still diverges after that, unification gets reconsidered on evidence.

**Next:** implement fix A, re-probe the ten-input matrix, compile, commit.

---

## 2026-08-09 — both fixes landed; Defect B's root was DEEPER than the first diagnosis

### Fix A — `_splitBlockStatements` now breaks at a block statement's closing brace

emit-logic.ts. Added `_BLOCK_STMT_HEAD_RE`, `_BRACE_CONTINUATION_RE`, `_closesBlockStatement`, and a
depth-0 `}` branch in the splitter loop. Three conditions must ALL hold to split, because this predicate
has to be right about every context it will ever meet:

1. the segment so far is headed by a block-statement keyword (`for|while|do|if|switch|try|match|given|each`)
   — this is what keeps `const o = { … }` / `const f = () => { … }` off the path;
2. what follows is not a continuation keyword (`else|while|catch|finally`) — splitting there would tear
   `if/else`, `do/while`, `try/catch` in half;
3. what follows begins a statement (identifier / `@` / `{` / literal) — a WHITELIST, so `{ … }.a`,
   `{ … }[0]`, `{ … })`, `{ … } + 1` can never split.

The keyword fences are `(?![A-Za-z0-9_$])` OUTSIDE the alternation, per invariant 46 / #463 — `\b`
excludes `$`, which scrml identifiers admit, and a fence inside the alternation guards only its last
member. Without this, `formatted`/`iface`/`matcher` would read as block-statement heads.

Adversarial probe (14 inputs) — all safe: `if/else`, `if/else-if/else`, `try/catch`, object-literal
init, object-literal member tail, arrow init, nested `for`, object literal INSIDE a loop body, a brace
inside a string literal, a string tail, a `for`-prefixed identifier, a nested `match` statement.

### Fix B — the real root was a DROPPED OPTIONS ARGUMENT, not the missing set

First diagnosis (R4's `bodyOpts` carries no `declaredNames`) was INCOMPLETE. Instrumenting the actual
dispatch showed the arm-level set was fine and a *fresh empty* set appeared one level down:

    FORSTMT {"tilde":true, "declared":["r","a"]}   <- broken route, set is CORRECT here
    DECL    {"kind":"tilde-decl","name":"a","declared":[]}   <- one level down, EMPTY

Cause: `_emitForStmtWithTilde` (emit-logic.ts) has two fallbacks for shapes tilde-accumulation does not
apply to (C-style `for`, and a reactive `@cell` iterable). Both read:

    if (reactiveMatch) return emitForStmt(node);       // <- options argument DROPPED

`emitForStmt` then ran with `opts === undefined`, so its `emitLogicBody(body, {declaredNames:
opts?.declaredNames, …})` opened a FRESH empty Set, and the `tilde-decl` reassignment guard — which keys
exactly on `opts.declaredNames?.has(name)` — could never fire. Hence `const a = 1` / `const a = a + 1`.

**This hop dropped EVERYTHING `opts` carries**, not just `declaredNames`: `boundary`, `serverFnNames`,
`asyncRouteMap`, `clientAsyncBody`, engine bindings. `declaredNames` is simply the field whose loss was
visible as a wrong value. Any reactive-iterable `for` inside any tilde context lost the lot.

Fix: both fallbacks now re-enter `emitLogicNode(node, { ...opts, tildeContext: undefined })`. This runs
the SAME canonical `case "for-stmt"` dispatch the non-tilde path uses — so there is no hand-copied
argument list here to drift out of step with it — and clearing `tildeContext` is what terminates the
re-dispatch (the `case "for-stmt"` guard routes back into `_emitForStmtWithTilde` only when it is set).

### THIRD defect found and fixed by the same touch — sibling-arm scope leak

R4 emitted every arm against ONE shared `declaredNames` set, so a name declared in arm 1 was visible to
arm 2. Measured on `{ .Idle :> { let a = 0; a = a + 1; a }  .Busy :> { a = 5; a } }`:

    shared set (before): else if (…) {   a = 5;      _scrml_tilde_4 = a; }   <- NO binding in scope
    per-arm set (after): else if (…) {   const a = 5; _scrml_tilde_4 = a; }  <- correct

The `a = 5` form has no binding in that arm's scope: in the emitted classic (non-strict) script it
silently creates a GLOBAL. R4 now seeds a PER-ARM set from the enclosing scope. Surfacing this
explicitly rather than folding it in silently — it is a third defect, adjacent but not one the BRIEF
named. **R2 (emit-control-flow.ts:2321) still shares one set across arms and therefore still has this
leak** — see the deferred list; fixing it is a separate touch on a route that is correct on the two
axes the BRIEF scoped.

### Process note against myself

A `sed -i 's/emitLogicNode(stmt, bodyOpts)/…armOpts/'` hit FIVE call sites when only one was intended;
the other four are in unrelated functions where `armOpts` is not in scope. Caught by reading
`git diff` immediately after, reverted by line number, re-verified by grep. Recording it because the
whole-file blind sed is the kind of thing that lands a compiling-but-wrong change.

**Next:** readability pass on the emitted `};`, then unit tests, execution harness, conformance,
differential.

---

## 2026-08-09 — differential EXPECTATION, stated before running it

Per the BRIEF: a clean `0 of N` is exactly how both these defects shipped past #470, so the expectation
goes on record first and the coverage caveat goes with it.

**Fix A (`_splitBlockStatements`) — expect ZERO changed artifacts.** It only moves output where a §18.5
block arm's RAW-STRING body holds a block-bodied statement immediately followed by a tail with no
`;`/newline between them. The BRIEF already established no corpus file puts a block-bodied statement
inside a match block arm at all. A zero here would confirm the BRIEF's corpus claim; it would NOT be
evidence the fix is safe.

**Fix B (re-dispatch with `opts`) — expect a SMALL NON-ZERO delta, and this is the one to scrutinise.**
It fires wherever a tilde-context `for` hits either fallback (C-style header, or a reactive `@cell`
iterable) — a much commoner shape than A's. Everything `opts` carries was being dropped there, so a
changed artifact could show up as: a bare assignment now emitting as an assignment instead of a `const`;
a server call now correctly `await`ed (`asyncRouteMap` restored); an engine write now routed through the
write-guard (engine bindings restored); a `boundary`-sensitive emission flipping to the right side. Every
one of those is a REPAIR, but each has to be read individually — "it changed" is not "it improved".

**Fix C (per-arm `declaredNames`) — expect a SMALL NON-ZERO delta.** Fires where the structured
local-decl route has multiple arms and a later arm reuses a name an earlier arm declared. Output moves
from a bare `x = …` to `const x = …`.

**What this instrument does NOT cover, stated explicitly:**
- It compares EMITTED TEXT. It executes nothing, so it cannot distinguish a repair from a regression —
  only the executed conformance `domAnchored` half and the browser suite assert VALUES.
- `0 of N` means the corpus does not contain the shape. It is an ABSENCE-of-coverage signal, not a
  safety signal.
- Its syntax half (three goggles, separate NODE subprocess) does cover the one thing text comparison is
  genuinely good at: a bundle-breaking emission. That half IS load-bearing here, because fix A changes
  how statements are joined and a mis-join would surface as a SyntaxError.

---

## 2026-08-09 — verification artifacts

**Executed, not grepped.** Built a happy-dom execution harness modelled on
`compiler/tests/browser/browser-match-block.test.js` (runtime + `captureInsideChunkScope` + real DOM
read), because `node --check` accepts the TDZ shape and is not a valid oracle here. Real values off the
executed bundle, post-fix:

    tail-shape case:   #after-for=1  #after-if=2  #straight=3  #void-arm=""
                       #ret-after-for=4  #multi-after-if=5  #local-after-for=6  #fn-local-after-for=7
    fidelity case:     #derived-assign=1  #derived-self-ref=12  #ret-self-ref=21  #multi-assign=30
                       #local-self-ref=42  #fn-local-assign=50  #fn-local-self-ref=62

`#void-arm=""` is the counter-gate: a block statement with no trailing expression still yields §18.5
void and renders empty, not `undefined`. The self-referencing totals ACCUMULATE over two iterations
(10->12, 40->42, 60->62), so a fix that stopped the shadowing but dropped the write would still fail.

**Conformance — 2 cases, both halves.**
- `match-block/block-arm-tail-after-block-statement` — axis (a) tail-shape: tail after `for`, after
  `if`, straight-line control, and the void counter-gate, in 5 value positions.
- `match-block/block-arm-nested-assignment-fidelity` — axis (b) nested-statement fidelity: bare
  assignment and self-referencing assignment, in 5 value positions.

Both carry `codes: []` + `notCodes: [E-CODEGEN-INVALID-LOGIC]` (codes half) and `domAnchored` value
assertions (runtime half).

**Positions covered: 5, not 4** — derived cell, return statement, multi-scrutinee decl (§18.19), `fn`
local decl, `function` local decl. The last two are DIFFERENT ROUTES (R3 raw-string vs R4 structured)
even though the BRIEF's table treats "local decl" as one position; `fn` and `function` bodies do not
parse their arm bodies the same way. Pinning only one would have left half the local-decl surface
uncovered.

**The markup-interp position is NOT DOM-asserted, and that is inherited, not new.** The pre-existing
`value-form-block-arm-all-paths` case records why: a match written directly inside a markup `${ }` is
emitted as a bare unterminated IIFE whose value is discarded, so nothing renders. My reproducer
reproduces that exactly. It IS covered on the codes half and its emitted lowering is correct on both
axes (verified in the reproducer output); only its DOM rendering is the separate pre-existing gap.

**Unit test** `compiler/tests/unit/match-block-arm-tail-after-block-statement.test.js` — segmentation
matrix against the exported `planBlockArmLift` seam (6 lifting shapes, separator-spelling equivalence,
straight-line control, 2 void counter-gates), the no-tear counter-gates (if/else, if/else-if/else,
try/catch, object-literal init, member-read off a brace, arrow init, brace-in-string, keyword-prefixed
identifiers per invariant 46), the do-while RESIDUAL pinned explicitly as documented-not-desired, and
the emission assertions for axes B and C.

**Axis C is pinned on EMISSION, deliberately.** The sibling-arm scope leak emits a bare `a = 5` with no
binding in scope; in a classic non-strict script that creates a global and still renders 5, so no
`domAnchored` value assertion can see it. A text assertion is the only instrument that can.

---

## 2026-08-09 — PRE-FIX PROOF, and it CORRECTS THE BRIEF'S TABLE

Built a base worktree at `05787a42` (`git worktree add --detach`, `node_modules` symlinked from this
worktree — a fresh worktree checks out only tracked files) and compiled BOTH conformance cases with the
PRE-FIX compiler, then executed each bundle in happy-dom. This is what makes the two cases gates rather
than decoration.

**Case 1 (tail-shape), executed on the PRE-FIX compiler:**

    #after-for          = ""    (post-fix 1)   BROKEN
    #after-if           = ""    (post-fix 2)   BROKEN
    #straight           = "3"                  correct — the control, and the ONLY shape #469/#470 covered
    #void-arm           = ""                   correct — void, unchanged by the fix
    #ret-after-for      = ""    (post-fix 4)   BROKEN
    #multi-after-if     = ""    (post-fix 5)   BROKEN
    #local-after-for    = ""    (post-fix 6)   BROKEN
    #fn-local-after-for = ""    (post-fix 7)   BROKEN

**Case 2 (nested fidelity), executed on the PRE-FIX compiler:** all seven anchors `""`.

### The correction, and it matters for how the gap is described

The BRIEF's four-row table marks `return match` and markup-interp as ✅ on the "tail after a block
statement" axis. **That is wrong. Pre-fix, Defect A broke FIVE of the five positions I tested**, return
position included. Both cases render EMPTY, not `undefined` — `_scrml_render_value` of an `undefined`
cell paints nothing, so the adopter symptom is silently missing content, not a visible error string.

Why the BRIEF measured otherwise: **the discriminator is the ARM FORM, not the value position.**

- VARIANT arms (`.Idle :>`) parse to `arm.structuredBody` — the parser has already segmented the body,
  so the raw-string segmenter is never asked and the defect cannot fire.
- LITERAL / wildcard arms (`1 :>`, `_ :>`) stay a raw SOURCE STRING and go through
  `planBlockArmLift` -> `_splitBlockStatements`, where the defect lives.

The BRIEF's reproducer used variant arms for the return and markup-interp positions and a raw-string
shape for the derived cell, so it read as position-dependent. It is not. My own first reproducer
inherited the same confound — `retPos` with variant arms emitted `return a` correctly pre-fix, which is
what made me record "derived and markup-interp are not the same route" early on. Both observations were
real; the CAUSE was arm form the whole time.

**Consequence for coverage:** pinning the axis only in the positions the BRIEF named would have missed
it, because position is not the variable. Both conformance cases therefore use LITERAL arms (the
vulnerable form) across five positions, and the unit test exercises the segmenter seam directly.

---

## 2026-08-09 — DIFFERENTIAL RESULT, scored against the expectation I filed before running it

`bun scripts/corpus-emit-differential.ts`, base `05787a42` vs head `abfd7693`, over the default roots.
Base 1897 sources / 7328 artifacts; head 1899 / 7334.

    source set delta          2        <- EXACTLY my two new conformance case.scrml files, nothing else
    compile-failure delta     0 newly failing / 0 newly passing
    diagnostic changes        0 code / 0 text-only
    artifact set delta        0 added / 0 removed
    artifact CONTENT diffs    0 of 7328 compared      <- byte-identical
    syntax delta (effective)  0 new / 0 fixed / 0 message-changed   (66 failing both sides)
    syntax delta (script)     0 new / 0 fixed         (629 both sides)
    syntax delta (module)     0 new / 0 fixed         (64 both sides)
    load-context changes      0
    bare server-fn sites      base 142 / head 142

Process exit **1 = differences found**, and the two differences are the two source files I added. This
is NOT exit 2, which would mean the comparison itself was invalid.

### Scoring my own expectation — I was RIGHT on A and WRONG on B and C

- **Fix A — predicted ZERO, got ZERO.** Correct, and it independently confirms the BRIEF's corpus claim
  that no corpus file puts a block-bodied statement inside a match block arm.
- **Fix B — predicted a SMALL NON-ZERO delta, got ZERO. My prediction was wrong.** I reasoned that a
  reactive-iterable `for` inside a tilde context is "a much commoner shape". It is not present in the
  corpus at all: the tilde context here arises from a value-form match-expr DECL, and no corpus arm body
  contains a `for` of any kind.
- **Fix C — predicted a SMALL NON-ZERO delta, got ZERO. Also wrong**, for the same reason: no corpus
  match has two arms where a later arm reuses an earlier arm's name.

Recording the misses rather than quietly reporting a clean run. Both wrong predictions failed in the
same direction and for the same reason — I over-estimated corpus coverage of every shape in this area.

### What this clean result DOES and DOES NOT establish

**DOES:** my changes are completely INERT on the existing corpus. 7328 of 7328 artifacts byte-identical
means the new depth-0 `}` boundary never fired on a single existing construct, so the tear risk
(if/else, do-while, try/catch, object literals, member reads off a brace) cannot have materialised
anywhere in 1897 sources. The three syntax goggles agreeing exactly — including the 629-artifact script
goggle — is the strongest available evidence that nothing became a broken bundle.

**DOES NOT:** carry any evidence that the fixes WORK. Zero changed artifacts means the corpus does not
contain the inputs that would trip either defect — which is precisely how #470 shipped both of them past
a clean `0 of 7296`. The affirmative evidence is elsewhere and is deliberately execution-based:
the two conformance cases (all anchors empty pre-fix, all correct post-fix, values read out of a
happy-dom-executed bundle), the 23-assertion unit test on the segmentation seam, and the no-tear
counter-gates — none of which the corpus could have supplied.

**Axis the differential covers:** emitted TEXT, compile outcome, diagnostic set, artifact set, and
parse-under-both-goggles. **Axis it does not cover:** runtime VALUES, and any shape absent from the
corpus — which here is every shape in scope.

---

## 2026-08-09 — SUITE RESULTS, and the browser-failure attribution

**Pre-commit gate** (`bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance`),
run directly rather than read off a hook: **22193 pass / 0 fail / 70 skip / 1 todo**, 22264 tests across
1214 files, exit 0. Both commits also passed this gate through the real pre-commit hook.

**Conformance** (`bun conformance/run.ts`): **876/876 cases pass**, exit 0. That is 874 + my 2. (The
BRIEF's "868/868 or better" figure is stale — the suite had already grown before this dispatch.)

**Full suite** (`bun run test`, chains pretest): 29850 pass / **49 fail** / 216 skip / 1 todo, 30116
tests across 1346 files, exit 1. Every failure is in `compiler/tests/browser/`.

### Attributing the browser failures — measured, not argued

Two independent lines, because "my diff looks unrelated" is not evidence.

**1. The differential already settles the input axis.** Browser tests consume compiled artifacts from
`samples/compilation-tests/dist`. `samples` is 877 of the 1897 differential sources, and artifact
CONTENT diffs came back **0 of 7328**. The browser suite therefore consumed byte-identical inputs on
both sides. My source diff is confined to one file (`compiler/src/codegen/emit-logic.ts`); I touched no
runtime, no test harness, no fixture.

**2. Matched-scope failure-SET comparison** (invariant 8: gate on the NAME SET, not the count). Ran
`bun test compiler/tests/browser` on BOTH the base worktree and this one, same scope, same fixtures:

    base : 50 failing names
    head : 48 failing names
    diff : head is a strict SUBSET of base. ZERO names present in head and absent from base.

The two names base has and head does not are `TodoMVC §0/§1 — dist not compiled`, an environment gap in
the throwaway base worktree (no `benchmarks/todomvc/dist`), not a behaviour difference.

**Conclusion: all 48 browser failures are PRE-EXISTING. This change introduces none.**

Also worth recording: the whole-suite run reported 49 browser failures while the browser-only run
reported 48 on the same tree. That ±1 is the known happy-dom global-state leak across suites, which is
exactly why the comparison above was run at MATCHED scope on both sides rather than diffing a
whole-suite number against a browser-only number.

### Deferred / not done, with reasons

1. **The residual `};` in the derived position's emission.** Fix A makes a block statement a separate
   leading segment, and the leading-segment emitters append `;` unconditionally, so a block statement
   now emits `for (…) { … };` — a redundant empty statement. Valid and readable enough, but noise.
   NOT fixed: suppressing it correctly requires gating on the block-statement head at two more sites,
   and it would move bytes on a pre-existing shape (`{ … for (…) { … }; a }`) that is correct today —
   BRIEF constraint 1. Cosmetic, deliberately left, one-line-ish follow-up.
2. **Axis C on the raw-string routes.** Pinned as a failing-by-design RESIDUAL in the unit test. Those
   routes make no decl-vs-assignment decision at all (they preserve source text), so closing it means
   giving them one — a change to routes that are correct on both briefed axes. STOP-IF-BIGGER.
3. **The do-while tail.** No depth-0 `}` terminates a do-while and `while` after `}` is ambiguous from
   text. Pinned as a RESIDUAL. Workaround: a `;` or newline before the tail.
4. **Route unification as prescribed by the BRIEF.** Argued against on measurement; see the scoping
   section above. Neither defect was caused by route multiplicity.
