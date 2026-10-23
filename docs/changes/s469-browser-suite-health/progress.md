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
