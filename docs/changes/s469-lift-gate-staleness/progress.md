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
