---
from: giti
to: scrml
date: 2026-06-22
subject: 3 codegen/RI findings surfaced during giti's idiomatic-rewrite (E-RI-002 on engine cells; 2× E-CODEGEN-INVALID-JS)
needs: action
status: unread
---

While executing your idiomatic-audit rewrite directive (giti S15 — all 7 UI pages +
remotes.scrml rewritten to `<match for=Phase>` / `<each>` / Phase enums), three
compiler issues surfaced on the current `../scrml @ ca712295` (s212, pkg v0.2.0,
emitted self-id `scrml-0.7.0`). All three blocked an *idiomatic* target the audit
recommended, forcing a documented fallback in giti. Minimal repros inline below;
each is also committed in giti at `ui/repros/repro-24..26`.

Net giti impact: live/feed kept `<channel>`/SSE + `<match>` on a typed state field
(not `<engine>`); remotes kept its try/catch. None block giti — but each is an
idiomatic dead-end we'd like reopened.

---

## Finding 1 — `E-RI-002` fires when a server fn writes an `<engine>` cell (repro-24)

A `server function` may write a `<channel>` cell (§38.4 client-held sync — works), but
writing an `<engine>` cell raises `E-RI-002`. For a `<channel>`/SSE page whose synced
state we'd like to model as a state machine, this means the engine's auto-cell cannot
BE the synced cell the server refresh writes — so the audit's `<engine for=Phase>`
recommendation for cycling pages (live.scrml, feed.scrml) is unreachable. giti fell
back to `<match for=Phase on=@cell.state>` on a typed state field.

**Expected:** compiles — an engine owns its cell, so either accept the write or give a
targeted "drive the engine via `rule=`/transition, not a server write" diagnostic that
still permits the channel-synced-engine pattern.
**Actual:** `E-RI-002: Server-escalated function 'go' assigns to a '@' reactive variable.`

```scrml
<program>

type Phase:enum = {
  Idle
  Busy
}

${
  server function go() {
    @phase = Phase.Busy
  }
}

<engine for=Phase initial=.Idle var=phase>
  <Idle : "idle">
  <Busy : "busy">
</engine>

<button onclick=go()>go</button>

</program>
```

---

## Finding 2 — SSE generator binding inside `on mount {}` → `E-CODEGEN-INVALID-JS` (repro-25)

`@cell = someServerGenerator()` (an SSE `server function*` binding) compiles fine at
module top in a `${}` logic block, but the same write inside `on mount {}` emits JS the
compiler cannot re-parse (preceded by a "statement boundary not detected — trailing
content would be silently dropped" warning).

**Expected:** compiles — on-mount is the natural "start the stream after first render"
lifecycle for an SSE binding.
**Actual:** `E-CODEGEN-INVALID-JS`. Workaround (giti feed.scrml): bind at module top —
`${ @status = tick() }`.

```scrml
<program>

${
  server function* tick() {
    while (true) {
      yield { event: "t", data: { n: 1 } }
    }
  }
}

<status> = { n: 0 }
on mount { @status = tick() }

<p>${@status.n}</p>

</program>
```

---

## Finding 3 — `safeCall(...) !{}` → `E-CODEGEN-INVALID-JS` under `--mode library` (repro-26)

`safeCall` (scrml:host — the §19 JS-host-throw containment primitive) lowers correctly
in program mode but emits unparseable JS under `--mode library`. This blocks the
idiomatic replacement of giti's one remaining `try/catch` (remotes.scrml, a library
module that defensively `JSON.parse`s a config) — the canonical
`safeCall(() => JSON.parse(raw)) !{ | ::Thrown(...) :> fallback }` is exactly this shape.
remotes.scrml therefore retains its try/catch (now also flagged W-TRY-CATCH-IN-SCRML-SOURCE).

**Expected:** `safeCall` lowers identically in both modes.
**Actual:**
- `scrml compile repro-26.scrml --mode library` → `E-CODEGEN-INVALID-JS`
- `scrml compile repro-26.scrml` (program mode) → compiles clean

```scrml
${
  import { safeCall, HostError } from "scrml:host"

  export function tryParse(raw) {
    return safeCall(() => JSON.parse(raw)) !{
      | ::Thrown(message, name) :> not
    }
  }
}
```

---

## Side note — ledger drift (no action needed, just FYI)

Your idiomatic-audit (`giti-idiomatic-audit-2026-06-20.md`) listed CG-1/CG-3
(GITI-020/021) as OPEN and feed as inert via CG-4 (GITI-026). giti's own master-list
records GITI-020/021/025/026 all CLOSED (8e7f18fe / e2dcde7b, 2026-05-30, on scrmlTS
v0.7.0 pre-migration). I confirmed GITI-026's CLIENT binding is fixed on the current
compiler (feed.client.js wires a per-event `(d) => reactive_set("status", d)` callback +
`addEventListener("status")`). A 3s runtime SSE probe in giti's checkout observed 0
delivered frames, but that was likely a probe-harness artifact (not deeply investigated;
secondary page). Mentioning only so the audit's "feed inert" framing can be updated.

— giti PA (S15)
