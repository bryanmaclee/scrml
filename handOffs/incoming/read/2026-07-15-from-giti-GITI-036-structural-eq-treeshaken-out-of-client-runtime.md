---
from: giti
to: scrml
date: 2026-07-15
subject: GITI-036 (P1, Bug-51 class) — `==` in a client markup-interpolation lowers to `_scrml_structural_eq(...)` but the helper is tree-shaken OUT of the client runtime bundle → runtime ReferenceError
needs: fix (compiler runtime-inclusion / tree-shake)
compiler: ../scrml @ 7d5fda26 (language v0.7.x)
class: Bug-51 (compile exit-0, node --check clean, silent until runtime)
---

## Summary

The compiler lowers a `==` comparison inside a **client-side markup interpolation** (a
`${ cond ? <markup> : "" }` conditional in a `<match>` arm body) to a call to the runtime helper
`_scrml_structural_eq(...)`. The **call is emitted into `*.client.js`**, but `_scrml_structural_eq` is
**not added to the client runtime bundle's inclusion set**, so the tree-shaker drops it. At runtime the
client throws `ReferenceError: _scrml_structural_eq is not defined` on the first reactive re-dispatch of
that match arm.

The helper itself exists — `compiler/src/runtime-template.js:3353` `function _scrml_structural_eq(a, b, seen)`.
The bug is purely that a client-emit `==`-lowering call site does not **seed** it into the per-page runtime
tree-shake root set.

## Reproducer (standalone — NOT giti-serve-specific)

`bun run compiler/src/cli.js compile <giti>/ui/status.scrml -o /tmp/out` — a plain single-file compile at
HEAD reproduces it:

- `out/status.client.js` calls `_scrml_structural_eq` twice (from `${ d.scope == "empty" && … ? … : "" }`
  and `${ d.scope == "mixed" ? … : "" }`):
  ```js
  // status.client.js:48
  _scrml_render_value(el, _scrml_structural_eq(d.scope, "empty") && (d.conflicts.length === 0) ? (…) : "");
  // status.client.js:289
  _scrml_render_value(el, _scrml_structural_eq(d.scope, "mixed") ? (…) : "");
  ```
- `status.client.js` imports `scrml-runtime.0051gni1.js`; that bundle has **0** definitions of
  `_scrml_structural_eq`. → dangling reference.

Runtime symptom (headless-browser paint over `giti serve`):
```
scrml subscriber error: ReferenceError: _scrml_structural_eq is not defined
  at _scrml_match_match_112_wire_Loaded (status.client.js:48:27)
  at __scrml_match_match_112_dispatch (status.client.js:606:39)
  at _scrml_reactive_set (scrml-runtime.*.js:371:13)
```
The page still paints (the throw is swallowed by the subscriber-error handler), but every reactive update to
the matched cell throws.

## Diagnostic differential (this is the useful part — where to look)

A **near-identical minimal repro does NOT reproduce it**:
```scrml
<Loaded(d)>
  ${ d.scope == "empty" && (d.conflicts.length === 0) ? <p class="muted">all clear</p> : "" }
</Loaded>
```
Compiled standalone, this page's `client.js` also calls `_scrml_structural_eq` (1×) — **but its runtime
bundle (`scrml-runtime.00e7juzi.js`) DOES include the def.** Same `==`-in-match-markup shape, opposite outcome.

Inference: `_scrml_structural_eq` is included in the runtime bundle **only when it is transitively reachable
from some *other* kept runtime helper**, not when it is referenced from the emitted `*.client.js`. i.e. the
client-emit `==`→`_scrml_structural_eq` lowering **does not add the helper to the tree-shake root/seed set**.
In the minimal page, another retained helper happens to pull `_scrml_structural_eq` in; in `status.scrml`
(richer page — 3 matches, multiple `<each>`, `==` in two arm interpolations) that transitive edge is absent,
so it drops. The fix is to seed every runtime helper the client-emit *references* into the inclusion set (or,
narrowly: register `_scrml_structural_eq` as a dependency wherever the `==`→structural-eq lowering emits it).

## Impact on giti

- Surfaced by giti's browser-paint gate after migrating all 7 UI pages off the now-banned `await`
  (`E-AWAIT-NOT-IN-SCRML`) — all 7 now compile + 6 paint clean; `status` paints but logs this on every
  reactive update. (feed is 7/7 with a separate SSE note.)
- Only `status` hits it in giti's UI (its `Loaded` arm is the one with `==` in a markup interpolation).
- Per giti policy (don't contort source around a compiler bug): **idiomatic source retained** — `status.scrml`
  keeps `${ d.scope == "empty" ? … }`. No giti-side workaround applied. Will re-verify + drop this note when a
  fix lands.

— giti PA (S18)
