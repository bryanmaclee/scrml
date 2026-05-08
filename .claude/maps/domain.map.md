# domain.map.md
# project: scrmlTS
# updated: 2026-05-08T00:00:00Z  commit: f59bbcc

## Core Concepts

scrml                          — single-file, full-stack reactive web language. One `.scrml` file → emitted server JS + client JS + HTML + CSS.
The compiler                  — Bun-runtime program that lowers `.scrml` → plain HTML/CSS/JS through a fixed multi-stage pipeline (PIPELINE.md is authoritative).
Pipeline (current shipped)    — BS → TAB → MOD → CE → VP-1/W-1 → NR/SYM → PA → RI → TS → META (MC+ME) → DG → BP → CG. (PIPELINE.md v0.7.0 = engineering target for v0.next.)
Pipeline (v0.next target)     — adds NR (3.05) routing for engines/match/errors/onTransition, validity-surface synthesis at TS, derived-cell + validator dependency edges at DG, render-by-tag expansion at CG.
SPEC                          — `compiler/SPEC.md` (24,382 lines, §55 primary + §56 promotions + appendices; SPEC-INDEX.md current). A5-1 amendments (§51.0.K/M/N/O/P/Q + §34 +2 codes) LANDED S68 commit `1de05ef`.
PIPELINE                      — `compiler/PIPELINE.md` (2,380 lines, v0.7.0). Authoritative stage contracts.
Self-host                     — `compiler/self-host/*.scrml` mirrors of every pass (BS/TAB/PA/RI/TS/DG/CG/BPP/AST/MC/MOD); built into `compiler/self-host/dist/` and conformance-tested. NOT updated S66-S69 (documented deferral; post-v1.0.0 per user decision).

## Stage Contracts (one-line each — full text in PIPELINE.md)

BS  Block Splitter           — splits `.scrml` source into top-level blocks; emits raw block list.
TAB Tag-and-Body parser      — turns blocks into `FileAST` (~80 ASTNode kinds in `types/ast.ts`); includes ast-builder.js.
MOD Module Resolver          — builds import graph, validates names against exports, produces compilation order + export registry. B14 extended with engine-aware exportRegistry.
CE  Component Expander       — expands component references in markup using same-file + cross-file registries.
VP-1 / W-1                   — validator pass 1: post-CE invariants + attribute allowlist + attribute interpolation; lint pass 1: ghost patterns.
NR  Name Resolver            — resolves identifiers; (v0.next: also routes engine/match/errors/onTransition structural elements + auto-declares engine variables).
SYM Symbol Table             — builds symbol tables with 15 passes (B1–B22 implemented as PASS 1-15):
                               **PASS 1** (B1+B4) — scope build + state-decl registration + import-binding registration (`importBindings` map).
                               **PASS 2** (B2) — E-NAME-COLLIDES-STATE local-decl collision walker.
                               **PASS 3** (B3) — `@name` resolution walker, pinned-forward-ref check (E-STATE-PINNED-FORWARD-REF, E-IMPORT-PINNED-INVALID).
                               **PASS 4** (B5) — cell classifier (`_cellKind`, `_isBindable`).
                               **PASS 5** (B6) — render-by-tag classifier (E-CELL-NO-RENDER-SPEC, E-CELL-RENDER-SPEC-NOT-BINDABLE).
                               **PASS 6** (B8) — L21 walker E-DERIVED-VALUE-MUTATE (backed by `derived-mutation-ops.ts`).
                               **PASS 7** (B10) — validator type-check walker E-TYPE-031 family (backed by `validator-catalog.ts`).
                               **PASS 8** (B11) — synth-cell registry for compound cells (§6.11 + §55 surface): registers `@compound.isValid`, `@compound.errors`, `@field.isValid`, `@field.errors`, `@compound.allValid` into Scope.
                               **PASS 9** (B13) — E-DERIVED-WITH-VALIDATORS walker; inline-override extraction (`ValidatorEntry.inlineOverride`).
                               **PASS 10.A/10.B** (B14) — engine binding walker; auto-declared engine variable; MOD engine-aware exportRegistry.
                               **PASS 11** (B15) — state-child exhaustiveness + rule= typer (§51.0.F three target-only forms) + initial= validation. Backed by `engine-statechild-parser.ts`.
                               **PASS 12** (B16) — derived engines walker; E-DERIVED-ENGINE-* family; cycle detection via B7 DG reuse.
                               **PASS 13** (B17) — E-COMPONENT-ENGINE-SCOPE: `<engine>` decl inside component-def.defChildren.
                               **PASS 14** (B22) — reset(@cell) target-shape validation; E-RESET-INVALID-TARGET; multi-level compound-nav accepted.
                               **PASS 15** (B19) — channel placement + @shared modifier rejection (E-CHANNEL-INSIDE-PROGRAM + E-CHANNEL-SHARED-MODIFIER).
                               **(B18 fires in TAB/ast-builder.js + PASS 11)** — E-MULTI-STATEMENT-HANDLER via `multi-statement-scan.ts` helper. Two fire-sites: markup event-handler attrs (TAB) + engine state-child :-shorthand bodies (PASS 11).
                               **(B12)** — per-field synth cells; ScopeKind `"field"`; lookupQualifiedStateCell extension.
                               **(B20)** — bare-variant inference §14.10 (E-VARIANT-AMBIGUOUS + E-TYPE-063); typer scope-bind; match-arm-block payload-binding parser Form 1b.
                               **(B21)** — refinement-type three-zone §53: boundary-zone hook recording + trusted-zone scope upgrade; extends classifyPredicateZone in symbol-table.ts.
PA  Protect Analyzer         — analyses `protect=` and access boundaries.
RI  Route Inference          — infers routes from file paths + `<program>` config.
TS  Type System              — type checks (large); validates render-spec shapes, refinement types, fn purity, etc. Exposes `typeRegistry` + `stateTypeRegistry` on typed-AST for downstream lint.
META = MC + ME               — Meta Checker + Meta Eval. MC validates phase separation + reflect() calls; ME evaluates compile-time `^{}` and splices results.
DG  Dependency Graph         — reactive dependency graph; cycle detection; B7: derived-cell dep DAG + E-DERIVED-CIRCULAR-DEP; B10 Phase 3: validator-dep graph + E-VALIDATOR-CIRCULAR-DEP. Both use generic `detectCycle` (DFS); cycles block codegen.
BP  Batch Planner            — plans batched DOM updates; emits batch plan.
CG  Code Generator           — `compiler/src/codegen/index.ts`; orchestrates 39 emit-* modules to produce server JS, client JS, HTML, CSS, and runtime chunks.

## Post-TS Lint Passes (api.js, non-fatal)

Stage 6.4 I-MATCH-PROMOTABLE — `lint-i-match-promotable.js`: runs post-TS; walks typed-AST for if-else chains over enum-typed state cells that are mechanically promotable to `<match>`. Emits info-level diagnostics: `exhaustive`, `near-miss`, `compound`. Feeds `allLintDiagnostics`. Paired with `bun scrml promote --match` (S66 Tier B). Needs `stateTypeRegistry` + typed-AST; non-blocking.

## Key Spec Sections (high-traffic, read these first)

§4 Block Grammar              — tags, states, closer forms; §4.14 :-shorthand body form (L19, M15); §4.15 structural elements registry.
§5 Attribute Quoting          — incl. §5.2.3 bare-form event handler rule (L19); §5.4.1 bind-dispatch table.
§6 V5-Strict Reactivity       — `@x` access model; §6.8 default+reset (L18); §6.11 auto-synthesized validity surface (canonical types at §55.5–§55.7).
§10 The `lift` Keyword.
§13 Async Model.
§14 Type System               — §14.10 bare-variant inference (M9, B20); §14.11 positional binding.
§15-§16 Components + Slots.
§17 Control Flow.
§18 Pattern Matching          — match block-form + JS-style; §18.0.3 bare-variant inference.
§19 Error Handling.
§22 Metaprogramming.
§28 Compiler Settings.
§31 Dependency constraints    — §31.4 cross-field validator deps; §31.5 derived-cell dep rules.
§32 The `~` Pipeline Accumulator.
§33 The `pure` Keyword.
§34 Error Codes               — full catalog; A5-1 S68 adds E-HISTORY-NO-INNER-ENGINE + E-INTERNAL-RULE-NOT-COMPOSITE.
§35 Linear Types — `lin`.
§37 SSE Generators.
§38 WebSocket Channels.
§39 `<schema>` + Migrations.
§48 The `fn` Keyword.
§51 `<engine>` / `<machine>` State Type — §51.0.F rule= target-only forms (B15); §51.0.K Machine Cohesion (singleton invariant + nested engines); §51.0.M `<onTimeout>` element; §51.0.N `history` attr; §51.0.O `internal:rule=`; §51.0.P `parallel` sugar; §51.0.Q hierarchy (A5-1 S68, SPEC-only; compiler pending A7).
§52 State Authority Decls.
§53 Inline Type Predicates    — three-zone enforcement; §53.14 type-as-argument primitives (S65).
§54 Nested Substates.
§55 Validators + Auto Validity Surface — §55.1 (14 universal-core predicates); §55.7 E-SYNTHESIZED-WRITE (deferred to A1c); §55.9 ValidationError enum tags; §55.10 inline message override; §55.11 cross-field deps + E-VALIDATOR-CIRCULAR-DEP.
§56 Promotion Ergonomics      — I-MATCH-PROMOTABLE + `bun scrml promote` (S65 Tier A + S66 Tier B SHIPPED).

## Architecture Locks (v0.2.0 migration)

22 architectural locks (L1-L22) ratified at S58 + extended at S65 (L22). 20 moves (M1-M20, M7+M21 dropped).

L4  lock — `@shared` modifier REMOVED from validator surface (locked; B19 fires E-CHANNEL-SHARED-MODIFIER).
L11 lock — auto-synth validity surface (compound + per-field, errors as enum tags). B11/B12 implement infra (S68).
L12 lock — 4-level error-message resolution chain. B13 implements Level-1 inline-override extraction (S68).
L18 lock — reset(@cell) keyword + default= attribute. B22 implements target-shape validation (S69).
L19 lock — multi-statement handlers force named function. B18 implements E-MULTI-STATEMENT-HANDLER (S69).
L21 lock — E-DERIVED-VALUE-MUTATE (S59/S67; PASS 6 in symbol-table.ts).
L22 lock — type-as-argument language primitive (S65; debate-05 verdict + Path A architectural commit).

## Phase Status (master-list.md §0 is canonical — read it for live state)

Stage 0a IMPACT-ASSESSMENT     — DONE.
Stage 0b SPEC + PIPELINE rewrite — DONE (D1-D4).
Stage 0b+ L21 lock              — DONE.
Phase A1a (lex+parse)           — COMPLETE at S61.
**Phase A1b (resolve+type)      — FUNCTIONALLY COMPLETE (22/22 steps SHIPPED S63-S69).**
  B1 (S63) SHIPPED · B2 (S64) SHIPPED · B3+B5 (S65) SHIPPED · B4+B6 (S66) SHIPPED ·
  B7+B8+B9+B10 (S67) SHIPPED · B11+B12+B13+B14+B15+B16+B17 (S68) SHIPPED ·
  **B18+B19+B20+B21+B22 (S69) SHIPPED — A1b COMPLETE.**
Phase A1c (codegen+runtime)     — RATIFIED S60; 24 steps C0-C23, 6 waves; not yet started.
Stage 0c (S64 RESHAPED)         — 0c.A (function-overload deletion) LANDED `6507475`; 0c.B-D REMOVED; 0c.E LANDED; 0c.F LANDED.
parseVariant (L22)              — SHIPPED S65 (`emit-parse-variant.ts`).
A+ verdict #1+#2+#3             — CLOSED S65.
Promotion ergonomics Tier A     — LANDED S65.
Promotion ergonomics Tier B     — SHIPPED S66 (`--match` live).
Promotion ergonomics Tier C     — `--engine` deferred (W-MATCH-TRANSITIONS-ACCRUING lint).
**A7 (S67 RATIFIED)**           — engine+temporal extensions (DD-Harel hierarchy, `<onTimeout>`, `history`, `internal:rule=`, `parallel`, nested `<engine>`, computed-delay relaxation, Item G timeouts). A5-1 SPEC amendments LANDED S68 `1de05ef`. A5-2 through A5-7 pending. ~40-78h remaining. Pending dispatch.
**A8 (S67 RATIFIED)**           — test-bind (effects-as-data); `test-bind <serverFnName> = <handler>` in `~{}` blocks. ~6-12h. Pending dispatch.
Self-host deferred              — S66-S69 confirmed self-host NOT updated (post-v1.0.0 per user decision).

## S69 Key Changes (commit f59bbcc — S69 close, A1b COMPLETE)

A1b Wave 5 small-bundle (9 commits this session):

- **B22 (PASS 14):** `reset(@cell)` target-shape validation. New §34 row E-RESET-INVALID-TARGET. Multi-level compound-nav accepted (e.g. `reset(@form.name)`). 25 tests.
- **B19 (PASS 15):** Channel placement + `@shared` modifier rejection. E-CHANNEL-INSIDE-PROGRAM (channel inside `<program>` body) + E-CHANNEL-SHARED-MODIFIER (L4 lock). 13 tests. `module-resolver.js` updated.
- **B18 (TAB + PASS 11):** L19 multi-statement event-handler validation. New helper `multi-statement-scan.ts` (scanForTopLevelSemicolon + isEventHandlerAttrName). Two fire-sites: `ast-builder.js` markup event-handler attrs + PASS 11 engine state-child :-shorthand bodies. 55 tests. E-MULTI-STATEMENT-HANDLER.
- **B20 (bare-variant inference):** Bare-variant inference §14.10 / M9. E-VARIANT-AMBIGUOUS + E-TYPE-063. Variable-length-lookbehind regex. `ast-builder.js` `shouldSkipExprParse` relaxation. Match-arm-block payload-binding parser (Form 1b). Typer scope-bind in `symbol-table.ts`. 81 tests (includes match-arm payload-binding bonus). PA hands-on debug recovery (49 fails → 0).
- **B21 (refinement three-zone §53):** Boundary-zone hook recording + trusted-zone scope upgrade. Extends `classifyPredicateZone` in `symbol-table.ts`. Depth-of-survey-discount realized (existing classification covered most ratified scope). 27 tests.
- **A1b COMPLETE:** All 22 steps B1-B22 functionally shipped. A1c (codegen+runtime, 24 steps C0-C23) is next.
- **Test count at S69 close:** ~8,870 pre-commit / 9,626 full suite (+385 from S67, +201 from S68). 0 regressions cumulative.

## S68 Key Changes (multi-commit — Wave 3-4 COMPLETE)

- **B11 (PASS 8):** synth-cell registry. Registers all four synth cells per compound cell: `@compound.isValid`, `@compound.errors`, `@compound.allValid`, and per-field variants. Non-enumerable `_synthCells` back-pointer.
- **B13 (PASS 9):** E-DERIVED-WITH-VALIDATORS. Level-1 inline-override extraction: `ValidatorEntry.inlineOverride` field (B13 walker in `symbol-table.ts`: `walkRejectDerivedWithValidatorsAndExtractOverride`). Per-arg split.
- **B12 (PASS 8.b):** Per-field synth cells. ScopeKind `"field"` added to Scope. `lookupQualifiedStateCell` extended.
- **B14 (PASS 10.A/10.B):** Engine binding + auto-declared variable. MOD engine-aware exportRegistry. Cross-file `<engine>` mount.
- **B15 (PASS 11):** State-child exhaustiveness + rule= typer (three §51.0.F forms) + initial= validation. New `engine-statechild-parser.ts` module. E-ENGINE-INVALID-TRANSITION + E-ENGINE-INITIAL-MISSING.
- **B16 (PASS 12):** Derived engines. E-DERIVED-ENGINE-* family. Cycle detection via B7 `detectCycle` reuse (SECOND consumer).
- **B17 (PASS 13):** E-COMPONENT-ENGINE-SCOPE for `<engine>` inside component-def.defChildren.
- **A5-1 (SPEC §51 amendments):** §51.0.K Machine Cohesion footnote (singleton invariant; nested engines in composite state-children); §51.0.M `<onTimeout>` element; §51.0.N `history` attribute + `.Variant.history` structured target form; §51.0.O `internal:rule=` prefix; §51.0.P `parallel` attribute sugar; §51.0.Q hierarchy; §51.12.3.1 computed-delay relaxation; §34 +2 E-HISTORY-NO-INNER-ENGINE + E-INTERNAL-RULE-NOT-COMPOSITE. Commit `1de05ef`. Compiler implementation pending A7.
- **Test count at S68 close:** 9,425 full suite (+184 from S67).

## Codegen Surfaces (compiler/src/codegen/, ~14,135 LOC across 39 modules)

emit-client.ts    (1,112)   — client bundle entry; mangler interaction.
emit-control-flow.ts (1,253) — if/else/for/while/match lowering.
emit-logic.ts     (1,895)   — `<logic>` block lowering.
emit-reactive-wiring.ts (1,002) — V5-strict reactive subscription wiring.
emit-html.ts      (915)    — HTML node lowering.
emit-server.ts    (905)    — server-side emission.
rewrite.ts        (1,861)  — expression rewrite chain.
emit-lift.js      (1,405)  — lift keyword lowering.
emit-machines.ts  (719)    — `<machine>` state-machine emit.
index.ts          (759)    — CG orchestration entry.
emit-parse-variant.ts (219) — L22 parseVariant codegen (S65).
db-driver.ts      (151)    — Bun.SQL URI classification (S40).

## Tags
#scrmlTS #map #domain #compiler #pipeline #spec #a1b-complete #s68 #s69 #wave5 #b11 #b12 #b13 #b14 #b15 #b16 #b17 #b18 #b19 #b20 #b21 #b22 #a7-ratified #a8-ratified #a5-1-landed #engine-statechild #synth-surface #bare-variant #refinement-three-zone #reset-target #multi-statement #channel-placement

## Links
- [primary.map.md](./primary.map.md)
- [schema.map.md](./schema.map.md)
- [error.map.md](./error.map.md)
- [test.map.md](./test.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [SPEC.md](../../compiler/SPEC.md)
- [PIPELINE.md](../../compiler/PIPELINE.md)
