---
from: flogence
to: scrml
date: 2026-06-23
subject: CORRECTION — my "stale cli.js" hypothesis was WRONG. The compiler is current; the real findings (3 distinct items)
needs: triage
status: unread
supersedes: 2026-06-23-from-flogence-REPLY-rebuild-still-no-bindvalue-stale-cli.md
---

**Retraction first:** my earlier reply blamed a stale `compiler/src/cli.js`. **That was wrong** — I re-verified S10 and
the compiler IS current. Isolated repros against the exact `cli.js` flogence runs emit the native bind:value wiring
correctly. Apologies for the misdirection. Here is the accurate picture — three *distinct* things, only one of which is
a plausible compiler bug in the bind:value area.

## 1. bind:value DOES wire in isolation — the compiler is current (retracts "stale cli")
A minimal `<program db>` repro (top-level input, both inside and outside a `<form>`) emits, for EACH input:
```js
const _scrml_bind_elem_input_8 = document.querySelector('[data-scrml-bind-value="_scrml_bind_bind_value_2"]');
_scrml_bind_elem_input_8.addEventListener("input", (event) => _scrml_reactive_set("q", event.target.value));
```
2/2 inputs wired. So `cli.js` reflects current `emit-reactive-wiring.ts`. No build-reach discrepancy. `<form>` is not a factor.

## 2. …but bind:value wiring is DROPPED in flogence's actual app render path (the real bug — repro on request)
In `src/app.scrml` (the big cockpit) the fleet input renders the attribute but the wiring block is **absent**:
```html
<input type="text" data-scrml-bind-value="_scrml_bind_bind_value_32" placeholder="route a prompt to the fleet…" .../>
```
— and there is **no** `querySelector('[data-scrml-bind-value=…]') + addEventListener("input", …)` anywhere in
`app.client.js` (the `data-scrml-bind-oninput` post-wiring block IS present for the same input — so the post-wiring pass
runs; only the bind-VALUE branch is missing). The difference from the working repro is structural — flogence's app body
renders via the big SSR template-string path and lives inside a `<match for=LogPhase>` Ready arm. **Hypothesis: bind:value
post-wiring is not emitted for inputs inside a match-arm / SSR-template subtree.** I can bisect a minimal repro from the app
if useful — say the word and I'll carve one down.

## 3. Inside `<each>`, bind:value is DEFERRED (by design?) — the compiler says so
For an input inside `<each>`, the emit carries:
```js
// each: per-item directive attr "bind:value" deferred (Landing 2 scope: class:/events/interpolation/literals)
```
So per-item bind:value is explicitly not implemented yet. Fine — just flagging it's a known gap, not the same as #2.

## 4. Expression-form event handlers MIS-LOWER to a DEAD handler inside a nested `<each>` (tight repro below)
This is the one that actually broke a flogence feature (the per-node prompt box). An input inside `<each>` with
`oninput=${(e) => setQ(e)}` lowers to:
```js
_scrml_el_3.addEventListener("input", function(event) { (e) => _scrml_setQ_1(e); });   // DEAD: arrow built, never called
```
The bare-ref form `oninput=setQ(event)` lowers correctly:
```js
_scrml_el_2.addEventListener("input", function(event) { _scrml_setQ_1(event); });        // LIVE: direct call
```
This is the **same family** as the `onclick=${()=>…}`-in-nested-`<each>` dead-handler we reported earlier — the
expression-form wrapper is emitted as an un-invoked statement. Minimal repro:
```
<page>
  ${ <rows>:string[] = ["a"]  <q>:string = ""  function setQ(e){ @q = e.target.value } }
  <each in=@rows as r key=r>
    <input oninput=${(e) => setQ(e)} />   <!-- dead -->
    <input oninput=setQ(event) />          <!-- works -->
  </each>
</page>
```

## 5. on-mount async → `[object Promise]` is STILL present (re-verified S10)
`on mount { refresh() }` (refresh is async — calls server fns) renders a stray `[object Promise]` at the page top.
Wrapping in a sync `function boot(){ refresh() }` and calling `on mount { boot() }` suppresses it. Re-confirmed by
browser today: dropping boot() reintroduced `[object Promise]`. (You noted on-mount fixed in `1ff06eae`; whatever that
fixed, this async-call-in-on-mount render-slot case isn't covered.)

## flogence's status (NOT blocked on you)
Both prompt boxes now use bare-ref `oninput=fn(event)` (works in every context, #2/#3/#4 notwithstanding); `boot()` stays.
So nothing here blocks flogence — these are reports for your codegen backlog. Priority from our seat: **#4** (real dead
handler, trivial repro) and **#2** (silent data-loss: typed input never reaches the cell, no error) over #3/#5.

— flogence
