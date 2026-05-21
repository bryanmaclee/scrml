# domain.map.md
# project: scrmlts
# updated: 2026-05-21T09:04:37-06:00  commit: 092fa90a

The domain of this repo is *compiling the scrml language*. scrml is a
single-file, full-stack reactive web language: one `.scrml` source compiles to
plain HTML + CSS + JS, with the compiler splitting server from client, wiring
reactivity, and inferring HTTP routes. The "core concepts" below are the
compiler's pipeline stages and the language constructs they process.

## The Compilation Pipeline  [compiler/PIPELINE.md — normative stage contracts]
A `.scrml` file flows through 18 numbered stages. Each stage takes a well-typed
input, performs a bounded transformation, and hands a well-typed output to the
next. Stages 1–CE are per-file parallel (one Bun worker each); MOD and the
cross-file stages are project-wide synchronization points.
Hard target: a 4000-line project compiles from scratch in under 1 second.
The live pipeline (compiler/src/) is UNCHANGED since commit 78faa65 — verified at
`092fa90a` (the S114 native-parser arc edited only cli.js / commands/compile.js /
api.js for the M5-LIGHT observability flag; all 18 pipeline stages are unmodified).

| # | Stage | Abbrev | Source file(s) |
|---|---|---|---|
| 1   | Preprocessor | PP | (in block-splitter / api.js pre-pass) |
| 2   | Block Splitter | BS | src/block-splitter.js |
| 3   | Tokenizer + AST Builder | TAB | src/tokenizer.ts, src/ast-builder.js, src/expression-parser.ts |
| 3.05| Name Resolution | NR | src/name-resolver.ts, src/symbol-table.ts |
| 3.1 | Module Resolver | MOD | src/module-resolver.js |
| 3.2 | Component Expander | CE | src/component-expander.ts (+ Phase 2 channel expansion) |
| 3.3 | Unified Validation Bundle (VP-1/2/3) | UVB | src/validators/{attribute-allowlist, attribute-interpolation, post-ce-invariant}.ts |
| 4   | protect= Analyzer | PA | src/protect-analyzer.ts |
| 5   | Route Inferrer | RI | src/route-inference.ts |
| 5.5 | Monotonicity Classifier | MC | src/monotonicity-analyzer.ts |
| 6   | Type System | TS | src/type-system.ts |
| 6.5 | Meta Check + Eval | META | src/meta-checker.ts, src/meta-eval.ts |
| 6.7 | Validity Surface Synthesis | VSS | (TS sub-passes B11/B12/B17) |
| 7   | Dependency Graph Builder | DG | src/dependency-graph.ts |
| 7.5 | Batch Planner | BP | src/batch-planner.ts |
| 7.6 | Reachability Solver | RS | src/reachability-solver.ts, src/reachability/* (SPEC-anchored; impl deferred) |
| 8   | Code Generator | CG | src/code-generator.js → src/codegen/* (~50 emit-*.ts modules) |

Auxiliary cross-file pass: AuthGraph (src/auth-graph.ts) — auth-site
enumeration + role-enum resolution + per-gate classification, feeding the
Reachability Solver.

## The Native-Parser Front-End  [compiler/native-parser/ — charter B, S111]
A SECOND, scrml-native compiler front-end built in parallel with the live
pipeline above. It is NOT a port and NOT the post-v1.0 from-scratch self-host —
it is a composed-engines front-end that, under charter B, replaces the WHOLE
live front-end (the heuristic block-splitter, the Acorn JS layer, the
body-pre-parser, and the statechild re-tokenizers).

Status (parallel track — see structure.map.md):
- NOT wired into the api.js pipeline. compiler/src/ does not import it.
  Consumed only by `compiler/tests/parser-conformance*` test files.
- Accessible as an OBSERVABILITY SHADOW via `--parser=scrml-native` (M5-LIGHT,
  S114): the live pipeline still runs; the flag emits `I-PARSER-NATIVE-SHADOW`
  into result.warnings confirming end-to-end flag wiring. Downstream routing is
  M5-FULL scope (compiler/native-parser/M5-ast-bridge-scoping.md).
- Swaps in behind `--parser=scrml-native` at milestone M5-FULL; M6 deletes the live
  front-end stages (BS + Acorn + BPP) and retires the flag.
- Each module is a `.scrml` CANONICAL source + `.js` EXECUTABLE shadow.
- FEATURE-COMPLETE at S114 (JS chain M1-M4 + markup chain MK1-MK4 + K-ledger 12/12 RESOLVED).

### Composed-engines architecture (DD §D2)
The front-end is a stack of trampoline loops, each dispatching by an `<engine>`:

JS layer:
- M1 — LEXER. `lex(source): Token[]` (lex.scrml) is a loop dispatching by the
  `LexMode` engine. 7 lex modes (InCode + 6 sub-modes for strings, templates,
  comments, regex). ✅ COMPLETE (M1.1-M1.4, S99-S103; M1.5 verified S113).
- M2 — EXPRESSION PARSER. `parse-expr` consumes M1's Token[] through
  `token-cursor` and emits `Expr` AST (ast-expr) via precedence-climbing,
  dispatching by the `ParseMode` engine. ✅ COMPLETE (M2.1-M2.4, S112-S113).
  M2.4 closed the 5+ `preprocessForAcorn` Acorn-workaround failure modes —
  one regression test per fixed class (the M2 gating criterion).
- M3 — STATEMENT PARSER. `parse-stmt` consumes M1's Token[] and emits `Stmt`
  AST (ast-stmt). Function bodies parsed IN-LINE — subsumes the live
  `body-pre-parser.ts` (BPP deletes by construction at M6). ✅ COMPLETE
  (M3.1-M3.4, S113). M3 extends ParseMode with `.InBlock`. Error recovery
  wired into M1's ErrorRecovery engine (panic-mode resync on `;` /
  statement-start keywords / `}`).
- M4 — full bounded JS subset (D5 MUST-PARSE/ADD + full-corpus conformance).
  M4.1 (await/yield as operators; function* wiring; inAsync/inGenerator ctx) ✅ S113.
  M4.2 (K6 destructuring unification; noIn flag) ✅ S114.
  M4.3 (full-corpus conformance close; async/await RETRACTED — parallel-by-default,
    no colored functions; canonical async surface is the compiler body-split) ✅ S114.
  ✅ M4 COMPLETE S114.

Markup layer:
- MK1 — CONTEXT GRID. `parse-markup` is a trampoline dispatching by the
  `BlockContext` engine — recognizes the 7 block-opener sigils + the `<ident`
  markup-tag boundary, producing a typed block-stream. ✅ COMPLETE
  (MK1.1-MK1.3, S112). MK1 does NOT build the `<tag>` tree.
- MK2 — `TagFrame` engine: the `<tag>` tree, 3 closer forms (`</>`, `</name>`,
  `/>`), `TagKind` (Html / Component / ScrmlStructural / StateOpener),
  `TagClass`, the §4.15 / §24.4 structural registry, opener tokenization, and
  mismatch recovery via `E-MARKUP-002`. ✅ COMPLETE (MK2.1-MK2.3, S113).
  MK2.3 closed 5 BS classifier heuristics (regression test per heuristic).
- MK3 — `BodyMode` + `DisplayTextLiteral`: §4.18 native quoted-text.
  ✅ COMPLETE (MK3.1-MK3.3, S113). `BodyMode` 2-variant engine (`.FreeText` /
  `.CodeDefault`) populated via tag-frame `bodyMode` payload; `DisplayTextLiteral`
  3-variant engine (`Outside` / `InLiteralText` / `InInterpolation`); `"..."`
  literal with `\"`/`\\`/`\${` escape set; `${...}` interpolation delegates to
  M2's expression parser; `E-UNQUOTED-DISPLAY-TEXT` (§4.18.7) fires as a parse
  outcome in code-default bodies.
- MK4 — markup↔JS seam; re-tokenizer-scaffolding deletion. ✅ COMPLETE (S114).
  `parse-seam.scrml/.js` — DelegationFrame stack; MarkupToJS / JSToMarkup frame
  variants; cross-seam error attribution. `delegation-frame.scrml/.js` — leaf module
  (K9 circular-import fix). `ast-expr` extended with `MarkupValue` ExprKind
  (markup-as-value: `const card = <div/>`, `renders <p>...</p>`). `parse-expr`
  extended with `parseMarkupValue` (JS→markup delegate-up). `parse-markup`
  extended with `emitContextBlock` (markup→JS LogicEscape body parsing).
  `parseInterpolationBody` in display-text-literal.js threads source for
  cross-seam diagnostics.

JS-host third body-mode (§40.8 `default-logic` — NOT MK3's scope): `<program>`
/ `<page>` body parses in `default-logic` mode, a distinct third mode that
§4.18 explicitly does NOT classify. The native-parser `body-mode.js` declares
`ProgramBodyMode` enum + `isProgramBodyElementName` for `<program>`/`<page>`.

### Native-parser engines (state-shape; Pillar 5b)
LexMode       — JS-lexer context (which lexing mode is active right now).
BracketStack  — bracket depth + opener-frame stack.
ErrorRecovery — parse-error recovery (ParsingNormally / AccumulatingSkipped / ReSynchronized).
ParseMode     — JS expression/statement parsing context (incl. `.InBlock` for M3).
BlockContext  — markup-layer context grid (which scrml context the cursor is in).
TagFrame      — markup-tag tree (3 variants: Closed / OpenExpectingChildren(payload) /
                OpenSelfClosed(payload)). Payload-bearing per `bracket-stack` precedent.
BodyMode      — markup-tag body mode (FreeText / CodeDefault, §4.18).
DisplayTextLiteral — display-text-literal scanner (Outside / InLiteralText /
                     InInterpolation, §4.18.3-§4.18.4).
(Engine state-child catalog: see schema.map.md.)

### M-ladder status at HEAD `092fa90a` (S114 CLOSE)
JS chain:    M1 ✅ M2 ✅ M3 ✅ M4 ✅ — COMPLETE
Markup chain: MK1 ✅ MK2 ✅ MK3 ✅ MK4 ✅ — COMPLETE
K-ledger: 12/12 RESOLVED (K1-K7 in S113; K8-K12 in S114)
NATIVE-PARSER FRONT-END FEATURE-COMPLETE.
Next: M5-FULL (downstream-bridge pipeline swap; scoping doc:
  compiler/native-parser/M5-ast-bridge-scoping.md + M5-divergence-ledger.md;
  estimated 98-180h per MD-ladder scope-revision DD outcome).

### New native-parser files added S114 (2 new paired modules)
`parse-seam.scrml/.js` — markup↔JS seam contract (DelegationFrame, MK4)
`delegation-frame.scrml/.js` — leaf module; delegation surface extracted from parse-ctx (K9)

### Authority
Native-parser design lives in scrml-support (deep-dives), NOT this repo:
`scrml-native-parser-design-2026-05-17.md` (S98 DD) and
`scrml-native-parser-front-end-charter-2026-05-20.md` (charter B).
In-repo working artifacts: `docs/changes/native-parser-front-end/IMPLEMENTATION-ROADMAP.md`
(authoritative M-ladder + K-ledger tracker; §5 progress table is the single source of truth)
+ `compiler/native-parser/M5-ast-bridge-scoping.md` (M5-FULL downstream-bridge scoping doc)
+ `compiler/native-parser/M5-divergence-ledger.md` (surface gap inventory for M5-FULL).

## Core Language Concepts (what the compiler processes)
V5-strict access model — two declaration forms; `<x> = init` declares, `@x` reads/writes a reactive cell (SPEC §6, §1.6).
Reactive cell — `@`-sigil state; three RHS shapes: plain, decl-coupled-with-render-spec, derived (`const <name> = expr`).
Compound state — `@compound.field` access; Variant C (SPEC §6.3).
Markup-as-value — markup is a first-class value usable in logic-context expressions (SPEC §1.4, the L1 pillar).
Context model — logic `{}`, SQL `?{}`, CSS `#{}`, meta `^{}`, foreign `_{}`; stack rules + coercion (SPEC §3, §7-§9, §22-§23). Approach C for `^{}`: Approach C primitives + import:host suffix-form α ratified S114 (SPEC §21.3.1 + §22.5.1 + §22.12 + §22.13).
Tier ladder — control-flow promotion: Tier 0 `if=`, Tier 1 `<match>`, Tier 2 `<engine>` (SPEC §17.0, §51.0).
`<engine>` / `<machine>` — state machine governing an enum or struct; rule= transitions, effect=, <onTransition> (SPEC §51).
`<channel>` — file-level WebSocket sync; V5-strict body auto-syncs (SPEC §38).
Route inference — server/client split + HTTP route inferred from file structure; escalation triggers (SPEC §12).
`not` — the single unified absence value; `is some` / `is not` / `given x =>` / `T | not`. null/undefined do NOT exist in scrml (SPEC §42).
`lift` keyword — value coercion / accumulation across contexts (SPEC §10).
`lin` — linear types: exactly-once consumption (SPEC §35).
`~` keyword — pipeline accumulator / lin-variable / context boundary (SPEC §32).
`fn` vs `function` — `fn` is a constrained pure function ≡ `pure function`; `function` is unconstrained (SPEC §33, §48).
No async/await in scrml — SPEC §19.9.8 encodes the language-wide rule: parallel-by-default, no colored functions; canonical async surface is the compiler body-split (ratified S114 — M4.3 retraction; +3 §34 codes).
Validators + auto-synthesized validity surface — 14 universal-core predicates (`req`/`length`/`pattern`/`min`/`max`/...); per-compound `isValid`/`errors`/`touched`/`submitted` (SPEC §55).
Inline type predicates — refinement types `number(>0 && <10000)`, `string(email)`; SPARK zones (SPEC §53).
Type-as-argument family (L22) — `parseVariant` / `formFor` / `schemaFor` / `tableFor` — types passed as values (SPEC §41.13-§41.15, §53.14).
`<schema>` + migrations — SQL DDL, column types, migration diff (SPEC §39).
§4.18 quoted-text model — native display-text literal; MK3 implements natively at the native-parser; the older quoted-text-model BS-retrofit (Waves 2-7) was SUPERSEDED by charter B and DEREF'd to scrml-support/archive/ at S114.
Output name encoding — emitted JS var names use kind prefixes + a hash scheme (SPEC §47).

## Compiler Analysis Concepts (passes that classify, not transform)
AuthGraph — enumerates auth sites, resolves role enums, classifies each gate as
  closed-form vs gated-for-role; cross-refs auth redirects (src/auth-graph.ts, SPEC §40).
Reachability Solver — per-role playable-surface analysis + chunk planning;
  drives tree-shaking and per-route artifact splitting (src/reachability/, SPEC §40.9).
Monotonicity Classifier — classifies state cells for batch-planning safety (src/monotonicity-analyzer.ts).
Batch Planner — plans coalesced reactive updates / SQL batching (src/batch-planner.ts).
Dependency Graph — derives-from / validator-arg / engine-derives edges + cycle detection (src/dependency-graph.ts).
protect= Analyzer — server/client boundary + protected-data audit (src/protect-analyzer.ts).

## Promotion Ergonomics
`I-MATCH-PROMOTABLE` info-lint fires when an if-chain over an enum could become
a `<match>`; `bun scrml promote --match` rewrites it. `--engine` (Tier 1→2) is
CLI-locked, rewrite impl pending (SPEC §56).

## Self-Hosting Track
Two distinct scrml-authored efforts exist; do not conflate them:
- `compiler/native-parser/` — the charter-B native-parser FRONT-END (M-ladder
  above). Ships into the scrmlTS pipeline behind `--parser=scrml-native`.
- `compiler/self-host/` — earlier self-host modules (ast/bs/bpp/cg/dg/ri/ts/tab.scrml
  + dist). The post-v1.0 from-scratch hand-built compiler is a SEPARATE later effort.
The TypeScript compiler (compiler/src/) is the temporary scaffold.

## Authoritative Sources
SPEC.md (compiler/SPEC.md, 28,489+ lines, §1-§57 + appendices) — normative language spec.
SPEC-INDEX.md — section navigation map.
PIPELINE.md (compiler/PIPELINE.md) — normative stage contracts + lock map (L1-L22) + failure-mode catalog.

## Tags
#scrmlts #map #domain #compiler #pipeline #scrml-language #native-parser #composed-engines #charter-b #mk4 #m5-light

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [structure.map.md](./structure.map.md)
- [schema.map.md](./schema.map.md)
- [error.map.md](./error.map.md)
