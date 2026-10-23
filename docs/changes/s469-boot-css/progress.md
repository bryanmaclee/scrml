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

## Round 2 (review LAND-W-F/U; rulings scrml-support `f487d21` + `0908198`)

Rulings applied (user-voice-scrml.md S469 "⭐ RULED — `#{}` CSS on the bootstrap" `f487d21`; "⭐ RULED —
runtime ratchet, scope root, engine in `<empty>`, CSS output" `0908198`):

- (a) **Any malformed `#{}` is E-CSS-SYNTAX** — written into §65.2.5 (new bullet) and §9.1; §34 row updated.
- (b) **`${}` inside `#{}` is never allowed** — §9.1 normative bullet + §65.4.2 note; the bootstrap now emits
  E-CSS-SYNTAX (was E-BOOTSTRAP-UNSUPPORTED) in a value and in a selector. No new code (E-CSS-SYNTAX's row covers it).
- (c) **Component CSS goes inside `renders`** (or a field's variant body there) — §9.1 DQ-7 bullet. The bootstrap
  already refused `#{}` in a declaration body (E-PARSE-DECL-BODY).
- (d) **§25.3 retired** (struck, "§65.3.2 governs"); §25.4's use-site half struck with it; §65.14's table row fixed.
- (e) **DQ-7 → "the page's stylesheet"; either shape conforms** (an inline `<style>` keeps the `<` refusal and the
  `\3c` re-encode). Decision 1 above is now ruled, not a divergence.
- (f) **A component's scoped rules match its own root in real browsers** — §9.1 DQ-7 bullet + §25.6 rule 1. css.scrml
  emits each scoped arm twice: as written (a descendant of the root — inside `@scope` a selector is relative to
  `:scope` as a DESCENDANT, so `.card {}` never matches the root) and ROOT-ANCHORED, `:scope` in its leftmost compound
  after any type selector: `:where(.card), :where(:scope.card)` for a flat arm, `.card:hover, :where(:scope).card:hover`
  for a conditional one (`:where(:scope)` adds no specificity). The donut limit `to ([data-scrml])` still applies.
  Verified in Chromium (below); slice-m3 `css.test.js` and the slice-m4 shape tests re-pinned.
- (g) Engine in a top-level `<empty>` — not touched by this change (no §65 text involves it); left to the bootstrap side.

### Chromium run (the real-browser check)

The machine's Chromium is `/usr/bin/chromium` (the reviewer's probes `scope*.mjs` drove it through playwright's
`chromium.launch({ executablePath: "/usr/bin/chromium" })`; puppeteer's bundled Chrome is not installed, which is why
the slice-m3 oracle cannot launch here). `slice-m4/css-chromium-s469.test.js` uses the repo's own puppeteer dep with
that `executablePath`. It is **OPT-IN** (`SCRML_BROWSER_TESTS=1`, binary `$SCRML_CHROMIUM` else `/usr/bin/chromium`):
CI and the hook have no Chromium, so in the hook it is 4 skipped tests. Recorded run (2026-10-23, Chromium 152, from
`compiler/self-host-v2`, `SCRML_BROWSER_TESTS=1 bun test slice-m4/css-chromium-s469.test.js`): **4 pass, 0 fail** —
the root takes `.card` / `.hit` / `*` / `::before`; a child takes `.card > h2`; the component rule beats the
program-global layer; a nested component's root and subtree, and the page, are not styled by the parent (the donut);
the program-global `@layer` rule applies; a flat block's inline style applies; the §25.7 bridge resolves and follows a
click. **Bite:** with the root-anchored arms removed, the root test FAILS (3 pass / 1 fail) — so the check pins (f).

### Findings fixed

- F1 MED — `ltAt` now skips STRINGS first (a `<` inside a string is found even behind a `/*` in it), then comments (an
  unclosed comment no longer hides what follows). Pack shapes added: content, attribute selector, `@import` string,
  `--x`, §25.2 definition, flat block, `</style>` after an unclosed comment, a `//`-comment neighbour line.
- F3 — `//` is a comment in CSS (SPEC §4.7 says it is unchanged in CSS): at a line start or after whitespace, to the
  end of the line, so `url(http://x)` / `a//b` stay content (the S444 free-text reading, as the PA directed). The block
  is masked once (`maskLineComments`, offsets kept) and `blockEnd` / `blockStop` skip it. Corpus: 88 `.scrml` files
  with `#{` under samples/ examples/ docs/ stdlib/ — 0 E-CSS-SYNTAX. The §65.13 worked example: its `#{}` blocks (with
  their trailing `//` comments) report no E-CSS-SYNTAX; the program as a whole does not compile on the bootstrap
  (`<theme>`, `<defaults>`, style values, `&` nesting, `props={…}`, legacy `<mode> = .Light` — all spec-ahead).
- F4 — the injection pack's header narrowed to the `#{}` stylesheet; `<p style=(@c)>` filed:
  `g-bootstrap-style-attr-bound-value-unguarded-s469` (MED) — it should NOT reuse `cssValueOf` as is (one value vs a
  declaration list); recommended: a `cssDeclarationsOf` guard that admits each `prop: value` through `cssValueOf`.
- F5 — the malformed-`@import` messages rewritten (they no longer show quotes while forbidding quotes); CSS escapes in
  class / id names are accepted and printed as written (`.\31 0`, `.a\:b` — safe: no raw `<` can be in a block, and
  `\3c` is text); a class / id starting with a digit names the escape to write.
- F6 — filed `g-bootstrap-css-residuals-s469` (LOW): `url(@c)` literal, `:root` / `:host` in a scope matching nothing,
  an author `data-scrml` off the root colliding with the scope key. Fixed here: an extra `}` directly after a block is
  E-CSS-SYNTAX (consumed); `-->` / `--x` / `_x` are not element names (E-CSS-SYNTAX).
- F7 — README and NERDME say the guard refuses gradients, transforms, quoted font names and `url()`.

### Proposed edits to scrml-support `docs/workability/bootstrap-map-2026-10-22.md` (for the PA to apply)

- **§1 item 6** ("No author CSS, though the emitter is done.") → "Author CSS (`#{}`) compiles: program-global rules,
  component `@scope` (root included), flat root `style=`, `@cell` values; not yet `@media` / at-rule blocks, `<theme>`,
  `<defaults>`, style values, or the §65.2 conflict checker."
- **Row 9** (CSS contexts `#{}`): status REFUSED → **PARTIAL**. Built: "`#{}` at file top / program / plain element →
  `@layer global`; in `renders` → the component's `@scope` donut with root-anchored arms; a flat block on the root →
  inline `style=`; `@charset` / `@import` hoisted; §25.2 definitions; `//` and `/* */` comments; E-CSS-SYNTAX for any
  malformed block (ruled S469), every `<` refused". Missing: "`@media` / `@supports` / `@container` / `@keyframes` /
  `@font-face` / `@layer` blocks, CSS nesting / `&`, `@apply`, `!important` (§65.7 unclassified), the §65.2 conflict
  checker (`style/program-scope-overlap-soft` FAILs on it), per-instance `@field`". Evidence: "`css-syntax.scrml`;
  analyze `cssPass`; lower `coreCss` / `stampViews`; `print.scrml` `sheetOf` / `cssVarStmts`; `slice-m4/css-s469.test.js`,
  `css-injection-pack-s469.test.js`, `css-chromium-s469.test.js` (opt-in, Chromium); `acceptance/css` (10); change
  `s469-boot-css`". Size: S–M (at-rule blocks: a Core node + emitter; the conflict checker: M).
- **Row 25** (CSS variable syntax): UNSTARTED → **PARTIAL**: "§25.2 `name = value;` → `--name` inside a rule; `@cell`
  → `var(--scrml-cell)` + the guarded `:root` bridge (`rt.cssVar` / `cssValueOf`); §25.3 retired (S469). Missing:
  `<theme>` tokens (`var(--name)`), per-instance fields, bool / enum cells."
- **Row 65** (Native CSS model): keep PARTIAL; Missing becomes "`<theme>` / `<defaults>` / style values (Wave 2), the
  §65.2 conflict checker, `!important` interop, at-rule blocks"; drop "no author styles reach it" and the
  `print.scrml:2317` / `parse.scrml:2744` evidence (both lines are gone).
- **The `#{}` row of the blocker table** (line ~380): "REFUSED at parse; emitter built but unfed" → "compiles (program,
  component, flat root, `@cell`); at-rule blocks and the conflict checker missing".
- **W0 item 0d** (CSS wiring): mark DONE (change `s469-boot-css`); the follow-on is "`<theme>` (blocked on O17) and
  at-rule blocks".

### OWNER_QUESTIONS remaining (after the S469 rulings)

1. `!important` (§65.7 internal vs interop) — rec: E-STYLE-IMPORTANT-INTERNAL when the file has no `@import`.
2. Flat blocks outside a component root (§9.1 ⚑ OPEN) — rec: error everywhere but the root.
3. A top-level `#{}` in a module with no `<program>` — rec: it joins the importing program's global layer.
4. Per-instance `@field` in a component's CSS — rec: a per-instance custom property on the instance root.
5. Bool / enum cells through the bridge — rec: an enum's tag as an identifier value.
6. `g-bootstrap-style-attr-bound-value-unguarded-s469` — rec: guard `style=(expr)` with a declaration-list allow-list.

### After round 2 (origin/main `dba986eb9` merged)

- slices: 3155 pass / 4 skip (the opt-in Chromium file) / 0 fail (3160 tests, 87 files).
- bootstrap-conformance (1809 cases after the merge): PASS 218 = main's 218 · FAIL 52 (main 51; +1 is
  `style/program-scope-overlap-soft`, now graded, wanting the conflict checker) · UNSUPPORTED 858 (main 859) · CRASH 0.
- snippet-gate --strict 0 · claim-gate --strict 0 · SPEC-INDEX regenerated · known-gaps counts regenerated
  (`bun scripts/state.ts --write`, only the count hunk moved).

## Round 3 (final review of e8cf42653: FIX — `url(/*</style>…*/)` hid a `<` from wall 1)

- **Wall 1 is structural.** `ltAt` and its skip rules are deleted. Once the block's extent (`#{` to its matching `}`,
  or to the recovery point of an unclosed one) is found, `firstLt` scans the RAW source slice for `<` skipping nothing
  — no string, comment, `url(` or escape is special. The block is refused whole at its first `<` (E-CSS-SYNTAX, span on
  that `<`; nothing of it is read or printed). Ruling S469 item 1 read literally; the §34 row ("any `<` anywhere in the
  block") is now true as written. A `<` in a CSS comment is refused too (comments are not printed). SOURCE shapes added:
  `url(/*</style>*/)`, `URL(/*<!--*/)`, `/* < */`, `// <`.
- **SPEC:** §65.2.5 drops the "a block an inline `<style>` prints" qualifier (any `<`, nothing skipped); DQ-7 says the
  `<` refusal holds whatever the output shape; the ruling-3 bullet names `E-PARSE-DECL-BODY` for a `#{}` in a §66
  declaration body; the §34 E-CSS-SYNTAX row rewritten to the exact behaviour.
- **Comment model:** `url(…)` contents are verbatim in every scanner (`urlEnd`, bounded — never across a line break or
  a brace, so an unclosed `url(` cannot swallow the block's `}`): `@import url(a/*x*/.css)` keeps its URL, and
  `url( //cdn/x.png)` is a URL (it compiles — the accurate message is none). `\/*` is an escaped slash, not a comment.
  CR-only line endings filed under `g-bootstrap-css-residuals-s469` (item 6).
- **Docs:** `docs/PA-SCRML-PRIMER.md` no longer teaches §25.3; it points to §25.2 / §25.7 / §65.3.2.
- **Runs:** slices 3161 pass / 4 skip / 0 fail; injection pack green; Chromium (opt-in, `/usr/bin/chromium`) 4/4;
  bootstrap-conformance regenerated and `--check` 0 (PASS 218 = main · FAIL 52 · UNSUPPORTED 858 · CRASH 0);
  snippet-gate / claim-gate `--strict` 0; SPEC-INDEX `--check` OK; `state.ts --check` 0. origin/main had not moved
  since the round-2 merge (`dba986eb9`).
