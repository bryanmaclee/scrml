# S286 chunk-namespacing BUG-6 accessor-rename — FINISH-TO-GREEN dispatch brief

**Archived dispatch brief (verbatim).** change-id: `chunk-ns-finish-s286`. Agent: `scrml-js-codegen-engineer`, isolation:worktree, model opus. Base: `finish/chunk-ns-bug6-rename @ bab18e56` (the merged rename onto current main `fe1ad047`).

---

## MISSION

Drive the ~90%-done chunk-namespacing BUG-6 accessor-rename from KNOWN-RED to GREEN + landable. The rename is already merged onto current main; your job is the real finish: fix the executed-output codegen bugs, correct over-migrated tests, regenerate the parity baseline, re-measure gzip, and get the WHOLE suite green. Do NOT re-do the rename — it exists and is proven ~90% done.

## CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE (F4) — do this FIRST, every write worktree-absolute

Incident-rate discipline: leaks are measured. Lead every edit with the worktree-absolute path.
1. `pwd` MUST start with `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-`. If it is the main checkout `/home/bryan-maclee/scrmlMaster/scrml` — STOP, report, exit (wrong-root allocation).
2. `git rev-parse --show-toplevel` MUST equal your worktree root. `git branch --show-current` should be your `worktree-agent-<id>` branch, based on `bab18e56`.
3. `bun install` (worktrees do NOT inherit node_modules — the acorn-missing failure otherwise).
4. `bun run pretest` (populates gitignored `samples/compilation-tests/dist/` browser fixtures — RECOMPILES with the rename codegen; ~130 ECONNREFUSED-shaped fails without it). A fresh worktree also lacks gitignored `dist/` — symlink from main if browser tests need it: `ln -s /home/bryan-maclee/scrmlMaster/scrml/dist dist` (ENV-GAP not regression).
5. Edits: use Bash on WORKTREE-ABSOLUTE paths (echo before, `git diff`/grep after). NEVER `cd` into the main checkout. Use `git -C "$WORKTREE_ROOT"`, `bun --cwd "$WORKTREE_ROOT"`. Do NOT use the Edit/Write tools' short relative paths that could resolve against main.
6. **The baseline is KNOWN-RED — this is EXPECTED, not a reason to STOP-abort.** ~85 unit/int/conf fails + ~89 browser (leak-inflated) + 10 within-node-parity fixtures. Driving them green IS the task.

## MAPS — REQUIRED FIRST READ

Read `.claude/maps/primary.map.md` first; follow its Task-Shape Routing to the codegen maps. **Currency: the map is stamped `e8fdd44c`, which is 15 commits behind main AND predates the entire rename surface** — treat every map claim as a VERIFY-AGAINST-SOURCE hypothesis, not truth. New rename files the map does NOT know: `compiler/src/codegen/cell-accessor-rename.ts`, `chunk-namespace.ts`, `fnv1a-hash.ts`. Report the load-bearing map finding (including "not load-bearing").

## THE RENAME ARCHITECTURE (internalize before touching anything)

The BUG-6 rename gives each cell-accessor a CHUNK-LOCAL scope so two chunks in one bundle don't collide. Mechanism:
- **It is a BUNDLE-ASSEMBLY Acorn pass**, NOT an emit-time change. `renameCellAccessors(body, CELL_SCOPE_ACCESSORS)` at `compiler/src/codegen/index.ts:667` rewrites the ASSEMBLED bundle body: callsites `_scrml_reactive_get(...)` → `_scrml_cs_reactive_get(...)`, which hit a per-chunk PROLOGUE of scoped wrapper fns (`_scrml_cs_key`, `_scrml_cs_owners`, `_scrml_cs_<accessor>`) that call the original accessor with a scoped key.
- **CONFIRMED: NO emitter (`emit-expr.ts`/`emit-logic.ts`/`emit-reactive-wiring.ts`/`emit-engine.ts`/`emit-match.ts`) emits `_scrml_cs_` directly** — they all still emit the RAW `_scrml_reactive_get` etc. The `_cs_` names only exist AFTER the index.ts:667 pass runs on the assembled bundle.
- Consequence: a unit test that calls `emitExpr()`/`emitLogic()` directly sees the RAW (pre-rename) name. A test asserting `_scrml_cs_` on direct-emit output is WRONG (over-migrated). A test running the FULL compile pipeline correctly sees `_scrml_cs_`.

## THE WORK — PHASED. Commit + progress.md after EACH phase.

### PHASE 1 (HARD — do FIRST, most context) — executed-output runtime bugs (~10 non-browser + the browser reactive/each/engine cluster)
The rename campaign has REVERT commits (`c3cc1b95`/`8a09756c`/`7b22aa37`) of "folded prologue self-recurses / mangled executed clientJs" — the executed output was fragile. Real runtime failures observed on the merged tree:
- `ReferenceError: _scrml_lex_90 is not defined` — a gensym/local ref left dangling by the rename or a fold.
- `ReferenceError: __scrml_engine_marioState_transitions is not defined` — engine transition-table name inconsistency (note the `__scrml_engine_` double-underscore family vs the `_scrml_cs_` rename — check the rename didn't miss/over-catch a family).
- `TypeError: _scrml_map_insert(_scrml_cs_reactive_get("a"), "X", 1).insert is not a function` — a scoped wrapper broke method chaining (wrapper returns the wrong thing).
- Browser (run ISOLATED per file for a CLEAN count — the happy-dom global-state leak, Bug-60 class, cascades order-dependently and inflates the whole-dir count; ~12 base flakes are EXPECTED, not rename-caused): clusters in `each`/`reactive`/`mount`/`engine`/`reconcile`.
**Verify EVERY runtime fix by EXECUTING the bundle in happy-dom/real DOM (S265 execute-don't-grep) — emit-shape/text asserts are NOT sufficient.** A base control (pre-fix) proving the bug + your harness discriminating is the bar.

### PHASE 2 — correct over-migrated unit tests (~40 fails across these 10 files)
These assert the post-rename `_scrml_cs_` name at the EMIT-UNIT stage (before the index.ts:667 pass). Correct each: revert the expectation to the RAW emit name (e.g. `_scrml_cs_reactive_get("dragPhase")` → `_scrml_reactive_get("dragPhase")`) — OR restructure the test to run the full pipeline if it is genuinely meant to test the assembled output. The rename itself is covered by the 27 full-pipeline test files that assert `_scrml_cs_` on assembled output — do NOT weaken those.
FILES: `compiler/tests/integration/s95-bug-2-engine-payload-variant.test.js`, `compiler/tests/unit/if-expression.test.js`, `engine-a7-history.test.js`, `computed-delay.test.js`, `value-attr-binding-i81.test.js`, `request-tag-and-server-fn-reactive.test.js`, `engine-event-handler-writes.test.js`, `match-arm-codegen-bundle-bug-1.6-1.7.test.js`, `engine-a7-internal-rule.test.js`, `engine-opener-effect-c1.test.js`.
CAUTION: for EACH assertion decide "over-migrated (revert to raw)" vs "real codegen gap (this path SHOULD emit renamed)". If any is genuinely the latter, that is a Phase-1 codegen bug, not a test revert — flag it explicitly in your report.

### PHASE 3 — triage the remaining ~35 (engine onTransition/onTimeout shape + byte-identity); parity baseline; gzip
- Triage each remaining non-browser fail into Phase-1 (real codegen) or Phase-2 (over-migrated test) class and fix accordingly.
- **Within-node parity (10 fixtures over-budget):** regenerate `compiler/tests/parser-conformance-within-node-allowlist.json` to the current merged-tree residuals (this is the designed baseline-regen path). Attribution: the classifier runs on PARSED FileASTs (pre-codegen) so the rename cannot cause this — the drift is main's #162 ast-builder change accumulating against the base-era allowlist. **Add an in-file comment/note documenting WHY the baseline moved** (a decision, not an oversight). Fixtures: stdlib/path (27), router (18), store/kv (6), random (5), time (4), 05-multi-step-form (2), http (2), math/process/gauntlet-r10-solid-spreadsheet (1 each).
- **gzip:** the SPA runtime is 16,330 B gzip, 54 B under the 16,384 budget — but 54 B < the ~200 B gzip whitespace-noise band. Whitespace-normalize the runtime removal + RE-MEASURE carefully; do not trust a single measurement. HOLD 16 KB (bryan ruled) via zero-core-residue (already achieved). Confirm the `v0-3-x-spa-tree-shake-phase-b` gzip-budget test + the `c10-error-message-resolution` tree-shake test are green.

### PHASE 4 — the full verification bar (ALL required; report each)
- `bun test compiler/tests/{unit,integration,conformance}` GREEN (the pre-commit set).
- Browser suite: run per-file isolated; every non-base-flake, non-leak fail GREEN.
- Within-node parity GREEN (post-regen).
- Full-suite name-diff clean vs base (the 31-unique-name base set).
- Artifact-diff PASS (the hardened 446-file gate — NOT the hollow 8-of-115).
- R26: recompile real adopter `.scrml` (`scrml-support/docs/gauntlets/gauntlet-r25/dev-*.scrml`) on your post-fix baseline; report symptom-gone.

## COMMIT + SAFETY DISCIPLINE
- Incremental WIP commit after each phase (+ append-only `progress.md`: what done / what next / blockers). The branch + progress.md are your ONLY crash-recovery anchor.
- **`--no-verify` is AUTHORIZED for WIP commits ONLY (bryan, S286)** — because the tree is red until the finish is done and every WIP `--bail`s the pre-commit gate.
- **hooksPath-disabling / `git config core.hooksPath` override is ABSOLUTELY FORBIDDEN** — that is a security violation (S283). Use `--no-verify` on the commit, nothing else.
- **The FINAL commit MUST pass the REAL pre-commit gate** (do NOT `--no-verify` the final commit — it must be green on its own). The PA will run the S239 adversarial review + the cloud `gate` before the PR merges. Do NOT land anything red.
- Do NOT touch `main`. Do NOT run `/code-review` (you can't in-agent; the PA runs S239 on return). Do NOT widen scope beyond this finish.

## REPORT (return this)
FINAL_SHA · files-touched (grouped src / tests / baseline) · before→after fail counts per gate (unit+int+conf / browser-isolated / parity) · every executed-output bug found+fixed with a one-line repro + the executed-DOM proof · anything flagged "over-migrated-test vs real-codegen-gap" you were unsure about · deferred items · gzip final measurement. Commit-after-each-change; WIP commits expected.
