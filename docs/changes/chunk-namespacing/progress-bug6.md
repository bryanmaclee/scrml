# progress — BUG-6 accessor-rename (S283 execution)

Append-only. Timestamps UTC. Branch `worktree-agent-a91ad13968b46ab5d`.
Plan: `BUG6-RENAME-SCOPING.md` §5 (8 steps). Brief: `BRIEF-bug6-rename.md`.

## 2026-07-23 — startup

pwd = `/home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a91ad13968b46ab5d`.
Startup gate passed: branch correct, tree clean at `096f2239`, `bun install` OK,
pretest populated `samples/compilation-tests/dist/`, `dist` symlinked from main
(ENV-GAP, NOT committed), `dist/scrml-runtime.js` resolves.

Baseline (pre-change) both BUG-6 tests confirmed RED:
- §C10.1 `c10-error-message-resolution.test.js` — core-only assembly contains
  `_scrml_message_for` (via `_scrml_cell_scope` in the core chunk). FAIL.
- gzip `v0-3-x-spa-tree-shake-phase-b.test.js` — SPA runtime **18,346 B gzip**
  vs budget 16,384. FAIL by +1,962. (Matches SCOPING §2.2 HEAD row.)

Read + verified against source (not assumed):
- `_scrml_cell_scope`/`_scrml_cell_key`/`_scrml_cell_name` live in
  `runtime-template.js:828-897`, inside the CORE chunk region (no dedicated
  chunk marker at line 794). Confirmed by the failing §C10.1.
- ESM crux SOUND: `analyzeChunk` (emit-client-esm.ts:150) collects top-level
  `const` declarators via `collectAssignmentTargets`, so `_scrml_cs_*` prologue
  consts are chunkOwnDecls → excluded from imports. `deriveTopLevelExportNames`
  (runtime-esm.ts:256) exports every top-level fn incl. `_scrml_ssr_seed_apply_scoped`,
  so the prologue's real-accessor refs import read-only. No shadow, no TDZ.
- Deleted `cell-namespace-pass.ts` Acorn machinery retrieved from `3b3f6442~1`
  (parse module→script fallback, generic walk, back-to-front splice).

## Plan deltas discovered during reads
- artifact-diff.mjs `unwrapChunkScope` + `fold` currently fold the OLD
  `_scrml_cell_scope(...)` prologue shape; MUST be updated for the new
  `_scrml_cs_*` prologue + `_scrml_cs_`→`_scrml_` call-site rename (step 8 gate).
- test helper `chunk-scope.js` `unwrapChunkScope`/`captureInsideChunkScope`/
  `chunkNamespaceToken` read the OLD prologue; MUST become rename-aware (step 5).
- Emitting a clean `// --- end chunk cell scope ---` end-marker gives every
  fold/unwrap a reliable delimiter.

## 2026-07-23 — resume after transient API drop (ENOTIMP)

Worktree intact at `074f6ddc`. Banking the step-3 scaffold
`cell-accessor-rename.ts` (Acorn callee/reference rename pass, module→script
parse, back-to-front splice, shielded-position guard) as a checkpoint before
touching `index.ts`. e8fdd44c subset baseline + current-HEAD (76-fail) baseline
captured to scratchpad for the step-8 name-diff. Next: wire steps 1-2 (position
metadata + `_scrml_cs_*` prologue) into `codegen/index.ts`.

## 2026-07-23 — steps 1-3 landed (emit mechanism)

`codegen/index.ts`: added `CELL_SCOPE_ACCESSOR_POSITIONS` (arg0/arg01/arg2/
passthrough/ssrApply), `cellScopeWrapper`, `cellScopeKeyFn` (inlined key deriv,
mirrors core `_scrml_cell_key`), rewrote `buildCellScopePrologue` to emit
`_scrml_cs_*` wrappers + end-marker, rewrote `addCellScopePrologue` to split
header/body + run `renameCellAccessors` on the body BEFORE prepending the
prologue. Call site at ~1856 unchanged.

Verified on real emitted output (classic + esm):
- wide: prologue emits only the 4 used wrappers; 15 `_scrml_cs_*` body call
  sites; 0 `_scrml_cell_scope`; 0 leaked bare accessor calls. collision-scan: 0
  colliding tokens.
- ESM CRUX CONFIRMED: alpha.client.js imports the REAL accessors read-only
  (`_scrml_reactive_get`,…); imports ZERO `_scrml_cs_*` (own-decls); no shadow,
  no IIFE. Matches SCOPING §1.3 exactly.
- N4 preserved: `__scrml_engine_01nk4qam_phase_transitions` still namespaced.
Next: step 4 strip core (delete `_scrml_cell_scope`/`_scrml_cell_key`, move
`_scrml_cell_name` to conformance shim, trim banner) + gzip re-measure (STOP gate).

## 2026-07-23 — step 4 (strip core) DONE — gzip GREEN

Deleted `_scrml_cell_scope` + `_scrml_cell_key` + `_scrml_cell_name` from
`runtime-template.js` (replaced with a ONE-LINE pointer); moved the author-name
inverse into the conformance shim as `_conf_cell_name`
(`conformance/adapters/impl1-ts.ts`). `_scrml_ssr_seed_apply_scoped` stays in core.

MEASURED (whitespace-clean, deterministic): SPA runtime gzip = **16,330 B**
(< 16,384 budget by 54 B). §C10.1 GREEN (61 pass / 0 fail). gzip test GREEN
(19 pass / 0 fail).

SCOPING-vs-reality note: SCOPING §2.2 predicted zero-residue = 16,255. My clean
removal proves ZERO CODE residue — the core runtime diffs against base e8fdd44c
by EXACTLY ONE comment line, nothing else. gzip is 16,330 (73 B over base's
16,257) — that entire delta is the one-line pointer comment. The knife-edge is
real: base is only 127 B under budget, PRE-EXISTING (§6 HIGH, bryan's policy call).

## 2026-07-23 — step 5 (rename-aware tooling)

`compiler/tests/helpers/chunk-scope.js`:
- `chunkNamespaceToken` now reads the token from the `// --- chunk cell scope
  (TOKEN) ---` banner (was `_scrml_cell_scope("TOKEN"`).
- `captureInsideChunkScope` rewrites each bare accessor the prologue wraps to its
  `_scrml_cs_` form before splicing (inside the scope the bare name is now the
  UN-namespaced global, not a shadow).
- `unwrapChunkScope` drops the prologue (banner→end-marker) + IIFE, then
  un-renames body `_scrml_cs_*` → `_scrml_*` so no-runtime shims resolve.

`docs/changes/chunk-namespacing/artifact-diff.mjs`: `unwrapChunkScope` matches the
new banner→end-marker prologue; `fold` un-renames `_scrml_cs_*`→`_scrml_*` per
line so body call sites compare equal to base. (These are the two plan-deltas.)

## 2026-07-23 — MECHANISM PROVEN; SCOPING MISCOUNT FOUND (load-bearing)

Mechanism verified COMPLETE + CORRECT:
- Both pinned tests GREEN (§C10.1 tree-shake; gzip 16,330 B < 16,384).
- Acceptance in REAL Chromium, BOTH formats: alpha's rows SURVIVE beta's chunk
  (classic + esm ISOLATED, no clobber, no pageerror).
- ESM crux verified on emitted output; N3 IIFE / N4 nsName preserved; zero core
  code residue (core diffs base by one comment line).

**SCOPING WAS WRONG about the migration surface (§3.2/§3.3).** It claimed "46
files / 160 failures, 129 new" and "the rename re-migrates ZERO already-done
files if the helpers are rename-aware." REALITY: the callee-rename changes
`_scrml_reactive_get("x")` -> `_scrml_cs_reactive_get("x")` at ~959 sites, and the
pre-commit subset jumps from 76 -> **679 failures** (~607 NEW). The SCOPING
measured migration against the reverted SHADOW design (`0581f480`), where the
callee stayed BYTE-IDENTICAL — so ~600 text-assertion tests that pin
`_scrml_reactive_get("x")` in compiled `clientJs` passed there and FAIL under the
rename. The two rename-aware helpers cover EXECUTION harnesses, not text
assertions. True surface: ~131 files using `compileScrml` (1443 accessor-assert
lines across 205 files; not all fire), no central patch point.

Migration PATH proven safe + mechanical: new helper `foldChunkAccessors(js)` folds
`_scrml_cs_X` -> `_scrml_X` (surgical — masks nothing else). Applied once in a
file's shared compile helper at the read boundary. REFERENCE: if-expression.test.js
60/4 -> 64/0 with one 8-line edit. This is NOT the "bulk assertion rewrite" the
S239/§6 laundering warning targets (that was round-1's in-quote key rewrite); a
prefix fold provably cannot mask a non-rename delta.

## 2026-07-23 — DECISION: mechanism DONE + PROVEN; migration SURFACED to PA (182 files)

Precise migration surface (pre-commit subset, HEAD 971fe5c7): **182 firing test
files / 675 failures** — unit 126, integration 38, conformance 6, gauntlet 12.
That is ~4x the SCOPING's "46 files / 160 failures". e8fdd44c subset baseline is
GREEN (0), so all these are arc-migration, NOT pre-existing.

Steps 1-5 + 7 COMPLETE + committed. Step 6 (the 182-file assertion migration) is a
4x-scoped campaign; per the brief's guardrail (do not silently expand scope; STOP
and surface a scope/premise discovery) + §7 (report where the SCOPING was WRONG),
this is SURFACED to the PA rather than ground through unilaterally in-dispatch.

Artifact-diff fold changes VALIDATED (self-consistency: wide at two paths ->
GATE PASS, token-only delta). Reference migration proven (if-expression 60/4->64/0).

RECOMMENDED next: authorize the fold campaign — for each of the 181 remaining
firing files, apply `foldChunkAccessors(clientJs)` once at the file's compile-read
boundary (shared `compile()`/`compileScrml` wrapper where present; else per read).
It is a surgical prefix fold, provably non-laundering. Then step 8 full-tree
verification (acceptance already green both formats; gzip 16,330; C10.1 green;
E-CG-018 catalogued).

Base worktree (e8fdd44c) used for baselines removed.

## 2026-07-23 — MECHANISM FIX: rename pass no longer crashes on pre-existing invalid JS

Found during the fold campaign (batch 1): the rename pass HARD-THREW on the
http stdlib chunk, which emits `await` inside a non-async `function`
(`_scrml__request_1`) — genuinely invalid JS from a PRE-EXISTING async-coloring
quirk (NOT caused by chunk-namespacing; conf-TRY-CATCH passed at 096f2239). My
always-on `renameCellAccessors` parsed it and threw, converting a
previously-tolerated emit into a codegen crash (regression).

FIX (`cell-accessor-rename.ts`): `parseChunk` returns null (not throw) when
neither module nor script grammar accepts the body; `renameCellAccessors` then
leaves the body UNCHANGED. Valid JS always parses, so this only skips genuinely-
invalid chunks (which cannot run anyway — no scope leak that matters), rather than
crash a unit that compiled before the pass existed. http stdlib now compiles;
conf-TRY-CATCH + both BUG-6 tests green (87/0).

SEPARATE PRE-EXISTING BUG surfaced (report, out of scope): stdlib/http emits
`_scrml__request_1` as a non-async `function` containing `await` — invalid JS.

## 2026-07-23 — STEP 6 fold campaign (PA-authorized) + a regression class found

PA ruled: hold the 16 KB budget, run the fold campaign. Executed
`foldChunkNamespacing` (accessor + N4 engine-name + N2 cell-key surgical folds) at
the compile-read boundary across the 182-file surface via a scripted transform
(migrate.mjs — production assign / `+=` / object-prop / destructure / `.get().clientJs`
/ `getOut` / readFileSync-ternary read patterns), committed in batches.

Result: 675 -> ~245 fails as pure text-assertion accessor-pins folded green
(~136 files).

MECHANISM FIXES found mid-campaign (committed):
1. rename pass hard-threw on http stdlib (await-in-non-async, pre-existing invalid
   JS) -> made `parseChunk` return null (no crash).
2. `foldChunkAccessors` lookbehind `(?<![.$\w])` skipped `..._scrml_cs_x` spreads
   -> dropped the `.` (spread now folds).

REGRESSION CLASS found + REVERTED (load-bearing): the BLIND production-point fold
was WRONG for any test that EXECUTES the clientJs (`new Function`/`captureInsideChunkScope`)
or BYTE-COMPARES it (native==live parity, `node --check`, byte-identical). Folding
the EXECUTED clientJs mangles the prologue (`_scrml_reactive_get = n => _scrml_reactive_get(...)`
self-recurses) -> RangeError; folding one side of a parity compare breaks equality.
28-flux "collision" etc. PASSED at step5, my fold broke them. Reverted the fold in
**45 execution/parity/native-harness files** to step5 (they pass via the step-5
rename-aware helpers). The correct migration for THOSE files is surgical — fold at
the `expect(...)` read only, NOT the executed/compared clientJs — a bounded follow-up.

NET: pure-text files migrated; execution/parity files at step5 (no regression).
Residue = pre-existing behavioral (baseline) + execution-file text-pins (un-folded).

## 2026-07-23 — FINAL STATE (converged, 0 regressions)

Full pre-commit subset: **198 fails / 54 files. 0 regressions vs step5** (679 step5
-> 198; ~481 accessor-pin text assertions folded GREEN in ~136 pure-text files;
nothing that passed at step5 fails now).

Residue (198) categorized:
- **61 pre-existing behavioral** — failing at the 096f2239 baseline (pre-BUG-6),
  from the earlier N1-N4 arc (engine runtime-sims, byte-parity, E-IDLE, migrate
  --fix, etc.). Not fold-touchable; leave red, out of BUG-6 scope.
- **137 BUG-6-era accessor-pins in the 45 reverted execution/parity/native files**
  — the blind production-fold was REVERTED in those files (it mangled executed /
  byte-compared clientJs); their `.toContain("_scrml_reactive_get(...)")` assertions
  are now un-folded. FIX (bounded follow-up): surgical fold at the `expect(<X>)
  .toContain(<accessor>)` READ only — NOT the `new Function(clientJs)` execution nor
  a parity `.toBe(...)`. A precise per-file edit; an auto-regex attempt did not match
  reliably and was NOT applied (regression-risk). This is the remaining green gap.

Both pinned BUG-6 tests still GREEN (80 pass / 0 fail). Mechanism unchanged +
proven. E-CG-018 catalogued. The branch is COHERENT (no regressions) but NOT fully
green — the 137 execution-file text-pins are the surfaced, honest residue.
