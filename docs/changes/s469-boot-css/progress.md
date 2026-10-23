# s469-boot-css — `#{}` CSS wired through the bootstrap (progress)

Branch `s469-boot-css` (cut from origin/main `0ff6c93aa`, which includes #1510). Bootstrap map W0 item
"0d. CSS wiring": `#{}` → Core `CssUnit` → `print` → `css.scrml`.

## Baselines (origin/main `0ff6c93aa`)

- bootstrap slices (`cd compiler/self-host-v2 && bun test`): 2984 pass / 1 todo / 0 fail (2985 tests, 84 files).
- `bun scripts/bootstrap-conformance.ts`: PASS 217 · FAIL 51 · NOT-TWINNED 679 · UNSUPPORTED 861 · CRASH 0.

## Log

- [x] Phase 0 — read SPEC §9, §25, §65 (whole), §66.15; the emitter `css.scrml` (done, slice-m3) and the
      impl#1-AST shim `css-ingest.scrml` (its selector grammar / value scan are the model); impl#1's
      `emit-css.ts` / `emit-reactive-wiring.ts` (the `--scrml-<cell>` bridge on `:root`).
- [x] Phase 1 — the reader: `css-syntax.scrml` (new module, in the slice-m2 bundle list), `ast.scrml`
      `ANodeK.Css(ACss)`, `parse.scrml` `parseCssNode` at the three `#{` sites (element children, program
      body, file top level). Every `ANodeK` match got its `.Css` arm (21 sites; a Css node is transparent to
      an `if=` chain, analyze `isCssNode` / lower `blankText`).
- [x] Phase 2 — analyze `cssPass` (placement + `@name` resolution + the fail-closed refusals), `Tables.css`.
- [x] Phase 3 — Core `CoreProgram.css: CoreCss | not` (`sheet: CssUnit`, `vars: CssVar[]`); lower `coreCss` +
      root stamping (`data-scrml`, flat-block `style=`); print: one `<style>` (html.scrml `HStyle`, verbatim,
      `<` → `\3c `), the `rt.cssVar` bridge calls at boot; runtime `cssVar` + `cssValueOf` (the guard).
- [x] SPEC §34 row `E-CSS-SYNTAX`; `bun scripts/gen-bootstrap-severity.ts` (E-CSS-SYNTAX, E-THEME-TOKEN-UNKNOWN).
- [x] tests: slice-m4 `css-s469.test.js` (shape, diagnostics, happy-dom), `css-injection-pack-s469.test.js`
      (the CSS security pack — 36 hostile values × the guard and end to end, 7 hostile sources), acceptance
      `acceptance/css/*` (10 cases, STATUS pinned in `slice-m4/acceptance.test.js`).
- [x] fixtures that used `#{}` as "the unsupported example" moved to a `^{}` meta context:
      `compiler/tests/integration/bootstrap-conformance-counter/fixtures/refused/unsupported`,
      `compiler/tests/unit/doc-gate-bootstrap-mode.test.js`, `compiler/tests/unit/doc-gate-round2.test.js`;
      `slice-m2/parse.test.js` F-D now asserts the CSS node (the "never text" invariant kept).
- [x] docs: `docs/tutorial.md` §2.3 marker removed (02c-styles compiles), "#{} style blocks" dropped from the
      03-todos / 10-all-together / README tasks markers (their pins unchanged — no CSS code in their sets);
      README / NERDME / llm-kickstarter "not in the bootstrap" lists corrected. snippet-gate --strict and
      claim-gate --strict exit 0. `docs/bootstrap-conformance.md` regenerated.
- [x] self-attack round: pseudo-class / pseudo-element names validated, `:is/:where/:not/:has` arguments
      parsed (§65.2.5 — a forgiving list never hides a bad arm); non-ASCII names; `<` in a comment allowed;
      `@a.b` refused; a component's own field shadows a program cell of the same name (refused, not bridged);
      the redundant same-name check dropped (the linker already refuses two declarations of one name).

## After

- slices: 3141 pass / 1 todo / 0 fail (3142 tests, 86 files).
- bootstrap-conformance: PASS 217 (unchanged) · FAIL 52 (+1: `style/program-scope-overlap-soft`, now graded,
  wants the §65.2 checker) · UNSUPPORTED 860 (−1) · CRASH 0.

## Decisions (recorded as they were taken)

1. **Where the sheet goes: one inline `<style>` in the page head, not a `.css` file.** The bootstrap already
   printed its §65.3.4 reset there; the author sheet joins it. SPEC §9.1 DQ-7 says "in the output `.css`
   file" — impl#1 writes `<base>.css` + `<link>`. Output shape is an implementation freedom (D3: codes +
   runtime effect); the cost is that an inline `<style>` is a raw-text element a `</style` would end, so the
   reader refuses every `<` in a block (E-CSS-SYNTAX) and `HStyle` re-encodes any `<` that reached it as
   `\3c ` (two walls). Listed as a SPEC/impl divergence for the owner (OWNER_QUESTIONS).
2. **Core carries the sheet** (`CoreProgram.css`), against css.scrml's note that `CssUnit` is "a root of its
   own, NOT a CoreProgram field" (dpa-051 §8.4). That note was written for the impl#1 hybrid's CSS seam; in
   the pure bootstrap the client artifact needs the sheet's §25.7 bridges (`rt.cssVar`) and the page needs
   the sheet, both from `printProgram`, and every driver calls `printProgram(core, …)` — so the sheet rides
   on the Core rather than changing every driver's call. `css: not` when the program writes no author CSS,
   so the M1 hand-built Cores (and the slice-m2 equality oracle) are `css: not`.
3. **`data-scrml` is stamped on EVERY component's root once any component has a scoped sheet**, not only on
   the roots of components with CSS: the donut `@scope (…) to ([data-scrml])` stops at a nested component
   only if that nested root is marked. When no component has a scoped sheet nothing is stamped (no output
   change for CSS-free programs). The compiler owns the attribute there (an author `data-scrml` on that root
   is replaced). A root that renders as an `if=` chain or an `<each>` takes it on each element it can be.
4. **`@name` → program cells only.** A program cell of type int / number / string → `var(--scrml-<name>)`,
   bridged to `:root` (impl#1's target too). A component's own field (per-instance) → E-BOOTSTRAP-UNSUPPORTED
   (no `:root` home; a per-instance bridge is a follow-on). Other cell types → E-BOOTSTRAP-UNSUPPORTED. A name
   that is neither a cell nor a token → E-THEME-TOKEN-UNKNOWN (`<theme>` is refused at parse, so no token
   exists in a bootstrap program).
5. **The bridge's guard (`cssValueOf`)** is an allow-list: a finite number, or a string ≤ 256 chars over
   `[A-Za-z0-9 #%.,+\-*/_()]` whose every function is a colour / math function. A refused value REMOVES the
   property (the `var()` resolves to the property's unset value) and warns without echoing the value
   (the url-guard's convention). impl#1 writes the raw value with `setProperty` (it relies on CSSOM parsing).
6. **§25.2 `name = value;` inside a rule → `--name: value;`** (§65.14: "§25 CSS vars … KEPT"). §25.3
   (`prop: name fallback` → `var(--name, fallback)`) is NOT implemented: it contradicts §65.3.2 ("a bare
   identifier is a literal CSS value"), and impl#1 does not implement it either (OWNER_QUESTIONS).
7. **Conformance**: `style/program-scope-overlap-soft` moves UNSUPPORTED → FAIL — it reaches grading now
   and asserts `W-STYLE-CONFLICT-POSSIBLE`; the §65.2 conflict checker is not in the bootstrap (deferred).
