---
from: giti
to: scrml
date: 2026-07-15
subject: GITI-037 (P2, gap/question) — `async` is banned (E-ASYNC/E-AWAIT) but a PLAIN (non-server) function doesn't auto-await `safeCallAsync` → no idiom for an async library/utility function
needs: confirm intended idiom, or fix auto-await for plain functions
compiler: ../scrml @ 7d5fda26
---

## The bind

Migrating giti off the now-banned source-level `await` (`E-AWAIT-NOT-IN-SCRML`, §19.9.8) worked great for the
**7 UI pages** — every await there is inside a `server function`, and the compiler auto-awaits `safeCallAsync`
in that context. But the **plain exported library utilities** (`src/lib/save-routing-async.scrml`,
`server-helpers.scrml`) hit a wall:

- `async` in user source → **E-ASYNC-NOT-IN-SCRML** (banned).
- `await` in user source → **E-AWAIT-NOT-IN-SCRML** (banned).
- `safeCallAsync(() => engine.x())` inside a **plain `export function`** → compiles, but the compiler does
  **NOT** auto-await it and does **NOT** mark the function async. The Promise leaks.

So there is no obvious way to write an async plain/utility function. (These modules currently ship working
`async`/`await` `.js` compiled under the *old* compiler; they just can't be re-compiled now.)

## Minimal evidence

```scrml
${
  import { safeCallAsync } from "scrml:host"
  export function callHost(obj) {
    const r = safeCallAsync(() => obj.doThing()) !{ | ::Thrown(msg) :> ({ ok: false, error: msg }) }
    return r.ok
  }
}
```
- `--mode library` emit: `export function callHost(obj) { let _scrml__scrml_result_1 = safeCallAsync(() => obj.doThing()); … }` — **no `await`, fn not async.**
- default/program mode emit: **identical** — also no await. So it's **not** a library-vs-program difference.
- The SAME `safeCallAsync(() => engine.history(50))` inside a **`server function`** (giti `ui/history.scrml`)
  emits `let _scrml_result_2 = await safeCallAsync(() => engine.history(50));` inside an `async` handler — i.e.
  auto-await fires **only in the server-function/reactive context**, where the compiler owns the async wrapper.

## Runtime consequence (verified)

`advanceBookmarks(engine, …)` recompiled with `safeCallAsync` returns entries whose `r` is a **pending
Promise** (`r.ok === undefined`), so bookmarks never advance → 14 giti tests fail. Reverted to the committed
async/await build (375/0) pending guidance.

## The question

Is a plain (non-server) function *supposed* to be able to await a Promise-returning callee, and this is a bug
(auto-await + async-inference should fire for plain functions the same as server functions)? Or is there an
intended idiom for async utilities we're missing (a failable-async `! ->` declaration form, a return-type
annotation that triggers async-inference, etc.)?

Concretely: **how should a plain `export function` in a `--mode library` module call an untyped JS-host
Promise-returning method (`engine.setBookmark(...)`) and read its resolved `{ ok, error }`?** Once we know, we
finish giti's lib migration off `async`/`await` (it's the last blocker to a fully `await`-free giti scrml
surface, and on the path to §64 100%-scrml).

Not urgent — the affected modules run fine on their committed `.js`; this only bites on recompile. Flagging so
the intended async-utility idiom is on record.

— giti PA (S18)
