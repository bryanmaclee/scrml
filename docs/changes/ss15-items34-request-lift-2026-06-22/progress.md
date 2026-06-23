# ss15 items 3+4+5 — <request> <#id> LIFT-PATH bridge + SPEC §6.7.7 doc migrate

## Phase 0 findings (recorded before band-aiding)

### Item 3b — content-split corruption ROOT CAUSE (PARSE bug, not emit)
`preprocessWorkerAndStateRefs` (ast-builder.js) does a LENGTH-CHANGING regex
replace `<#feed>` (7 chars) -> `_scrml_input_feed_` (18 chars), a +11 byte shift,
on a logic block's `bodyRaw` BEFORE `tokenizeLogic`. `tokenizeLogic` locates the
body's BLOCK_REF children by their ORIGINAL absolute spans (`childByStart`,
tokenizer.ts:1168). When a `${...}` interpolation lives INSIDE a lift markup body
(`lift <h1>${<#feed>.data}</h1>`), the interpolation IS a BLOCK_REF child of the
outer for-loop logic block AND preprocesses its own `<#feed>` recursively. The
blind outer `String.replace` ALSO expanded that inner `<#feed>`, shifting the
inner BLOCK_REF off its `childByStart` key. The tokenizer then mis-sliced:
consumed `_scrml_input_` where it expected the BLOCK_REF, leaked the residual
`feed_.data}` as a literal text node. So the `<h1>` got TWO children: a correct
logic block + a garbage `text "feed_.data}"`.

FIX: span-aware preprocessing — skip `<#...>` that fall inside a BLOCK_REF child
span (the inner block preprocesses itself) and re-shift the absolute child spans
for any `<#...>` expanded in non-child text, keeping `childByStart` aligned.

### Items 3a + 4 — requestIds not threaded into the lift path (codegen)
emit-lift lowers `${...}` interpolations through `emitExprField` with NO
`requestIds` in the EmitExprContext, so `<#feed>` fell through to the §36
`_scrml_input_state_registry` (which `<request>` never populates). emit-control-
flow's `emitIfStmt` built the if-condition ctx without `requestIds` too.

FIX (mirror S213 inline Seam 2): thread the file's `<request>` id set into the
lift path via a module-level push/pop stack (`pushLiftRequestIds`/`popLift-
RequestIds` in emit-lift, same single-threaded-codegen justification as the
reconcile-ctx stack). `emitForStmt`/`emitIfStmt` push `opts.requestIds` around
their body emission. A `liftExprCtx()` helper folds the active set into every
lift-body `emitExprField` ctx. emit-expr's existing `_scrml_input_<id>_` ->
`_scrml_request_<id>` routing (emit-expr.ts:541-549) then fires.

Seam 3 (reactivity): a lift-body interpolation that reads `_scrml_request_<id>`
(deep-reactive) is wrapped in `_scrml_effect` so the fetch-resolve (loading ->
data) re-renders (`liftExprReadsRequestState` gate). Mirrors the inline path's
`_scrml_effect(function(){ _scrml_render_value(el, _scrml_request_<id>.data); })`.

## Additional fix surfaced by item 5 end-to-end check (NESTED else-if)
emitIfStmt's bodyOpts did NOT thread `requestIds`, so a NESTED `else if
(<#profile>.error)` (which lowers via emitLogicBody -> emitLogicNode ->
emitIfStmt) lost requestIds and fell back to the §36 registry. SPEC §6.7.7
Example 1's else-if arm caught this. Fix: thread requestIds + scopeVar into the
if/else bodyOpts.

## E-CONTROL-FLOW-IN-MARKUP diagnostic HOLE (DO NOT FIX HERE — for PA)
Bare control-flow whose body contains `lift` (`<div> if(c){ lift <p>x</> } </>`)
EVADES the `block.type==="text"` / `BARE_CONTROL_FLOW_IN_MARKUP_RE` gate at
ast-builder.js:1518 and silently ships raw `lift …` text instead of firing the
error. The gate fires correctly for bare `for(){ <li> }` without lift. Surfaced
to PA via sPA; NOT widened in this dispatch.

## SECOND defect in SPEC §6.7.7 Example 1 — `not`-as-negation (DO NOT FIX HERE — for PA)
The verbatim Example 1 condition `if (<#profile>.loading && not <#profile>.stale)`
uses `not` as a boolean-negation PREFIX. Per §42 / E-TYPE-045, `not` is the
unified absence VALUE, not a logical-negation operator — this fires E-TYPE-045.
So even after the item-5 ${ }-wrap migration, the example does NOT compile clean:
TWO defects — the bare-control-flow form (now fixed by the wrap) AND the `not`-as-
negation. The brief scoped item 5 to ONLY the ${ }-wrapper (bodies verbatim), so
the `not` was LEFT AS-IS in SPEC.md and surfaced here. Canonical fix would be
`&& !<#profile>.stale`. The end-to-end test fixture uses `!` so the lift-PATH fix
is verifiable without the `not` defect masking it.

## Status
- [x] Phase 0 root-cause (item 3b = parse bug; 3a/4 = codegen threading gap)
- [x] Item 3b content-split fix (ast-builder span-aware preprocessing)
- [x] Items 3a+4 requestIds threading + Seam 3 effect-wrap (emit-lift + emit-control-flow)
- [x] NESTED else-if bodyOpts requestIds threading (surfaced by item 5)
- [x] Item 5 SPEC §6.7.7 Worked Example 1+2 ${ }-wrap migrate (bodies verbatim)
- [x] Tests extended (request-id-render-bridge.test.js §8 lift cases + §7 parse)
- [x] R26 verification (items 3,4 + migrated Example 1 + §36 regression)
- [ ] Full suite (pre-commit gate)
