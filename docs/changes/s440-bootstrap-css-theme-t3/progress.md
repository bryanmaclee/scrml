# progress — s440-bootstrap-css-theme-t3

Append-only. Worktree `.claude/worktrees/agent-a07d7b136031a04cd`, base `d244a6f3b` (== origin/main at start).

## 2026-09-28 — Phase 0: reading + measurement (before any code)

Read: dpa-051 in full; SPEC §65 (all), §66.17, §9.1, §25 (all), §26.9; s439 progress/footprint/bite-matrix;
slice-m3 harness/substitute/bench; pipeline-seam.ts; api.js CG call; codegen/index.ts css assembly;
emit-css.ts + emit-theme-reset.ts (impl#1 — reference for WHERE the seam is, not an oracle).

### Governing sentences (quoted)
- §9.1 DQ-7: "`#{}` inside a **state type constructor** compiles to a native CSS `@scope ([data-scrml="ConstructorName"]) to ([data-scrml]) { ... }` block in the output `.css` file. Class names are NOT mangled." / "**Flat-declaration `#{}` blocks** … compile to inline `style="prop: value; ..."` on the containing element. They do NOT appear in the CSS file." / "**Program-level `#{}` blocks** are emitted as global CSS without any `@scope` wrapper."
- §65.2.5: "The compiler SHALL emit `:where()`, **never** `:is()`, for flat wrapping" / "Pseudo-element rules (`::before`/`::after`) are emitted **unwrapped**" / "The compiler SHALL **validate author selectors and fail loud** — it MUST NOT rely on `:where()`/`:is()`'s forgiving-list behavior".
- §65.2: "§65 reuses that same mechanism for every author selector inside a scope (§65.2.5)."
- §65.3.4: reset = box-sizing border-box on `*, ::before, ::after`; margin zeroed on the flow set; `img, picture, video, canvas, svg` → `display: block; max-width: 100%`; form controls inherit `font`; a sane `body` (readability `line-height`; `min-height: 100vh`). "It lives in the bottom **`reset`** `@layer` … **Opt out via `<program reset="none">`**".
- §65.5: "the emitted layer order, **lowest → highest**, is `@layer reset`  <  `@layer global` (the program-global `#{}` escape hatch)  <  **component author scope** (emitted UNLAYERED …)" / "(The theme `:root` custom-property definitions are unlayered …)".
- §65.8: "**Wave-1 emission** ships the ratified sub-order `@layer reset, global;`" / "`@charset` becomes the very first thing in the sheet (byte 0), and `@import` follows the `@layer name;` order declaration but precedes any style rule or `@layer {}` block. Source order among the hoisted statements is preserved; an `@import` nested inside another at-rule block is not hoisted."
- §65.3.2 / §25.7: "`<theme>` tokens **lower to CSS custom properties** (`:root { --brand: #2563eb; }`; a `color: @brand` reference → `color: var(--brand)`)" / "`@name` where `name` is a declared `<theme>` token → `var(--name)`; otherwise → the reactive-cell bridge `var(--scrml-name)`; membership disambiguates."
- §65.6: the runtime reflection "reflects the bound cell's active enum-variant tag onto `:root` as the **`data-scrml-theme-<cell>`** attribute — the SAME attribute the variant selector keys off (`:root[data-scrml-theme-<cell>="Dark"]`)". "A `<theme>` with no `for=@cell` binds no cell and emits no reflection."
- §65.7: "`!important` targeting a property the compiler **can resolve scrml-internally** … SHALL emit **`E-STYLE-IMPORTANT-INTERNAL`**" / interop `!important` "is **ALLOWED**, carrying an info-lint `W-STYLE-IMPORTANT-INTEROP`".
- §66.17 items 1-7 (T3): item 2 "`<brand:string="#338967"/>` inside `<theme>` → `:root { --brand: #338967; }`"; item 3 "The compiler RECOGNIZES a locked token whose initializer is a `match` over an enum-typed cell and emits it as today's variant selector CSS — `:root[data-scrml-theme-<cell>="<Variant>"] { --<token>: …; }`"; item 4 "**One namespace.** … a token and a same-named cell cannot coexist silently"; item 7 "a match-over-enum token the compiler does NOT recognize for the fast variant CSS still lowers — *each token change is a separate `:root` write*".
- OPEN (fail closed, never emitted): O47 (other reactive token shapes); O17 (a) hyphenated names / non-string values, (b) `for=` on a T3 `<theme>`, (c) `@media (prefers-color-scheme)` auto-bind, (d) library-file placement.

### Seam hypothesis — HELD
`pipeline-seam.ts:526-529` is the CG seam (`runCG → { outputs: Map<source, FileOutput>, errors }`), picked
at `api.js:2826`. FileOutput.css is assembled in `codegen/index.ts` from THREE parts: the user stylesheet
(`generateCss`, :2326), Tailwind utilities (`getAllUsedCSS`, §26) and §38 transition keyframes. Only the
first is this dispatch's surface (the brief's list is exactly generateCss's content). So the sub-seam is
the `generateCss` call, not the whole `css` field: Tailwind + transitions stay impl#1's and are appended as
before. The html `<link rel=stylesheet>` depends on css non-nullness (index.ts:2736) — computed AFTER the
swap point, so it stays consistent.

### Measurement: conformance never observes CSS
`conformance/normalize.ts:27` — "Deferred (v1.next): `<head>`, computed CSS/class visual state". The adapter
never loads the stylesheet. So a css swap graded ONLY by conformance passes trivially and certifies nothing:
every css corruption would be "does not bite". A css oracle is required. happy-dom 20.8.9 (probed) IGNORES
`@layer` entirely (a reset-layer-only rule never applies) — unusable for layer order. Real Chromium
(puppeteer, Chrome 146, ~0.7 s launch, ~20 ms/page) resolves `@scope` donut, `@layer` order, `:where()`,
`var()` and the `:root[data-scrml-theme-*]` switch correctly (probed). ⇒ the css half = spec-derived
COMPUTED-STYLE assertions evaluated in Chromium over the real build output (impl#1 html + clientJs,
bootstrap css). Kept in slice-m3 (not the conformance schema — that is a suite-contract decision; flagged).

### Measurement: T3 source cannot reach the css module through impl#1
`<let mode:Mode=.Light/>` + `<theme><ink:string=(match …)/></theme>` compiled by impl#1: E-MARKUP-001
(`<let>`), E-ATTR-001, E-STATE-UNDECLARED, E-THEME-TOKEN-UNKNOWN ×2 — the front end REJECTS it, and the
theme body is captured only as `malformed` TEXT, truncated (`ink:string=(match @mode { … "#e2e8f0"` — the
`})/>` is lost). So T3 is FRONT-END class for every source; the §66.17 lowering is built at the Core level
and proven by unit tests over Core css nodes. Needed next (front end, NOT done here): parse.scrml/analyze/
lower produce the Core css node from `<theme>` + §66 declarations + `#{}`.

## 2026-09-28 — step 1: the CSS sub-seam (compiler/src, seam only)
- pipeline-seam.ts: new registry entry `CSS` ("Stage 8 sub-seam (FileOutput.css)", entry `generateCss`,
  output contract: a string). api.js passes `generateCss: seams.pick("CSS", generateCss)` into runCG;
  codegen/index.ts calls it where it called `generateCss` (+ a 5th arg `{ filePath, mode }`, which
  emit-css.ts's `generateCss` now declares as an unused optional param). Tailwind + §38 keyframes are
  still appended by CG after the user stylesheet.
- BYTE-IDENTITY PROOF: `slice-m3/bench/css-identity.js` snapshots every conformance case (pure impl#1,
  fixed per-case paths — random temp dirs made 629/1048 digests differ between two identical runs at
  first; fixed). Before (base d244a6f3b) vs after: **1048 cases compared, 664 carry css, 0 differ** in any
  artifact digest (html/css/clientJs/serverJs/libraryJs), code list, or css text.
- compiler/tests/integration/css-sub-seam.test.js (3): identity pick; a swapped emitter replaces only the
  user sheet (html + clientJs byte-equal, Tailwind `.p-4` still appended, ctx carries filePath + mode);
  a non-string return → StageSeamError naming CSS. hybrid-stage-swap + hybrid-xfail 26/0.
- types-gate --check: exit 0; no new diagnostic in emit-css.ts / pipeline-seam.ts / api.js (the one
  `codegen/index.ts` line it lists is the pre-existing `./emit-lift.js` TS7016).
