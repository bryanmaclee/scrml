# F1 REFRAME — native silently drops the §51.0 engine substrate (supersedes the SURVEY's "F1 narrow" conclusion)

**Date:** S163, 2026-06-04 (PA-discovered during B1 R26 dual-verify). **Status:** corrects `SURVEY.md`.

## What the SURVEY got wrong

`SURVEY.md` concluded "F1 is narrow — 24/35 engine files compile clean under native; only 4 are genuinely engine-arm-body (2 ruling + 2 bugs)." **That conclusion is the S139 "node-check-clean ≠ correct" trap, applied at the survey level.** The survey measured **fatal-error-absence**, not **output correctness**. The "clean" 24 engine files **silently miscompile** under native.

## The real finding (PA byte-compare, verified)

Native (`--parser=scrml-native`) **drops the entire §51.0 engine substrate** on engine-bearing files. Verified on `engine-modern-001-basic` (a SURVEY-"clean" file) and `examples/14-mario-state-machine.scrml`:

| Emit (in client.js) | native | default |
|---|---|---|
| `__scrml_engine_<var>_transitions` (transition table) | **dropped** | present |
| auto-declared engine var init `_scrml_reactive_set("phaseTag","Idle")` | **dropped** | present |
| `§51.0.D` engine mount / body-render | **dropped** | present |
| transition write form | `_scrml_reactive_set("phaseTag", PhaseTag.Loading)` (plain, **NO rule= validation**) | `_scrml_engine_direct_set("phaseTag", PhaseTag.Loading, __scrml_engine_phaseTag_transitions)` (§51.0.F validated) |
| `_scrml_engine_` occurrences (engine-modern-001 client.js) | **0** | 7 |
| `__scrml_engine_` occurrences (mario client.js) | **0** | 6 |

Native compiles these **clean** (no fatal error) but emits the `<engine>` as a **dumb reactive cell** — it loses transition-table validation, the §51.0.F rule= contract, mount/body-render wiring, and var-init. This is a **silent miscompile** affecting EVERY engine file under native, not just the 4 the survey flagged.

## Why the flip-test (~168) is largely REAL, not inflated

The SURVEY said the "~168" was test-assertion fan-out + mis-attribution over ~4 files. WRONG. The flip-test runs the actual test **assertions** (runtime behavior / output shape), which catch the silent engine-substrate-drop that fatal-error-checking misses. So the ~168 is largely the genuine silent-engine-codegen-drop surface. F1 is the **dominant** swap-grind family, as the S162 triage originally estimated — the survey under-counted it via the fatal-only methodology.

## Root (partially isolated — needs a proper survey)

NOT a missing structural-promotion: `<engine>` IS in native `tag-frame.js STRUCTURAL_ELEMENTS`, and native produces engine-decl/machine-decl nodes (`parse-file.js`, `parse-state-body.js`, `collect-hoisted.js`, `translate-stmt.js`). Native KNOWS the engine var name (`phaseTag`) and the transition targets (`PhaseTag.Loading`) — it emits the onclick handlers correctly. But the **engine codegen path (`emit-engine.ts` / the §51.0.F `_scrml_engine_direct_set` wrapping / transition-table emit / mount) does not fire** for the native-produced engine node. Most likely: the native engine-decl node shape (or its `engineMeta` annotation from the SYM B14/B15 passes) doesn't match what the engine codegen consumes → codegen skips the substrate and falls back to plain reactive-cell emission. **Root-cause survey needed** to isolate whether the gap is (a) native engine-node shape, (b) SYM engine-registration not recognizing the native node, or (c) codegen recognition.

## What is SOLID despite this

**B1 (reset → reset-expr) is correct, landed (`6ad8ca13`), and R26-verified** — orthogonal to the engine substrate (reset is an expression keyword, not engine codegen). The engine-substrate-drop is pre-existing; B1's reset fix merely UNMASKED it on mario (mario failed with the E-SCOPE-001 fatal before B1, so its silently-miscompiled output was never visible). Not a B1 regression.

## Methodology lesson (bank)

**Native-parser-swap parity surveys MUST byte-compare native-vs-default emitted output, NOT just check fatal-error-absence.** "Compiles clean under native" is the S139 trap at the survey level — it passes silent miscompiles. The flip-test (runtime assertions) is the real parity oracle; per-file surveys must add `diff <(native emit) <(default emit)` to be trustworthy.

## Recommendation

The real F1 is the **engine-substrate native-codegen bridge** (L-sized, the dominant swap-grind item). B2 (§51.0.S message-arm parser) is a SUBSET of the engine surface, not a sibling. Next step: a root-cause survey of the native-engine-node → engine-codegen bridge (isolate (a)/(b)/(c) above), then the L-sized fix. Re-measure the flip after.
