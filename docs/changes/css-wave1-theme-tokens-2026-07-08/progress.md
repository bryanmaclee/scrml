# CSS Wave-1: `<theme>` tokens + reactive theming — progress

Feature: SPEC §65.3.2 + §65.6 + §25.7 + §65.9 — the native theming leg.
Dispatch: css-wave1-theme-tokens-2026-07-08 (iso:worktree).

## Phase-0 split decision (SURFACED to PA)

This is the biggest Wave-1 piece; it spans recognition → runtime across 10+ files.
Split at the natural seam per the brief:

- **Phase A (THIS dispatch)** — recognition + typer + corpus migration + Phase-A tests.
  - block-splitter classification (`<theme>` structural opener, raw-body capture)
  - attribute-registry `for=@cell` slot
  - AST node (`theme-decl`) + a dedicated theme-body parser (token bindings +
    `.Variant { … }` sub-blocks + `@media (...)` auto-bind)
  - typer/symbol: variant-set enum-like type; `<theme for=@mode>` binds+TYPES the
    bare cell (bare-variant inference §14.10); token registration per scope
  - corpus migration (§65.9) — the 10 live `<theme>` state-cells renamed
  - Phase-A tests (recognition, AST shape, variant inference)

- **Phase B (follow-on dispatch)** — codegen + runtime + the error code + conformance.
  - emit-css: base tokens → `:root { --brand: … }`; use-site `color: brand` →
    `color: var(--brand)`; variant sub-blocks + `@media` → reactive switching;
    tokens land in the `tokens` @layer
  - **`E-THEME-TOKEN-UNKNOWN`** — REFINEMENT of the brief's suggested split: this
    check is the flip side of the emit-css token-resolution (the var() rewrite),
    and its calibration is the §65.11-flagged risk (a bare CSS identifier vs a
    token ref). It couples to the lowering, so it moves to Phase B where the
    token-resolution table + the CSS-value scan already live. §34 row lands with
    Phase B (Rule 4 — code lands WITH the impl that fires it).
  - runtime: `@mode = .Dark` → one `:root` custom-property-set write (reuse the
    §25 CSS-variable-bridge machinery in emit-reactive-wiring.ts), zero re-render
  - conformance suite

## Reference architecture (load-bearing findings)

- Structural-element recognition: `block-splitter.js` — two sets:
  `STRUCTURAL_RAW_BODY_ELEMENTS` (captures body as one raw text run) +
  `COMPOUND_LIFT_EXEMPT_TAGS` (prevents compound-state-decl misclassification).
  `<onchange>` (§38.13) is the freshest precedent.
- AST construction: `ast-builder.js` `case "markup":` → per-name dispatch
  (`block.name === "onchange"` at ~15023 is the model). Opener-end finder
  (brace/paren/bracket/string aware) + raw-body capture from text-node children.
- CSS body parser: `parseCSSTokens` (ast-builder.js:13169) + `tokenizeCSS`
  (tokenizer.ts:2034). Theme body uses `=` bindings (not `:`), so it needs a
  DEDICATED parser (values are CSS values / token refs).
- attribute-registry: `attribute-registry.js` — `ELEMENT_ATTR_REGISTRY.set(name, {allowedAttrs})`.
  `for=` slot = `attrSpec({ supportsInterpolation: false })` (see channel/engine/formfor).
- Runtime CSS-var bridge (Phase B target): `emit-reactive-wiring.ts:842-868` —
  `document.documentElement.style.setProperty("--scrml-x", …)` inside a
  `_scrml_effect` — the exact zero-re-render mechanism §65.6 reuses.
- §25 var-ref rewrite: `utils.ts:replaceCssVarRefs` (`@x` → `var(--scrml-x)`).

## E-NAME-COLLIDES-RESERVED — pre-existing Nominal gap (SURFACED)

Grep shows `E-NAME-COLLIDES-RESERVED` is NOT implemented for ANY structural
element (engine/page/channel/onchange) — it lives only in SPEC/PIPELINE/INDEX.
So a component/user-type named `theme` firing that code is out of scope here
(implementing it only for `theme` would be inconsistent). Noted as a pre-existing
gap; the `<theme>` reclamation is handled by the block-splitter reservation +
corpus migration.

## Corpus migration targets (§65.9) — 10 files

(non-frozen corpus; scrml8 archive excluded)
- samples/compilation-tests/reactive-018-class-binding.scrml
- samples/compilation-tests/meta-013-runtime-meta-dg002.scrml
- samples/compilation-tests/gauntlet-s79-theme-settings.scrml
- samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-type-enum-inside-program-013.scrml
- samples/compilation-tests/gauntlet-s19-phase1-decls/phase1-reactive-file-level-003.scrml
- samples/compilation-tests/gauntlet-s19-phase4-markup/phase4-attr-interpolated-019.scrml
- samples/compilation-tests/gauntlet-s19-phase4-markup/phase4-dynamic-class-template-076.scrml
- samples/compilation-tests/gauntlet-s19-phase4-markup/phase4-className-ghost-040.scrml
- samples/compilation-tests/gauntlet-s20-meta/meta-runtime-reactive-001.scrml
- examples/05-multi-step-form.scrml

Rename `<theme>` cell → `<themeMode>` (preserves intent; all in-file refs updated).

## Empirical findings (R26)

- Recognition of the block form does NOT break the state-decl `<theme> = value`
  shape (distinct grammar path — verified: standalone cells + a compound
  `signup.theme` field both compile clean post-change). So the reclamation of the
  block/void form is clean; the state-decl form remains a non-enforced Nominal gap
  (consistent with ALL structural elements — E-NAME-COLLIDES-RESERVED is Nominal
  everywhere).
- Only 2 test files actually COLLIDED (used the `<theme/>` void / `<theme>` block
  form): c4-bind-dispatch + block-analysis-footprint. Migrated.
- The 9 standalone-cell `.scrml` files compiled clean without migration; migrated
  anyway per brief item-6 + §65.9 stated-intent.
- s79 has PRE-EXISTING E-TYPE-025/E-SYNTAX-002 (verified with changes stashed) —
  unrelated to theme.

## Status log

- [DONE] Phase A recognition — block-splitter + theme-body-parser + ast-builder +
  attribute-registry. Commit 64aa3b49.
- [DONE] §65.9 reclamation migration (10 files: cell `theme` -> `themeMode`).
  Commit 64aa3b49.
- [DONE] Phase A typer — variant inference from `for=` (bare-variant inference
  §14.10) in type-system.ts + 14 unit tests (theme-tokens.test.js).
- Full blocking gate GREEN post-Phase-A: 19660 pass / 0 fail / 65 skip
  (unit+integration+conformance); browser-class-binding 29/29.
- [DEFERRED to Phase B] emit-css lowering (:root / var() rewrite / tokens @layer),
  E-THEME-TOKEN-UNKNOWN, reactive `@mode` switching, §34 row, conformance suite.
