# Component-scoped reactive CSS-var bridge: `_scrml_el` → `document.documentElement`

Fix + regression coverage for a load-time `ReferenceError: _scrml_el is not
defined` crash. Base: `3b62839a` (CSS Wave-1 emission).

## Bug
A `#{ prop: @cell }` (flat decl) inside a `const Card = <div…>` component emitted
a client-top-level bridge targeting `_scrml_el` — an undefined stub for a
per-instance runtime element that does not exist (components are compile-time
INLINED). The whole client bundle halted on load.

## Fix
`emit-reactive-wiring.ts` — the CSS-var bridge always targets
`document.documentElement` (:root). The `bridge.scoped ? _scrml_el : …` ternary
is collapsed. Every cell reaching this path is a GLOBAL reactive cell; the :root
custom property inherits into the component's inline `style="… var(--scrml-name)"`
(§65.3.1 / §25.5). Non-scoped branch was byte-identical → zero blast radius.

## Work log
- [x] `emit-reactive-wiring.ts` — collapse ternary → `document.documentElement`. (57732e84)
- [x] `css-variable-bridge.test.js` T8 — rewrote (asserted the BUGGY `_scrml_el`);
      now asserts documentElement + no `_scrml_el`. (coupled, 57732e84)
- [x] `css-wave1-emission.test.js` TASK 5 — codegen assertion: bridge targets
      documentElement, no `_scrml_el`, inline style consumes var(--scrml-accent). (d1d7880f)
- [x] `browser/browser-component-css-var.test.js` — EXECUTES bundle: no
      ReferenceError; --scrml-accent = #f00 at mount; → #00f after reactive set. (14ecd146)
- [x] `collect.ts` — dead-code cleanup: drop `CSSVariableBridge.scoped`, the
      `isScoped` param, the never-assigned `_constructorScoped` field. (cadcf4b0)
- [x] Conformance case — SKIPPED (not data-testable: domAnchored reaches only
      `<body>`, has no style/custom-prop field; can't assert a documentElement
      custom property. Unit + browser cover it strictly more strongly.)

## Observed (executed bundle)
- load: no ReferenceError
- `--scrml-accent` @ mount: `#f00`
- after `_scrml_reactive_set("accent","#00f")`: `#00f`
- after `_scrml_reactive_set("accent","#0f0")`: `#0f0`

## Not touched (separate pre-existing bugs, PA filing)
- Selector-form `#{ .box { color: @cell } }` in a component: `collectCssVariableBridges`
  doesn't collect selector-NESTED reactiveRefs → no bridge → E-DG-002. Different bug.
