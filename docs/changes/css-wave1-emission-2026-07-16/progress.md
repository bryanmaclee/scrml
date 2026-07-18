# CSS Wave-1 EMISSION (§65) — progress

Branch: feat/css-wave1-emission · base origin/main 9c27ce9a
Worktree: /home/bryan-maclee/scrmlMaster/scrml-css-wave1

## Scope
Finish the CSS Wave-1 EMISSION half. The §65.2 conflict-CHECKER (css-conflict-check.ts)
is DONE + conformance-tested — NOT touched. Close the confirmed emission gaps:
theme token lowering, reset layer, :where()-flat.

## Log (append-only)

### 2026-07-16 — startup
- F4 verified: worktree path + branch (feat/css-wave1-emission) + clean; bun install + pretest OK.
- Map primary.map.md (stamp f079d0a9): load-bearing — pipeline is `compileScrml()` in api.js
  (block-split → AST-build → type-check → codegen); §65 CSS is a compiler feature; codegen at
  compiler/src/codegen/.
- Read SPEC §65 (35200-35618) + §25/§25.7 + §34 catalog region.

### 2026-07-16 — investigation findings
- The brief claim "E-THEME-TOKEN-UNKNOWN already wired — verify it fires" is INACCURATE: the code
  existed NOWHERE in source (only comments). The checker fires only E-STYLE-CONFLICT /
  W-STYLE-CONFLICT-POSSIBLE. Wired E-THEME-TOKEN-UNKNOWN as part of the theme-emission gap.
- `theme-decl` AST node already produced (ast-builder + theme-body-parser.ts): { forCell, baseTokens,
  variants, mediaBinds }. Type-system already infers the `for=@cell` variant type.
- §25.3 variable-USE (`prop: name fallback`) is NOT lowered in current emission (values pass
  through verbatim) — so the token-lowering is conflict-free (first bare-ident rewriter).
- `<program>` markup node carries attrs `[{name, value:{value}}]`; `reset="none"` reachable there.

### 2026-07-16 — impl (commit 6fd89cd2)
- NEW compiler/src/codegen/emit-theme-reset.ts:
  - collectThemeDecls / findProgramNode / readAttrString node walkers.
  - lowerTokenRefsInValue: conservative whole-identifier token→var(--token) rewrite (skips hex,
    --custom-props, function names, url(), string literals).
  - emitThemeCss: base tokens→:root; `.Variant`→`:root[data-scrml-theme-<cell>="Variant"]`;
    `@media`→`@media { :root {} }`; fires E-THEME-TOKEN-UNKNOWN on variant/media token absent from base.
  - RESET_LAYER_CSS (frozen §65.3.4 reset) + emitResetLayer (gated on <program>, opt-out reset="none").
  - wrapSelectorWhere (:where() flat, never :is(), pseudo-elements unwrapped).
- emit-css.ts: threaded tokenNames + flatWrap through renderDeclValue/renderCssBlock/
  renderApplyGroupedDeclarations; theme :root at top, reset at bottom, component-scope selectors :where-wrapped.
- Consequence: the §65.3.4 UNIVERSAL reset means every <program> now emits a stylesheet <link>.
  Fixed 4 byte-identity unit tests (html-colon-shorthand, native-tablefor) to normalize the new
  per-file CSS <link href> — same class of incidental fixture-name noise they already strip
  (<title>, <script src>). Unit + integration + conformance all green independently.
- R26 probe: docs/changes/css-wave1-emission-2026-07-16/repros/themed-app.scrml — all 4 PASS criteria met.

### 2026-07-16 — tests + catalog + registry (this commit)
- §34 catalog row for E-THEME-TOKEN-UNKNOWN (SPEC.md, Rule 4).
- attribute-registry.js: registered `reset` (closed vocab ["none"]) on <program> — was firing a
  spurious W-ATTR-001 and leaking `reset="none"` into HTML; now recognized + not forwarded.
- NEW compiler/tests/unit/css-wave1-emission.test.js (19 tests): token lowering / :root / variant /
  @media / E-THEME-TOKEN-UNKNOWN / reset present+opt-out / :where / lowerTokenRefsInValue edge cases.
- 3 new conformance cases under conformance/cases/style/: theme-variant-rebind-unknown (neg),
  theme-emission-clean (pos), reset-opt-out-clean (pos). Updated theme-tokens-recognized stale NOTE.
  Conformance 642 → 645, all pass.

## Deferred / surfaced (NOT closed this dispatch)
- Runtime @mode→root-attribute reflection (the CLIENT-JS half of §65.6): the `.Dark` reactive
  SELECTOR is emitted, but nothing yet reflects the bound cell's active variant onto
  `<html data-scrml-theme-<cell>>` at runtime, so the theme does not actually SWITCH live. Scoped
  OUT (brief = EMISSION half; R26 = CSS-only). This is the remaining Wave-1 runtime half — touches
  emit-client.ts (which the brief said to avoid).
- E-THEME-TOKEN-UNKNOWN use-site form (§65.3.2 `color: brand`, brand undeclared bare-identifier):
  NOT fired — undecidable vs a valid CSS keyword without a token sigil or a complete CSS-keyword DB;
  a hard error would reject valid CSS (Rule 2). Needs a SPEC decidability ruling (OQ). Wired the
  DECIDABLE variant-rebind-unknown-base case instead.
- --explain-style DX (§65.2.6): OPTIONAL / non-trivial — deferred per brief.
- Flat-declaration inline `#{}` token lowering (emit-html path) + at-rule inner-body token lowering /
  :where wrapping: not covered (selector-path only). Low-frequency; noted.

### 2026-07-16 — S239 FIX ROUND (@-sigil fold + cascade fixes) — commit 2a1aedaa + SPEC
Coordinator dispatched a bundled fix round: the ratified `@` token sigil (supersedes bare refs)
+ 5 confirmed cascade bugs + 2 theme defects + cleanups. NOTE: this ROUND revises the earlier
"E-THEME-TOKEN-UNKNOWN use-site undecidable" deferral above — the `@` sigil MAKES it decidable.
- A. `@`-sigil fold: reference `color: @ink` → var(--ink); BARE identifier NEVER lowered (fixes
  [5] token-shadows-keyword by construction). E-THEME-TOKEN-UNKNOWN = decidable use-site check
  (`@name` ∉ theme tokens ∉ declared cells). Critical discovery: the `@` sigil COLLIDES with the
  §25 reactive-CSS-var bridge (`@cell`→var(--scrml-cell)); resolved by membership (theme token
  first, else the reactive bridge) — css-variable-bridge.test.js stays green.
- [0] wrapSelectorWhere: split comma-list, wrap each arm; [4] don't flatten conditional/state
  selectors (keep layer specificity); [1] reset `@layer` emitted FIRST (lowest); [6] variant-rebind
  check uses GLOBAL base set; [7] variant-only token fires (via global-base check).
- D cleanups: dead IDENT_RE removed; 3 AST walks → 1 (collectThemeContext); flat path reuses render.
- SPEC: §65.3.2 amended (@ sigil + decidable use-site); §25.7, §65.10 table, §34 row, and the §65
  worked examples (§65.3.3/§65.4/§65.6/§65.13) updated to the `@` form.
- Repro per finding under repros/.

### NEW finding surfaced (out of scope — for the coordinator)
- **Component-scope descendant-combinator SPACE collapse (PRE-EXISTING silent-miscompile):** a
  component `#{ .card .title { } }` tokenizes to selector `.card.title` (SPACE LOST) — a descendant
  selector silently becomes a COMPOUND selector (matches an element with BOTH classes, not a
  descendant). Present on base 9c27ce9a (old code emitted `rule.selector` verbatim); NOT introduced
  by this work and NOT in the S239 findings list. Program-level `#{}` preserves the space; only the
  component path collapses it. Confirmed via debug: `wrapSelectorWhere` receives `.card.title`.

### ESCALATED (finding [2]) — component-scope vs program-global precedence
- Component `:where(.link)` (0,0,0) now LOSES to a program-global unwrapped element rule (`a`, 0,0,1)
  — the :where flattening is what exposes it (CSS cascade checks specificity BEFORE @scope proximity).
  §65.5 ranks `component-scope #{}` high and program-global is the §65.9/OQ-8 "escape hatch" OUTSIDE
  the §65.1 resolution algorithm, but NEITHER §65.5 NOR §65.8 CRISPLY places a program-global `#{}`
  rule's LAYER relative to component-scope. Per the coordinator's instruction ("if the spec does not
  clearly rank, STOP and ESCALATE — do not guess a cascade semantic"), NOT implemented. Lean: place
  program-global `#{}` in a layer BELOW the component `author` layer (so component wins), pending a
  ruling.

### 2026-07-16 — finding [2] RULED + IMPLEMENTED (component-scope beats program-global)
bryan ruled: component-scope beats program-global — implement the lean (program-global `#{}` →
a CSS `@layer` below the component author scope).
- emit-css.ts: program-global `#{}` now wrapped in `@layer global { … }`; component `@scope` stays
  UNLAYERED (unlayered > every layer → component wins). Leading `@layer reset, global;` order
  declaration makes the precedence explicit. Layer order (lowest→highest): reset < global <
  component-author (unlayered). Theme `:root` stays unlayered (defines var VALUES).
  - WHY unlayered-component (not `@layer author`): Tailwind CSS is appended UNLAYERED by index.ts
    (which the brief said to avoid); wrapping component in `@layer author` would make it lose to
    unlayered Tailwind (violating §65.8 utilities-LOW). Keeping component unlayered fixes [2]
    (beats program-global @layer) while preserving the existing component-vs-Tailwind behavior;
    the full §65.8 Tailwind-layer integration is Wave-3.
- SPEC §65.5: NORMATIVE — the layer order + "a component's scoped rule wins over the program-global
  escape hatch"; the precedence chain gains the program-global tier; §65.8 gains the `global`-layer
  reconciliation note.
- Repro finding2-component-beats-global.scrml: component `:where(.link)` (unlayered) beats
  program-global `a` (@layer global) — `.link` is green, not red. Verified.
- NOTE (surfaced): program-global `#{}` is now BELOW unlayered Tailwind too (it was unlayered =
  specificity-war with Tailwind before). Consistent with "escape hatch = weakest," but a behavior
  change for any corpus program-global rule that previously beat a utility by specificity. Full
  suite green.

---

## S265 round-4 (land-prep build) — scrml-js-codegen-engineer

### 2026-07-17 — startup
- F4 verified: worktree agent-a35c5b88558286e32; `git reset --hard feat/css-wave1-emission`
  (07a1a694 "[2] component-scope beats program-global via @layer"); `HEAD..origin/main` = 0.
  `bun install` + `bun run pretest` OK. Baseline `bun test unit+integration+conformance`:
  **20641 pass / 0 fail** (confirmed green before any change).
- Map primary.map.md (stamp 0a79d838) load-bearing: pipeline `compileScrml()` in api.js
  (block-split → AST-build → type-check → codegen); §65 CSS is a compiler feature (style.map.md
  ABSENT — tracked in domain.map.md + error.map.md); codegen at compiler/src/codegen/. Confirmed
  against source.
- Read SPEC §65 IN FULL (35231-35651) + §25.7 (16972) + §34 E-THEME-TOKEN-UNKNOWN row.

### 2026-07-17 — TASK 1 [399] @import/@charset hoist (commit: this)
- ROOT CAUSE confirmed: program-global `#{}` wrapped in `@layer global { … }` (emit-css.ts ~399)
  traps top-level `@charset`/`@import` → browser drops them (invalid inside `@layer {}`).
- FIX: NEW `hoistCharsetAndImports(css)` in emit-css.ts — a depth-0 scanner (brace/paren/string
  aware) that lifts top-level `@charset`/`@import` statements out of the program-global body,
  preserving source order; nested (`@media { @import }`) are left. generateCss reassembles in CSS
  ordering law: `@charset` (byte 0) → `@layer reset, global;` (order decl) → `@import`s →
  `@layer reset {…}` → theme `:root` → `@layer global { <rest> }` → unlayered component/theme.
  `layerOrder` "global" now gated on the POST-hoist rest (an import-only block emits no empty layer).
- Empirical: `#{ @charset "utf-8"; @import url("x.css"); a{…} }` → charset byte-0, import above the
  `@layer global {}` block, `a{}` still inside the layer, no `@import` trapped. VERIFIED.
- TEST: +4 tests in css-wave1-emission.test.js (2 pipeline pos, 2 `hoistCharsetAndImports` unit incl.
  the `@media`-nested negative + a `url()`-not-mistaken-for-import guard). 26 pass / 0 fail.

### 2026-07-17 — TASK 2 [86] flat-inline #{} token lowering (commit: this)
- ROOT CAUSE: `renderFlatDeclarationAsInlineStyle` (emit-css.ts) — the flat `#{}`→`style=""` path
  (emit-html.ts, a flat `#{}` child of a component root, DQ-7) used `replaceCssVarRefs`
  (unconditional `@x`→`var(--scrml-x)`), so `@brand` never resolved a theme token + no
  E-THEME-TOKEN-UNKNOWN. This is the DOMINANT `#{}` corpus shape.
- FIX (no forked logic): `renderFlatDeclarationAsInlineStyle(block, ctx?)` now REUSES
  `renderDeclValue` → `lowerCssValueRefs` (identical membership + error semantics to the selector
  path). NEW exported `collectThemeTokenNames(ctx)` in emit-theme-reset.ts (single source of the
  token-name set; `emitThemeCss` refactored to reuse it). emit-html.ts builds ONE `flatInlineLowerCtx`
  from the FULL `fileAST` (shared across the top-level + every nested arm-body generateHtml call, so
  a flat `@brand` inside a match/engine arm still sees program-scope `<theme>` tokens) and threads it
  to the flat call site. `LowerCtx` exported from emit-css.ts.
- Built UNCONDITIONALLY (mirrors generateCss which always builds its LowerCtx) so a themeless-file
  `@nope` fires E-THEME-TOKEN-UNKNOWN exactly like the selector path; `lowerCssValueRefs` no-ops on
  non-`@` values → byte-identical for the common case. Removed the now-dead `replaceCssVarRefs` import.
- Empirical: `#{ color: @brand; padding: 16px; }` → `style="color: var(--brand); padding: 16px;"`;
  `@nope` → E-THEME-TOKEN-UNKNOWN; `@accent` (state cell) → `var(--scrml-accent)`; bare `red` untouched.
- No double-fire: generateCss SKIPS flat-declaration blocks; only emit-html lowers them (component
  scope), only generateCss lowers program-level flat + selector blocks — disjoint.
- TEST: +4 tests (pos lower / neg unknown / reactive-cell bridge / bare-untouched). FULL suite
  unit+integration+conformance: **20649 pass / 0 fail** (baseline 20641 + 8 new from Task 1+2). NO
  corpus regression from the always-build change.

### 2026-07-17 — TASK 3 descendant-combinator space collapse (commit: this)
- ROOT CAUSE (traced empirically, not assumed): the component body `raw` (a logic-token-joined
  string) preserves `#{}` CSS content VERBATIM, but `normalizeTokenizedRaw` (component-expander.ts)
  runs markup-focused collapse passes over the WHOLE body — the S200 member-access collapse
  `([A-Za-z0-9_$\)\]])\s*\.\s*([A-Za-z_$])` → `$1.$2` turns `.card .title` → `.card.title` (a
  DESCENDANT selector silently becomes a COMPOUND one), and the strip-space-before-`>` pass turns
  `.a > .b` → `.a> .b`. tokenizeCSS / the native CSS parser both PRESERVE the space (verified) — the
  damage is ONLY in normalizeTokenizedRaw. (parseCSSTokens/tokenizeCSS are NOT called for a component
  `#{}`; the body reparses via `reparseSynthesizedFile` → nativeParseFile after normalization.)
- FIX (surgical, provably safe): NEW `maskCssBlocks`/`restoreCssBlocks` — mask every `#{ … }` block
  with an inert `\x00<idx>\x00` placeholder (NUL is matched by NO collapse-step char class) BEFORE the
  passes, restore VERBATIM after. The `#{}` content is already clean source, so masking is strictly an
  improvement; the re-parse tokenizes the restored block itself. Brace matching is depth-counted +
  string-aware (`content: "}"`).
- Empirical: `.card .title` → `:where(.card .title)` (descendant, space kept); `.a > .b` →
  `:where(.a > .b)` (child, kept); compound `.card.title` (no space) STAYS `:where(.card.title)`;
  `.btn:hover` stays unwrapped; theme token in a descendant rule lowers (`color: @brand` →
  `var(--brand)`) AND keeps the space.
- TEST: +4 regression tests (descendant / compound-unchanged / child-combinator / descendant+token).
  FULL suite unit+integration+conformance: **20653 pass / 0 fail**. No component-expansion regression.

### 2026-07-17 — TASK 4 runtime theme-switch (§65.6 client half) (commit: this)
- HEADLINE: `<theme for=@cell>` emitted the `:root[data-scrml-theme-<cell>="Dark"]` variant selectors
  but NOTHING reflected the cell's active variant onto <html> → the theme never SWITCHED. Wired the
  client half.
- FIX: NEW `emitThemeSwitchReflection(nodes)` in emit-client.ts — for each `<theme for=@cell>` emits
  `_scrml_effect(function(){ document.documentElement.setAttribute("data-scrml-theme-<cell>",
  _scrml_reactive_get("<cell>")); });`. `_scrml_effect` runs the body at REGISTRATION (mount → initial
  variant, matching first paint) AND on every @cell change (the `_scrml_reactive_get` read establishes
  the subscription) → one `:root` attr write flips the whole page, zero re-render. The attr
  (`themeVariantAttr(cell)` = `data-scrml-theme-<cell>`) is the SAME helper the variant selector uses,
  so client attr == CSS selector attr EXACTLY. The enum-variant cell is stored as its plain tag STRING
  at runtime (`@mode = .Dark` → `_scrml_reactive_set("mode","Dark")`), so `_scrml_reactive_get` IS the
  tag name (no variant→string reinvention). Emitted AFTER cell inits + event wiring. One reflection per
  bound cell (base+variant SPLIT across two `<theme for=@mode>` shares one cell). No `for=@cell` → none.
- CHUNK: `detectRuntimeChunks` now adds `deep_reactive` (`_scrml_effect`) when a `<theme for=@cell>`
  exists (`_scrml_reactive_get` is always-on core). Verified the runtime file DEFINES `_scrml_effect`.
- `@media (prefers-color-scheme)` auto-bind is CSS-native (no runtime reflection); composes on top.
- Empirical: client bundle has `setAttribute("data-scrml-theme-mode", _scrml_reactive_get("mode"))`
  inside `_scrml_effect`; CSS has `:root[data-scrml-theme-mode="Dark"]` — attrs match.
- TEST: +5 tests (reflection-present / attr-matches-selector / reads-via-reactive-get / no-cell-no-
  reflection / split-shares-one-cell). FULL suite unit+integration+conformance: **20658 pass / 0 fail**.
- DEFERRED (per brief — SSR is best-effort): SSR no-flash injection of the INITIAL
  `data-scrml-theme-<cell>` onto the prerendered static `<html lang="en">` (index.ts doc shell).
  Rationale: (a) the client reflection already sets the attr at first JS execution, correct in ALL
  cases; (b) a flash occurs ONLY when the initial variant ≠ base `:root` (uncommon — most apps
  initial=light=base → no flash); (c) baking a theme attr into the SHARED static HTML has
  per-session-theme correctness subtleties + a doc-shell blast radius needing broad HTML-output
  regression coverage; (d) deriving the initial variant string in the shell path needs the state-decl
  → tag-string lowering (non-trivial). FOLLOW-ON. NO new §34 code (reused existing cell/variant + the
  existing E-THEME-TOKEN-UNKNOWN).

### 2026-07-17 — SPEC amendments (Rule 4 — land WITH the impl) (commit: this)
- §65 top banner (35233): rewrote the status — Wave-1 emission is LANDED (lists every implemented
  piece incl. flat-inline lowering + runtime theme-switch + @charset/@import hoist); Waves 2–3 stay
  Nominal with the genuinely-deferred items named.
- §65.6: NEW normative paragraph "The runtime reflection (Wave-1 — Implemented)" — the compiler-emitted
  client-side reactive binding (mount + on-change) reflects `@cell` onto `<html data-scrml-theme-<cell>>`
  (same attr the variant selector keys off), realizes "switch the cell → the whole page flips"; @media
  auto-bind needs no reflection; SSR no-flash prestamp noted as a follow-on refinement.
- §65.4.1: NEW paragraph — the flat-declaration `#{}`→`style=""` path runs the IDENTICAL §65.3.2
  `@`-sigil lowering as the selector path (theme token / reactive cell / E-THEME-TOKEN-UNKNOWN / bare
  untouched) — tokens work in the dominant `#{}` pattern.
- §65.8: NEW bullet — `@charset`/`@import` hoisted out of `@layer global {}` (CSS ordering law:
  @charset byte-0, @import after the @layer name; decl before any block; nested not hoisted).
- §65.15: Wave-1 bullet marked LANDED with the full implemented list.
- NO new §34 diagnostic rows (Task 4 reused existing cell/variant + E-THEME-TOKEN-UNKNOWN). Ran
  `bun run scripts/regen-spec-index.ts` → SPEC-INDEX.md refreshed (32 rows, missing 0) for the shifted
  line numbers.

### 2026-07-17 — CONFORMANCE cases (commit: this)
- +4 cases under conformance/cases/style/ (all PASS; runner is codes-focused — emitted-CSS/JS shape
  is asserted in the source unit test, cross-referenced in each rationale):
  - flat-inline-token-unknown (NEG) — flat `#{ color: @nope }` → E-THEME-TOKEN-UNKNOWN (the strongest:
    a real code assertion proving the flat-inline path shares the decidable use-site check).
  - flat-inline-token-lowering-clean (POS) — flat `#{ color: @brand }` → clean, no E-THEME-*/E-STYLE-*.
  - descendant-combinator-preserved (POS) — component `.card .title` → clean compile (guards the
    space-preservation fix against a re-introduced error).
  - program-import-hoist-clean (POS) — program-global `@import` → clean compile (guards the §65.8 hoist).
- `bun conformance/run.ts`: **738/738 pass** (baseline 734 → 738, +4).

### 2026-07-17 — R26 EMPIRICAL (symptom-gone, not "tests pass")
Final baseline: HEAD 86519ad0 (+ this repro/progress commit). NEW comprehensive repro
`repros/themed-app-r26.scrml` exercises all three round-4 CSS behaviors in one file
(runtime theme-switch + flat-inline `@token` + program `@import` + component descendant selector).

1. themed-app repro `repros/themed-app.scrml` → `/tmp/css-r26`:
   - (a) CLIENT reflection PRESENT + effect-wrapped:
     `_scrml_effect(function() { document.documentElement.setAttribute("data-scrml-theme-mode", _scrml_reactive_get("mode")); });`
2. comprehensive repro `repros/themed-app-r26.scrml` → `/tmp/css-r26b`:
   - (a) client reflection `setAttribute("data-scrml-theme-mode", _scrml_reactive_get("mode"))` PRESENT.
   - (b) flat-inline `#{ background: @bg; padding: 16px; }` → `style="background: var(--bg); padding: 16px;"`
     (flat-inline `@token` LOWERS; bare `padding: 16px` untouched). Selector `.card .title` →
     `:where(.card .title) { color: var(--ink); }` (descendant SPACE kept + token lowered).
   - (c) NO `@import`/`@charset` trapped in `@layer`: emitted order is `@layer reset, global;` →
     `@import url("vendor.css");` (TOP-LEVEL) → `@layer reset {…}` → `:root {…}` →
     `:root[data-scrml-theme-mode="Dark"] {…}` → `@layer global { a { color: var(--brand); } }`
     (the `@import` is HOISTED OUT of `@layer global`; awk trap-check → "OK top-level").
3. Adopter no-regression (base 07a1a694 vs HEAD, 5 changed source files swapped): 8 known-good
   compilation-test fixtures with `#{}` (component-scoped-css, css-001..005, css-scope-01, css-004-layout,
   edge-010-css-in-markup) → **CSS BYTE-IDENTICAL** on all 8; HTML + client.js BYTE-IDENTICAL on the
   4 spot-checked. Confirms round-4 is ADDITIVE (output changes ONLY when a new feature is exercised).
   (Note: samples/card.scrml etc. fail E-COMPONENT-021 on BOTH base + HEAD — a PRE-EXISTING `${...}`
   Phase-1 re-parse limit, unrelated to this arc.)
4. Full gate `bun test unit+integration+conformance`: **20662 pass / 68 skip / 1 todo / 0 fail**
   (baseline 20641 → +21: Task1 +4, Task2 +4, Task3 +4, Task4 +5 unit, +4 conformance). Conformance
   738/738. ZERO new failures.

## ROUND-4 STATUS: COMPLETE — all 4 tasks + SPEC + tests + conformance + R26 green.
DEFERRED (documented, brief-sanctioned): §65.6 SSR no-flash prestamp on the static `<html>` (client
reflection is the normative mechanism; flash only when initial variant ≠ base :root; doc-shell blast
radius + per-session-theme subtleties). NO new §34 diagnostic codes.

### 2026-07-17 — TASK 3 hardening (adversarial self-review) (commit: this)
- Self-review found a robustness gap: `maskCssBlocks` scanned for `#{` WITHOUT top-level string
  awareness, so a LITERAL `#{` inside a component-body attribute string (`title="a#{b}c"`) would be
  wrongly masked + corrupted. Added top-level string/attribute-value skipping (the inner `#{}`
  brace-matcher was already string-aware). Verified: descendant `.card .title` still preserved AND
  `title="a#{b}c"` survives untouched. +1 regression test. Full gate: 20663 pass / 0 fail.

---

## S239 ADVERSARIAL REVIEW — round-4 fixes (S265)

### 2026-07-17 — FIX 1 (HIGH) apostrophe/quote bug in maskCssBlocks (commit: this)
- My earlier "harden" (47573f0c) added top-level string tracking to maskCssBlocks — REGRESSION.
- ROOT CAUSE (debugged, not assumed): an apostrophe in component UI text (`<p>don't panic</p>`) is
  converted UPSTREAM by the logic tokenizer to a SPURIOUS unbalanced `"` in the component-body raw
  (`don "t panic…`), which then swallows a following `#{}` as "string content" → the block escapes
  masking → the collapse regex eats the descendant space (`.card .title` → `:where(.card.title)`,
  MISCOMPILED). The reviewer's proposed `"`-only restriction does NOT fix it (the swallowing char IS
  a `"`). CORRECT fix: REMOVE outer string tracking entirely — mask EVERY `#{}` unconditionally. A
  literal `#{` inside a real attribute string round-trips regardless, because the masked block is
  restored VERBATIM (`title="a#{b}c"` → masked → restored unchanged). The outer tracking was both
  unnecessary AND the regression source.
- Empirical (all 3): `don't` → `:where(.card .title)` (space kept); `title="a#{b}c"` → descendant kept
  + attr preserved; `stay calm` → `:where(.card .title)`.
- TEST: refocused the round-trip test + NEW contraction regression test; NEW conformance case
  style/descendant-combinator-contraction-text. css-wave1 41 pass; conformance 739/739.

### 2026-07-17 — FIX 2 (HIGH) lowering rejects valid reactive cells (commit: this)
- ROOT CAUSE: Task-2/base built `cellNames` for the E-THEME-TOKEN-UNKNOWN membership from
  `collectThemeContext()` (state-decl ONLY). The reactive-style wiring uses `collectReactiveVarNames`
  (the COMPLETE collector: state + derived-state + tilde + engine/machine-projected vars). So a `@name`
  referencing an ENGINE/machine-projected cell (NOT a state-decl) false-fired E-THEME-TOKEN-UNKNOWN.
- EMPIRICAL (executed, both directions): `<engine for=LoadPhase>` projects cell `loadPhase`;
  `#{ .x { color: @loadPhase } }` → WITHOUT fix: FALSE E-THEME-TOKEN-UNKNOWN; WITH fix: clean
  (`var(--scrml-loadPhase)`). (NOTE: a canonical DERIVED `const <doubled>` is a state-decl(shape:derived)
  and was ALREADY handled by collectThemeContext — the reviewer's `const d=@a*2` example; the genuine
  gap is engine/machine/tilde, which FIX2 closes. A plain `const d=@a*2` WITHOUT `<>` is NOT a reactive
  cell — a plain JS const — and correctly still errors.)
- FIX: build `cellNames` from `collectReactiveVarNames(fileAST)` for BOTH the flat-inline (emit-html,
  reusing the already-computed `reactiveVarNames`) AND the selector (emit-css `generateCss`, new
  optional `fileAST` param threaded from index.ts) LowerCtx. A strict SUPERSET of the old set → only
  REDUCES false positives, never adds them; a genuine unknown `@nope` still errors. Fallback to the
  state-decl set for direct `generateCss(nodes)` unit callers (no theme surface).
- TEST: +2 unit (derived-cell clean, engine-cell clean-no-false-fire) + conformance
  style/reactive-cell-lowering-clean. FULL gate: 20668 pass / 0 fail; conformance 740/740.

### 2026-07-17 — FIX 3 (HIGH) theme-switch was DOA — theme tokens wrongly bridged (commit: this)
- META-LESSON applied: EXECUTED the bundle in happy-dom (did NOT grep). CONFIRMED the bug by running
  themed-app-r26's emitted client: `LOAD_ERROR: ReferenceError: _scrml_el is not defined`;
  `data-scrml-theme-mode at mount: null` — the reflection NEVER registered → theme DOA.
- ROOT CAUSE: `collectCssVariableBridges` (collect.ts) collected a `<theme>` TOKEN `@bg` (a flat
  `#{ background: @bg }`) as a §25 reactive-CSS-var bridge, emitting a spurious
  `_scrml_el.style.setProperty("--scrml-bg", _scrml_reactive_get("bg"))` at MODULE scope. `_scrml_el`
  is undefined there (the scoped-bridge target is a pre-existing unbuilt stub) → the bundle throws on
  load → every later statement (incl. the theme-switch reflection) never runs.
- FIX: exclude `<theme>` tokens from `collectCssVariableBridges` — a `@name` resolving to an in-scope
  theme token is a STATIC `var(--name)` (§65.3.2), not a JS bridge. Skip a simple-ref theme token; skip
  an expression bridge only when EVERY ref is a theme token (mirrors emit-css renderDeclValue). Did NOT
  touch the deeper `_scrml_el` scoped-bridge stub (genuine reactive CELLS in a component `#{}` — the
  pre-existing gap the PA is filing separately).
- EXECUTE-VERIFY (happy-dom, the emitted bundle — actual observed values):
  - LOAD_ERROR: NONE (spurious `_scrml_el` bridge GONE — grep count 0, and it EXECUTES clean).
  - `<html data-scrml-theme-mode>` at MOUNT = **"Light"** (the initial variant, first-paint match).
  - after `@mode = .Dark` → **"Dark"**; after `@mode = .Light` → **"Light"** (live subscription, the
    theme demonstrably SWITCHES both directions).
- Genuine reactive-cell bridge SURVIVES: a flat `#{ color: @accent }` (accent = a `<accent>` cell) still
  emits `document.documentElement.style.setProperty("--scrml-accent", …)`; only theme tokens excluded.
- TEST: NEW compiler/tests/browser/browser-theme-switch.test.js (3 tests — EXECUTES the bundle: no
  ReferenceError / mount=Light / switch→Dark→Light). css-variable-bridge.test.js 13 pass (no bridge
  regression). FULL gate: 20668 pass / 0 fail.
