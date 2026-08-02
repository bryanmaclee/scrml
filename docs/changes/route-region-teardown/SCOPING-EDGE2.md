# Edge 2 — route-enter re-association: SCOPING

**Status:** `scoping` — **forks open, nothing built.** Requested by bryan S314 ("scope edge 2").
**provenance:** `spec:` §20.8.8 step 3 + §20.8.8(6) · `ruling:` user-voice S313 (Pole C ratified) ·
`dd:` `scrml-support/docs/debates/soft-nav-outlet-lifecycle-model-2026-08-02.md`

> Companion to `SCOPING.md` (the leave edge, measured and reverted at S314-BUILD). Read that first for
> why the arc does not split at the leave/enter seam.

---

## 0. The governing sentences, quoted (Rule 4 gate)

**§20.8.8 step 3** — *"`route-enter` fires after §20.8.2 step 4 (Hydrate/Adopt) — specifically **after
SSR re-seed and after `each` re-materialisation** — and **before** step 5 (Transition) … **Bodies
associated with the region run in declaration order.**"*

**§20.8.8(6)** — *"**Initial load.** The first rendering of route content into the `<outlet>` on document
load **IS a `route-enter`**. Region-associated bodies therefore run **exactly once** on initial load —
never zero times, never twice."*

**§6.7.2.1** bullet 1 scopes "region-associated bodies" to: `${}` bare expressions · `on mount` ·
`<request>` · `<timer>` · `<poll>` · author `cleanup()`.

---

## 1. ⭐ The finding that reshapes this arc — declaration order is ALREADY violated, with no navigation

The build report framed declaration order as an Edge-2 requirement. **It is a live conformance gap
TODAY, at initial load, on a page that never navigates.** Established by compilation, not reading:

```scrml
<program>
  <request id="first" get="/api/a"/>              <!-- declared 1st -->
  <timer interval=1000>${ … }</timer>             <!-- declared 2nd -->
  <request id="third" get="/api/c"/>              <!-- declared 3rd -->
</program>
```

Emitted order in `order.client.js`: **the timer's `_scrml_timer_start` at :28, both requests' fetch
init at :34+.** The body declared SECOND runs before both bodies declared around it.

**Cause:** `emitReactiveWiring` emits **by bucket, not by source position** —
`emit-reactive-wiring.ts:849-900` runs five sequential passes (Step 5 lifecycle → 5b input-state →
5.5 channel → 5c request → …). Within a bucket the walk is source-ordered; **across** buckets, all
timers precede all requests regardless of authoring.

**Why this matters to the scoping:** §20.8.8(6) makes initial load a `route-enter`, so the ordering
clause binds a path that exists and ships today. That means **the ordering half is independently
true, independently fixable, and independently testable with zero navigation infrastructure.** It is
not Edge-2 work that happens to need ordering; it is a pre-existing defect Edge 2 would have
inherited.

---

## 2. Corrections to the S314-BUILD report

The build's measurements all held. Two of its *scoping* claims are too strong:

| claim | verdict |
|---|---|
| *"route identity has no runtime representation"* | **TOO STRONG.** `_scrml_nav_pathname` (`runtime-template.js:2643`) is initialised from `window.location.pathname` at boot and updated on every nav (`:2681`); `_scrml_nav_apply_html(html, path, …)` receives the path directly. The route half exists at BOTH edges. |
| *"one ordered registry … forcing emit-reactive-wiring + emit-client module-init + emit-logic cleanup-registration to funnel through it"* | **DIRECTIONALLY RIGHT, OVERSIZED.** True that the three emitters must agree on order. But §20.8.8(6) means module-init already IS the initial-load enter — so the shape is *name and register what already runs*, not *move it out*. |

**What IS genuinely absent (verified):** a chunk does not know **which route it owns**.
`_scrml_nav_missing_chunks(doc, path)` derives chunks from the *fetched document's* `script[src]`; no
route→chunk registration exists in the emitted output. The **compiler** knows the answer (filesystem
route inference, `route-inference.ts`) — it simply never emits it.

---

## 3. Decomposition — five units, not one monolith

**U1 — declaration order.** Replace the five bucket passes with one source-ordered pass over the
classified nodes. Pure emit-side reordering; no runtime change. **Independent of every other unit.**
Verifiable at initial load with no nav: assert emitted position matches source position.

**U2 — the region enter-body.** Wrap the region slice of module-init in a named function, register it,
and invoke it (a) at boot — which §20.8.8(6) says IS the initial enter — and (b) on route-enter.
**The precedent already exists and is the strongest argument for the shape:** `_scrml_nav_rewire` is
emitted at module-init, registered via `_scrml_register_rehydrator`
(`runtime-template.js:2629`), run at boot with `document`, and re-run scoped to the swapped region.
Extend that established pattern from *(non-delegable handlers + reactive display)* to *(region
lifecycle bodies)*. Depends on U1 for the ordering guarantee, U3 for the key.

**U3 — the region key.** Emit each chunk's owned route (the compiler knows it) and match against
`_scrml_nav_pathname` so a chunk can answer *"is this MY region entering?"*. Small emit addition +
a registry keyed by that value.

**U4 — the load/teardown ordering bug.** `_scrml_nav_load_chunks` executes the INCOMING chunk before
`_scrml_teardown_region`, so the outgoing drain kills the entering route's timer (S314-BUILD finding
(a), "dead on arrival"). Bounded: stage pushes while `_scrml_chunk_loading > 0`. **Prerequisite for
U0** — without it the predicate flip is self-defeating.

**U0 — the predicate flip.** Verified, ~3 lines. Deliberately last: landing it before U2 converts a
leak into staleness (the measured regression). Note `g-region-predicate-divergence-cells-vs-lifecycle`
— `collectShellCellNames` in the same file already uses the correct `<outlet>` OR `<page>` predicate,
so this is adopting the file's own answer, not inventing one.

---

## 4. Forks — bryan rules

**FORK 1 — does U1 land standalone, ahead of the arc?**
**Recommend YES.** It is a pre-existing §20.8.8 step-3 violation, provable and pinnable at initial
load with zero nav machinery, and it shrinks the remaining arc to genuinely-new work. Landing it
separately also gets the ordering guarantee under conformance before anything depends on it. The
counter is that it is a `semantics-changed` landing (§8 silent class — reordering side-effecting
bodies changes observable behaviour for any program whose bodies interact), so it owes a real-input
recompile and an artifact diff. That cost is the same whenever it lands; paying it in isolation makes
it *easier* to attribute, not harder.

**FORK 2 — region key granularity: pathname, or `(route-pattern, params)`?**
**Recommend pathname** for V1. §20.8.8 says the region is keyed by `(route, params)`; a concrete
pathname distinguishes `/user/1` from `/user/2`, which is exactly what **CN-7** asserts, so pathname
satisfies the observable contract by construction. The pattern+params pair only becomes necessary if
something must treat those two as the *same* region — which is `keep-alive`'s cache-key question
(§20.8.4 keys the cache by route+params), not the lifecycle's. Defer the split until keep-alive is
built.

**FORK 3 — does a re-entering `<request>` re-fetch?**
**Recommend yes — it is the ratified trade, not an oversight.** §20.8.8 makes bodies re-run and the
ruling explicitly *"knowingly ships a footgun"*, choosing redundant work over staleness. The v1
obligation that pays for it is **`W-ROUTE-REQUEST-DUPLICATES-SERVER-LOAD`**, currently NAMED with no
emitter. **Recommend building the diagnostic in the same arc as U2** — the ruling's own rationale
makes it the price of the choice, and shipping the footgun without the warning is the half the
ratification specifically argued against.

**FORK 4 — interaction with `keep-alive` (newly admitted S314).**
A kept-alive route's payload is cached (§20.8.4), so its `<request>` should NOT cold-fetch on
re-entry — which is in tension with FORK 3's re-run default. **Recommend: out of scope for this arc,
explicitly.** §20.8.4's cache does not exist; U2 should define enter-body re-run for the
non-keep-alive path and leave the cached path to the keep-alive build, with **CN-10** (authored S314,
`runtime-half-pending`) already standing as the pin that will catch it.

---

## 5. Cost

Bands, not point estimates, per the depth-of-survey discount (which has fired seven times and would
plausibly fire here — U2's precedent may absorb more than expected):

| unit | band | driver |
|---|---|---|
| U1 ordering | **S** | one pass replacing five; the classification walk is already source-ordered |
| U3 region key | **S** | compiler already computes the route; emit + match |
| U4 load ordering | **S–M** | staging behind `_scrml_chunk_loading`; concurrency-sensitive |
| U2 enter-body | **M–L** | the real work; spans three emitters; band collapses toward M if the rehydrator precedent absorbs it |
| U0 predicate | **XS** | ~3 lines, verified |
| `W-ROUTE-…-DUPLICATES-SERVER-LOAD` | **M** | needs server-load payload reachability — genuinely new analysis |

**Sequence:** U1 → (U3, U4 parallel) → U2 → U0 → CN-1..CN-9. U0 last is load-bearing, not stylistic.

---

## 6. What each unit owes

- **U1** — emitted-position-vs-source-position assertion at initial load; real-input recompile +
  artifact diff (`semantics-changed`); a conformance case pinning declaration order.
- **U2/U3/U4** — **execute the bundle**, do not grep it. The "emitted ≠ runs" trap has five recorded
  occurrences (S265, S268, S278, S307, and S314-BUILD's own dead-on-arrival). The S314 probe
  (`probes/route-region-timer.probe.js`) is the apparatus and already measures the right things.
- **U0** — the A/B/C differential must hold A, flip B, hold C; shell-timer non-regression from an
  executed bundle remains the single most important negative test.
- **All** — the full S239 adversarial pass before landing; CN-4 fail-before/pass-after.

---

## 7. Not in scope

`keep-alive` runtime cache (§20.8.4) · nested / multiple outlets (V1 is flat) · `<request>` true
abort via AbortController (`g-region-request-discard-not-abort`) · B-3's `_scrml_nav_rewire`
chain-seeding, which remains **forbidden** (the judge rated it the riskiest item any pole proposed).
