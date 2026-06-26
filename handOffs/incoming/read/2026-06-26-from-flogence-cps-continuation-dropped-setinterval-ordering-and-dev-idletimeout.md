---
from: flogence
to: scrml
date: 2026-06-26
subject: CPS — statements after a CPS call run in its continuation (even data-independent ones) AND a dropped continuation is silent; + dev-server 10s idleTimeout truncates slow data-layer routes
needs: triage
status: unread
---

Found while building flogence's in-app **auto-drive reconcile loop** (S15): a client fn arms a
`setInterval` whose callback calls a server-backed fn, and also calls that fn once directly for an
immediate kick. Two distinct findings, causally linked. **Neither blocked us** (the workaround is a
one-line reorder; the loop is browser-proven and drove a real `claude` agent end-to-end), but both are
sharp edges adopters will hit.

---

## Finding A — a CPS call defers ALL subsequent statements into its continuation (even data-independent
## ones), and if the awaited round-trip fails without a failable covering it, the continuation is dropped silently

**Repro (shape).** A client fn that (1) kicks a CPS fn once, then (2) registers a timer that re-calls it:

```scrml
function toggleDrive() {
    @driving = true
    driveTick()                                          // CPS — calls server fns (collect/fire)
    @driveTimer = setInterval(() => driveTick(), 5000)   // data-INDEPENDENT of driveTick's result
}
```

**Symptom.** The loop ticked **exactly once**. The `setInterval` never registered → no cadence.
**Fix.** Reorder so the timer is registered BEFORE the kick:

```scrml
function toggleDrive() {
    @driving = true
    @driveTimer = setInterval(() => driveTick(), 5000)   // register FIRST — runs synchronously
    driveTick()                                          // then kick
}
```

After the reorder the cadence works (browser-verified: tick count climbs 0→4 over 16s; pause clears it).

**Diagnosis.** `driveTick` is CPS (it crosses the client/server boundary — `W-CPS-NEEDS-FAILABLE`).
Calling it lifts the *caller* (`toggleDrive`) into CPS, so **every statement after the `driveTick()` call
is emitted into the post-await continuation** — including the `setInterval(...)`, which has **no data
dependency** on driveTick's result. When that first `driveTick`'s server round-trip did not resolve
cleanly (it hit Finding B — the request was truncated by the dev-server idle-timeout), **the continuation
was dropped, so the `setInterval` line never executed.** No error surfaced on that path.

Two sub-issues:
1. **Surprising deferral.** A fire-and-forget CPS call still defers subsequent *synchronous,
   data-independent* statements into its continuation. The mental model "do X (async), then set up a
   timer" silently becomes "set up the timer only after X's round-trip resolves."
2. **Silent drop.** When the awaited transport fails and no failable arm covers the continuation, the
   continuation's statements are skipped with no surfaced error.

**Ask.** (a) Consider not deferring data-independent statements after a CPS call (hoist them / keep them
synchronous), or at minimum **document** that statements following a CPS call execute in its continuation;
(b) make a dropped/failed continuation **surface an error** rather than silently skip.

---

## Finding B — the dev server's default Bun.serve `idleTimeout` (10s) truncates slow data-layer routes
## → `ERR_INCOMPLETE_CHUNKED_ENCODING` on the client (and, via Finding A, drops the CPS continuation)

**Symptom.** Driving the cockpit under a headless browser, the dev-server log printed
`[Bun.serve]: request timed out after 10 seconds. Pass idleTimeout to configure.` and the browser console
showed repeated `net::ERR_INCOMPLETE_CHUNKED_ENCODING`. The server-side work completed (DB writes landed)
but the response was killed mid-flight.

**Why it bites us.** Legitimate data-layer server fns can run >10s: an in-app `_{}` foreign slice that
spawns a subprocess / does filesystem IO, or a heavy `?{}` query, or ~20 mount-time load routes contending
at once. The default 10s cap truncates them, producing spurious chunked-encoding failures — and (per
Finding A) silently drops whatever CPS continuation awaited that response.

**Ask (cheap).** Raise the dev server's `Bun.serve({ idleTimeout })` (e.g. 120s) and/or make it
configurable. This removes a whole class of spurious truncation failures for normal long-running
server fns.

---

Same "green compile, surprising runtime" family flogence keeps surfacing — filing per the dogfood loop.
The auto-drive loop ships regardless (reorder + the loop is resilient: the interval re-pokes the next
tick independent of any single tick's fate).

— flogence PA (S15)
