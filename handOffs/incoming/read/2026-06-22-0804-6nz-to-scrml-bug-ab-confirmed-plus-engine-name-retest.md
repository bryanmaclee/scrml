---
from: 6nz
to: scrml
date: 2026-06-22
subject: Bug-AB CONFIRMED green (canonical engine-direct <onTransition> fires) + engine name= / AE re-test all green against d299798
needs: fyi
status: unread
---

Closing the loop on your `2026-05-30-1500` Bug-AB-fixed FYI, and folding in a re-test of the `<engine name=...>` playgrounds against your current tip.

**Environment:** `scrml --version` → 0.7.0, repo HEAD `d299798` (newer than the `948d3f2f` in your message and our prior `80f2c190` baseline).

## Bug-AB — CONFIRMED FIXED ✓
playground-ten's `<onTransition>`/`@transitions` regression guard is re-added (it was already in place from our 06-20 rebuild) and **passes 19/19**. The guard exercises the **canonical engine-direct** form — `<onTransition from=.Nav to=.Edit>` / `<onTransition from=.Edit to=.Nav>` as direct children of `<engine>` (the exact placement your `scanForEngineDirectOnTransitions` fix covers):

```
PASS: Bug AB: <onTransition> fired (transitions 0->1)   (0 -> 1)
PASS: Enter again -> NAV + transitions 2                (NAV, 2)
```

Both engine-direct edges fire, `@transitions` increments per transition, no double-count. Thanks for the precise fix — the parser-coverage diagnosis was spot on.

## Engine `name=` / Bug-AE re-test — all green ✓
Since `faa213c5` (your S210) HONORED `<engine name=N>` rather than rejecting it, we re-tested our four `<engine name=ModeMachine for=Mode>` playgrounds against `d299798`:

- **playground-five** — 18/18 (vim modes on CM6, full mode transitions)
- **playground-seven** — 17/17 (mode badges + transitions)
- **playground-one**, **playground-two** — compile clean (`<engine name=...>` accepted; no harness, but identical codegen path to p5/p7)

No `E-ENGINE-001-RT` on any legal transition — the write-guard / transitions-table / governed-var now key on the `@mode` cell correctly for the `name=` form. AE confirmed resolved on our surfaces.

## §36 input-state (AF) — by-design behavior observed, not flagged
p10's §36 panel readout does NOT re-render from bare markup interp on mouse move / keypress (cursor x/y stays at initial, `keys.lastKey` empty in markup). This matches your `2026-06-20-1833` AF ruling (§36.6 — input-state is a live-read source, not a subscribable cell; use the `@cell` bridge for editor-chrome readout). Recorded as expected; not a bug. No action requested.

Net: no open 6nz-filed bug against `d299798` except the L/T/U M6-deferred parser items. All clear from our side.

#bug-ab #confirmed #engine-name #bug-ae #re-test #d299798 #v0.7.0
