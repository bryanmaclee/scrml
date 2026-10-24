# s469-lift-gate-staleness — progress

Gap: `g-lift-gate-placement-inherits-main-staleness-s469` (HIGH). Branch `s469-lift-gate-staleness` from
origin/main 8ec9bf20e. Limb: impl#1 `compiler/src` (security: a revoked guard stays open).

## Design (one structural rule)

A lifted `if=` / `show=` is re-evaluated by RE-RUNNING THE CODE THAT PRODUCED WHAT IT READS, under the
runtime's read tracking (`_scrml_effect`: a read through any call depth is a dependency):

- **closed** gate — its condition reads no binding declared in its render unit (the outermost `${}` block /
  function it is built in), except the binder of the reconciled row it is built in (re-resolved live by key):
  its OWN tracked effect re-evaluates it. Cells read inside called functions are tracked.
- **open** gate — reads a render-unit binding (a body local, a local closure, an item-derived local, an outer
  row's binder): evaluated inline where the element is built, and the unit re-renders on what that render
  read — an `if … lift` arm (its render is an effect), or a plain group (forced to its re-render effect).
  A keyed row whose tree holds an open gate is lowered as the plain loop (the unit re-runs it).
  Anything else (an open gate in a function body, an escaped while-in-row lift, an open gate that still
  lands in a keyed row) is REFUSED at compile time (fail closed).

Locals are decided by the compiler's declaration tables (a pre-pass over the file AST: every name declared in
the unit), not by reading the emitted JS. Over-reporting a local is the safe direction (inline + re-render, or
plain lowering — both correct).

Value-indexed `@cell == row.field`: the bucket stays (O(2)), but its key is re-registered by a tracked effect
that reads the live row's field; a non-literal value side outside a row is no longer value-indexed.

## Log
- startup: worktree clean, bun install, compile-test-samples OK.
- baseline (main 8ec9bf20e): n23 36 FAIL of 124 (exactly the KNOWN_FAIL list); browser STALE_ON_MAIN 21.
- d2675304d: lift-gate-scope.js (declaration tables + condition names), `_emitLiftGate` (closed → own tracked
  effect; open → inline + render re-run; VI row → re-keyed bucket; refusals), group window / forced re-render in
  emit-reactive-wiring, pins folded into forLiftTreeHasImpureLoop. n23 0 FAIL; KNOWN_FAIL emptied; the 21
  expected-failure browser cases pass; round-6 `__counter` snapshots re-recorded (main hid S2 at @n=2 and
  duplicated escaped markup); M1b / H4 expectations updated (see the test comments).
- 12f6f5d66: n23 +28 shapes (main 57 FAIL / 152, branch 0, 1 refused); text-form lifts pin; nested loops count as
  keyed only with a `@` iterable (gauntlet-r10-odin-filebrowser was refused by the backstop before); SPEC §17.1 +
  §34 row; SPEC-INDEX regen.
- fe80c43e1: lift-gate-staleness-s469.browser.test.js — 47 revoke/re-grant cycles; main 42 fail, branch 0.
- f2a04e05b: VI bucket callback reads the live row the effect resolved (no resolve → no spurious list dep);
  gap resolved; g-lift-group-rerender-keeps-previous-gate-effects-s469 filed; state.ts --write (gap-counts).
- merge origin/main (78b0e1fe6): pack 758 + 28 = 786; full pack PASS=437 REFUSED=332 DENY=15 UNJUDGED=2 FAIL=0.
- 3e69ce87d: .d.ts for types-gate.

## Differential
- Corpus: 3,750 `.scrml` (self-host excluded), both compilers copied to the same directory layout: error sets
  identical for all files. 16 files carry a lifted gate; 15 mount; every cell perturbed (flip / empty / restore,
  row fields flipped): 1 step differs — gauntlet-r10-rust-orders `@selectedOrderId = 1`, branch shows the order
  detail whose condition is TRUE (main stale). "Branch shows content whose condition is false": 0.
- Leak measurement (group re-render, LOW, filed): swap calls per @ok off+on after 5/10 re-renders — main 15/29,
  branch 12/22 (direct); indirect main 2/2 (stale: never re-read), branch 12/22.
