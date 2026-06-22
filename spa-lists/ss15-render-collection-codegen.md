# sPA ss15 — render-collection-codegen

**Launch:** `read spa.md ss15` · **Branch:** `spa/ss15` · **Worktree:** `../scrml-spa-ss15`
**Built:** S214 (2026-06-22) over the S213/S214 render-emission queue.

> **Reproduce-first, always.** Every item below carries an R26 status. Where it says *verify on current
> HEAD* — do the dog-food compile FIRST; if the symptom is gone, classify NOT-REPRODUCED + skip (the
> S214 `bind:value` ghost was a stale-dist report — do not chase one).

## Shared ingestion
The codegen **collection + emit passes over markup**: how render-slots are collected from logic-block
bodies (`collect.ts` / `emit-html` / `emit-control-flow` match-arm path), how Tailwind class-names are
collected (`collect-class-names.ts` / `tailwind-classes.js`), and how `lift` is emitted (`emit-lift.ts`),
INCLUDING the S213 render-bridge `_scrml_request_<id>` deep-reactive model (`<request>`/`<#id>` →
`_scrml_deep_reactive`, landed `fec0a054`). A dev who reads the emit/collection pipeline + the
render-bridge model scopes every item here; nothing needs the type-system or the PRIMER.

## Core files
`compiler/src/codegen/collect.ts` · `compiler/src/codegen/emit-lift.ts` · `compiler/src/codegen/emit-html.ts` · `compiler/src/tailwind-classes.js` (+ `collect-class-names.ts`)

## Items (least-ingestion-first)

1. **`g-tailwind-lint-false-fires-on-scoped-class`** `[open]` bug LOW · tier low — *(warm-up; lowest ingestion)* `W-TAILWIND-UNRECOGNIZED-CLASS` fires on class names defined in the author's own in-scope `#{}` block (the lint only knows Tailwind utilities) → spurious noise on every scoped-CSS component. **files:** `compiler/src/tailwind-classes.js` (the lint) + a `#{}`/`<style>` selector collector (likely `collect-class-names.ts`). **specSections:** §9.1 (DQ-7) / §25.6 / §26. **entry:** `/tmp/css-dogfood.scrml` (S214 dog-food). **briefSeed:** collect the `.class` selectors defined in in-scope `#{}` / `<style>` blocks (component-scope + program-scope — the same set the `@scope` emitter resolves) and exclude them from the unrecognized-class warning. **R26:** CONFIRMED S214 — `@scope ([data-scrml="Card"])` emits correctly yet `card`/`card-title` each draw the lint. Filed `docs/known-gaps.md` §S214.

2. **`g-on-mount-bare-call-render-slot`** `[open]` bug MED→HIGH · tier med — a bare CALL statement in `on mount { f() }` is mis-collected as a render interpolation → emits a `<span data-scrml-logic>` + `_scrml_render_value(el, f())`, printing the call's return as a text node (async fn → visible "[object Promise]" at page top). **files:** the render-slot collector (`collect.ts` / `emit-html` — find where `on mount` / lifecycle block-body statements are collected) + whatever emits `_scrml_render_value`. **specSections:** lifecycle hooks (`on mount`) — verify the SPEC says hook bodies run as EFFECTS, not render values (R4 — read the section before encoding). **entry:** `/tmp/onmount-repro.scrml` (`<x>=0; fn val(){return 42}; on mount { val() }; <div>hi</div>`). **briefSeed:** the collector must treat `on mount` (and other lifecycle-hook) block-body statements as effect statements — run them, emit NO render slot for a bare expression-statement. Behaviour matrix: pure-assignment body = 0 slots; bare call = 1 spurious; trailing assignment does NOT suppress; both default-logic + `${}` modes. **R26:** REPRODUCED S214 — `data-scrml-logic` span × 1 + `_scrml_render_value(el, _scrml_val_2())` in client.js. flogence inbox report `2026-06-22-from-flogence-BUG-on-mount-...`. **NOT yet filed in known-gaps — the sPA files it (or confirm the PA filed it at re-integration).**

3. **`g-request-lift-nested-interp-mangle`** `[open]` bug MED · tier med — `lift <h1>${<#id>.data}</h1>` nested inside a markup-lift block mangles the inner interpolation (emit-lift requestIds-threading gap + content-split corruption). The S213 render-bridge wired the 4 canonical inline forms but DEFERRED the lift-path forms. **files:** `compiler/src/codegen/emit-lift.ts`. **specSections:** §60 `<api>`/`<request>` + §36 input-state registry + the S213 render-bridge (`_scrml_request_<id>` deep-reactive). **priorArt:** the render-bridge landing `fec0a054` (agent a7ebad43, 13 files) — read how `<#id>` refs route to `_scrml_request_<id>` in the INLINE path, then thread the same through emit-lift. **briefSeed:** thread the `requestIds` set into emit-lift so a `<#id>` ref inside a nested markup-lift resolves to `_scrml_request_<id>` (not mangled / not the §36 registry); fix the content-split corruption. **R26:** *verify on current HEAD first* (S213 hand-off scoped it; confirm it still reproduces). Companion of item 4.

4. **`g-request-lift-bare-if-reads-input-registry`** `[open]` bug LOW · tier low — bare `${ if (<#id>.loading) { lift } }` reads the §36 input-state registry instead of `_scrml_request_<id>` (same emit-lift gap as item 3, different shape). **files:** `compiler/src/codegen/emit-lift.ts` (reuses item-3's ingestion). **briefSeed:** route the `<#id>` ref in a bare-`if`-`lift` to `_scrml_request_<id>`. **R26:** *verify on current HEAD first.* Same fix region as item 3 — likely lands together.

5. **`spec-677-worked-example-1-doc-migrate`** `[open]` doc — · tier low — SPEC §6.7.7 Worked Example 1 uses bare `if(){lift}` directly in a `<div>`, now invalid (`E-CONTROL-FLOW-IN-MARKUP`, S204). **files:** `compiler/SPEC.md` §6.7.7. **briefSeed:** migrate the example to the `${}`-wrapped form. **Sequencing:** lands WITH items 3/4 (the canonical lift-path shape they fix). Pure doc — no codegen.

---

## Disposition
*(filled by the sPA during the run — per-item: landed-on-branch SHA / parked + reason / NOT-REPRODUCED / dropped.)*

- **[1]** `g-tailwind-lint-false-fires-on-scoped-class` — **LANDED** spa/ss15 @ `6ad31d8b` (R26-verified).
- **[2]** `g-on-mount-bare-call-render-slot` — **LANDED** spa/ss15 @ `c13bbc48` (positional fix + lift/nested-arm carve-outs; R26-verified).
- **[3]** `g-request-lift-nested-interp-mangle` — **LANDED** (pending commit) — parse-bug span-shift fix; R26 clean (0 mangle-leak).
- **[4]** `g-request-lift-bare-if-reads-input-registry` — **LANDED** (pending commit) — requestIds threaded; R26 clean.
- **[5]** `spec-677-worked-example-1-doc-migrate` — **LANDED** (pending commit) — §6.7.7 ex.1+2 `${}`-wrapped; silent raw-text ship stopped. `not`/`==not` body defects deferred → PA.
- **DEFERRED→PA (1):** E-CONTROL-FLOW-IN-MARKUP diagnostic hole (bare control-flow w/ `lift` body evades gate → silent raw-text ship).
- **DEFERRED→PA (2):** §6.7.7 example currency — `not`-as-negation (E-TYPE-045) + `==not` (E-EQ-002) + pseudo-code body; recommend a sweep.


## Progress
`ss15.progress.md`. Land on `spa/ss15`; ping the PA inbox (`scrml/handOffs/incoming/`) when a batch is ready. Do not advance main / do not push.
