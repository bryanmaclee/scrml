# ss15 items 3+4+5 — `<request>` `<#id>` LIFT-PATH bridge + SPEC §6.7.7 doc migrate (sPA ss15)

> Archived per pa.md S136. change-id: `ss15-items34-request-lift-2026-06-22`. Agent: `scrml-js-codegen-engineer`, `isolation:"worktree"`, `model:opus`. Landed by sPA on `spa/ss15`. Base: `origin/main` 1ce8de34. Three items, one landing (3+4 share the emit-lift fix region; 5 is the doc that the fix makes valid).

## Background — the S213 render-bridge (priorArt `fec0a054`, change-id `request-id-render-bridge-2026-06-22`)
S213 wired the `<#id>` render bridge for `<request>` state in the INLINE path: a `<#id>` ref whose id names a `<request>` routes to `var _scrml_request_<id> = _scrml_deep_reactive({loading,data,error,stale})` (Seam 2) and the binding is `_scrml_effect`-wrapped (Seam 3, reactive). It threads a `requestIds: Set<string>` (built by `collectRequestIds(fileAST)` at `compiler/src/codegen/emit-reactive-wiring.ts:293`, passed via `emitOpts.requestIds` ~line 343) so emit-expr routes inline `<#id>` refs. **It DEFERRED the lift-path forms — that's items 3+4.** `<#id>` refs inside a `lift` body still route to the §36 `_scrml_input_state_registry` (which `<request>` never populates).

## Item 3 — `g-request-lift-nested-interp-mangle` (MED, sPA R26-CONFIRMED on HEAD)
`lift <h1>${<#id>.data}</h1>` nested inside a markup-lift block does TWO wrong things. Repro `/tmp/lift-item3.scrml`:
```scrml
<program>
    ${ for (x of [1,2,3]) { lift <h1>${<#feed>.data}</h1> } }
    <request id="feed" url="/api/feed"></>
</>
```
Emitted client.js (the bug):
```
_scrml_lift_el_2.appendChild(document.createTextNode(String((_scrml_input_state_registry.get("feed").data) ?? "")));   // (a) wrong registry — should be _scrml_request_feed.data
_scrml_lift_el_2.appendChild(document.createTextNode("feed_.data}"));                                                   // (b) CONTENT-SPLIT CORRUPTION — the ${<#feed>.data} interpolation was mangled; a literal "feed_.data}" text node leaked
```
(a) the `<#feed>.data` ref reads the unpopulated §36 registry (`_scrml_request_feed` IS created — `_scrml_deep_reactive` — but the lift body doesn't route to it). (b) the nested interpolation is split/mangled, leaking literal text.

## Item 4 — `g-request-lift-bare-if-reads-input-registry` (LOW, sPA R26-CONFIRMED on HEAD)
Bare `${ if (<#id>.loading) { lift } }` reads the §36 registry. Repro `/tmp/lift-item4.scrml`:
```scrml
<program>
    ${ if (<#feed>.loading) { lift <p>Loading...</p> } }
    <request id="feed" url="/api/feed"></>
</>
```
Emitted: `if (_scrml_input_state_registry.get("feed").loading) {` — should be `if (_scrml_request_feed.loading) {`. Same root as item 3 (emit-lift doesn't thread requestIds), different shape — fixes together.

## THE FIX (items 3+4) — Phase 0 scope-first
The fix region is `compiler/src/codegen/emit-lift.js`. Mirror the S213 inline-path Seams 2+3 into the lift path:
1. **Thread `requestIds`** into emit-lift.js (it currently does NOT receive it). Source: `collectRequestIds(fileAST)` / the `requestIds` set already built in `emit-reactive-wiring.ts` (~line 293/343). Pass it down through the lift-emission call chain (find where emit-lift is invoked from emit-reactive-wiring / emit-html).
2. **Route**: where emit-lift lowers a `<#id>` ref (the `_scrml_input_state_registry.get("<id>")...` emissions — sPA grep located them near `emit-lift.js` ~lines 1255–1314 and ~2357–2377; CONFIRM by reading), when `requestIds.has(id)` emit `_scrml_request_<id>` (with the `.data`/`.loading`/`.error`/`.stale` member preserved) INSTEAD of the registry. Leave §36 input-state `<#cursor>` refs (id ∉ requestIds) routing to the registry UNCHANGED (§36.6 render-once-by-design — do NOT regress them; mirror the S213 §6 test).
3. **Reactivity** (Seam 3): the lift-body binding that reads `_scrml_request_<id>` must take the `_scrml_effect`-wrapped path so a fetch resolve (loading→data) re-renders — `_scrml_deep_reactive` auto-tracks the read. Confirm how the inline path effect-wraps and apply the equivalent in the lift body.
4. **Content-split corruption (item 3)**: fix the nested-interpolation mangle so `lift <h1>${<#id>.data}</h1>` emits ONE correct text-node binding reading `_scrml_request_<id>.data` — no leaked literal `"<id>_.data}"` node. This is likely in the lift-body content-split/tokenize step; find where `${...}` inside a lift markup body is split and why the `<#...>` token corrupts it.

REPORT the Phase-0 finding (where requestIds threads in; whether the content-split is a tokenize bug or an emit bug) before band-aiding.

## Item 5 — SPEC §6.7.7 doc migrate (`spec-677-worked-example-1-doc-migrate`) + FOOTPRINT CORRECTION
SPEC.md §6.7.7 **Worked Example 1** (lines ~4306–4328) AND **Worked Example 2** (lines ~4330–4348) both use bare `if (...) { lift ... } else ... ` control-flow DIRECTLY inside a `<div>` (no `${ }` wrapper). Per §17.4 / §7 control flow in a markup body MUST be wrapped in a `${ ... }` logic block — so these examples are INVALID and predate the S203 rule. **Migrate both** to the `${ if (...) { lift ... } else if ... else ... } }`-wrapped form (wrap the whole `if/else-if/else` chain in one `${ }` inside the `<div>`). Preserve the `<#profile>`/`@user`/`@appConfig` refs and lift bodies verbatim; only add the `${ }` wrapper.

**FOOTPRINT CORRECTION (sPA-verified — do NOT repeat the list's claim):** the list said the example "now [fires] E-CONTROL-FLOW-IN-MARKUP." It does NOT — empirically the bare `if(){ lift … }` form compiles CLEAN and SILENTLY SHIPS THE RAW SOURCE TEXT (`lift <p>Loading...</>`) into the `.html` (a silent-accept). The migration direction is still correct (the form is invalid per §17.4/§7), but the mechanism is a silent raw-text ship, not a fired diagnostic.

**After the items-3/4 fix lands**, the migrated `${ if(<#profile>.loading){ lift … } }` examples should COMPILE CLEAN and route `<#profile>` to `_scrml_request_profile` — compile the migrated Example 1 as a scratch `.scrml` and verify (this is the end-to-end check that item-3/4 fixed the lift path). Note: Example 1's `else if (<#profile>.error)` body has two sibling `lift`s + a `refetch()` onclick — keep them.

## DO NOT FIX HERE — FILE this (sPA found it; PA triages):
**E-CONTROL-FLOW-IN-MARKUP diagnostic HOLE** — bare control-flow whose body contains `lift` (e.g. `<div> if(c){ lift <p>x</> } </>`) EVADES the `block.type==="text"` / `BARE_CONTROL_FLOW_IN_MARKUP_RE` gate at `ast-builder.js:1518` and silently ships raw `lift …` text into the DOM instead of firing the error. The gate fires correctly for bare `for(){ <li> }` (no lift). Add ONE line to `$WORKTREE_ROOT/docs/changes/ss15-items34-request-lift-2026-06-22/progress.md` describing this; do NOT widen this dispatch to fix it (separate item).

## R26 EMPIRICAL VERIFICATION (S138 — before DONE)
Recompile `/tmp/lift-item3.scrml` + `/tmp/lift-item4.scrml` + the migrated Example 1 scratch file. Verify: every lift-body `<#feed>`/`<#profile>` ref reads `_scrml_request_<id>` (NOT `_scrml_input_state_registry`); item-3 has NO leaked `"feed_.data}"` literal text node (one clean `_scrml_request_feed.data` binding); bindings are `_scrml_effect`-wrapped; a §36 `<#cursor>` control still routes to the registry (regression guard); `node --check` clean. Paste before/after client.js shape for each.

## TESTS
Extend `compiler/tests/unit/request-id-render-bridge.test.js` (the S213 suite) with lift-path cases: `${ for(){ lift <h1>${<#id>.data}</> } }`, bare `${ if(<#id>.loading){ lift } }`, and the §36-registry-unchanged regression. Coupled code+test = ONE commit (S113).

## MANDATORY (F4 / S99-S126 / S83 / S198)
- **F4 startup:** `pwd` MUST contain `.claude/worktrees/agent-`. `bun install --cwd "$WORKTREE_ROOT"` + `bun run --cwd "$WORKTREE_ROOT" pretest` first.
- **Path discipline:** ALL edits via Bash (`perl`/`python3`/heredoc) on WORKTREE-ABSOLUTE paths; NEVER `cd` into a main checkout; NO Edit/Write tools. First commit message includes verbatim `pwd`. NOTE: native-parser `.scrml` mirrors may be feature-stale — fix the `.js` (`emit-lift.js`), brief the conditional form if a `.scrml` mirror exists.
- **Tests:** run the FULL `bun run --cwd "$WORKTREE_ROOT" test` (incl. browser + within-node canary) before DONE. Re-baseline shifted within-node fixtures (`M6.5.b.0` allowlist — printed `raw`, in-place) IN THE SAME LANDING.
- Commit incrementally (sub-buckets: 3+4 emit-lift; 5 SPEC.md); `git status` clean before DONE; NEVER `--no-verify`. Progress → `$WORKTREE_ROOT/docs/changes/ss15-items34-request-lift-2026-06-22/progress.md`.

## REPORT BACK
WORKTREE_PATH · FINAL_SHA · AGENT_BRANCH · FILES_TOUCHED (worktree-absolute) · Phase-0 finding · R26 evidence (items 3,4 + migrated Example 1) · the E-CONTROL-FLOW-IN-MARKUP-hole note · full-suite pass/skip/fail · within-node re-baseline. sPA lands via S67 file-delta onto `spa/ss15`.
