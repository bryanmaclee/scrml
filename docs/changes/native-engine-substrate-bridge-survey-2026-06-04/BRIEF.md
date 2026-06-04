# Native-engine → codegen substrate bridge — Phase-0 ROOT-CAUSE SURVEY-STOP

**Dispatch:** S163, 2026-06-04. **Agent:** general-purpose (READ-ONLY — NO project-tree edits). **Model:** opus.
**Change-id:** native-engine-substrate-bridge-survey-2026-06-04.

## What this is

A READ-ONLY Phase-0 root-cause survey. ISOLATE where the native parser pipeline loses the §51.0 engine substrate, then STOP. Do NOT fix. Return all findings as your FINAL REPORT TEXT (the PA archives it). Zero file writes.

## The confirmed bug (PA-verified — do not re-confirm, start here)

Under `--parser=scrml-native`, engine-bearing files **silently drop the entire §51.0 engine substrate** in the emitted client.js. They compile CLEAN (no fatal error) but emit the `<engine>` as a dumb reactive cell. PA byte-compared `engine-modern-001-basic` and `examples/14-mario-state-machine.scrml`, native vs default:

| Emit (in client.js) | native | default |
|---|---|---|
| `__scrml_engine_<var>_transitions` (§51.0.F transition table) | **DROPPED** | present |
| auto-declared engine var init `_scrml_reactive_set("phaseTag","Idle")` | **DROPPED** | present |
| §51.0.D engine mount / body-render | **DROPPED** | present |
| transition write form | `_scrml_reactive_set("phaseTag", PhaseTag.Loading)` (plain, NO rule= validation) | `_scrml_engine_direct_set("phaseTag", PhaseTag.Loading, __scrml_engine_phaseTag_transitions)` (validated) |
| `_scrml_engine_` occurrences (engine-modern-001 client.js) | **0** | 7 |

Repro: `bun compiler/bin/scrml.js compile samples/compilation-tests/engine-modern-001-basic.scrml --output-dir /tmp/n --parser=scrml-native` vs the same without the flag; `diff` the `*.client.js`. This is a SILENT MISCOMPILE (S139 class) affecting EVERY engine file under native — it is the dominant F1 / native-parser-swap failure surface (the flip-test's ~168 catches it via runtime assertions). The prior F1 survey UNDER-counted it by checking fatal-error-absence instead of output (`docs/changes/native-engine-arm-body-f1-survey-2026-06-04/FINDING-engine-substrate-drop.md` records the reframe).

## What is NOT the cause (ruled out)

NOT a missing structural-promotion: `<engine>` IS in `compiler/native-parser/tag-frame.js STRUCTURAL_ELEMENTS`, and native DOES produce engine-decl / machine-decl nodes (`parse-file.js`, `parse-state-body.js`, `collect-hoisted.js`, `translate-stmt.js`). Native KNOWS the engine var name (`phaseTag`) and transition targets (`PhaseTag.Loading`) — it emits the onclick handlers. The gap is in the **native-engine-node → engine-codegen bridge**.

## Your task — isolate WHERE the substrate is lost

Trace ONE engine file (`samples/compilation-tests/engine-modern-001-basic.scrml`) through the native pipeline and compare to the default pipeline at each stage. The engine codegen keys off `engine-decl` ASTNodes in `machineDecls` (per the parse-file.js comment block). Determine which of these is the break:

- **(a) Native engine-node SHAPE.** Does `nativeParseFile` produce an `engine-decl` node in `FileAST.machineDecls` (or wherever the live pipeline puts it)? Does it carry the fields the live `engine-decl` carries (`engineName`/`varName`, `governedType`/`forType`, `initialVariant`, `rulesRaw`, state-children, `derivedExpr`, etc.)? Compare the native engine node to the live ast-builder `engine-decl` node (live: `ast-builder.js` ~L11930 pushes engine-decl into machineDecls). The native synthesis is at `compiler/native-parser/parse-file.js:160-280` (read the comment block — it explicitly discusses live-parity engine-decl + machineDecls).
- **(b) SYM engine-registration.** The SYM passes `walkRegisterEngines` (PASS 10/B14) + `walkValidateEngineStateChildrenAndRules` (PASS 11/B15) in `compiler/src/symbol-table.ts` attach `engineMeta: EngineMetadata` (variants, stateChildren, initialVariant, transitions) to engine-decl nodes — this is what codegen consumes. Under native, does SYM RUN over the native engine node and attach `engineMeta`? Or does the native node shape cause SYM to skip it (so `engineMeta` is absent → codegen falls back to plain reactive emission)?
- **(c) Codegen recognition.** The engine codegen is `emit-engine.ts` (`emitEngineMountHtml`, `emitEngineBodyRenderForFile`), `emit-machines.ts`, `emit-variant-guard.ts`, dispatched from `codegen/index.ts:922` + `emit-html.ts:2046`. Does the codegen's engine dispatch find the native engine node + its `engineMeta`? Does the `_scrml_engine_direct_set` transition-write wrapping (the §51.0.F hook) consult engine metadata that's missing under native, so it falls back to plain `_scrml_reactive_set`?

**Method (mandatory):** byte-compare native-vs-default emitted output at the stage level, NOT fatal-error-absence (the prior survey's mistake — the S139 trap). If you can, dump/inspect the FileAST (`machineDecls`) + the post-SYM annotations under both pipelines for engine-modern-001 and pinpoint the first stage where they diverge. The native pipeline routes via `nativeParseFile` (`compiler/native-parser/parse-file.js`); the live via BS+TAB. Both feed the SAME downstream SYM/TS/codegen.

## STOP + report

Return: (1) the EXACT divergence point — which stage drops the substrate, and whether it's (a) node-shape, (b) SYM-skip, or (c) codegen-recognition (or a combination); (2) the specific missing field / node-shape mismatch / skipped pass, with file+function+line; (3) a FIX DECOMPOSITION — which file(s)/function(s) to change, approximate size (S/M/L), whether it's one cohesive fix or several coupled ones, and whether it can reuse the S162 each/match-promotion bridge pattern; (4) whether B2 (§51.0.S message-arm parser) is subsumed by this fix or remains separate; (5) any other engine sub-features that will need separate native bridging (onTransition, onTimeout, onIdle, history, nested engines, derived engines, effect=). Honest scope — if this is genuinely L (multi-feature), say so.

## Discipline
- READ-ONLY. Edit NOTHING. Return findings as final report text (PA archives as SURVEY.md). You MAY compile files + dump AST to /tmp for inspection; clean up any throwaway worktree.
- `cd /home/bryan-maclee/scrmlMaster/scrmlTS && pwd` + `git rev-parse --abbrev-ref HEAD` (main) at startup. HEAD ~`6ad8ca13` or later. You are NOT in a worktree.
- Read `.claude/maps/primary.map.md` + the "Native-Parser File Table" in `structure.map.md` + `domain.map.md` "Codegen each/match/engine Emit Map" first. SPEC §51.0 (esp. §51.0.B/C/D/E/F/J) is normative.
- SPEC is normative (pa.md Rule 4): native dropping valid engine semantics the live pipeline emits = BUG. Don't soft-classify.
