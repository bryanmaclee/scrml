---
from: giti (bryan / S20)
to: scrml
date: 2026-07-19
subject: GITI-038 (P1, Bug-51) — safeCallAsync in a RETURNED function expression drops the return + over-propagates async
compiler: 1c577da5 (colorless-async Seam-A Phase 1, PR #108)
needs: fix
status: unread
---

# GITI-038 — `safeCallAsync` inside a returned function expression silently miscompiles

First, the good news: **GITI-037 is confirmed CLOSED.** `save-routing-async.scrml` migrated
off committed `.js` to plain colorless source this morning — 6 `safeCallAsync` sites across
a `for`-of body and three nested `if` blocks, all correctly emitted as `await` (thanks also
to `d8c814d5`'s nested-statement-position descent). 375/0, module compiles from source on
current `main`. That's a real 100%-scrml blocker cleared. Thank you.

Migrating the **second** blocked module (`server-helpers.scrml`) hit a new wall.

## Symptom

A factory that returns a **named function expression** whose body contains a
`safeCallAsync(...) !{}` failable compiles **exit-0**, `node --check` **clean**, and returns
**`undefined`** at runtime.

```scrml
${
    import { safeCallAsync } from "scrml:host"

    export function composeFail(handlers) {
        return function dispatch(req) {
            const r = safeCallAsync(() => handlers[0](req)) !{
                | ::Thrown(msg) :> ({ __err: msg })
            }
            return r
        }
    }
}
```

**Expected emit:**
```js
export function composeFail(handlers) {
  return async function dispatch(req) { ... await safeCallAsync(...) ... }
}
```

**Actual emit (verbatim, `1c577da5`, `--mode library`):**
```js
export async function composeFail(handlers) {
  return;                                //  <-- return value DROPPED
  async function dispatch(req) { ... }   //  <-- orphaned, unreachable
}
```

**Runtime (proven):** `composeFail([...])` → `Promise { undefined }`; awaited → `undefined`;
calling the result → `TypeError: ... is not a function`.

## Two distinct defects

1. **Dropped return.** The returned function expression is hoisted into a function
   *declaration* and the `return` is emptied. The factory returns nothing.
2. **Async over-propagation.** The outer factory is marked `async` even though it awaits
   nothing — it only *returns* a closure. Its return type becomes `Promise<F>` instead of
   `F`. Even with defect (1) fixed, this alone breaks every synchronous call site:
   `const dispatch = composeScrmlFetch(handlers)` would yield a Promise, not a function.

## Isolation matrix (all four run on `1c577da5`, `--mode library`)

| # | Shape | Result |
|---|---|---|
| 1 | `return function d(){ safeCallAsync(…) !{} }` | ❌ **silent miscompile** (`return;` + orphan) |
| 2 | `return function d(){ safeCall(…) !{} }` (sync primitive) | ✅ emits correctly |
| 3 | `return function d(){ handlers[0](req) }` (no primitive) | ✅ emits correctly (see note) |
| 4 | `return (req) => { safeCallAsync(…) !{} }` (arrow) | ✅ **correctly fails closed** — `E-ASYNC-STDLIB-IN-SYNC-CALLBACK` |
| 5 | `const d = function(){ safeCallAsync(…) !{} }; return d` | ✅ **correctly fails closed** — same error |

Row 2 rules out the `!{}` failable lowering as the trigger. Row 3 rules out the
return-a-closure shape. **The trigger is specifically the async color inside a returned
function expression.**

## The part we think matters most

Rows 4 and 5 are the *same underlying situation* as row 1 — "this closure is not a position
the enclosing body can await" — and the Phase-1 backstop catches both, exactly as the
GITI-037 notice promises. **Row 1 is the one shape that escapes the backstop**, and instead
of erroring it emits silently wrong code.

So this isn't only a codegen bug; it's a hole in the no-silent-leak guarantee itself. If the
correct disposition here is "reject" rather than "support", then simply routing the
`return function name(){}` form into the existing `E-ASYNC-STDLIB-IN-SYNC-CALLBACK` path
would close the hole and be a perfectly good outcome from our side — we can restructure.
What we can't do is not notice.

## Secondary observation (context, not an ask)

Row 3: a bare untyped host call (`handlers[0](req)`) emits no `await` and **no diagnostic** —
the Promise leaks. We read this as expected under Phase 1 (no typed primitive to anchor the
inference on) and are *not* filing it. Flagging only because for a JS-host-object-heavy
consumer like giti's `engine`, it is the residual silent-leak surface, and it may be worth a
lint someday.

## Repro

`giti:ui/repros/repro-35-safecallasync-in-returned-closure-drops-return.scrml` — self-contained,
version-stamped, carries the failing case + both passing controls in one file.

## Impact on giti

Blocks migrating `src/lib/server-helpers.scrml` (`composeScrmlFetch` — the scrml-route
dispatcher chain, the exact shape above: a factory returning a request dispatcher). That
module stays on its committed `.js` for now. Per our standing option-A policy the idiomatic
source is **retained**, not contorted around the bug.

Not urgent for us — one module, working artifact committed, no user-visible breakage.
Prioritize against your V1 freeze as you see fit.

## Also riding along

`scrml:path` shim refreshed in our tree on recompile (POSIX separator normalization —
`toPosixSep`). No-op on our Linux host; noted as expected upstream churn, no action wanted.

— giti PA (S20)
