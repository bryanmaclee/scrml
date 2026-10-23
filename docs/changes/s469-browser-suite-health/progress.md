# s469-browser-suite-health — progress

Branch `s469-browser-suite-health` (cut from origin/main 0a2d747d3).

## Baseline run (main, local)

- `bun test ./compiler/tests/browser/` — load avg 14.1 → 17.3 during the run.
- 1727 pass / 46 skip / 4 todo / **51 fail**, 136 files, 98.8s.
- 48 of the 51 are EXACTLY `compiler/tests/browser/FAILURE-BASELINE.json` (CI's S313 name-set gate;
  CI `browser` job run 39992783681: "PASS — browser failure name set matches the baseline (48
  asserted, 0 of 2 env-excluded observed)"). So those 48 fail in CI too — they are baselined, not
  local-only.
- 3 local-only:
  - `TodoMVC §0 … app.html must exist`, `TodoMVC §1 … dist files exist` — the 2 env-excluded names
    (gitignored `benchmarks/todomvc/dist/`, built by CI's gauntlet step before the tier runs).
  - `S462 r3 F1 … <match> arm, ;-sequence (base failed too)` — isolation leak (below).

## Step 1 — S462 isolation leak (FIXED, class b)

Root cause: `browser-gated-handler-narrowing-s462` mounts 5 programs into ONE happy-dom document and
never removes the previous program's document-level delegated listeners. Handler ids restart per
compile (`_scrml_attr_onclick_4`), so a later program's button resolves against an EARLIER program's
handler table: SRC_WHEN's `@out = @user.name` (its `@user` already `not`) threw. The listeners also
outlive the file (no `GlobalRegistrator.unregister()`), so the next file in the same process
(`browser-handler-if-else-helpers-s462`) collected the TypeError in its `seen` window-error array.
Not a product bug: a real page boots one program per document.

Fix: `compiler/tests/helpers/mount-isolation.js` (records document/window listeners added during
exec + DOMContentLoaded boot; `teardown()` removes them); both s462 files tear down before each mount
and unregister happy-dom in `afterAll` (the convention 120 other browser files already follow).

Consequence found: the N8-1 nested render-count test expected `[8, 0, 8]`. That 8 was measured WITH
the leak (the previous case's program's on()/off() also ran and its spy counted into the same
global). Mounted alone (`-t "nested gated subtree"`, nothing to leak) the count is 6 — 2 per gated
interpolation, same rate as the flat case's 4. Expectation corrected to `[6, 0, 6]` (a correct value,
not a relaxed one: still exact equality).

## Step 2 — TodoMVC dist (FIXED, class a)

`benchmarks/todomvc/dist/` is gitignored and no tier setup built it. It passed only when CI's
gauntlet step had built it, or when `todomvc-e2e.test.js` (which compiles into the same dist in its
beforeAll) happened to run first — in the baseline run the dist appeared at 12:16, mid-suite, after
browser-todomvc had already read `distExists=false`. `scripts/compile-test-samples.sh` (the
`pretest` step CI also runs) now builds it with the gauntlet's flags. browser-todomvc: 39 pass /
8 skip (pre-existing, documented harness skips) / 0 fail from a deleted dist.

## Step 3 — Bug 60 browser twin (FIXED, class b — stale fixture)

All 5 `Bug 60 — nested compound render-by-tag …` cases failed at COMPILE: `<email req email>` →
E-TYPE-031 (unknown validator predicate; §55.1 vocabulary closed since d894e1a04, which migrated the
unit twin to `pattern(/^[^@]+@[^@]+$/)` but not this browser file). Same migration applied; 5/5 pass.
Baseline pruned (48 → 43).

## Step 4 — i174 (FIXED, class b — stale harness accessor keys)

`i174 (browser) §2` read/wrote cells through the BARE global accessors with bare names. Since BUG-6
chunk namespacing (#180) the store key is `<token>$name`, so `get("name")` was `undefined` and
`set("name", …)` wrote a cell nothing subscribed to. Now keys via `chunkCellKey(clientJs)` (the
helper the other browser files use). 6/6 pass; assertions unchanged. Baseline 43 → 41.

## Step 5 — transitions (FIXED, class b — test pinned a superseded lowering)

`browser-transitions.test.js` (14 failing) asserted the DISPLAY-TOGGLE lowering of `if=`
(`[data-scrml-bind-if]`, `style.display`). S239 `if-mount-unmount-phase2` moved transition-bearing
`if=` onto the mount path (§17.1: false removes, exit deferred to `animationend`; true mounts a fresh
clone). `[data-scrml-bind-if]` matched nothing → 14 TypeErrors, and the 2 "initially visible" cases
passed VACUOUSLY over an empty list. Ported 1:1 (display:none → not connected; re-shown → re-queried
fresh node); every enter/exit class assertion kept; added non-emptiness guards so the "initially"
cases can no longer pass on zero elements. 16/16 pass. Product transitions verified working in
happy-dom. Baseline 41 → 27.

## Classified, NOT fixed — class c, ALREADY FILED

- `g-each-peritem-markup-value-ternary` (3) and `g-emit-lift-markup-text-interp` (4): `ON ${@.label}` /
  `Saved ${@cell}` render `ONalpha` / `Savedhello` — the lift/markup-value emitter emits
  `createTextNode("ON")` (space before the interpolation dropped). Reproduced on main (scratch:
  `<p>${ @f ? <span>HI ${@n}</span> : "" }</p>` → `createTextNode("HI")`; plain markup keeps
  `HELLO `). Filed: `g-ast-markup-text-interp-adjacent-space-dropped` (MED, ruling-gated
  whitespace-model call) and `g-lift-path-drops-whitespace-around-interpolation-s462` (LOW).
