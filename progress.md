# s469-boot-loops-1 — progress (crash-recovery anchor)

Brief: first loop slice in the bootstrap (SPEC §49 "one `for`"). Branch `s469-boot-loops-1` off origin/main 1c9cc4a6e.

Baseline: bootstrap conformance PASS 205 / FAIL 81 / UNSUPPORTED 845 (1806 attempted).

## Plan
1. lex: `..` / `..=` tokens (DotDot / DotDotEq); `0..n` lexes the int, not `0.`.
2. ast: AFor / AForHead / AIterSrc; AStmtK.For / Break / Continue.
3. parse: four heads, labels, break/continue; refusals E-LOOP-WHILE-RETIRED, E-LOOP-DO-WHILE-RETIRED,
   E-FOR-UNPARENTHESIZED-HEAD (braceless `for x in`/`of`), E-CTRL-011 (`for (… in …)`), E-RANGE-OUTSIDE-LOOP-HEAD.
4. core: Stmt.Loop / Break / Continue, LoopHead; PrimOp.IndexRead / AtRead.
5. analyze: binder, loop-control pass (E-LOOP-001..006), typer (cond, iterable, range bounds), index reads, walkers.
6. lower, check (C19), print (+ runtime trap helper), walk, measure.
7. tests (slice-m4/loops-s469.test.js) + acceptance/loop/*.

## Log
