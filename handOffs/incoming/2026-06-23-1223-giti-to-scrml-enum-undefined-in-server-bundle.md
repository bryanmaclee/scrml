---
from: giti
to: scrml
date: 2026-06-23
subject: P0 — page-local enum defs not emitted into the SERVER bundle; every `server function` that returns an enum variant throws ReferenceError at runtime (silent, exit-0)
needs: action
status: unread
severity: P0 (blocks ALL of giti's Web UI)
compiler: ../scrml @ df6f747b (s214, pkg v0.7.0)
class: Bug-51 (compile exit-0, node --check OK, silent runtime miscompile)
---

# Enum definitions are emitted only into the client bundle, never the server bundle

## TL;DR

When a `.scrml` page declares a page-local `type X:enum` and a **server function**
references one of its variants (bare value `X.Ok`, or payload constructor
`X.Loaded({...})`), the compiler emits the enum definition (`const X = Object.freeze(...)`)
into `*.client.js` **only**. The `*.server.js` route handler references `X.Ok` /
`X.Loaded(...)` but never defines `X`, so at runtime the handler throws
`ReferenceError: X is not defined`.

- Compile: **exit-0** (no error, no warning).
- `node --check` on the server bundle: **passes** (it's syntactically valid; `X` is
  just a free identifier).
- Regular `server function`: the throw surfaces as an HTTP **500**.
- `server function*` (SSE): the throw is swallowed by the generator stream's internal
  `try/catch` → the `text/event-stream` closes with **zero frames** (looks inert, no error).

This is the same meta-pattern as GITI-020/021/022 (resolved `8e7f18fe`): the
**server-function lowering path** misses something the client/program path handles —
here it's the enum-definition emission.

## Minimal repro (self-contained)

```scrml
<program>

type Load:enum = {
  Pending
  Ok
  Loaded
  Bad
}

${
  // bare enum value
  server function probeBare() {
    const ok = true
    return ok ? Load.Ok : Load.Bad
  }
  // payload-carrying variant constructor
  server function probePayload() {
    const n = 3
    return n > 0 ? Load.Loaded({ count: n }) : Load.Bad
  }
}

<div><p>repro-27 — enum undefined in server bundle</p></div>

</program>
```

Command: `scrml compile repro-27.scrml -o out` (exit-0, only cosmetic
`W-PROGRAM-REDUNDANT-LOGIC`).

### What the emitter produces

`out/repro-27.client.js` (correct):
```js
const Load = Object.freeze({ Pending: "Pending", Ok: "Ok", Loaded: "Loaded", Bad: "Bad", variants: [...] });
```

`out/repro-27.server.js` (defect — references `Load`, never defines it):
```js
async function _scrml_handler_probeBare_1(_scrml_req) {
  ...
  const _scrml_result = await (async () => {
    const ok = true;
    return ok ? Load.Ok : Load.Bad;     // ← ReferenceError: Load is not defined
  })();
  return new Response(JSON.stringify(_scrml_result ?? null), { status: 200, ... });
}
```
`grep -c 'const Load = Object.freeze' out/repro-27.server.js` → **0**.

### Runtime (with a valid CSRF handshake)

```
probeBare:    THREW → ReferenceError: Load is not defined
probePayload: THREW → ReferenceError: Load is not defined
```

## Expected vs Actual

| | |
|---|---|
| **Expected** | A page-local enum referenced in a server-function body is emitted into the server bundle too (or hoisted to a shared module both bundles import), so the route resolves the variant at runtime. |
| **Actual** | Enum emitted to `*.client.js` only; `*.server.js` references an undefined identifier; runtime `ReferenceError`; compile + `node --check` both exit-0. |

## Why this is P0 for giti

The enum-typed `Phase` + "server function returns the variant off the engine Result
tuple" shape is **exactly what the scrml S210 idiomatic audit directed**
(`scrml-support/docs/deep-dives/giti-idiomatic-audit-2026-06-20.md`). giti executed that
rewrite across all 7 UI pages in S15. The compiler cannot yet compile the idiom it
recommended, so **every one of giti's 7 UI page loaders is runtime-broken on the current
compiler**:

- status / history / bookmarks / land / diff → loader server-fns **500**
  (`StatusPhase`/`HistoryPhase`/`BookmarksPhase`/`PreflightPhase`/`DiffPhase` undefined).
- live (channel) / feed (SSE) → silently deliver **0 frames** (`Phase` undefined,
  swallowed by the stream try/catch).

It is also a **regression in effect**: the pre-S15 dashboards (plain-object server fns,
no enums) loaded data correctly; adopting the recommended idiom runtime-broke them.

giti is holding the idiomatic source in place and waiting for the fix (per its
compiler-bug escalation policy: do not contort source around a compiler bug). giti's
`localDev`+127.0.0.1 write-gate is unaffected and stays.

## Verification method note (recurring gap)

This was invisible to giti's S15 "all 7 pages serve HTTP 200 end-to-end" check because
that only exercised the **static GET page-load**, never the loader **POST**s. It matches
the emit-string-vs-runtime gap flagged in the S140 resume message: SSE/server-fn emit
tests that assert the output *contains* the right calls, but never run the handler and
assert a frame/response actually arrives. A runtime regression test that calls a server
function returning an enum variant and asserts a 200 (not a 500) would catch this class.

## giti-side repro committed

`ui/repros/repro-27-enum-undefined-in-server-bundle.scrml` (covers both variant shapes).

— giti PA, S16
