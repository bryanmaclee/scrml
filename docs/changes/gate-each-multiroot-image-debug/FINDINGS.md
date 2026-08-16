# FINDINGS — gate-each-multiroot-image-debug (S345-bryan dispatch)

Debug branch: `debug/gate-each-multiroot-image-20260810` (never merges).
Failing test: `compiler/tests/unit/each-multi-root.test.js:503` — §5 "two lifts per iteration
render both roots per item" — `api.count(".lhdr")` 0, expected 4, deterministic on runner image
`ubuntu24 20260810.271.1`, green on `20260720.247.2` and locally.

## ONE-LINE VERDICT

**TEST-HARNESS defect** — a cross-file stale-`DOMContentLoaded`-listener leak through the shared
happy-dom document: `engine-body-render.test.js`'s evaled chunks leave never-removed `_scrml_boot`
listeners on the process-global document; `each-multi-root`'s harness re-dispatches
`DOMContentLoaded`, re-firing them; a stale rewire re-queries the GENERIC selector
`[data-scrml-logic="_scrml_logic_1"]`, matches §5's span, and overwrites it (`textContent = "99"`),
wiping the (correctly rendered!) lift output. The new runner image merely changed `bun test`'s
filesystem-readdir file-execution order so the writer file now runs before the victim file.

## WHERE THE RENDER PATH DIVERGES

Nowhere in the §5 bundle. Proven in-cloud on the RED image (round 2, PHASE B):

- compile errors `[]`, clientJs 2533 bytes — byte-length-identical to local, contains the lift factory;
- eval throws nothing;
- **counts PRE-dispatch: lhdr 4 / lrow 4** — the emitted bundle renders every root correctly
  in the poisoned cloud context;
- counts POST-dispatch: lhdr 0 / lrow 0, span content `"99"` — the harness's own
  `document.dispatchEvent(new Event("DOMContentLoaded"))` (each-multi-root.test.js:78) is the wipe.

The wipe chain, captured by instance-level mutation spies with stacks (round 2):

```
SPY A-span set textContent = "99"
  at _scrml_render_value  (runtime, evaled)
  at _scrml_nav_rewire    (chunk boot body, evaled by engine-body-render.test.js)
  at _scrml_boot          (chunk boot, evaled by engine-body-render.test.js)
  at #callDispatchEventListeners (happy-dom EventTarget)
  at dispatchEvent ← each-multi-root.test.js probe/harness dispatch
```

Writers observed: `"7"` then `"99"` — exactly `engine-body-render.test.js` §13's cell values
(`api.set("count", 7)` line ~870; `api.set("count", 99)` line ~933, the idempotency test — the
last §13 test to run, so 99 is the surviving value in that chunk's closure store). Last write wins.

Mechanism ingredients (all three required):

1. **Generic placeholder ids** — every compiled chunk names its first logic span
   `data-scrml-logic="_scrml_logic_1"`. The S282 chunk-namespacing arc tokened cells, engine
   names, and each/match ids, but NOT logic-placeholder ids. A stale chunk's rewire
   (`emit-event-wiring.ts` — `_scrml_nav_rewire` display effect, `el.textContent = …` via
   `_scrml_render_value`) re-queries document-wide and takes the FIRST match — the current
   test's span.
2. **Unconditional, never-removed boot listeners** — `emit-event-wiring.ts:2262`
   `document.addEventListener("DOMContentLoaded", _scrml_boot)` (same pattern at
   `emit-variant-guard.ts:1341` `_fire`, `emit-client.ts:2706` link-boost). Harmless on a real
   page (DOMContentLoaded fires once per document) but persistent on the shared test document
   (happy-dom does NOT auto-clear them — probed: dispatch / innerHTML / time all leave them in
   place; engine §13 evals measurably accumulate 2 → 3 → 5 listeners).
3. **Harness re-dispatch on a shared document** — `each-multi-root.test.js`'s `compileAndLoad`
   evals runtime+chunk against the process-global happy-dom document (registered once per
   process, `if (!globalThis.document) GlobalRegistrator.register()`) and dispatches
   `DOMContentLoaded` every call, re-firing every accumulated listener from every prior file
   since the last fresh-window re-registration. (The conformance adapter
   `conformance/adapters/impl1-ts.ts run()` does NOT have this defect — it
   unregister+register's a FRESH window per runtime case, which is why the conformance for-lift
   runtime cases pass in cloud.)

## WHY THE IMAGE FLIP TRIGGERED IT (and why it looked like a flake, then went deterministic)

`bun test <dir> <dir>` executes test files in filesystem readdir order — NOT sorted (verified:
cloud `##[group]` sequence and local junit sequence are both unsorted and mutually different over
the IDENTICAL 1015-file set; 0 set difference, identical 50 skips). readdir order on ext4 is
directory-hash order, seeded per filesystem instance — i.e., baked into the runner image at build
time and stable fleet-wide for a given image build.

- RED image `20260810.271.1` order: `engine-body-render` at group position **660**,
  `each-multi-root` at **719**, and no happy-dom re-registration between them → the stale
  listeners are live when §5 dispatches → deterministic wipe.
- Local (and evidently the GREEN `20260720.247.2` order): `each-multi-root` runs BEFORE
  `engine-body-render` (locally 76 vs 383) → the writer doesn't exist yet when §5 runs → green.
- Mixed runner pool during the ~Aug 10 rollout = per-run order lottery = the S338
  "intermittent flake"; saturated pool = deterministic red. The windows job stays green
  (different filesystem → different order).

Cloud single-file run of `each-multi-root.test.js` on the RED image: all 21 pass (round 1) —
confirming suite-context dependence, not per-file environment divergence.

Note on replay methodology: `bun test <fileA> <fileB> …` does NOT honor CLI argument order for
execution (verified with both argument orders and mtime changes — same execution order each
time). Early "cloud-order replay is green locally" results in this dispatch were void for that
reason; order could not be forced from the CLI, which is also why a local repro of the exact
cloud order was not achievable this session.

## VERDICT (three-way)

- **TEST-HARNESS defect: YES — primary.** The §5 assertion fails only because the harness (a)
  shares one happy-dom document across ~1000 files, (b) re-dispatches DOMContentLoaded per
  compileAndLoad, and (c) inherits stale listeners whose rewires resolve generic ids
  document-wide. Any shared-document eval-harness file is a potential victim AND a potential
  writer; the victim/writer pairing is decided by readdir order, i.e., by runner-image build.
- **COMPILED-RUNTIME defect: NO for this failure** — the bundle renders 4/4 in cloud
  pre-dispatch. BUT the mechanism exposes a real, latent language-level gap (below).
- **TOOLCHAIN: NO** — bun 1.3.14 (0d9b296a) and happy-dom 20.8.9 identical and
  behaviorally equivalent in both environments; happy-dom listener lifecycle probed identical.

Latent adopter-relevant gap (separate backlog item, NOT the CI red): logic-placeholder ids are
not chunk-namespaced, boots query document-wide, and multiple chunks can legitimately share one
document on a real page (SPA soft-nav route-chunk injection). Two chunks on one page can
cross-write each other's `_scrml_logic_1` spans. Same collision class the S282 arc closed for
cells/engine names/each-match ids — logic ids were left out.

## MINIMAL FIX CANDIDATES (diagnosis only — not built)

1. **Emitter one-liner (recommended, fixes the CLASS): register the boot with `{ once: true }`.**
   `document.addEventListener("DOMContentLoaded", _scrml_boot, { once: true })` at
   `emit-event-wiring.ts:2262`, `emit-variant-guard.ts:1341`, `emit-client.ts:2706`. On a real
   page DOMContentLoaded fires exactly once per document, so `once` is semantically identical in
   production — it only removes the stale-listener hazard under any once-per-eval test harness.
   Kills the whole class for every harness file at zero production cost.
2. **Harness fix (immediate, local): fresh window per `compileAndLoad`** (or per file via
   `beforeAll`) in `each-multi-root.test.js` — `await GlobalRegistrator.unregister();
   GlobalRegistrator.register();` — the exact pattern `conformance/adapters/impl1-ts.ts run()`
   already uses (and why conformance runtime cases are immune). Note: fixes only this file;
   every other shared-document eval-harness file (engine-body-render §13 included) remains a
   potential victim of the same class on the next image shuffle.
3. **Gate-stability instrument (optional, complements 1/2): pin the CI file order** — invoke the
   gate via a deterministic file list so a future image rollout cannot re-shuffle victim/writer
   pairings. Caveat: bun ignores CLI arg order, so this needs its own verification (bunfig or a
   wrapper). This MASKS the class rather than fixing it — do not ship alone.
4. **Backlog (adopter surface): chunk-namespace the logic-placeholder ids** (N1-style token,
   `data-scrml-logic="<token>_logic_1"`) so two chunks on one real page cannot cross-write —
   `once: true` does not fully close that page-level case (both chunks legitimately fire on the
   same single DOMContentLoaded and still resolve first-match document-wide).

## RAW EVIDENCE (key excerpts per round)

### Round 0 (pre-CI, local + log mining)
- Failing main run 31806286070 gate log: §1–§4 of the same file PASS in cloud; conformance
  for-lift runtime cases PASS; failure is a clean expect diff (`Expected: 4 / Received: 0`), no
  eval throw. Windows job (same suite) green.
- Cloud `##[group]` order vs local junit order: same 1015-file set, different order, both
  unsorted. `each-multi-root` cloud pos 719 / local pos 76; `engine-body-render` cloud 660 /
  local 383; `corpus-bridge` (fresh-window re-registrar) cloud 822 / local 41.
- §5 emitted artifacts (local compile): static HTML carries NO `.lhdr` — only
  `<span data-scrml-logic="_scrml_logic_1">`; all rendering client-side at eval time.

### Round 1 (run 31809637050, image 20260810.271.1, kernel 6.17.0-1022-azure, glibc 2.39)
- Single-file step: `bun test compiler/tests/unit/each-multi-root.test.js` → 21 pass 0 fail ON
  THE RED IMAGE.
- Gate-suite ZZDEBUG dump: compile errors `[]`; clientJs 2533 bytes, contains `lhdr`;
  body-before-eval correct; `eval error: none`; reactive `rows` reads back correctly; body after
  eval+dispatch: `<div class="wrap"><span data-scrml-logic="_scrml_logic_1">99</span></div>`;
  counts lhdr 0 / lrow 0.

### Round 2 (run 31810901785 — mechanism + culprit)
- PHASE A (probe dispatch, our chunk NOT evaled): span `""` → `"99"`. Stale listener proven.
- PHASE B: eval only → `lhdr 4 / lrow 4` (bundle CORRECT in cloud); after dispatch →
  `lhdr 0`, span `"99"`.
- SPY stacks: `_scrml_render_value` ← `_scrml_nav_rewire` ← `_scrml_boot`, closures attributed to
  `compiler/tests/unit/engine-body-render.test.js` eval frames; sequential writes `"7"` then
  `"99"` matching engine §13's `count` values; also the same chain via `effectFn ← _scrml_effect`
  (the rewire registers a fresh effect against the current span each re-fire).
- Same-run single-file step: PHASE A clean (`""` → `""`) — no prior files, no stale listeners.

### Round 3 (run 31812533811 — listener census, in-cloud, CLOSES the chain)
- Gate suite, engine-body-render §13 evals: document DOMContentLoaded listeners accumulate
  `2 → 3 → 5` in cloud — IDENTICAL to local measurement (registration behavior is the same
  everywhere; only file ORDER differs).
- Gate suite, each-multi-root §5 (`CAL lift-run`): `listeners pre-eval: 5/0` — the five stale
  engine listeners are live when §5 runs; still `5/0` post-dispatch (not once-registered).
- Enumerated listener sources (with hints):
  - 3 × engine dispatcher `_fire`:
    `function() { __scrml_engine_phase_dispatch(_scrml_reactive_get("phase")); }`
  - 2 × `_scrml_boot` (757 chars) whose body contains
    `querySelector('[data-scrml-logic="_scrml_logic_1"]')` — the generic-id writers.
- Same-run single-file step: `0/0` at every checkpoint; engine §13 runs after each-multi-root
  there, counts 2 → 3 → 5 only afterwards.
- Supporting local probes: happy-dom listeners survive dispatch / innerHTML / time (no
  auto-clear; `readyState` starts `interactive`, `complete` after a tick).

### Side observation (out of scope, pre-existing)
The Tier-0 lift path emits `document.createTextNode("H${r.label}")` — a LITERAL, uninterpolated
string (text interpolation dropped for lift-element children). §5 asserts counts only, so it
passes; the §2 `<each>` path interpolates correctly. Matches the tracking-lane bug already named
in ci.yml comments: `g-emit-lift-markup-text-interp`.
