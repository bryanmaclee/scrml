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
