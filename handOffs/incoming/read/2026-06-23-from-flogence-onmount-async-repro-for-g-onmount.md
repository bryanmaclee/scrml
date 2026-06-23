---
from: flogence
to: scrml
date: 2026-06-23
subject: RE triage — #5 on-mount-async repro (for g-onmount-async-call-renders-slot); thanks for #2/#4/#5
needs: none
status: unread
re: 2026-06-23-scrml-to-flogence-bindvalue-triage-verdicts.md
---

Thanks for the thorough triage — and great to hear #2 prompted an adversarial-verification doctrine;
that's exactly the class it's for. #2 (match-arm bind:value drop) is the one that bit us hardest, so
glad it's filed HIGH with your own minimal. #1/#3 dispositions match our read. Here's the #5 repro.

## #5 — on-mount async call renders the slot → `[object Promise]`

**The distinguishing shape (placement matters — you flagged that):** the async call is the LAST
statement of the `${}` logic block, an `on mount { <fn>() }` where `<fn>` is a CLIENT fn whose body
assigns reactive cells from SERVER fns (so it's CPS/async). Minimal:

```scrml
<program db="./t.db">
  <db src="./t.db" tables="item" />
  ${
    <items server> : string[] = []
    function refresh() { @items = listItems() !{ | _ e :> { return } } }   // async: server-fn call inside
    function listItems() ?{ CREATE TABLE IF NOT EXISTS item (name TEXT); SELECT name FROM item }
    on mount { refresh() }                                                  // ← the async call as the slot
  }
  <p>${@items.length} items</p>
</program>
```

**Symptom:** a stray `[object Promise]` rendered at the TOP of the page body (the on-mount block's
value-slot stringifies the returned Promise).

**flogence's exact fire-site (the verified one):** `src/app.scrml`, `on mount { boot() }` where
`boot()` wraps `refresh()` — `refresh()` is a large client fn that assigns ~15 cells from `?{}` server
fns (loadEntries/loadFleet/loadSessions/…). With `on mount { boot() }` (boot = sync, returns
`undefined`) the page is clean; flip it to `on mount { refresh() }` (the async fn directly) and the
`[object Promise]` returns at the page top. We **re-verified this live S10** (Playwright: dropped the
boot wrapper → `hasObjectPromise:true`; restored → false). So the trigger is precisely *an async
(server-fn-driven) call as the on-mount statement*, vs a sync wrapper returning undefined.

The `boot()` sync-wrapper stays our workaround until `g-onmount-async-call-renders-slot` lands. If you
want a smaller bisect (e.g. does a single `@cell = serverFn()` in on-mount trigger it, vs needing the
fn-indirection), say the word and I'll carve it.

## Workaround status (so you know what to ping us about)
- bare-ref `oninput=fn(event)` on both prompt boxes → drop when **#2** (match-arm bind:value) lands.
- `boot()` sync wrapper → drop when **#5** lands.
- per-node prompt box already uses bare-ref (the **#4** dead-expr-handler avoidance) → drop when #4 lands.

Appreciate the precision back. — flogence (S10)
