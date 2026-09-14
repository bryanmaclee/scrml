# S415 — `g-declared-names-set-shared-across-blocks-emits-a-bare-assignment`

Append-only working log. Worktree: `.claude/worktrees/agent-abe5853aa1cf34454`, cut from
`origin/main` @ `ccb5e022`.

## Baselines captured BEFORE any change

- `bun test compiler/tests/conformance/` at the branch point: **1608 pass / 0 fail**,
  1638 tests across 133 files, 70.66 s. (Recording the real figure, not a remembered
  one — a previous dispatch reported 906/906 when the truth was 905/905.)

## Locus — verified, not assumed

The dispatcher located 8 threading sites. Verifying them by reading each:

- `emit-control-flow.ts:451` is `_emitIfStmtInner`'s `bodyOpts` — and that ONE object is
  passed to BOTH the consequent (`:506`) and the alternate (`:522`). So the then-limb
  and the else-limb do not merely leak outward, they leak into EACH OTHER. That sibling
  case was not in the dispatch brief; it is a real additional reproducer and is pinned.
- `emit-control-flow.ts:627` C-style `for` body · `:802` for-of body · `:1015`
  `emitWhileStmt` body · `:1037` `emitDoWhileStmt` body. All four confirmed.
- `emit-logic.ts:2947` / `:2990` and the `:3016` / `:3021` while/do-while call sites are
  DISPATCH HOPS, not body emissions — they forward into emit-control-flow, which is
  where the body is actually emitted. Fixing the hops would have been the wrong altitude
  (and would have missed the `_emitIfStmtWithOpts` route below). Fixed at the bodies.
- **REFINEMENT — a 6th site the brief did not list:** `emit-logic.ts:_emitIfStmtWithOpts`
  (~`:4359`) is a SECOND, independent if/else emitter, taken whenever `opts.tildeContext`
  or `opts.continueBehavior` is active (`emit-logic.ts:2908`). It bypasses `emitIfStmt`
  entirely and passed `opts` straight through to both limbs. Patched too.
- Out of scope, noted: `emit-control-flow.ts:1072/1089/1099` (try/catch/finally) and
  `:985` (`emitHoistedForStmt`) thread NO `declaredNames` at all, so they run in the
  "no tracking" mode and cannot exhibit this defect. `emit-lift.js` likewise has no
  `declaredNames` threading. Match arms (`emit-logic.ts:~5376`) and lambdas
  (`emit-expr.ts:~4102`) ALREADY copy — this fix makes blocks consistent with them.

## Bite proof — the tests were written and run BEFORE the fix

`bun test compiler/tests/unit/declared-names-block-scope.test.js`

- **on base (no fix): 3 pass / 7 fail.** All 7 failures are
  `ReferenceError: row is not defined` at runtime, from an artifact that compiled at
  exit 0 with zero diagnostics. The 3 that pass are exactly the three CONTROLs — which
  is the point of a control.
- **with the fix: 10 pass / 0 fail.**

Failing shapes on base: C-style `for`, the same with an intervening inner `function`,
`if` body, `if`/`else` SIBLING leak, `while` body, `do…while` body, for-of body.

## The fix

`blockScopedDeclaredNames<T>(names: T): T` in `emit-logic.ts` — returns `new Set(names)`,
but returns `null`/`undefined` UNCHANGED (an absent set means "no tracking at all",
which is a different mode from "an empty set"; `new Set(undefined)` is an empty Set and
would have changed behaviour). Generic in `T` so every call site keeps its exact type.

Applied at all 6 block-body emissions. A copy, never a fresh empty Set: enclosing
bindings must stay visible in nested blocks, or an ordinary `acc = acc + 1` two blocks
deep would emit `const acc = acc + 1` and read itself in its own TDZ. Test
`⚑ CONTROL — enclosing bindings survive into nested blocks` pins that at two levels of
nesting, for a frame-level binding AND an enclosing-block-level one.

## Pins re-run after the fix

`e-mu-001-nested-block-name-collision` + `e-mu-001-inner-fn-reassignment` +
`inner-fn-assignment-to-captured-binding` + `meta-captured-bindings` +
`s144-server-fn-nested-block-lowering` + `while-braceless-body-stays-in-the-loop`:
**59 pass / 0 fail.**

## Full suites

- `bun test compiler/tests/unit/` — **18,615 pass / 2 fail** (17 skip, 6 todo, 18,640 ran
  across 964 files, 214 s). Both failures are the documented Windows co-run
  `node --check` subprocess timeouts, at 5,017 ms and 5,033 ms:
  `giti-035-sse-generator-seed-clobber` and `lift-engine-advance-bug65`. Re-run in
  ISOLATION per the brief: **24 pass / 0 fail in 2.04 s** — i.e. not slow, merely
  starved when 964 files contend for subprocesses. Not a regression.
- `bun test compiler/tests/conformance/` — **1608 pass / 0 fail**, 1638 tests across 133
  files. **Identical to the pre-change baseline**, which was captured at the branch
  point before the fix existed.
- `bun scripts/facts.ts --check` — FAILED on the facts table (LOC and test-file count
  moved). Regenerated with `--write`, plus `bun scripts/state.ts --write`, and both
  SQUASHED INTO THE CODE COMMIT (a docs-only follow-up push does not re-trigger the
  gate — `on.push` `paths-ignore`). Both now PASS.
- `SPEC.md` untouched, so `regen-spec-index.ts` was not needed.

## Compile-time measurement — #941 shipped a quadratic regression doing the twin fix

### The end-to-end A/B is BELOW THIS HOST'S NOISE FLOOR, and saying so is the finding

Alternating BASE/BRANCH in separate JIT-warmed processes, median of 11, two rounds:

| shape | round | BASE | BRANCH |
|---|---|---|---|
| 1500 names x 800 blocks | 1 | 1256.7 ms | 1638.1 ms |
| 1500 names x 800 blocks | 2 | 2016.8 ms | 1844.5 ms |
| CONTROL 5 names x 800 blocks | 1 | 1050.5 ms | 1094.8 ms |
| CONTROL 5 names x 800 blocks | 2 | 1027.5 ms | 1017.6 ms |

⚑ The two stress rounds DISAGREE IN SIGN (+30 %, then −9 %), and BASE itself drifted
1257 → 2017 ms for a BYTE-IDENTICAL build. The noise is larger than the effect, so no
delta can be read off this table. Reporting either round as the answer would have been
an instrument lying. The CONTROL is the one usable row: +4 % / −1 %, i.e. no delta where
none is expected.

### So measure the added work DIRECTLY — it is countable, and counting it has no noise

The fix adds exactly one thing: a `new Set(...)` per block body. Instrumenting
`blockScopedDeclaredNames` with a counter (temporarily; reverted, tree verified clean)
gives the TOTAL number of elements copied, and a separate microbenchmark converts that
to milliseconds at **17.4 ns/element** (3.0 M elements in 52 ms).

| program | compile | block copies | elements copied | added time | as % |
|---|---|---|---|---|---|
| SYNTH worst case, 1500 names x 800 blocks | 909 ms | 1,600 | 2,402,400 | **41.8 ms** | +4.6 % |
| SYNTH 600 names x 200 blocks | 195 ms | 400 | 240,600 | 4.2 ms | +2.1 % |
| REAL `compiler/self-host/ast.scrml` (161 KB, biggest in repo) | 532 ms | 636 | 8,666 | **0.15 ms** | +0.03 % |
| REAL `compiler/self-host/ts.scrml` (107 KB) | 294 ms | 495 | 6,115 | 0.11 ms | +0.04 % |
| REAL `compiler/self-host/dg.scrml` (44 KB) | 129 ms | 254 | 3,569 | 0.06 ms | +0.05 % |

The scaling is exactly linear in (blocks x names-in-scope) — 1,600 copies averaging
1,501 elements in the worst case — and NOTHING is re-walked, nothing is per-node, and no
work restarts. That is the definitional cost of block scoping, and the same cost
`function-decl`, match arms and lambdas already pay. It is not the #941 hazard, which
was a whole-frame WALK restarted per inner function with no memoisation.

On the biggest REAL program in the repository the added work is **0.15 ms**, and to reach
even 42 ms you need a single function holding 1,500 live `let` bindings and 800 blocks.

(As a side note, the worst-case synthetic compiles in 909 ms in this quiet measurement
versus 1,257–2,017 ms in the A/B table above — an independent confirmation of how noisy
that host measurement was.)

## Status

Locus hypothesis: **HELD, and REFINED** — 5 of the filed sites were real body emissions,
2 were dispatch hops at the wrong altitude, and a 6th emitter (`_emitIfStmtWithOpts`) plus
the if/else SIBLING leak were not in the brief and are now covered.

Deferred, filed here rather than fixed: `try`/`catch`/`finally` bodies
(`emit-control-flow.ts:1072/1089/1099`), `emitHoistedForStmt` (`:985`) and `emit-lift.js`
thread NO `declaredNames` at all. They therefore run in the "no tracking" mode and cannot
exhibit THIS defect — but they also get no declaration tracking, which is a separate
question worth a look, out of scope here.

Direction: **semantics-changed AND newly-rejecting**.

⛑ **CORRECTED by the S239 pass — the original claim of "no diagnostic delta" is FALSIFIED**,
PA-reproduced by execution. A program with TWO bare writes after a block goes from exit 0 to a hard
reject:

```scrml
${ export function f(rows) {
    let out = ""
    for (let i = 0; i < rows.length; i = i + 1) { let row = rows[i]
                                                  out = out + row }
    row = "Q"
    row = "R"
    return out + row } }
```

| | base `ccb5e022` | this branch |
|---|---|---|
| diagnostics | none, **exit 0** | `E-CODEGEN-INVALID-LOGIC` |
| artifact | written | **none** |
| executed | `ReferenceError: row is not defined` | (no artifact) |

The newly-rejected population is confined to programs that ALREADY threw `ReferenceError` at runtime
— CONTROL: the identical two writes with no block at all already reject on BOTH trees, and a program
with a real enclosing `let row` is unchanged and working on both. So the direction is right (loud
beats silent) and the corpus population is zero, but a previously-green build does go red and the
classification owes the word.
Weakest-gated class; owes a language-surface review, which this dispatch did not obtain.
