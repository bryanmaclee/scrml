# e2e-render-map-l1-2026-06-17 — progress

Append-only. Each line: timestamp — what was done — what's next.

## 2026-06-17

- START at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a47590dfee9fa1196
  HEAD a0f93c92. Startup verification passed (pwd/toplevel/merge-ff/clean/bun install/pretest).
  Authority read in full: docs/deep-dives/e2e-known-failure-map-2026-06-17.md (the spec).
  Substrate read: each-runtime-bug-57.test.js (mount), corpus-enumerator.js,
  parser-conformance-within-node.test.js (baseline+delta), test-examples.js (SERVER_EXAMPLES
  suppression — the anti-pattern to NOT replicate), trucking-dispatch-smoke (multifile compile).
- Corpus survey: examples/ 29 top-level .scrml ALL <program-rooted (attr-tolerant grep);
  09/18/26 are fragments (no <program); 22-multifile + 23-trucking-dispatch are multi-file dirs;
  benchmarks/ has todomvc/app.scrml + fullstack-scrml/app.scrml + per-route-roles/routes/*.scrml.
  samples/ now 877 .scrml (corpus grew since DD's measured 369).
- NEXT: Step 1 — render-corpus-enumerator.js (clone parser enumerator, add benchmarks/, filter to
  apps with a <program UI root). Then Step 2 detectors, Step 3 driving, Step 4 baseline+delta-gate.

- Step 1 DONE: render-corpus-enumerator.js (434 apps: 31 examples + 400 samples + 3 benchmarks
  single, 4 multi). EXPLICIT_SINGLE_APP_ENTRIES folds TodoMVC (a <div>-rooted app) IN — additive.
- Step 2-3 DONE: render-detectors.js (D0-D7, worst-wins, no suppression) + render-harness.js
  (compileApp single+multi mirror-tree gather + sibling .db copy; mountAndObserve happy-dom
  new Function mount, console.error + window.onerror capture, reactive set/get side-channel;
  observeApp empty vs populated). seed-fixtures.js (POPULATED_SEEDS per-app cell-set).
- Detector-validation DONE: 3 fixtures + detector-validation.test.js (3 pass). D3 fires GENUINELY
  (struct-into-text renders [object Object]); D1+D7 + D4 proven on historical symptom (bugs fixed).
- TIMING FINDING: examples+benchmarks slice (34 apps) = 3.3s in-process. samples mostly fast
  (fails-compile without mount). BUT samples/gauntlet-r18/rails-dev.scrml HANGS at mount (>25s,
  0% CPU — generated client loops/stalls in happy-dom; compiles fine in 0.8s). go-dev mounts in
  8.4s. => MUST run subprocess-isolated per-cell with a hard timeout (HARNESS-TIMEOUT cell —
  classified, never hidden). This is the architecture: generate-baseline.js spawns observe-one.js
  per cell with a 20s timeout.
- Step 4 in progress: generate-baseline.js (subprocess orchestrator, --write/--check/--print) +
  e2e-render-map.test.js (delta-gate, NON-gating, fast examples+benchmarks slice). Generating
  the baseline map now. NEXT: land baseline + run full suite + within-node untouched check.

- Step 4 DONE: generate-baseline.js (subprocess orchestrator) + observe-one.js (per-cell
  subprocess, 20s timeout -> HARNESS-TIMEOUT) + seed-fixtures.js + e2e-render-map.test.js
  (delta-gate NON-gating, subprocess-isolated slice). Baseline written.
- BASELINE MAP (438 cells / 434 apps / 160.6s): renders-clean 254, fails-compile 125,
  compiles-but-throws 33, renders-empty 20, smell-detected-wrong 5, HARNESS-TIMEOUT 1.
  Notable RED: examples/16-remote-data + 29-engine-vs-flags S-UNBOUND-REF (bug-2 class);
  examples/03-contact-book#populated S-NULLISH-TEXT (empty renders clean — board-class split);
  2 channel + 1 for-lift sample S-RAW-INTERP (bug-3 class still alive); 17-schema-migrations +
  per-route-roles/loads {} is not iterable; samples/gauntlet-r18/rails-dev HARNESS-TIMEOUT.
- Delta-gate logic validated (synthetic): green->red=regression, red->green=improvement, new=recorded.
- GATES: no corpus .scrml touched; no compiler/src touched. within-node 1012 pass / 0 fail
  (1008 files — fixtures NOT swept). e2e-render-map suite 7 pass / 0 fail (16.4s).
  Detector-validation 3/3 fire. Running full unit+integration+conformance gate to confirm
  no pre-existing regression.
