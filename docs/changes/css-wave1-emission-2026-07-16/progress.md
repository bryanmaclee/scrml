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
