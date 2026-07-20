# sPA ss75 — conformance authoring: control-flow §17 + linear §35 (freeze-gate, WAVE C language-boundary)

**Launch:** `read spa.md ss75` · **Branch:** `spa/ss75` · **Worktree:** `../scrml-spa-ss75`

**Fill:** conformance-authoring toward the FREEZE bar (S256 tier-1). Two contracts: **control-flow §17**
(`if=`/`else`/`else-if` placement — a markup-structure guarantee) and **linear types §35** (the `~`
pipeline-accumulator + `lin` single-consumption contract — a soundness guarantee; a linear value used
twice or never is unsound). The S256 audit puts the `E-CTRL-*`, `E-LIN-*`, `E-TILDE-*` sets in tier-1.
NEW S256 · **fireable now** (pure conformance-corpus data — disjoint). Enumerates the CODES; the fired
sPA authors the `.scrml`.

## What conformance authoring IS (the method)
Identical to `spa-lists/ss56-conformance-engine-51.md` §"What conformance authoring IS". Author from
impl#1 → SANITY-CHECK vs SPEC §17 (control-flow) + §35 (linear) → ESCALATE divergences; verify GREEN on
`bun conformance/run.ts`; schema in `conformance/README.md`. Grep each code live in `compiler/src`
(`ast-builder.js` for §17 placement ~8084-17581 + `type-system.ts` for §35 linear ~17015-17523) for the
exact trigger. Harness-clean (compile-time).

## Core files
`conformance/README.md` · `spa-lists/ss56-conformance-engine-51.md` (method §) ·
`conformance/cases/loop/` + `conformance/cases/each/` (mirror for control-flow) ·
`compiler/src/ast-builder.js` (§17 else/else-if placement) + `type-system.ts` (§35 linear) ·
`compiler/SPEC.md` §17 + §35 (normative — read the named subsection per code)

> **LIST CLOSED — S275 re-verification.** This list was WORKED and RE-INTEGRATED at `55bbdbed` (#75,
> +24 cases) and hardened by two follow-on fix rounds: `32cb0a89` (#76, E-CTRL-004 + E-LOOP-007
> soundness holes) and `8134fb55` (#78, E-CTRL-010 + E-LIN-004 + E-TILDE-001 message + E-LIN-005).
> The `[status=pending]` markers below were never updated at re-integration, so a `/spa ss75` re-fire
> reads as 14 open items. **It is a no-op.** Items 1-12 are LANDED; items 13-14 are PARKED under a
> standing user ruling. Re-verified independently on `58c8161d` (S275): `bun conformance/run.ts` =
> **745/745 green**, and a bidirectional family sweep (live fire-sites in `compiler/src` vs asserted
> `codes[]` in `conformance/cases/`) shows **every live `E-CTRL-*` / `E-LIN-*` / `E-LOOP-007` /
> `E-CONTROL-FLOW-IN-MARKUP` code is conformance-asserted** — the only two live-but-unasserted codes
> in the whole §17/§35 surface are `E-TILDE-001/002`, which cannot fire (below).

## Items — control-flow §17 (one code per item; reject-path pos + clean neg)
1. **E-CTRL-001** `[status=landed 55bbdbed]` — orphaned `else` with no preceding `if=` at the same level (`ast-builder.js:17723`). `ctrl-001-orphan-else-{pos,neg}`.
2. **E-CTRL-002** `[status=landed 55bbdbed]` — orphaned `else-if=` (`ast-builder.js:17734`). `ctrl-002-orphan-else-if-{pos,neg}`.
3. **E-CTRL-003** `[status=landed 55bbdbed]` — an element extending a chain that already ended with `else` (`ast-builder.js:17798`). `ctrl-003-extend-past-else-{pos,neg}`.
4. **E-CTRL-004** `[status=landed 55bbdbed neg / 32cb0a89 pos]` — `else`/`else-if=` on a state-object opener (`ast-builder.js:17757`). Was **provably dead** at author time (sPA blocker A); ruling-1 → fix-impl, landed #76. `ctrl-004-else-on-state-opener-{pos,neg}` + `ctrl-004-orphan-else-on-state-opener-pos`.
5. **E-CTRL-005** `[status=landed 55bbdbed]` — `else`/`else-if=` and `if=` on the same element (`ast-builder.js:17709`). `ctrl-005-else-and-if-same-element-{pos,neg}`.
6. **E-CTRL-011** `[status=landed 55bbdbed]` — `for (… in …)` rejected; scrml uses `for (x of …)` (`ast-builder.js:8140`, `:12405`). `ctrl-011-for-in-{pos,neg}`.
7. **E-CONTROL-FLOW-IN-MARKUP** `[status=landed 55bbdbed]` — a bare control-flow keyword in markup (`ast-builder.js:1855`). `ctrl-012-bare-control-flow-in-markup-{pos,neg}`.
8. **E-LOOP-007** `[status=landed 55bbdbed / widened 32cb0a89]` — `while` used as an expression (`type-system.ts:18848`). Landed NARROWER than SPEC §49.4.4 (sPA blocker C: impl additionally required a `lift` in the while body); ruling-1 → fix-impl, landed #76. `loop-007-while-as-expr-{pos,neg}` + `-no-lift-pos` + `separate-while-after-decl-neg`.

## Items — linear §35 (reject-path pos + clean neg)
9. **E-LIN-001** `[status=landed 55bbdbed]` — `lin` variable declared but never consumed before scope exit (`type-system.ts:17692`). `lin-001-never-consumed-{pos,neg}`.
10. **E-LIN-002** `[status=landed 55bbdbed]` — `lin` consumed more than once, or inside a loop (`type-system.ts:17272`, `:17780`). `lin-002-double-use-pos` + `lin-002-consumed-in-loop-{pos,neg}`.
11. **E-LIN-003** `[status=landed 55bbdbed]` — `lin` consumed in some branches but not others (`type-system.ts:17699`). `lin-003-branch-asymmetry-{pos,neg}`.
12. **E-LIN-006** `[status=landed 55bbdbed]` — §35.5: `lin` consumed in a DEFERRED ctx (`request`/`poll`; `type-system.ts:17204`). `lin-006-deferred-ctx-{pos,neg}`.
13. **E-TILDE-001** `[status=PARKED — structurally unreachable; ruling-2 scope-wiring-separately]` — see below.
14. **E-TILDE-002** `[status=PARKED — same]` — see below.

### Why 13-14 are PARKED (do NOT author — authoring them would be FALSE-GREEN)
`type-system.ts` dispatches E-TILDE off AST kinds `tilde-init` / `tilde-ref` (`:17801`, `:17807`) and
`lift-stmt` (`:17813`). **No producer anywhere in `compiler/src` constructs any of those three kinds** —
the builder emits only `lift-expr`; the `usesTilde` flag the walker reads (`:17814`, `:18527`) is never
set. Re-confirmed empirically on `58c8161d` (S275): 11 probe shapes — including SPEC §32.5's own verbatim
invalid examples (`${ process(~) }`, reinit-before-consume, init-then-scope-exit), plus the `lift` paths —
emit **zero** E-TILDE codes. `compiler/tests/unit/type-system.test.js:1766+` hand-builds
`{kind:"tilde-ref"}` AST literals, so both codes **appear covered while the real parse path is dead**
(the R26 trap); `compiler/tests/integration/tilde-carry-forward.test.js:193` already pins the gap verbatim
("neither E-TILDE-001 nor a fallback fires … a deeper spec-implementation gap"), and `emit-expr.ts` carries
a `null /* ~ orphaned */` codegen fallback *because* E-TILDE-001 never fires.

**Standing ruling — bryan S261 ruling-2** (delta-log `[547]`): E-TILDE-001/002 →
**"fix-message-now, scope-wiring-separately"**. The message half LANDED (#78, `8134fb55`). The WIRING is a
**parser arc** (how `~` is represented in the AST — it is gated behind a value-lift window; outside it `~`
parses as bitwise NOT) and is tracked as hand-off-261 item 8. Until that arc lands there is no input for
which impl#1 fires either code, so a pos case is impossible and a neg case would pass because the feature
is **dead**, not because the shape is legal.

**Definition of done — MET (to the maximum extent reachable).** 12 of 14 codes pinned (reject pos + clean
neg per code); `run.ts` green at 745/745; the two unreachable codes ESCALATED and ruled. The §17
control-flow + §35 linear diagnostic edge is conformance-covered **except** the `~` accumulator, which is
blocked on the parser arc, not on conformance authoring. Follow-on waves additionally pinned `E-CTRL-010`,
`E-LIN-004` and `E-LIN-005` — codes the original 14-item enumeration MISSED (the sPA's bidirectional sweep
caught them).

## Progress
`spa-lists/ss75.progress.md`. Land per-item on `spa/ss75`; ping the PA inbox per item. Do NOT advance
main / push. PA re-integrates via file-delta + confirms run.ts green. ESCALATE (do not decide) any
impl#1-vs-SPEC divergence.
