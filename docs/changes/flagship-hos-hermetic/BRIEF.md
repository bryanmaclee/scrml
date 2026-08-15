# BRIEF — flagship-hos hermeticity: find + fix the cloud-intermittent (S346-bryan dispatch)

DONE-PROBE: test -f docs/changes/flagship-hos-hermetic/FINDINGS.md && grep -q '^## MECHANISM' docs/changes/flagship-hos-hermetic/FINDINGS.md

## The symptom — main is RED on it right now
`bun scripts/browser-baseline.ts --check` (CI job `gate`, step 9 "Browser tier failure NAME-SET
gate") intermittently reports ONE new failure:
`flagship driver/hos — <engine> under an if= > the page compiles and its engine mount really does sit inside an if= template`
= `compiler/tests/browser/flagship-hos-engine-under-if.browser.test.js`, its FIRST test:
`expect(tpls.some((t) => t.includes("data-scrml-engine-mount"))).toBe(true)` over the emitted
`hos.html`. Latest instance: main run `31909195148` at `HEAD` `#534` (2026-08-15 21:21Z); the
next main run on the same tree (#532's leg) was GREEN. Same SHA passes and fails.

## What is ALREADY RETIRED — do NOT re-derive (three sessions have)
- **The compile SUCCEEDS** (post-#531 the test throws loudly on any compile error; it does not).
- **The artifact IS located** (post-#534 the test throws if it does not find exactly one
  `hos.html` + one `hos.client.js`; it does not). So the emitted `hos.html` genuinely lacks a
  `<template>` whose content contains `data-scrml-engine-mount`, intermittently.
- NOT commit-tied (dispatch on `7e4a86aa` passed, `a946fc32` failed, the diag branch passed once
  and failed once on adjacent commits). NOT event-type-tied (retired by measurement, S345).
- **#528 is EXONERATED** by timeline (#525 failed on this test before #528 existed) and by
  mechanism (`scanDirectory` is CLI-only; `compileScrml` never calls it; this test passes
  `inputFiles`).
- The test already SORTS its input walk (#527) and its output walk (#534).
- ⚑ **DO NOT `--write` the baseline.** The gate's own message invites it. It would green
  everything in one command and permanently blind a test guarding a real engine-under-`if=`
  defect (`g-dispatched-mount-inside-if-never-renders`, S301).

## What is KNOWN about the harness (load-bearing)
- `browser-baseline.ts:121` runs the tier as ONE process: `spawnSync("bun", ["test", TIER])` with
  `TIER` a bare DIRECTORY → bun runs the files in `readdir` order → **file order is a property of
  the runner IMAGE**, not the repo (the 20260810 image reshuffled it — that is what turned three
  latent order-dependencies into reds this week). PR **#529 [DRAFT]** sorts the tier explicitly and
  is HELD because sorted order currently resolves RED for this test locally? — VERIFY that claim
  first: run `bun test $(ls compiler/tests/browser/*.test.js | sort)` and report whether this test
  is red under sorted order on your machine.
- `spawnSync(..., {encoding:"utf8"})` CAPTURES stdout — **any `console.log` inside a test is
  swallowed by the driver.** Diagnostics must go to a FILE, or the file must be run directly
  (`bun test <file>`), or via the direct-run CI step on the diag branch.
- Every browser test file registers happy-dom via `GlobalRegistrator.register()` behind a
  first-file-wins guard and shares ONE `document`/`window`/globalThis across the whole tier
  process (27 files register, 71 unregister — S345 count).
- Instrumentation exists on branch `diag/flagship-hos-template` (never merges): prints html
  length / template ids / engine-mount count / marker set / html head when the assertion fails, and
  adds a direct-run `bun test <file>` CI step so the print reaches the job log. Its ONE red cloud
  run (`31894833703`, `09636a54`) predates the direct-run step, so nothing was captured yet.
  `workflow_dispatch` is available: `gh workflow run CI --ref diag/flagship-hos-template` (the
  workflow is read from the TARGET ref — it works on that branch).

## Hypotheses — the sharpest first (PA-located S346; VERIFY, do not assume)
H1 — **compiler module-level mutable state leaks across `compileScrml` calls in one bun process.**
`compileScrml` is IN-PROCESS. Another file in the same tier compiles a MODIFIED COPY of the same
page: `compiler/tests/browser/if-mount-dispatched-mount.browser.test.js:78` compiles a `tmpInput`
derived from `examples/23-trucking-dispatch/pages/driver/hos.scrml`. The compiler carries
module-level `let` state that is not obviously reset per compile — candidates (grep verified,
loci PA-located):
  `compiler/src/component-expander.ts:290 let _currentFileEngineMountNames: Set<string>` ·
  `compiler/src/codegen/chunk-namespace.ts:216 let _state` ·
  `compiler/src/codegen/emit-control-flow.ts:20/37/64/65` (`_hoistMap`, `_batchInListCap`,
  `_variantFields`, `_variantFieldCollisions`) · `compiler/src/codegen/emit-each.ts:235/2541/2614/2626`
  · `compiler/src/codegen/var-counter.ts:15 _varCounter` · `compiler/src/dependency-graph.ts:257
  _nodeCounter` · `compiler/src/expression-parser.ts:891 _currentUserAmbientActive`.
  If any of these survives into the next compile and changes what `emit-engine.ts:2772`
  (`<div data-scrml-engine-mount=…>`) or the `if=` template wrapper emits — the SECOND compile of
  the same page in a process differs from the FIRST. That is order-dependent by construction and
  cloud-only iff the image's readdir puts the writer before the victim.
  **TEST IT DIRECTLY:** run the writer + victim in ONE bun process in BOTH orders
  (`bun test <writer> <victim>` vs `bun test <victim> <writer>`; bun honours argument order for
  explicit files — verify that too), capture the emitted `hos.html` to a FILE each time (not
  stdout), and DIFF. Then bisect which other tier file(s) flip it (a `bun test <X> <victim>` sweep
  over the tier is ~70 runs × ~1-2s each — do it, it is cheap, and it is exactly the sweep S345
  did for `each-multi-root`).
H2 — the FIRST test calls `artifacts()` (= the compile) AFTER `beforeEach` has registered happy-dom
globals, so the compile runs with `window`/`document`/`fetch` defined. Grep the compiler for
`typeof window`/`typeof document`/`globalThis.` reads that change emission. Deterministic on its
own, but it composes with H1 (a global left behind by another file).
H3 — (S345's open hypothesis) cross-file coupling through the shared happy-dom document — a stale
`DOMContentLoaded`/rewire listener from a file that ran earlier mutating THIS test's document.
Note the failing assertion reads the emitted HTML STRING (`artifacts().html`), not the DOM — so H3
can only matter if it changes the compile, which routes back to H1/H2. Rank it accordingly.
Whichever holds: **a compile that depends on what was compiled before it in the same process is a
COMPILER BUG** (SPEC §58.1: compilation is a pure function `compile(source, buildStory) → artifact`),
not a harness bug — and the fix belongs in the compiler (reset per compile at the `compileScrml`
entry, or thread the state through the compile context), WITH the harness made hermetic as
defense-in-depth. If it is purely harness (H2/H3 without a compiler leak), fix the harness.

## Deliverables (in order)
1. **`docs/changes/flagship-hos-hermetic/FINDINGS.md`** with a `## MECHANISM` section: the cause,
   the writer file(s), the state that leaks, and a DETERMINISTIC local reproducer (command that
   goes red on demand). Bite-proof it: red with the writer first, green with the victim first, on
   the same tree. If you cannot make it red locally after the order sweep, say so and use the diag
   branch's direct-run step via `workflow_dispatch` (dispatch it 3-4× and read the logs) — do NOT
   guess.
2. **The fix** — compiler-side reset/threading if H1 (+ a unit test that compiles TWO different
   inputs in one process and asserts the second's artifacts are byte-identical to a fresh-process
   compile of the same input — that is the regression pin for the CLASS, not the instance), and/or
   the harness change (compile before happy-dom registration / in a fresh subprocess / fresh
   `document` per file per the `impl1-ts.ts` fresh-window pattern S345 used for `each-multi-root`).
   Direction-of-change: if the compiler changes, run the corpus emit differential
   (`scripts/corpus-emit-differential.ts` — read its header first) and report the count; a
   compiler-state reset should be INERT (0 files changed) on a fresh-process compile.
3. **Report whether the tier is green under SORTED order** with your fix (this is what unblocks
   #529): `bun scripts/browser-baseline.ts --check` locally + the sorted explicit-file run.
4. Do NOT touch `docs/known-gaps.md` (PA-owned). Do NOT re-record the baseline.

## MAPS — REQUIRED FIRST READ
Read `.claude/maps/primary.map.md` FIRST (stamp: commit `4f034e13`, 2026-08-11), follow its
§"Task-Shape Routing"; then `test.map.md` (the browser tier + `browser-baseline.ts`) and
`build.map.md`. Post-map landings to factor in: `#526` (`{ once: true }` on the three emitted
boot registrations — `emit-event-wiring.ts`/`emit-variant-guard.ts`/`emit-client.ts`), `#527`,
`#528` (sorted walks in `api.js`), `#530`, `#531`, `#534` (this test file). Treat map content as a
verify-against-source hypothesis. Report the load-bearing finding, "not load-bearing" included.

## Mechanics (CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE)
- isolation: worktree. FIRST: `pwd` must start with
  `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/`; `git rev-parse --show-toplevel` equals
  it; clean tree. Any failure: STOP + report. Then `bun install` and `bun run pretest` (the browser
  tier reads gitignored `samples/compilation-tests/dist/` fixtures — ~130 ECONNREFUSED-shaped
  fails without it). Then `git checkout -b fix/flagship-hos-hermetic`.
- Edit via Edit/Write on WORKTREE-ABSOLUTE paths only; NEVER write to the main checkout; no `cd`
  into main; `--cwd "$WORKTREE_ROOT"` for bun, `git -C "$WORKTREE_ROOT"` for git. Scratch files
  under the scratchpad or `$WORKTREE_ROOT/docs/changes/flagship-hos-hermetic/repro/` — never the
  repo root.
- Echo pwd in the first commit message. Commit after each unit (WIP fine); append-only
  `docs/changes/flagship-hos-hermetic/progress.md`; NEVER `--no-verify`; commit timeout ≥ 8 min.
- `git push -u origin fix/flagship-hos-hermetic` after the first substantive commit AND at the end.
- Gates before DONE: the flagship test green 5× in a row under BOTH orders you found; contract gate
  (`bun test compiler/tests/{unit,integration,conformance}`) 0 fail; `bun scripts/browser-baseline.ts
  --check` PASS with the 48 asserted names UNCHANGED (baseline NOT re-cut).

## Final report (raw data, not prose for a human)
FINAL_SHA · branch · files touched · the MECHANISM in two sentences · the writer file(s) · the
deterministic repro command · differential count (if compiler touched) · sorted-order tier result ·
whether any PA-located locus above was wrong · the maps load-bearing finding.
