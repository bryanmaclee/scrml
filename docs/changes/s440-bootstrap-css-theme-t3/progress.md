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

## 2026-09-28 — step 2: stylesheet Core + emitter + shim + css half
- core.scrml (ADDITIVE ONLY — appended; no existing type/fn touched): SimpleSel, Combinator, Compound,
  SelLink, ComplexSel, CssPart, CssDecl, StyleRule, TokenArm, TokenInit {Constant, OnVariant, ScriptWrites},
  ThemeToken, CssImport, ScopeSheet, CssUnit. A root of its own (not a CoreProgram field).
- css.scrml (NEW): CssUnit → CssStmt tree → text; footprint. css-ingest.scrml (NEW, throwaway shim):
  impl#1 FileAST → CssUnit + `why`. ingest.scrml: 17 readers gained `export` (behaviour unchanged).
- slice-m3: css-bundle.scrml, css.core.scrml (hand-built T3 Cores), css-substitute.js (the CSS-seam
  substitute), encode.js (the schema-free encoder, now shared with substitute.js), css-oracle.js (the
  Chromium css half), css.test.js (25), bench/css-oracle-both.js, css-oracle/conformance/*.json (17).
- scripts/hybrid.ts: the css half (`gradeCss` / `cssExtraCases` / `gradeCssCores`), `CssHalf` in the
  report, `cssPass/cssFail/cssUnobserved` in counts, a CSS section in the table; css fails are red.
- DECISIONS (each cited in the code):
  - no `<program>` → no reset (§65.3.4 opt-out lives on `<program>`; §65.8 order "emitted once").
    First cut failed closed on it and blocked 249 cases (implicit-program files + module files).
  - `@layer reset, global;` emitted whenever either layer is (§65.8 "a fixed @layer order, emitted
    once") — impl#1 emits it only when BOTH are (spec-directed difference).
  - §65.2.4 R1 floor: inside a scope every unconditional arm is :where()-flat (0,0,0), so a `*` rule
    AFTER `.btn` would win by source order — violating "resolves below class/id/specific author rules".
    Floor arms (`*`, `html`, `body`) are emitted first in their scope (a mixed-arm rule is split).
    impl#1 does not do this (finding, R26).
  - T3 OnVariant with no wildcard arm: one `:root[data-scrml-theme-<cell>="<V>"]` block per arm, no bare
    `:root` default — the literal item-3 emission; before the §65.6 mount-time reflection sets the
    attribute the token is undefined (the first-paint flash §65.6 already names as a follow-on).
  - A component used N times contributes its rules once (first expansion).
- impl#1 F18 (NEW): inside `${}`, the one-char string literal of a tilde compiles to
  `"__scrml_tilde__"` (the §32 `~` lowering reaches into string literals) — silent miscompile; `" ~ "`
  (with spaces) is untouched. Worked around with charCodeAt(0) == 126.
- FIRST GRADE (`--swap CSS=… --footprint`): 1048/1048 classified; GRADED 565 (conformance 565/565 run,
  299 runtime passes, 0 fail); NOT-YET 36; FRONT-END 447. CSS half: 17 css passes of 17 oracle cases.
  Pure impl#1 ALSO passes all 17 oracles (bench/css-oracle-both.js).

## 2026-09-28 — step 3: css-only sources, Core oracles, bite matrix CSS phase, R26
- css-oracle/sources/ (16): 9 graded adversarial sources (scope-donut-nested, layer-order, where-flat,
  r1-floor-order, import-hoist [+ a served theme.css], two-themes, variant-three, selectors, empty-blocks)
  + 7 expected-NOT-graded (adv-important, adv-token-cell-same-name, open-o17a/b/c, open-o47,
  open-t3-worked-example) — the css report lists why each is not graded.
- css-oracle/core/ (6): t3-worked, t3-wildcard, t3-script-writes, t3-two-cells, charset (a windows-1252
  page, so `@charset` is observable), cell-var (the §25.7 bridge's stylesheet half).
- bench/css-oracle-both.js: pure impl#1 vs hybrid on every oracle. impl#1 FAILS r1-floor-order
  (`#b` padding 0px; SPEC R1 says 16px) — impl#1 finding; every other graded oracle passes on both.
- hybrid.ts css half: extras classified by the same loop but kept OUT of the suite buckets; css fails
  red; counts cssPass/cssFail/cssUnobserved. css-half.test.js pins it with a stub grader (no browser).
- css-ingest: a `<theme>` in a file with no `<program>` → not-yet O17(d) (plus library mode).
- bite-matrix.js: now two phases (`--cg-only` / `--css-only`); CSS phase = 36 corruptions (31 emitter,
  5 shim). First CSS run (before cell-var): 31 css passes; 26 CERTIFIED, 0 UNCERTIFIED; Value.CellVar
  "does not bite" (no pass exercised it) → the cell-var Core oracle added.
- impl#1 finding: the §25.7 bridge is DEAD for a stylesheet rule — `.box { width: @w }` emits
  `var(--scrml-w)` but impl#1's clientJs never writes `--scrml-w` (it does for a flat inline `#{}`).
- R26 over the 25 `#{}` examples: 10 identical (whitespace-normalized); 4 differ only by the
  `@layer reset, global;` statement (spec-directed: §65.8 "emitted once"; impl#1 omits it when only the
  reset exists); 11 NOT-YET — `#{}` inside a non-component element (§9.1 "inline or scoped per compiler
  settings"). Samples (49 css/theme sources): 17 rejected by impl#1's front end; 4 identical; 16
  NOT-YET (15 element-level `#{}`, 1 `@keyframes` block); css-scope-01: impl#1 repeats a component's
  rules once per USE (4×), the bootstrap once — impl#1 redundancy, same effect; gauntlet-s79-calculator:
  a `//` comment inside `#{}` becomes garbage declarations `subtle: ; scanline: ; …` in impl#1 — impl#1
  bug (§27.1: `//` is a comment in every context); the bootstrap fails closed on it.

## 2026-09-28 — FINAL numbers (tip b063a7e0e + reports)
- CSS footprint grade (`bun scripts/hybrid.ts --swap CSS=compiler/self-host-v2/slice-m3/css-substitute.js
  --footprint --report …/footprint-css-2026-09-28.md`): exit 0. 1048/1048 classified; GRADED 565
  (conformance run 565/565: 299 runtime passes, 0 fail; codes-only passes are front-end codes); NOT-YET 36;
  FRONT-END 447. **CSS half: 32 css passes of 32** (17 conformance · 9 css-only sources · 6 Core-level);
  548 graded conformance cases carry a stylesheet but no oracle (unobserved — not evidence); 7 css-only
  sources NOT graded (the OPEN / adversarial list).
- CG footprint grade unchanged: 18/18 runtime passes, 10 codes-only, NOT-YET 573, FRONT-END 447.
- Bite matrix (both phases, 331 s, exit 0 → bite-matrix-2026-09-28.md): CG 18 runtime passes, 32
  certified / 0 uncertified (unchanged; Field.Derived shim-mode corruption still does not bite, as s439
  recorded). CSS 32 css passes, 36 corruptions, **27 certified / 0 uncertified**.
  Thin evidence (certified by ONE pass): Css.Global, Css.Import, Css.Charset, Sel.Id, Comb.Child,
  Comb.NextSibling, Comb.LaterSibling, Token.ScriptWrites, Value.CellVar.
- impl#1 conformance (`bun conformance/run.ts`): 1041/1048 pass + 7 xfail — unchanged.
- Suites: slice-m1 73/0 · slice-m2 284/0 · slice-m3 53/0 (css.test 26, css-half 1, bite 3, + s439's) ·
  lint 48 files 0 violations · pre-commit gate (b063a7e0e) 32084 pass / 85 skip / 0 fail.
