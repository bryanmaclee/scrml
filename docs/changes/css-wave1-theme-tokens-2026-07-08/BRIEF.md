# BRIEF — CSS Wave-1: `<theme>` tokens + reactive theming (the native theming leg)

**Prepared:** S246, 2026-07-08. **Agent:** scrml-js-codegen-engineer, iso:worktree. **Status:** PREPARED — dispatch AFTER the §65.2 checker lands (sequential CSS landings). **Adopter-pull:** flogence floStyle is waiting on this (oracle asks #7/#8).

## The feature (SPEC §65.3.2 + §65.6 + §25.7 + §65.9 — all landed/Nominal)
A `<theme>` structural element declares named token VALUES that lower to CSS custom properties, with reactive variant switching:
```scrml
<mode> = .Light                   // ordinary reactive cell; variant type flows from <theme for=@mode>
<theme for=@mode>                 // §65.6 — binds the variant set to @mode (the engine `for=` pattern)
    brand = #2563eb;              // §65.3.2 — named token; lowers to :root { --brand: #2563eb }
    ink   = #0f172a;
    paper = #ffffff;
    .Dark {                       // variant sub-block: re-binds a subset over the base
        ink   = #e2e8f0;
        paper = #0f172a;
    }
    @media (prefers-color-scheme: dark) { ink = #e2e8f0; paper = #0f172a; }   // auto-bind sugar
</theme>
```
- **Use site:** `color: brand` (inside a `#{}` / style-value) → `color: var(--brand)`. A token ref with no in-scope `<theme>` → **`E-THEME-TOKEN-UNKNOWN`**.
- **Switch:** `@mode = .Dark` → ONE `:root` custom-property-set write, natively propagated to every explicit use site, zero re-render.

## READ (locked spec — implement, don't re-design)
`compiler/SPEC.md`: **§65.3.2** (token-flow, lowering, no-action-at-a-distance, E-THEME-TOKEN-UNKNOWN), **§65.6** (reactive theming; the **PINNED** decl = infer-from-`for=`: `<mode> = .Light` bare, type flows from `<theme for=@mode>`, §14.10 bare-variant inference; `@mode` is a convention not reserved), **§25.7** (lowering to §25 custom properties — reuse the §25.2/§25.3 machinery), **§65.9 + §D** (`<theme>` structural-element registration; the §4.15/§24.4 rows are Nominal — the block-splitter classification + `attribute-registry.js` wiring land WITH THIS impl), **§65.5** (`<theme>` tokens → the `tokens` @layer).

## Scope — the build (front-to-back)
1. **Recognition** — wire `<theme>` as a scrml structural element (mirror how `<channel>`/`<page>`/`<engine>` are recognized per §4.15): block-splitter classification (`<theme` opener) + `attribute-registry.js` (the `for=@cell` attribute slot) + the body form (bare `name = value;` token bindings + `.Variant { … }` sub-blocks + optional `@media (...)` blocks). Add to the AST.
2. **Typer / symbol** — the variant set (`.Light`/`.Dark`) is an enum-like type; `<theme for=@mode>` binds + TYPES the cell `@mode` (bare-variant inference §14.10 — the cell is declared bare `<mode> = .Light`, type flows from the binding). Register the tokens per scope; a use-site token ref (`color: brand`) resolves against the in-scope `<theme>` → **`E-THEME-TOKEN-UNKNOWN`** if undeclared.
3. **Codegen (emit-css)** — lower base tokens to `:root { --brand: #2563eb; … }`; a use-site `color: brand` → `color: var(--brand)`; the variant sub-blocks (`.Dark { ink = … }`) + the `@media` form to the reactive-switching machinery. Tokens land in the `tokens` @layer (§65.5/§65.8).
4. **Runtime** — `@mode = .Dark` re-binds the active custom-property set with ONE `:root` write (reactive, zero re-render). Reuse the existing reactive-cell + §25 custom-property machinery.
5. **§34 rows** — `E-THEME-TOKEN-UNKNOWN` (Error) lands WITH this impl (Rule 4). Flip the §65.3.2/§65.6 Nominal-banner portion this implements.
6. **Corpus migration (§65.9 keyword-collision)** — `<theme>` RECLAIMS the identifier from the handful of live corpus `<theme>` state-cells (`<theme> = "dark"`, `<theme>: Theme = .Light` — verified multiple corpus files). Those cells must migrate to a different cell name (they were poor-man's proto-themes). GREP the corpus first; migrate the handful; a component/user-type named `theme` → `E-NAME-COLLIDES-RESERVED` (§4.15/§24.4, already spec'd).
7. **Tests + conformance** — recognition, token lowering, `E-THEME-TOKEN-UNKNOWN`, variant switching, the `@media` auto-bind, the `for=@mode` binding + bare-variant inference, the corpus migration.

## Decomposition note
This is the biggest Wave-1 piece. If it's too large for one clean pass, split at the natural seam: **Phase A** (recognition + typer: `<theme>` element + `for=` binding + token/variant typing + `E-THEME-TOKEN-UNKNOWN`) then **Phase B** (codegen + runtime: `:root` lowering + reactive variant switching). Phase-0-STOP and propose the split if warranted rather than rushing a giant diff.

## Constraints
- iso:worktree. `git merge main` first (the §65 spec + the landed checker). Commit incrementally (+ progress.md).
- Do NOT land — the PA reviews (S239 adversarial — MANDATORY on this codegen build; the checker fix-round proved why) then file-deltas.
- Concurrent session live on disjoint (non-CSS) threads — stay in the CSS footprint (block-splitter/ast/emit-css/§25/§65 spec + the theme recognition), and do NOT touch the §65.2 checker files (css-conflict-check.ts / the checker's api.js wiring).
- Final message: recognition locus + typer changes + emit-css lowering + runtime + §34 row + the corpus-migration list + tests + gate result + any Phase-0 split proposal.
