# Phase A1c — Step C15: cross-file engine mount + auto-declared engine variable (M16, M18)

**Phase:** A1c. Wave 4 sequential CLOSER — C12 SHIPPED (`5c910a3`), C13 SHIPPED (`888d0fd`), C14 (in flight at brief authoring time, expected to ship before this dispatch fires). C15 closes Wave 4.
**Estimate:** 5-7h focused (per SCOPE row 233).
**Dispatched:** 2026-05-09 (S74 or later).
**Authority chain:** SPEC §51.0.A (singleton invariant) + §51.0.D (declaration IS mount; cross-file via `<EngineName/>`) + §21.8 (cross-file engine import normative) + Move 16 (auto-derived var name) + Move 18 (cross-file engine sharing). SCOPE-AND-DECOMPOSITION row C15 (`docs/changes/phase-a1c-codegen/SCOPE-AND-DECOMPOSITION.md:233` + `:301` A1b dependencies = B14 + B17). C12+C13+C14 SURVEY HANDOFF sections.

## Goal (one paragraph)

Make cross-file engine mount work end-to-end at codegen. After C15 lands, an engine declared + exported in `engines.scrml` can be imported into `app.scrml` (auto-import alongside its type per §21.8) and mounted via `<engineVarName/>` at any markup position. The mount is a SINGLETON reference — the exporter file emits the engine substrate once (variant cell + transition table per C12; derived computation per C14); importer files emit a render-marker that resolves to the same instance via JS module semantics. Multiple importers see the same instance; multiple mount sites within one importer see the same instance; transitions in any mount-site location update the shared cell.

C15 closes Wave 4. After C15: Wave 4 (engines C12-C15) is SHIPPED end-to-end except for the standing `<onTransition>` / `effect=` / state-child body rendering deferrals (parser-extension blockers documented in C13/C14).

## What's already in place (depth-of-survey signal)

**Spec normative — §21.8 lines 12330-12372 + §51.0.D lines 20301-20347:**
- Importing file references engine via `<engineVarName/>` at desired mount position. ONLY use-site form for cross-file engines.
- Same singleton across all use-sites in all importing files. Cross-file import does NOT create new instance per importer.
- Use-site tag accepts NO attribute slots — engine declaration controls all attributes. Use-site is purely a mount marker.
- Importer's `${import { Phase } from './engines.scrml'}` (just the type) implicitly auto-imports the engine variable when the consumer references it (§21.8 line 12353 — "auto-imported alongside its type when the consumer references the engine's variable").
- Re-exporting an imported engine is legal via §21.4 standard re-export form.
- Importing non-exported engine → E-IMPORT-004.
- A use-site tag mounting an imported binding whose source export is NOT an engine → E-ENGINE-MOUNT-NOT-ENGINE per §34 line ~14386 (already firing per B14 PASS 10.B).

**A1b B14 PASS 10.B (cross-file engine mount validator) — ALREADY SHIPPED** per `compiler/src/symbol-table.ts:3974-4090`:
- Walks markup for self-closing `<X/>` tags
- Resolves against import graph
- If resolved-to-engine: silent (mount valid)
- Else (resolved-to-non-engine): fires E-ENGINE-MOUNT-NOT-ENGINE
- Per line 3993: "Use-site `<EngineName/>` tags at the SAME file scope are NOT engine mounts" — discrimination already established
- Per the discrimination, B14 distinguishes cross-file mount sites from same-file engine declarations + from local components

**A1b B17 deferrals** (per `compiler/src/symbol-table.ts:5128-5139`):
- Engine mount tag `<EngineName/>` INSIDE a component body — DEFERRED (component body markup not parsed)
- C15 should NOT try to handle inside-component cases; B17 will fire when that parser work lands

**Module resolver substrate (mature):**
- `compiler/src/module-resolver.js` — `exportRegistry` (Map<absolutePath, Set<exportName>>), `importGraph`, `validateImports`, `resolveModulePath`
- `compiler/src/name-resolver.ts` — consumes MOD's exportRegistry for cross-file name resolution
- Auto-gather (§21.7) + GATHER_LIMIT 5000 files already enforced

**C12/C13/C14 outputs (consumed by C15):**
- `engineTransitionTableName(varName)` from `emit-engine.ts` — exporter's table accessor name
- The variant cell registered via `_scrml_reactive_set(varName, initial)` (non-derived) or `_scrml_derived_declare(varName, fn)` (derived) — uses canonical varName as the key
- Chunk #18 `engine` triggered on `usage.engines === true` per C13 — needs to also trigger in importer files when they have engine mount sites
- C13's HANDOFF: "engine-decl AST detection arm in `emit-client.ts:detectFromNode` is conservative — triggers `engine` chunk for ANY engine-decl"
- C14's expected output (per BRIEF, not yet landed at this brief authoring time): same emit-engine.ts substrate extended for derived engines

**Test count baseline:** **10,426 / 60 / 1 / 0** (post-C14 close, commit `a945313`).

## Critical design surface — survey questions C15 must answer

**Q1 — How does the exporter expose the engine to importers in the compiled JS?**

The variant cell uses canonical name (e.g., `_scrml_reactive_set("appPhase", "Idle")` per §51.0.C lowerFirst-of-Type or var= override). The `_scrml_state` runtime table is module-scoped (per `runtime-template.js`). Two viable shapes:

- **(a) Shared module-scope state table** — if `_scrml_state` is shared across all compiled scrml modules in the same JS bundle, then importer's `_scrml_reactive_get("appPhase")` automatically resolves to the same cell as exporter's `_scrml_reactive_set("appPhase", ...)`. NO ADDITIONAL JS IMPORT NEEDED beyond ensuring exporter's module has been loaded. Singleton-by-module-load.
- **(b) Per-module state table + explicit cross-module resolution** — each compiled module has its own `_scrml_state`. Importer must JS-import a getter from exporter to read the cell. More plumbing; less natural.

**Lean: (a) — verify `_scrml_state` is module-scope-shared in `runtime-template.js`.** The legacy `<machine>` precedent likely already established this.

**Q2 — How does `<engineVarName/>` use-site emit at codegen time, given body rendering is still DEFERRED?**

Per C12's deferred body-rendering note: state-child bodies are RAW TEXT today; no walkable AST to render. The exporter's engine declaration emits a mount-position marker comment but no actual body markup.

For cross-file mount, the use-site is a self-closing tag in importer's markup. Two sub-questions:
- **(a) Must C15 wait for body rendering to land before cross-file mount works?** Lean NO — C15 ships the SUBSTRATE-PLUMBING (variant cell visibility + render slot), and body rendering follow-on later fills the slot. The use-site emits a placeholder marker (e.g., `// §51.0.D cross-file engine mount: appPhase from ./engines.scrml — body rendering deferred`) and the JS-side ensures the importer module imports the exporter module so the singleton is loaded.
- **(b) JS module dependency** — importer's compiled JS needs `import './engines.client.js'` (or whatever the exporter's compiled output is named) to ensure the exporter's module loads + `_scrml_reactive_set("appPhase", "Idle")` runs. Verify how the existing import lowerer handles this for non-engine cross-file references.

**Q3 — The auto-import behavior per §21.8 line 12353.**

The spec says: `import { Phase } from './engines.scrml'` is sufficient — the engine variable `appPhase` is auto-imported alongside the type when the consumer references the engine's variable (`<appPhase/>`).

This is unusual — most imports require explicit naming. The spec footnote says explicit `import { Phase, appPhase } from './engines.scrml'` is also legal. Survey:
- Does B14/MOD already handle the auto-import (i.e., when codegen sees `<appPhase/>` use-site, can it resolve `appPhase` against the importer's exportRegistry-via-imported-types?), OR
- Does C15 need to do the auto-import resolution itself?

Lean: A1b/B14 has done the heavy lifting (since PASS 10.B already validates mount sites against imports). Verify what annotation B14 leaves on the use-site AST node.

**Q4 — Discrimination at the use-site.**

B14 PASS 10.B distinguishes mount sites from local components / HTML elements via the unified registry (§15.15) + import-resolution. C15 codegen needs to know: at this use-site, is it a cross-file engine mount? A local component invocation? An HTML element? The discriminator already lives in B14/NR; C15 consumes the annotation.

Survey: what AST property distinguishes them? Likely `node.kind === "use-site"` + a `category: "engine" | "component" | "html"` annotation OR a `categoryRoutedTo` field. Find it; consume it.

## Re-scope notice — body rendering still deferred

Per C12 SURVEY: state-child bodies are RAW TEXT today; no walkable AST. Body rendering is DEFERRED to a follow-on step (likely after a parser-extension lands `<onTransition>` + `effect=` + state-child body parsing, since they're all blocked on the same parser-elevation step).

C15 SHIPS the cross-file MOUNT PLUMBING (singleton resolution + use-site visibility + JS module dependency). The actual visual rendering of state-child bodies at the mount position remains DEFERRED. After C15 + body rendering both ship, the canonical `<appPhase/>` use-site will visually render the engine's current variant body.

This is consistent with C12/C13/C14's pattern of substrate-first, body-rendering follow-on.

## Scope (in / out)

**IN scope (C15):**

1. **Use-site detection in importer's markup** — find all `<varName/>` self-closing tags whose `varName` resolves (via NR + MOD's exportRegistry) to an exported engine in another file. Consume B14/NR annotation; do NOT re-derive resolution.

2. **JS module import emission** — for each importer file with cross-file engine mount sites, emit a JS import statement at the top of the compiled JS that loads the exporter's module (e.g., `import './engines.client.js';`). This ensures the exporter's `_scrml_reactive_set` / `_scrml_derived_declare` calls run at importer module load. Survey-confirm the existing import lowerer pattern + use it for engine cases.

3. **Mount-position marker emission at use-site** — at each `<engineVarName/>` use-site, emit `// §51.0.D cross-file engine mount: <varName> from <exporterPath> — body rendering deferred to follow-on`. Mirrors C12's same-file mount-position marker pattern.

4. **Singleton verification** — multiple use-sites in the same importer (or across different importers) MUST resolve to the same `_scrml_reactive_get("varName")` cell. Verify via test: same-cell-identity assertion across multiple mount sites.

5. **Auto-import behavior** — when importer writes `import { Phase } from './engines.scrml'` (just the type) AND uses `<appPhase/>` at use-site, C15's emission MUST ensure the engine variable becomes accessible. This may require:
   - The JS module import (item 2) which loads the exporter's module-scope `_scrml_reactive_set("appPhase", ...)` call
   - A note in the importer's compiled JS that `_scrml_reactive_get("appPhase")` is a valid read
   - The variable is reactive-cell-resolved via the shared `_scrml_state` table

6. **Re-export support** — if importer file `re-exports` the engine (e.g., `export { Phase } from './engines.scrml'`), the engine remains the same singleton. C15 must not duplicate-emit the substrate; the exporter file is the only emission site.

7. **Tests:** `compiler/tests/unit/c15-cross-file-engine-mount.test.js`. Cover at minimum:
   - Single-file importer + exporter pair: importer's `<appPhase/>` resolves to the singleton.
   - Multiple importers of same engine: all see same singleton; transition in any updates all.
   - Multiple use-sites in one importer: all see same singleton.
   - Importing a non-engine: still fires E-ENGINE-MOUNT-NOT-ENGINE (regression-guard for B14).
   - Importing a non-exported engine: fires E-IMPORT-004 (regression-guard for MOD).
   - Re-export legal: re-exporter doesn't duplicate substrate; final consumer still sees same singleton.
   - Same-file engine declaration NOT regressed (C12/C13 path still works).
   - Derived engines also support cross-file mount (uses C14's `_scrml_derived_declare` substrate; mount-site emission is the same shape).
   - Auto-import: importer brings only `Phase` into scope, uses `<appPhase/>` at mount — works without explicit `appPhase` import.

**OUT of scope (deferred):**

- **State-child body rendering** — BLOCKED on parser-extension. Same-blocker-as-C12.
- **`<onTransition>` + `effect=` firing** — BLOCKED on parser-extension. Same-blocker-as-C13/C14.
- **Engine mount tag `<EngineName/>` INSIDE a component body** — A1b B17 deferred this; C15 should not handle (B17 follow-on territory).
- **Inline-named engine cell mount in same file** — same-file engines render at decl position per §51.0.D; no use-site tag form. C15 handles cross-file ONLY.
- **`pinned` import semantics** (§21.8.1) — already enforced at A1b; C15 does not need to add runtime hooks.
- **Cycle detection across cross-file derived engines** — A1b's job (§31 dep-graph machinery extended to cross-file).

## Spec verification (pa.md Rule 4)

Spec sections to read (verbatim) BEFORE writing emission:

- **§21.8** (lines ~12328-12395) — cross-file engine import normative. Specifically: lines 12330 (Move 18 formalisation), 12353 (auto-import alongside type), 12366-12372 (normative statements list).
- **§51.0.D** (lines ~20301-20347) — declaration IS mount; cross-file via `<EngineName/>`; singleton across mount sites; render-only mount.
- **§51.0.A** (lines ~20195-20218) — singleton invariant.
- **§15.15** (referenced from §21.8 line 12369) — unified state-type registry; resolution path for cross-file tags.
- **§21.4** (re-export form) — to verify re-export semantics for engines.
- **§34** rows: E-IMPORT-004 (line 12247), E-ENGINE-MOUNT-NOT-ENGINE (line ~14386).

If derived planning docs contradict §21.8 or §51.0.D, **SPEC WINS.** Quote in SURVEY.

## Dispatch protocol

S67 worktree-as-scratch / file-delta landing.

## Authorized decisions

- **File locus:** EXTEND `compiler/src/codegen/emit-engine.ts` for cross-file mount-site emission. Sibling functions to C12/C14: `collectCrossFileEngineMounts(fileAST, ctx)`, `emitCrossFileEngineMount(useSiteNode, importerPath, exporterPath)`. The JS module import emission likely lives in an existing import lowerer file — survey to find (`emit-client.ts` or sibling).
- **Runtime locus:** No new runtime helpers expected. Reuse `_scrml_reactive_get/_set` (chunk `core`) + `_scrml_derived_declare/get` (chunk `derived`). The `engine` chunk #18 may need to be triggered in importer files too (when `usage.engines === true` from cross-file mount sites — survey).
- **Test file:** `compiler/tests/unit/c15-cross-file-engine-mount.test.js`.
- **Naming convention:** `_scrml_engine_<varName>_transitions` continues (exporter-emitted; importer references via shared module state).

## Sibling-dispatch awareness

**Parallel sibling: B17.2** (parser-extension for `<onTransition>` + `effect=`) is dispatched in parallel with this C15 dispatch. File-disjoint:
- C15 touches: `compiler/src/codegen/emit-engine.ts`, `compiler/src/codegen/emit-client.ts`, possibly `compiler/src/codegen/emit-html.ts`, possibly `compiler/src/codegen/usage-analyzer.ts`, possibly an existing import-lowerer file under `compiler/src/codegen/`.
- B17.2 touches: `compiler/src/engine-statechild-parser.ts`, `compiler/src/symbol-table.ts`. NO codegen files.

**Zero file overlap expected.** S67 worktree-as-scratch handles file-disjoint parallel dispatches cleanly. If you find yourself about to edit `compiler/src/engine-statechild-parser.ts` or `compiler/src/symbol-table.ts`, STOP — that's B17.2's territory; surface to PA.

C13 + C14 must both have landed before this dispatch fires — C15 consumes their substrate (variant cell naming + transition table accessor + derived-declare reuse). Both have landed at brief-author time (commits `888d0fd` + `a945313`).

## Anti-patterns reading

`scrml-support/docs/gauntlets/BRIEFING-ANTI-PATTERNS.md` — cross-file singleton state has heavy Redux-Provider / React Context / Vue Pinia / Zustand training-data bias. The scrml shape is `import { TypeName } from './engines.scrml'` + `<engineVarName/>` use-site, NOT `<Provider store={...}>` wrapper or `useStore(/* selector */)` hook.

`docs/articles/llm-kickstarter-v1-2026-04-25.md` — kickstarter context.

## File-modification inventory expected

| File | Reason |
|---|---|
| `compiler/src/codegen/emit-engine.ts` | Extend with cross-file mount-site emission helpers |
| `compiler/src/codegen/emit-client.ts` (likely) | Wire cross-file mount detection + JS module import emission; possibly extend engine chunk-trigger to include cross-file mount sites |
| `compiler/src/codegen/emit-html.ts` (possible) | If use-site `<engineVarName/>` tags flow through the markup walker dispatch, add the engine-mount arm |
| Existing import-lowerer file (find via survey) | Wire engine-mount JS module import (probably an extension of existing cross-file component import pattern) |
| `compiler/src/codegen/usage-analyzer.ts` (possible) | If `engines` flag needs widening to include cross-file mount sites in importer files |
| `compiler/tests/unit/c15-cross-file-engine-mount.test.js` (NEW) | Unit tests per §scope IN item 7 |
| `docs/changes/phase-a1c-step-c15-cross-file-engine-mount/{progress,SURVEY}.md` | Crash-recovery + survey output (REQUIRED) |

## Definition of Done

- All §scope IN items shipped (use-site detection + JS module import + mount marker + singleton verification + auto-import + re-export + tests).
- 0 regressions vs baseline (10,426 / 60 / 1 / 0).
- Spec re-verified against §21.8 + §51.0.D text directly per pa.md Rule 4.
- Legacy `<machine>` cross-file path NOT regressed (if any exists).
- Same-file engines (C12/C13/C14) NOT regressed.
- A1b B14's E-ENGINE-MOUNT-NOT-ENGINE + MOD's E-IMPORT-004 still fire correctly.
- **Wave 4 declared CLOSED** in the final report (C12 + C13 + C14 + C15 all shipped).
- SURVEY.md documents:
  - Q1 module-scope-shared-state verification (a vs b).
  - Q2 use-site emission shape decision (placeholder marker + JS module import).
  - Q3 auto-import behavior — what B14 annotates vs what C15 must do.
  - Q4 use-site discrimination annotation field name.
  - Verdict shape: SHIP / REFINEMENT / SCOPE-CHANGE / BLOCKER.
- Wave 4 close summary: total tests added (C12 + C13 + C14 + C15), Wave 4 deferral list (body rendering, `<onTransition>`/`effect=` firing, compile-time write validation, inside-component mount), parser-extension step recommendation for unblocking the deferrals.

# CRITICAL — STARTUP VERIFICATION + PATH DISCIPLINE

Your worktree path is: **<ABSOLUTE-WORKTREE-PATH-PROVIDED-BY-HARNESS>**

## Startup verification (do this BEFORE any other tool call)

1. Run `pwd` via Bash. Output MUST equal the worktree path above. Save as WORKTREE_ROOT.
2. Run `git rev-parse --show-toplevel` via Bash. Output MUST equal WORKTREE_ROOT.
3. Run `git status --short` via Bash. Confirm tree is clean.
4. Run `bun install` via Bash. Worktrees do NOT inherit `node_modules`.
5. Run `bun run pretest` via Bash.
6. Run `bun run test` (chained) via Bash. Confirm 10,426 / 60 / 1 / 0 baseline.

If ANY check fails: DO NOT proceed. Report the mismatch and exit.

## Path discipline (enforce on EVERY Read/Write/Edit call)

- For Read: paths under WORKTREE_ROOT are safe.
- For Write/Edit: **ALWAYS use ABSOLUTE paths under WORKTREE_ROOT.** Do NOT use relative paths or paths starting with the main repo root.

If you find yourself about to write to a path starting with the main repo root, STOP. Re-derive from WORKTREE_ROOT.

## Crash-recovery protocol

Commit after each meaningful change. Update `$WORKTREE_ROOT/docs/changes/phase-a1c-step-c15-cross-file-engine-mount/progress.md` after each step.

## Final report format

- WORKTREE_PATH (absolute)
- FINAL_SHA (your branch tip)
- FILES_TOUCHED (list — for PA's `git diff main..<branch> -- <files>` review)
- VERDICT (SHIP / REFINEMENT / SCOPE-CHANGE / BLOCKER)
- TESTS at end: pass / skip / todo / fail counts
- DEFERRED-ITEMS: anything punted to follow-on / PA-decision
- SURVEY summary (one paragraph) — four decisions documented
- WAVE 4 CLOSE SUMMARY: total Wave 4 ships, total tests added, deferral catalog, parser-extension recommendation
