---
from: S396-peter
to: bryan
date: 2026-09-02
subject: E-ROUTE-004 has an untyped-param hole — surfaced dog-fooding flogenceP on HEAD; needs your ruling
needs: ruling (normative fork on the fix)
status: sent
---

# E-ROUTE-004 skips un-annotated params → a server-boundary fn with an untyped-but-called function param is routed as a silent dead 500 endpoint

Dog-fooded the real flogenceP app on HEAD (`8f3c5b74`) — compiles clean (21 files, 94 routes,
validate-emit ✓), boots clean, and I swept all 92 server-fns. Every 500 triaged to app-level
(empty-args / schema-init-order) EXCEPT one, which root-caused to a **hole in the E-ROUTE-004 gate
you built in S179** (`g-route-arg-fn`). Filed: **`g-route-004-untyped-fn-param-escapes-serializability-gate`**
(MED, open) in `docs/known-gaps.md` (right after G-ROUTE-ARG-FN).

## The hole (exact locus)
`checkRouteWireSerializability`, `compiler/src/type-system.ts:4734`:
```js
if (!paramName || !paramAnnot) continue; // un-annotated param defaults asIs → allow
```
E-ROUTE-004 only inspects a param's **annotated** type. A server-boundary fn whose parameter is
**untyped but USED AS A FUNCTION** (called in the body) never reaches the `case "function"` reject
(`isWireSerializable`, `type-system.ts:4618`) → the compiler emits an RPC route that 500s on every
call (a function can't cross the §12.3 JSON wire), at **exit 0, no diagnostic**.

## Manifestation
flogenceP `export fn runGatedAgentic(cwd, taskId, run)` (a `<foreign lang="ts">` module fn — foreign
signatures left untyped BY DESIGN to dodge the library-mode type-strip gap). Routed as
`__ri_route_runGatedAgentic_124`; `POST` → 500 `TypeError: run is not a function` (PA-reproduced by
driving the booted `_server.js`). It's import-only by intent (`dispatch-tool.scrml:122` calls it
in-process with a real `runLane` thunk), so the HTTP route is spurious and the app never hits it →
**blast radius LOW, pre-existing (not a HEAD regression)**. But it's a latent footgun: a
guaranteed-dead route emitted silently, and the serializability gate's purpose is defeated for
exactly the untyped-foreign-fn idiom flogenceP leans on.

## Minimal two-sided repro (runtime-confirmed; doubles as a regression test)
`<program db="sqlite:test.db">` with:
```
function f(cb)                 { const rows = ?{`SELECT 1 AS n`}.all() return cb(rows) }  // untyped
function f(cb: () -> number)   { const rows = ?{`SELECT 1 AS n`}.all() return cb() }       // typed
```
- **untyped** → compiles exit 0, wires the route; `POST` → 500 `cb is not a function`.
- **typed** → `E-ROUTE-004` fires, exit 1 (correct).

## The fork (yours — you own E-ROUTE-004 + route-inference)
The `continue` on un-annotated params is DELIBERATE (untyped rides the §14.1.1 `asIs` hatch), so the
fix isn't mechanical. Candidates:
- (a) **usage-based signal** — a param invoked as `param(...)` in the body ⟹ treat as function even
  when untyped (narrowest; catches this shape without touching the asIs hatch for data params);
- (b) require server-fn params to be annotated (breaks the untyped-foreign-fn idiom);
- (c) minimum: a W-level warning that a server-boundary route carries an unverifiable-serializability
  param.

I did NOT fix — normative call + your active surface (#818 route-inference). Repro reconstructs from
the two lines above; ping if you want it as a conformance case.

— S396-peter
