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
- 43a6b7682: a run-once block declaring a function that reads its own bindings refuses its open gates (forcing
  the re-render would move them out of the hoisted function's reach — M1a ReferenceError); an open condition that
  names no cell and calls nothing is evaluated once and not refused (a function body included).
- 9ffc64a5c: merge origin/main 14a788227. CI blocking commands all exit 0 (facts --check exit 1 = WARN-only).

## Differential
- Corpus: 3,750 `.scrml` (self-host excluded), both compilers copied to the same directory layout: error sets
  identical for all files. 16 files carry a lifted gate; 15 mount; every cell perturbed (flip / empty / restore,
  row fields flipped): 1 step differs — gauntlet-r10-rust-orders `@selectedOrderId = 1`, branch shows the order
  detail whose condition is TRUE (main stale). "Branch shows content whose condition is false": 0.
- Leak measurement (group re-render, LOW, filed): swap calls per @ok off+on after 5/10 re-renders — main 15/29,
  branch 12/22 (direct); indirect main 2/2 (stale: never re-read), branch 12/22.

## Round 2 (review of b57d697a9: FIX — HIGH-1, MED-1, MED-2, M1b)
- a69607112: merge origin/main (b8911ec3b).
- f9ac20bb8: HIGH-1 — the "names no cell, calls nothing" carve-out (43a6b7682) removed: a local can hold a value
  computed from a cell. Every open gate re-runs its render; in a function body it is refused. MED-1 — an inner
  loop holding an open gate that reads only its own declarations becomes a REGION of the keyed row (own live-keyed
  tracked effect, child owner scope); the outer row stays keyed. Pack n23 +11 (797). Browser +16. Gaps filed:
  keyed-row control-flow if (HIGH), group/arm call reads (HIGH), lift of markup-returning call (MED), plain-let
  residual (MED, owner question). M1b test comment names the residual.
- MED-2 (a) / (b) kept refused (not structurally fresh: a parameter / the escaped row binder may change unseen).
- Corpus differential re-run vs origin/main b8911ec3b: error sets identical (3,753 files); 1 visible-set step
  differs (gauntlet-r10-rust-orders, branch correct).

## Round 3 (review of b192c63de: FIX — HIGH-new from the MED-1 region)
- 3ee576ded: a region is emitted only when the inner loop sits inside an ELEMENT of the row
  (liftLoopInRowElement, gating liftRegionSafe — structural: the loop node's element ancestry). Among a fragment
  row's roots (group head, beside sibling roots, inside an arm with a sibling) the row falls back to the round-1
  plain lowering. Review repros h3/h4/h5/h7: 27/27 correct (b192c63de: 4 wrong; main: 26 wrong). Browser +7
  (6 fail on b192c63de), pack n23 +4 (801 shapes; the pack's single-click form does not reproduce the frozen-node
  reorder — the browser cases are the regression guard). Docs: direct-cell `if (@role …)` in a keyed row added to
  g-keyed-row-control-flow-if-not-reevaluated-s469 (2, want 0, main too); the function-body restriction stated
  in SPEC §17.1, the §34 row and known-gaps. LOW (region effects run twice at init) not changed.
