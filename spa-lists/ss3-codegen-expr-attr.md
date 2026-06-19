# sPA ss3 — codegen-expr-attr

**Launch:** `read spa.md ss3` · **Branch:** `spa/ss3` · **Worktree:** `../scrml-spa-ss3`
**Merged from:** emit-expr-residuals · is-op-bare-literal-attr · render-expr-asis

## Shared ingestion
The emit-expr accessor surface + the attribute-value/is-op/render-expr codegen+diagnostic loci:
`emit-expr.ts` `_scrml_reactive_get` module-top read emission + map-literal build + `emitSqlRef`
placeholder; `codegen/rewrite.ts` `_rewriteParenthesizedIsOp` (§42 not-unified-absence); `tokenizer.ts`
START class (`/[A-Za-z_@]/`, leading-colon exclusion); `type-system.ts` `visitAttr` per-attribute
exemption + the render-expr `of=` exhaustiveness fence (E-RENDER-NOT-ENUM); `component-expander.ts`
prop-typing (W-COMPONENT-001). Threads: how exprs lower to accessor calls; the asIs/unknown
escape-hatch must-not-false-fire rule; per-attribute value-registration.

## Core files
`compiler/src/codegen/emit-expr.ts` · `compiler/src/codegen/rewrite.ts` · `compiler/src/tokenizer.ts` · `compiler/src/type-system.ts` · `compiler/src/component-expander.ts`

## Items (least-ingestion-first)
1. **`g-component-001-coverage`** `[landed-on-branch]` bug LOW · tier low — **NOT-REPRODUCED.** W-COMPONENT-001 fires correctly on real source (a99246e2): block-splitter `scanAttributes` already tracks bare `{` depth (block-splitter.js:1233-1241), so the premise ("vestigial, can't fire") is stale. Verified empirically — fires on `() => void`, `(e) => T`, optional `()=>bool`, single- & multi-line `props={...}`. `isFunctionType` (:313) covers the canonical arrow form fully. Residual landed: corrected the stale "will not fire" comment at component-expander.ts:1066-1072. Entry: component-expander.ts (STALE fileHints — real :313/:1071).
2. **`s169-ordered-unordered-build`** `[open]` bug LOW · tier med — `@ordered` cell built UNORDERED from a `[:]` literal; map-literal codegen hardcodes `ordered=false` (the `@ordered` TYPE affix not propagated). Documented §59 v1 limit. Entry: emit-expr.ts:572 + runtime/stdlib/data.js.
3. **`g-bare-literal-attr-value`** `[open]` bug LOW · tier med — bare-integer `interval=` (`<poll>`/`<timer>`) + sibling value-attrs reject E-SCOPE-001 (bare numeric/bool read as ident). Extend the S186 reconnect exemption. Entry: type-system.ts `visitAttr` (:10687, exemption :10693-10704).
4. **`g-render-not-enum-asis-miss`** `[open]` bug LOW · tier med — `<render of=X/>` doesn't fence a non-enum target when X resolves to asIs (inert empty-switch no-op vs E-RENDER-NOT-ENUM). Concretize more cell-init types in the `of=` scope-lookup. Entry: type-system.ts:7673-7760.
5. **`r28-2b`** `[parked]` bug LOW · tier med — **PARKED → escalate PA** (design-ruling + blast-radius). Already a triaged/deferred known-gap (known-gaps.md:336 R28-2b LOW/open; changelog.md:341 re-confirmed-deferred). Admitting leading-`:` to tokenizer START class (`tokenizer.ts:451` `/[A-Za-z_@]/`) ripples across ALL leading-colon attrs + into block-splitter §4.14 `:`-shorthand recognition (ss4). `:let` works via the `let` alias. R26-repro: `:let` → E-CTX-001 cascade. NO ss3-bounded fix. Entry: tokenizer.ts:451.
6. **`emit-sql-ref-placeholder`** `[parked]` experiment LOW · tier med — **PARKED → escalate PA (prereq-blocked).** `emitSqlRef` (emit-expr.ts:1850) is an explicit `TODO(Phase 3 Slice 4)`; statement-level SQL emission is the unbuilt PREREQ (separate subsystem; existing sql-ref code only classifies for server-only suppression). Future-phase + design-open; blast-radius exceeds ss3. Entry: emit-expr.ts:1850.
7. **`giti-006-async-reactive-module-top-read`** `[in-flight]` bug LOW · tier med — **DISPATCH-PENDING item2** (file overlap emit-logic.ts/emit-expr.ts). R26-confirmed: markup `${@var.path}` emits a SPURIOUS module-top bare statement read alongside the render-effect; `null.path` THROWS at init for async reactives. Root: markup-interpolation bare-expr double-emitted (module-top logic statement + render wiring). Fix = suppress the module-top emission for render-consumed markup interps. Bounded codegen. Entry: emit-logic.ts (module-top bare-expr) + emit-html.ts/emit-bindings.ts.
8. **`dq12-phase-b-bare-compound-is-op`** `[parked]` feature n-a · tier med — **PARKED → escalate PA (design ruling + a real silent-wrong bug).** R26: logic-body bare-compound is-op already works (AST-level); but bare-compound in an attr `if=` SILENTLY DROPS `is not` → emits truthiness `if((fn(s)))` not the absence check (paren form is correct). `is not` not in cluster-A op-set so no E-ATTR-UNQUOTED-OPERATOR. FIX DIRECTION = ruling: (a) SUPPORT in fallback rewrite vs (b) REJECT-with-parens (cluster-A §5.2/§17.1 consistency). No ratification (no `dq12` doc, no §42.2.4 Phase-B). Entry: codegen/rewrite.ts `_rewriteParenthesizedIsOp` (:734-789).

## Progress
`ss3.progress.md`. Land on `spa/ss3`; ping PA inbox when ready. Do not advance main / do not push.
