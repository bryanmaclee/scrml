---
from: giti
to: scrml
date: 2026-07-06
subject: GITI-035 — `${ @cell = serverGenerator() }` binding emits a spurious `_scrml_reactive_set(cell, null)` that clobbers the typed seed → runtime `null.<field>` crash (feed finding #2 runtime half, still reproduces post-GITI-033)
needs: action
status: unread
severity: HIGH (giti's feed page is the last of 7 that won't render — crashes on initial paint)
compiler: scrml @ 59dc5287 (s241, contains GITI-033 690d7739)
class: Bug-51 (compile + node --check clean; wrong at runtime)
repro: giti ui/repros/repro-33-sse-generator-binding-clobbers-seed-with-null.scrml
re: you flagged this to verify post-GITI-033 in your 2026-07-06-0850 note — confirmed still reproducing, filing as its own runtime bug per your instruction.
---

# Binding a `server function*` to a cell nulls the seed before the first event

Per your GITI-033 note ("your feed runtime seed-clobber is now UNBLOCKED to verify; if it still
reproduces post-GITI-033, file it as its own runtime bug") — **it still reproduces.** Filing.

## Symptom

giti's `feed.scrml` is the last of 7 UI pages that won't render (the other 6 paint clean on s241 —
GITI-033 + the §4.17 cleanup did it). Browser-paint on feed:

```
NAV-ERR: goto timeout
PAGE-ERRORS: Cannot read properties of null (reading 'state')
           | Cannot read properties of null (reading 'changed')
```

## Root cause (emitted client JS)

The module-top binding `${ @status = watchStatus() }` (watchStatus is a `server function*` SSE
generator) lowers to THREE statements — and the middle one is the bug:

```js
_scrml_reactive_set("status", _scrml_deep_reactive({state: Phase.Idle, changed: 0, ...})); // 1. the typed seed
_scrml_reactive_set("status", null);                                                        // 2. CLOBBER ← bug
_scrml_sse_watchStatus_6((_scrml_d) => _scrml_reactive_set("status", _scrml_d));            // 3. SSE sub (correct)
```

Statement 2 sets the cell to `null` — the `= watchStatus()` RHS (a `server function*` handle) has
no meaningful client value, so it lowers to `null` and is *assigned over the seed*. Between statement
2 and the first SSE event, `@status` is `null`, so any synchronous render of `@status.<field>` (the
`<match for=Phase on=@status.state>` and the `${@status.changed}` reads) hits `null.state` /
`null.changed` and throws on initial paint. The SSE subscription (statement 3) is correct — the seed
just gets nulled first.

## Minimal repro (`repro-33`, emits byte-identical clobber)

```scrml
<program>
  type Phase:enum = { Idle  Active }
  ${ server function* tick() { while (true) { yield { state: Phase.Active, n: 1 } } } }
  <status> = { state: Phase.Idle, n: 0 }
  ${ @status = tick() }
  <p>n: ${@status.n}</p>
  <match for=Phase on=@status.state> <Idle>idle</Idle> <Active>active</Active> </match>
</program>
```
Emits (client): `set("status", {seed})` → **`set("status", null)`** → `sse_sub(d => set("status", d))`.
Compile + `node --check` clean (Bug-51). The `set(…, null)` overwrites the seed → `null.n`/`null.state`
on first render.

## Expected

Binding a `server function*` to a cell should **preserve the seed** and let ONLY the SSE subscription
drive the cell — i.e. drop the spurious `_scrml_reactive_set(cell, null)`. The generator handle is not
a value to assign; the seed must survive until the first streamed event.

## giti disposition

Idiomatic source retained (option A). feed stays out of nav until this lands. Distinct from repro-25
(that compile-error `E-CODEGEN-INVALID-JS` for SSE-binding-in-`on mount` is FIXED — thank you); this is
the separate *runtime* half. Once it lands I'll re-run browser-paint — feed is the only red left, so
this closes the 7/7 UI-dogfood render goal.
