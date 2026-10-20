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
- [commit 2] parse/ast/core/analyze/lower/check/print/walk/js/runtime: the four heads, labels,
  break/continue (loop-control pass), ranges, `xs[i]` (rt.indexRead trap) and `xs.at(i)` (rt.atRead).
  First end-to-end program compiles + prints readable JS. slice-m1..m4 + codec: 2650 tests, the 4
  diffs were pins (whileCond/forBody/arrayLit now retired/refused/PASS; double E-TYPE-031 fixed).
- [commit 2 landed after the power loss: 2nd WIP commit, gate 38365 pass]
- [commit 3] slice-m4/loops-s469.test.js (33 pass), acceptance/loop/* (20, all PASS), acceptance.test.js STATUS,
  conformance --write (PASS 205 -> 205), 4 gaps + state.ts --write, self-host-v2/progress.md section.
  boot:compile of acceptance/loop/sum-tape runs in happy-dom: `<p id="s">12</p>`.
