# Progress — §65 `<theme>`/`<defaults>` divergence fixes (2026-07-11)

## Status: COMPLETE (branch-only; PA reviews + lands)

## SPEC rules implemented (read in full — Rule 4)
- **§65.9** (SPEC.md ~35202): `<theme>` and `<defaults>` are PROGRAM-SCOPE structural
  elements — an immediate child of `<program>` (a sibling of `<page>` / `<channel>`)
  for v1; page-scope override deferred to v1.next. "Use outside a valid locus is
  `E-STRUCTURAL-ELEMENT-MISPLACED`."
- **§65.10** (~35228): "`<theme>`/`<defaults>` misplacement reuses
  `E-STRUCTURAL-ELEMENT-MISPLACED` (§4.15/§24.4). A component/user-type named
  `theme`/`defaults` reuses `E-NAME-COLLIDES-RESERVED` (§4.15/§24.4)."
- **§4.15** (~1080, ~16645): a user component / markup-const / state-type named a
  reserved structural-element identifier (incl. `theme`/`defaults`, case-insensitive
  — `const engine = <article>` lowercase AND `const Engine = <div>` uppercase) is
  `E-NAME-COLLIDES-RESERVED`.
- **§34** (~18011): `E-NAME-COLLIDES-RESERVED` = "a user-declared component or
  state-type name collides with a reserved scrml structural-element identifier."

## Reproduction (BEFORE)
Divergence A (placement):
- `<theme>` at file top-level (outside `<program>`) → clean-compile (silent-accept). WRONG.
- `<theme>` inside a component body → `E-COMPONENT-020/021/035`. WRONG.
- `<theme>` inside `<page>` → clean-compile. WRONG.
- `<defaults>` misplaced (top-level / page) → clean-compile. WRONG.

Divergence B (collision):
- `const theme = <div>x</div>` (`${}`-wrapped) → clean. WRONG.
- `const Theme = <div>x</div>` (component) → clean. WRONG.
- `type theme = {...}` → clean. WRONG.

## Fixes (compiler/src/ast-builder.js)

### Divergence A — placement gate (NEW gate, post-build tree walker)
- Fire-site: `buildAST` post-build walker (added after the program/page attr walker).
- Mechanism decision: **NEW gate, NOT the `ENGINE_CHILD_MARKUP_ONLY_ELEMENTS`
  mechanism.** The engine-child mechanism is a BUILD-TIME markup-locus fire gated on
  a `_engineBodyBuildDepth` counter (valid locus = "inside an engine body"). The
  `<theme>`/`<defaults>` valid locus is "immediate child of `<program>`" — a
  parent-identity check the build-time counter can't cleanly express (the generic
  markup-children loop is shared by every element). A post-build walker with full
  parent knowledge is cleaner + uniform: it collects the direct children of every
  `<program>` node as the VALID set, then fires `E-STRUCTURAL-ELEMENT-MISPLACED`
  for any `theme-decl` node OR `markup` node with tag `defaults` NOT in that set.
- ALSO added `theme`/`defaults` to `STRUCTURAL_ELEMENT_PLACEMENT` → the existing
  `parseLogicBody` `leadingTagName` gate now covers the `${ <theme> }` logic-body
  locus for free (single-fire; verified no double-fire with the walker).

### Divergence B — reserved-name collision (NEW check — code had NO prior fire-site)
- Fire-site: `buildAST` post-build walker (added after the placement walker).
- **`E-NAME-COLLIDES-RESERVED` had ZERO fire-sites anywhere in the compiler** (only
  in SPEC/PIPELINE/SPEC-INDEX docs) — a spec-ahead code since D4 (2026-05-04). The
  brief's "extend the existing check" premise was off; the check was WIRED here from
  scratch, scoped to the §65 identifiers (`RESERVED_CSS_ELEMENT_IDENTIFIERS`).
- Fires for a `component-def`, a markup-bound `const-decl` (`const theme = <markup>`),
  or a `type-decl` named `theme`/`defaults` (case-insensitive). Does NOT fire for a
  plain non-markup const (`const theme = 5`) — migration backlog per §65.9.

## Reproduction (AFTER)
Divergence A: top-level / page / `${}`-body / defaults-misplaced all → single
`E-STRUCTURAL-ELEMENT-MISPLACED`; valid program-scope `<theme>`/`<defaults>` → clean.
Divergence B: `const theme = <markup>`, `const Theme = <markup>`, `const defaults =
<markup>`, `type theme = {...}` → `E-NAME-COLLIDES-RESERVED`; `const theme = 5` clean;
valid `<theme>` block NOT flagged.

## Conformance cases (conformance/cases/style/)
- `theme-misplaced` (id `style-theme-misplaced`) → `E-STRUCTURAL-ELEMENT-MISPLACED`.
- `theme-name-collision` (id `style-theme-name-collision`) → `E-NAME-COLLIDES-RESERVED`.
- `bun conformance/run.ts`: **305 → 307 cases pass** (impl#1). Existing style/theme-*
  cases (valid loci; `theme` as a token-NAME inside `<theme>`) stay green.

## Reconciliation / regression
- `examples/05-multi-step-form.scrml:42` `<theme> = "light"` (a state-cell named
  `theme` — the §65.9 proto-theme migration-backlog case) → compiles clean, 0 errors.
  Correctly NOT flagged (state-decl, not a component/type/theme-block).
- `<themeMode>`/`<themeLabel>` corpus cells → unaffected (exact-name match on `theme`).
- theme-tokens.test.js: 14 → 26 tests (all green).

## Out of scope — surfaced to PA
- **A-2 (component body)**: `<theme>` inside a component-def *value* fires
  `E-COMPONENT-020/021/035`. Root cause is a GENERAL component-body
  structural-recognition gap (the markup-value is kept as raw `html-fragment` text
  and never built into a node) — it affects `<schema>` (silently swallowed) and
  `<onTimeout>` (`E-SCOPE-001`) equally, NOT theme-specific. A different layer
  (block-splitter / CE markup-value path). NOT the §65.9 placement divergence.
- **Bare lowercase `const theme = <markup>`** (no `${}`): the block-splitter detaches
  the markup into a sibling node (const-decl init="" + orphan `<div>`), so no markup
  init survives → collision can't fire. Pre-existing splitter behavior for lowercase
  bare markup-consts, not introduced here. The `${}`-wrapped + uppercase-component +
  type-decl forms all fire.
- **Full §4.15 reserved list** (engine/match/each/errors/onTransition/onTimeout/
  onIdle/render/page/endpoint/onchange) is still unwired to `E-NAME-COLLIDES-RESERVED`
  — scoped here to the §65 CSS-model identifiers per the brief; broader wiring is a
  follow-on.
