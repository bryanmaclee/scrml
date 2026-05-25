# scrml Compiler Pipeline — Stage Contracts

**Version:** 0.7.2
**Date:** 2026-05-18
**Owner:** scrml Integration Pipeline Reviewer
**Status:** Authoritative — no stage integration proceeds without a reviewed contract here.

**Change log:**
- **0.7.2 (2026-05-18, S101 v0.3.x refresh):** NEW Stage 2 (BS) v0.next addendum documenting SPEC §4.17 raw-content elements `<pre>` and `<code>`. Token suppression inside raw-content body (no `${...}` / `<TagName>` / brace contexts recognized); HTML entity-escape author-responsibility preserved; EOF recovery emits `E-CTX-001` + `closerForm: "inferred"`; locus `compiler/src/block-splitter.js`; conformance at `conf-raw-content-pre-code.test.js`. No contract changes on downstream stages — text-child carries through verbatim. Companion to v0.3.1 release tag (`cbe1b1e`). No other stage contracts changed in this revision.
- **0.7.1 (2026-05-09, A1c step C23 — prose pass):** PIPELINE.md prose pass per
  IMPLEMENTATION-ROADMAP §8.6 #2. No new normative content; no contract changes.
  Re-flow only — engineering substance is unchanged from 0.7.0.
  - All seven `### Stage N v0.next addendum` sections (TAB / NR / MOD / UVB / TS / DG / CG)
    re-flowed into their parent stage's narrative. Reading any stage now yields a single
    coherent contract description rather than a v0 prose + v0.next bolt-on.
  - **NEW Lock Enforcement Map** — top-level table after Stage Index. Maps locks L1-L22
    (S55-S65 deliberation outcomes) to firing stage(s) for each lock. Per-stage callouts
    were rejected in favor of a single discoverable table.
  - **NEW Stage 6.7: Validity Surface Synthesis (VSS)** — sub-stage between META and DG.
    Consolidates the auto-synthesized validity surface narrative (SPEC §55 + L11) which
    was previously fragmented across Stage 6 TS addendum (typing), Stage 7 DG addendum
    (validator-arg edges), and Stage 8 CG addendum (accessor emission). Implementation
    sub-passes (B11 synth-cell registry, B12 per-field walker, B17 onTransition walker)
    remain TS sub-passes; the Stage 6.7 narrative is the composite reader-facing view.
    DG and CG input contracts updated to require `synthCellRegistry`.
  - **IFMC** reordered by detection-stage (TAB → NR → MOD → UVB → TS → DG → CG →
    cross-cutting); 6 new failure-mode rows added (E-DERIVED-VALUE-MUTATE / L21,
    E-PARSEVARIANT-001 / L22, B14 path-shape mismatch surfaced S74, etc.).
  - **Stage Dependency Summary** updated: META → VSS → DG (was META → DG).
  - **Overview:** "eleven ordered stages" → "twelve ordered stages" (with Stage 6.7).
  - Test impact: zero — markdown only. Pre-commit hook ran 0 regressions.
- **0.7.0 (2026-05-04, Stage 0b D4):** v0.next pipeline updates — engineering target for Phase A1+ implementation. Per SPEC.md §1.4–§1.6 (markup-as-value pillar, north-star Tier ladder, V5-strict access), §6 (V5-strict reactivity), §18.0 (match block-form), §38 (file-level channels), §51.0 (engines as Tier 2), §55 (validators + auto-synthesized validity surface), and §4.14–§4.16 (`:`-shorthand, structural-elements registry, M7 negative-space). Affected stages get a v0.next addendum at each stage's end documenting the new contract surface; existing contract content remains authoritative for v1 features.
  - **Stage 3 TAB:** new tokens (`pinned`, `is some`, `is not`), recognition of `<engine>`/`<match>`/`<errors>`/`<onTransition>` as scrml-defined structural elements, `:`-shorthand body recognition, V5-strict `<x>` decl AST shape, render-spec-RHS classification, `default=` attribute capture.
  - **Stage 3.05 NR:** auto-declared engine variable resolution; auto-derived variable name (lowercase first run; legacy `Machine` suffix kept per §51.0.C); category routing for new structural elements; `pinned` forward-reference detection.
  - **Stage 3.1 MOD:** export registry includes `category: "engine"` entries (alongside `"channel"`, `"user-component"`).
  - **Stage 3.3 UVB / VP-1:** attribute allowlists for `<engine>`, `<match>`, `<errors>`, `<onTransition>` registered in `compiler/src/attribute-registry.js`.
  - **Stage 6 TS:** auto-synthesized validity surface type-checking (`@x.isValid`, `@x.errors`, `@x.touched`, `@x.submitted`); `ValidationError` enum + `.Custom(tag)` extension; render-spec validity classification (bindable vs display-only); engine `derived=expr` type compatibility; bare-variant inference type completion; positional binding for predefined-shape compound state.
  - **Stage 7 DG:** validator predicate-arg dependency edges; derived-state expression dependency edges; cycle detection for derived-cell and validator graphs.
  - **Stage 8 CG:** `<x/>` render-by-tag expansion to bound input element with bind-flavour dispatch by render-spec shape (§5.4.1); engine state-child rendering as conditional-on-engine-variant; transition validation (`rule=` contract) including compile-time check inside state-child bodies; auto-synthesized validity property emission via reactive computed-property machinery; `<errors of=expr/>` rendering with default `messageFor` resolution + body override + `all` attribute; `reset(@cell)` keyword expansion; `default=` attribute capture and reset-time evaluation; non-deterministic flush (post-S55) preserved.
  - **Output stage (CG/47):** auto-name encoding for synthesized properties (suffix-based deterministic) + auto-declared engine variables (cross-ref SPEC §47.5).
  - **No new pipeline stages.** Existing stages absorb the new responsibilities; no new project-wide synchronization points are required.
  - **Test posture:** v0.7.0 is a SPEC + PIPELINE engineering target. The compiler does not yet implement these contracts — Phase A1+ implementation dispatches bring the compiler into compliance. `bun test` is expected to pass on baseline tests post-D4 because no compiler source was modified.
- **0.6.1 (2026-05-02):** Stage 3 (TAB) Amendment 7 added. Form 2
  `export type X = {...}` now produces both a `type-decl` and an `export-decl`
  (P3.B; closes F-ENGINE-001). Mirrors `export function`'s dual-node emission.
  Per SPEC §21.2 normative + §51.16 (NEW). Purely additive change to Stage 3
  output; no downstream contract change.
- **0.6.0 (2026-04-02):** Pipeline restructured to reflect actual implementation. Changes in this version:
  - Stage 3.5 (BPP — Body Pre-Parser) removed. BPP was a registered no-op stage with no
    active implementation. It is removed from all contracts, cross-references, and the stage
    index. All downstream stage source lines that referenced BPP now reference CE (Stage 3.2).
  - Stage 3.1 (MOD — Module Resolver) added between TAB and CE. MOD builds the import graph,
    detects circular imports, validates import names against exports, and produces a compilation
    order and export registry consumed by CE.
  - Stage 3.2 (CE — Component Expander) added between MOD and PA. CE expands component
    references in markup using same-file and cross-file component registries built from TAB ASTs
    and the MOD export registry.
  - Stage 6.5 (META — Meta Check + Eval) added between TS and DG. META is the merge of the
    former MC (Meta Checker) and ME (Meta Eval) passes. MC validates phase separation and
    reflect() calls; ME evaluates compile-time ^{} blocks and splices results into the AST.
    DG now sees the post-meta-expansion AST.
  - TAB (Stage 3) consumer line updated: TAB now feeds MOD (Stage 3.1), not BPP.
  - TAB (Stage 3) deferred body parsing note updated: deferral target reference to BPP removed.
    Downstream stages receive ASTs as produced by CE.
  - PA (Stage 4), RI (Stage 5), TS (Stage 6) input contracts updated: source is now CE
    (Stage 3.2), not BPP. BPP-specific BareExpr invariant language removed.
  - DG (Stage 7) input contract updated: DG now receives the post-META-expansion AST.
  - Stage index table updated with MOD, CE, META rows; BPP row removed.
  - Stage dependency summary updated to reflect new pipeline.
  - Overview stage count and pipeline description updated.
  - Integration Failure Mode Catalog: "Deferred parsing gap" row updated (BPP removed).
- **0.5.1 (2026-03-30):** Security enforcement added to CG (Stage 8). Changes in this version:
  - CG output invariant extended: client JS MUST NOT contain SQL execution calls
    (`_scrml_sql_exec`, `_scrml_db`), server-environment access (`process.env`, `Bun.env`,
    `bun.eval()`), or other server-only constructs. This is now an explicit invariant, not
    an implicit assumption.
  - New error codes: `E-CG-006` (SQL/transaction/server-context meta node in client-boundary
    output), `W-CG-001` (top-level SQL/transaction-block suppressed from client output).
  - `CGError` type extended: optional `severity: 'error' | 'warning'` field. Default is
    `'error'`. `W-CG-001` uses `severity: 'warning'`.
  - CSRF token validation now injected into POST handlers when `csrf="auto"` is configured.
  - Auth check now injected into POST handlers when `auth="required"` is configured.
  - New failure mode row: "SQL/server-context leak to client JS".
- **0.5.0 (2026-03-27):** Stage 7 (DG) amended to resolve SPEC-ISSUE-007. Changes in this
  version:
  - `DGNode` type extended: every node variant gains a `hasLift: boolean` field. `hasLift` is
    `true` when the statement or statement sequence immediately following the node in the same
    anonymous logic block contains a `LiftExpr` node. This annotation is computed during the
    per-file subgraph phase and is immutable once set.
  - DG output invariants: added `hasLift` annotation invariant and the lift-annotation
    derivation rule.
  - DG error contract: added `E-LIFT-001` (concurrent lift — two parallel DG nodes in the same
    logic block both have `hasLift: true`).
  - DG transformation: added lift-checker sub-pass (Phase 2 of DG build) specifying the exact
    detection algorithm.
  - Integration Failure Mode Catalog: added "Concurrent lift misordering" failure mode row.
- **0.4.0 (2026-03-26):** Stage 3.5 (BPP — Body Pre-Parser) inserted per SPEC-ISSUE-008
  resolution. (Superseded by 0.6.0 — BPP removed.)
- **0.3.0 (2026-03-26):** Stage 4 (PA) contract revised to resolve 11 blocking issues from
  design review `docs/reviews/language/spec-review-§11-protect-PA-gate-2026-03-26.md`.
  Changes in this version:
  - PA input invariant: `tables=` is now REQUIRED (E-PA-005 if absent).
  - PA input invariant: `src=` absence is now E-PA-006 (distinct from E-PA-001, file not found).
  - PA output invariant: `protect=` split algorithm is now a canonical 4-step algorithm with
    enumerated ASCII whitespace codepoints. Replaces "split on comma+whitespace, trimmed."
  - PA output invariant: unknown `protect=` field names are now E-PA-007 (compile error), not
    a warning. W-PA-001 (the prior warning) is removed.
  - PA output invariant: empty tokens from consecutive commas are silently discarded (not an error).
  - PA output invariant: every `< db>` block gets a `views` entry regardless of protect= presence.
  - PA output: `dbPath` is now specified as the resolved canonical absolute path.
  - PA output: `StateBlockId.filePath` is now specified as the resolved canonical absolute path.
  - PA transformation: two db blocks referencing the same database with different protect= lists
    produce independent ProtectAnalysis entries.
  - PA architecture note added: `FunctionDecl.isServer` is a TAB syntactic hint; RI is authoritative.
  - PA architecture note added: `ColumnDef[]` to named type is a TS concern, not PA.
  - PA architecture note added: scope resolution (lexical scope of db block) is a TS concern.
  - Error codes added: E-PA-005, E-PA-006, E-PA-007.
- **0.2.0 (2026-03-26):** Contract change notice -- five amendments applied. See
  `docs/reviews/pipeline/contract-change-notice-2026-03-26.md` for details.
  - Amendment 1: Stage 2 BS output `kind` renamed to `type`; type values aligned to implementation.
  - Amendment 2: Stage 3 LogicNode kind wire-value table added.
  - Amendment 3: Stage 3 FunctionDecl shape updated (`fnKind`, `isServer`).
  - Amendment 4: Stage 3 deferred body parsing documented.
  - Amendment 5: Stage 3 error codes `E-MARKUP-001`, `E-STATE-001`, `E-REACTIVE-001`,
    `E-SCOPE-001` reassigned to Stage 6 (TS).
  - Amendment 6 (P2 / state-as-primary unification, 2026-04-30): Stage 3 TAB
    recognizes top-level `export <ComponentName ...>...</>` (SPEC §21.2 Form 1)
    via `liftBareDeclarations` desugaring. The contract is unchanged — Form 1
    produces an `export-decl` indistinguishable from the legacy
    `${ export const Name = <markup> }` form at the AST level.
- **0.1.0 (2026-03-25):** Initial stage contracts for all eight stages.

---

## Overview

The scrml compiler transforms `.scrml` source files into HTML, CSS, and JavaScript through twelve
ordered stages. Each stage receives a well-typed input, performs a bounded transformation, and
hands off a well-typed output to the next stage. This document defines the binding contracts for
every stage boundary.

**Hard performance target:** A 4000-line project MUST compile from scratch in under 1 second
(wall time). Per-stage budgets below are normative. Budgets are calibrated for a 100-line
median file (the common case); a 4000-line project spread across ~40 files at 100 lines each
maps to the per-file budgets below when running with full worker parallelism.

**Parallelism model:**
- File-level parallelism: stages 1 through CE (Stage 3.2) are embarrassingly parallel per file.
  Each file runs in its own Bun worker.
- MOD (Stage 3.1) is project-wide: it requires all TAB outputs before it can build the import
  graph and compilation order.
- Cross-file stages (protect= analysis, route inference, dependency graph) require a
  synchronization point after per-file passes complete.
- `SharedArrayBuffer` + `Atomics` are used for coordination signals between workers.
- A stage marked **parallelism: per-file** can run concurrently across all source files with no
  inter-file coordination.
- A stage marked **parallelism: project-wide** must wait for all per-file upstream results.

---

## Stage Index

| # | Name | Abbrev | Parallelism |
|---|---|---|---|
| 1 | Preprocessor | PP | per-file |
| 2 | Block Splitter | BS | per-file |
| 3 | Tokenizer + AST Builder | TAB | per-file |
| 3.05 | Name Resolution (IMPLEMENTED P1.E — shadow mode; routing flip in P2/P3) | NR | per-file (after MOD) |
| 3.1 | Module Resolver | MOD | project-wide (needs all TAB outputs) |
| 3.2 | Component Expander | CE | per-file (after MOD complete) |
| 3.3 | Unified Validation Bundle (VP-1, VP-2, VP-3) | UVB | per-file (after CE) |
| 4 | protect= Analyzer | PA | project-wide (needs schema I/O) |
| 5 | Route Inferrer | RI | project-wide |
| 5.5 | Monotonicity Classifier (A9 Ext 5) | MC | project-wide (after RI) |
| 6 | Type System | TS | per-file (after PA+RI complete) |
| 6.5 | Meta Check + Eval | META | project-wide |
| 6.7 | Validity Surface Synthesis | VSS | per-file (after META) |
| 7 | Dependency Graph Builder | DG | project-wide |
| 7.5 | Batch Planner (A9 Ext 5) | BP | project-wide (after DG, RI, PA) |
| 7.6 | Reachability Solver (SPEC ANCHOR — v0.3 §40.9; INACTIVE; impl deferred) | RS | project-wide (after DG with markup-context edges lifted) |
| 8 | Code Generator | CG | per-file (after DG complete) |

---

## Lock Enforcement Map

The locks L1-L22 originate from S55-S65 deliberation
(`scrml-support/docs/deep-dives/v0next-s56-deliberation-outcomes-2026-05-04.md` for L1-L20;
S59 for L21; S65 debate-05 for L22). Each lock describes a design decision that the v0.next
pipeline encodes into one or more stages. Use this table to locate the firing stage(s) for
any given lock without reading the full stage prose.

| Lock | One-line statement | Firing stage(s) |
|---|---|---|
| L1 | Markup-as-first-class-value (pillar) | cross-cutting — Stage 3 (TAB render-spec parsing) + Stage 6 (TS render-spec validity classification) + Stage 8 (CG render-by-tag expansion) |
| L2 | Compound state — Variant C with canonical `@compound.field` access | Stage 3 (TAB compound-rollup AST shape) + Stage 6 (TS field-type resolution) |
| L3 | Decl-coupled-with-render-spec (`<name req> = <input/>`) | Stage 3 (TAB `rhsShape` classification) + Stage 6 (TS bindable / non-bindable classification) |
| L4 | Declarative validators with partial vocabulary unification | Stage 3.3 (VP-1 attribute allowlist) + Stage 6 (TS validator-vocabulary check) |
| L5 | `is some` reused from existing existence primitive | Stage 3 (TAB token recognition) + Stage 6 (TS optional-typing semantics) |
| L6 | Match unification — Tier 0/1/2 ladder | Stage 3 (TAB `match-block-decl` AST shape) + Stage 6 (TS exhaustiveness) + Stage 8 (CG conditional dispatch) |
| L7 | Match attribute semantics (rules legal-but-inert; `effect=` / `<onTransition>` engine-only) | Stage 3.3 (VP-2 `E-STRUCTURAL-ELEMENT-MISPLACED` for `<onTransition>` outside engine) + Stage 6 (TS attribute semantics) |
| L8 | Two match shapes coexist (block-form vs JS-style) | Stage 3 (TAB classifies by parent context) |
| L9 | `loose` flag dropped | negative-space lock — no firing site (absence) |
| L10 | `reset()` as primitive | superseded by L18 |
| L11 | Auto-derived validity surface per compound | **Stage 6.7 (Validity Surface Synthesis)** — fires across TS sub-passes (B11/B12/B17), DG `'validator-arg'` edges, CG accessor emission |
| L12 | Validator error-message origin (4-level hybrid + `.Custom(tag)`) | Stage 6 (TS message-resolution chain) + Stage 8 (CG `messageFor(...)` emission) |
| L13 | Per-field error UI rendering (`<errors of=expr/>`) | Stage 3 (TAB `errors-elem` AST shape) + Stage 3.3 (VP-2 `of=` required) + Stage 8 (CG `<errors>` rendering) |
| L14 | Cross-field validation via predicate args (no separate category) | Stage 7 (DG `'validator-arg'` edges + cycle detection → `E-VALIDATOR-CIRCULAR-DEP`) |
| L15 | `const <derived> = expr` in-compound derived form | Stage 3 (TAB `rhsShape: "derived-expr"`) + Stage 6 (TS derived-cell typing) + Stage 7 (DG `'derives-from'` edges + cycle detection) + Stage 8 (CG reactive computed emission) |
| L16 | Multi-render via existing access paths (no override syntax) | negative-space lock |
| L17 | Bind-attribute dispatch by render-spec shape | Stage 6 (TS bindable / non-bindable classification) + Stage 8 (CG bind-flavor dispatch table) |
| L18 | `reset(@cell)` keyword (γ-semantics with `default=` fallback to β init re-eval) | Stage 3 (TAB `default=` capture; `reset` keyword) + Stage 8 (CG `reset(@cell)` expansion) |
| L19 | Multi-statement event-handler restriction | Stage 3 (TAB `E-MULTI-STATEMENT-HANDLER` at parse time) |
| L20 | `derived=expr` on engines | Stage 3 (TAB `derived=` attribute) + Stage 6 (TS engine-type compatibility) + Stage 7 (DG `'engine-derives'` edges + `E-DERIVED-ENGINE-CIRCULAR`) + Stage 8 (CG derived-engine reactive subscription) |
| L21 | Derived-cell value-mutation forbidden | Stage 6 (TS `E-DERIVED-VALUE-MUTATE`) |
| L22 | Type-as-argument as first-class primitive (`parseVariant` first member) | Stage 3 (TAB type-token recognition in expression position) + Stage 6 (TS type-as-argument resolution; `E-PARSEVARIANT-001`) + Stage 8 (CG `parseVariant` runtime emission) |

**Multi-stage locks are the rule, not the exception.** Most locks fire across 2-4 stages.
L1, L9, L10, L16 are exceptions: L1 is cross-cutting (a pillar); L9 / L16 are negative-space
(an absence enforced by silence); L10 was superseded by L18.

---

## Stage 1: Preprocessor (PP)

**Input contract:**
- Type: `{ filePath: string, source: string }`
- Invariants:
  - `source` is the raw UTF-8 text of a `.scrml` file exactly as read from disk.
  - `source` has not been modified by any prior pass.
  - `filePath` is the absolute path of the source file.
- Source: Compiler entry point (file reader)

**Output contract:**
- Type: `{ filePath: string, source: string, macroTable: Map<string, string> }`
- Invariants:
  - `source` is the result of applying all preprocessor macro substitutions to the input text.
  - `macroTable` maps each defined macro name to its substitution text.
  - All `#define`-style directives have been consumed and are absent from `source`.
  - `source` preserves line count relative to input (substitutions are inline; directives become
    blank lines). Source positions in downstream spans are calculated against the post-PP source.
  - No structural analysis has been performed. `source` is still a flat string.
- Consumer: Block Splitter (BS)

**Error contract:**
- May throw: No — errors are returned as values.
- Error type: `PPError { code: string, message: string, span: Span }`
- Error codes:
  - `E-PP-001`: Macro defined with duplicate name (second definition wins with a warning, not
    an error — configurable).
  - `E-PP-002`: Macro reference in source resolves to undefined name.
  - `E-PP-003`: Circular macro expansion detected.
- Partial output: Fail-fast on `E-PP-002` and `E-PP-003`. `E-PP-001` produces partial output
  with the warning attached.

**Transformation:**
The preprocessor performs a single-pass textual scan of the raw source, identifying preprocessor
directives (lines beginning with a `#define`-style marker). It builds a substitution table and
applies all substitutions to the remaining source text. Substitution is purely textual — no
awareness of scrml context types, tag/state distinctions, or attribute forms. The output source
is structurally identical to the input except that directive lines are blanked and substitution
sites are replaced with their expansion text.

**What is NOT done by this stage:**
- No parsing of scrml syntax.
- No tag/state disambiguation.
- No tokenization.
- No validation of macro expansion content as valid scrml.
- No scope analysis.
- No import resolution.

**Performance budget:** <= 5 ms per file.
**Parallelism opportunity:** Yes — fully per-file, no inter-file state.
**Dependencies:** None — first stage.

---

## Stage 2: Block Splitter (BS)

**Input contract:**
- Type: `{ filePath: string, source: string, macroTable: Map<string, string> }`
- Invariants:
  - `source` is the preprocessed source text (all macro directives consumed).
  - No structural analysis has been applied.
  - All line/column positions referenced in spans map to this `source` string.
- Source: Preprocessor (PP)

**Output contract:**
- Type: `{ filePath: string, blocks: Block[] }`

  ```
  Block = {
    type: 'markup' | 'state' | 'logic' | 'sql' | 'css' | 'error-effect' | 'meta' | 'text' | 'comment',
    raw: string,               // verbatim source slice (including delimiters)
    name: string | null,       // tag name for markup; state name for state; null for brace-delimited, text, and comment blocks
    span: Span,                // byte offsets [start, end) in preprocessed source
    depth: number,             // nesting depth (0 = top-level)
    children: Block[],         // nested child blocks
    closerForm: 'trailing' | 'explicit' | 'inferred' | 'self-closing' | null,
  }

  Span = { start: number, end: number, line: number, col: number }
  ```

  **`Block.type` value reference (Amendment 1, 2026-03-26):**

  | `type` value       | Opener syntax   | Closer syntax           | Notes |
  |---------------------|-----------------|-------------------------|-------|
  | `"markup"`          | `<ident`        | `</ident>`, `/`, or `/>` | No whitespace between `<` and identifier |
  | `"state"`           | `< ident`       | `</ident>` or `/`       | Whitespace between `<` and identifier |
  | `"logic"`           | `${`            | `}` (brace-depth)       | |
  | `"sql"`             | `?{`            | `}` (brace-depth)       | |
  | `"css"`             | `#{`            | `}` (brace-depth)       | Was `"css-inline"` in v0.1.0 contract |
  | `"error-effect"`    | `!{`            | `}` (brace-depth)       | |
  | `"meta"`            | `^{`            | `}` (brace-depth)       | |
  | `"text"`            | (implicit)      | (implicit)              | Raw text content between other blocks |
  | `"comment"`         | `//`            | end of line             | Line comments; includes the newline |

  **`closerForm` values:**
  - `"explicit"` — closed by `</name>` tag.
  - `"inferred"` — closed by bare `/`.
  - `"trailing"` — closed by trailing `/` (reserved; not yet produced by BS).
  - `"self-closing"` — closed by `/>` in the opening tag. The block is a leaf with no children.
  - `null` — brace-delimited blocks (`logic`, `sql`, `css`, `error-effect`, `meta`), `text`
    blocks, and `comment` blocks do not use closer-form semantics.

- Invariants:
  - The `blocks` array forms a complete, non-overlapping partition of the source text. Every
    source character is accounted for: whitespace and raw text are represented as `text` blocks;
    line comments are represented as `comment` blocks.
  - Every `Block` with `type === 'markup'` was introduced by `<` with NO whitespace before the
    identifier. Every `Block` with `type === 'state'` was introduced by `<` followed by one or
    more whitespace characters before the identifier. This disambiguation is exhaustive and
    unambiguous per spec Section 4.3.
  - Every `Block` with `type === 'meta'` was introduced by the two-character sequence `^{`.
    Meta blocks may appear inside ANY parent context (markup, state, logic, SQL, CSS, error, or
    another meta block). Meta blocks nest arbitrarily: `^{ ... ^{ ... } ... }` is valid. The
    closer is `}` following standard brace-depth tracking (spec Section 22.2).
  - Every `Block` has a valid `closerForm` reflecting the actual closer used in source, or
    `null` for block types that do not use closer-form semantics.
  - `children` arrays are sorted by source order (ascending `span.start`).
  - Spans are non-overlapping across siblings. Spans of children are fully contained within
    parent spans.
  - `raw` contains the verbatim source slice including delimiters. Attribute content for
    markup/state blocks is embedded in `raw`; attribute parsing is deferred to TAB.
  - No identifier resolution has been performed.
  - The context stack was balanced at parse time. Any unclosed context is reported as an error,
    not silently dropped.
- Consumer: Tokenizer + AST Builder (TAB)

**Error contract:**
- May throw: Yes — BS errors are thrown as `BSError` exceptions (fail-fast).
- Error type: `BSError { code: string, message: string, bsSpan: { start, end, line, col } }`
- Error codes:
  - `E-CTX-001`: Wrong closer for the current context type (e.g., `}` used inside markup
    context, mismatched `</tag>` close tag).
  - `E-CTX-002`: Bare `/` or trailing `/` used inside a brace-delimited context (`${}`, `?{}`,
    `#{}`, `!{}`, or `^{}`).
  - `E-CTX-003`: Unclosed context at end of file or before an outer closer.
- Partial output: Fail-fast. The block tree is not emitted if the context stack is unbalanced
  at end of file or if any `E-CTX-001` / `E-CTX-002` is encountered. This prevents downstream
  stages from operating on a structurally incoherent block tree.

**Transformation:**
The block splitter performs a single linear scan over the preprocessed source maintaining a
context stack. At each `<` character, it reads the immediately following character: if it is an
ASCII letter or underscore (no whitespace), the block is classified as markup; if it is any
whitespace character, the block is classified as state. At `${`, `?{`, `#{`, `!{`, and `^{`,
the corresponding context is pushed onto the stack. At each closer form (`/`, `</name>`, or
`/>`), the innermost open block is closed and popped. The `^{` opener pushes a meta context
onto the stack; the matching `}` (by brace-depth tracking) closes it. Meta blocks may nest
inside any parent context and may themselves contain any child context. Line comments (`//`)
are recognized at all context levels and produce `comment` blocks. Raw text between structural
blocks is accumulated into `text` blocks. The output is a tree of typed blocks with spans. No
evaluation of attribute values or content expressions occurs.

**What is NOT done by this stage:**
- No tokenization of attribute values or logic/SQL/CSS/meta content.
- No validation of attribute names against the HTML spec.
- No resolution of state identifiers (whether `< db>` is a valid state type is not checked here).
- No type inference or scope analysis.
- No validation that unquoted attribute values are resolvable identifiers.
- No import resolution.
- No compile-time evaluation of meta block content (that is downstream).

**Performance budget:** <= 10 ms per file.
**Parallelism opportunity:** Yes — fully per-file.
**Dependencies:** Preprocessor (PP) must complete for the file.

### Stage 2 v0.next addendum — raw-content elements (S101, SPEC §4.17)

- **Raw-content element recognition.** The lowercase tag names `pre` and `code` (matched case-insensitively, gated on `!isComp` so uppercase `<Pre>` / `<Code>` component references take the normal markup path) trigger the raw-content body-scan after `scanAttributes` consumes the opener's attribute set. The scan finds the matching close tag (case-insensitive on the element name) and captures the body verbatim as a single `text`-typed child of the markup block.
- **Token suppression inside raw-content.** During the body scan, no scrml-significant tokens are recognized: `${...}` does NOT open a logic context, `<TagName>` does NOT open a nested markup block, `?{...}` / `#{...}` / `!{...}` / `^{...}` / `_{...}` brace contexts do NOT open, `//` line-comments do NOT suppress recognition, `<!-- -->` markup-comment-skip does NOT engage. The entire body is a single text run.
- **HTML entity-escaping unchanged.** Authors continue to entity-escape `<` / `>` / `&` for visible display per plain-HTML rules; BS does not auto-encode raw-content bodies. (Browsers do not auto-encode inside `<pre>` either; the rule parallels HTML's own.)
- **EOF recovery.** Unterminated raw-content opener emits `E-CTX-001` against the opener span and emits the markup block with `closerForm: "inferred"` and the captured raw text spanning from after the opener's `>` through end-of-file.
- **No new error codes.** Token suppression does not fail; it just doesn't parse. Existing block-grammar diagnostics (`E-CTX-001`, `E-CTX-003`, `E-PARSE-001`) cover EOF / pairing / generic-parse cases.
- **Locus:** `compiler/src/block-splitter.js` — new `RAW_CONTENT_ELEMENTS` Set declaration; raw-content branch between the void/self-closing emit and the normal `pushTagContext` push in the markup-opener path. Companion conformance test at `compiler/tests/conformance/conf-raw-content-pre-code.test.js` (15 cases).
- **Composition with downstream stages.** The text-child carries through TAB / NR / TS / CG verbatim; CG emits it as literal HTML in the dist output. No new contract surface on downstream stages.

---

## Stage 3: Tokenizer + AST Builder (TAB)

**Input contract:**
- Type: `{ filePath: string, blocks: Block[] }` (as defined in BS output contract)
- Invariants:
  - `blocks` is a complete, non-overlapping partition of the source (all BS invariants hold).
  - Block discriminator is `block.type` (not `block.kind`).
  - No identifier resolution has been performed.
  - All spans reference positions in the preprocessed source string.
  - Context stack was balanced (BS would have failed otherwise).
- Source: Block Splitter (BS)

**Output contract:**
- Type: `{ filePath: string, ast: FileAST, errors: TABError[] }`

  **Note (Amendment 5, 2026-03-26):** TAB returns errors as values in the `errors` array. It
  does not throw exceptions. Downstream stages must check `errors.length === 0` before
  proceeding. A non-empty `errors` array means the `ast` may be partial or structurally
  incomplete.

  ```
  FileAST = {
    filePath: string,
    nodes: ASTNode[],           // top-level nodes
    imports: ImportDecl[],
    exports: ExportDecl[],
    components: ComponentDef[], // const Name = <element props> definitions
    typeDecls: TypeDecl[],
  }

  ASTNode =
    | MarkupElement { tag: string, attrs: AttrNode[], children: ASTNode[], span: Span }
    | StateBlock    { stateType: string, attrs: AttrNode[], children: ASTNode[], span: Span }
    | LogicBlock    { body: LogicNode[], span: Span }
    | SQLBlock      { query: string, chainedCalls: ChainCall[], span: Span }
    | CSSBlock      { rules: CSSRule[], span: Span }
    | StyleBlock    { rules: CSSRule[], span: Span }
    | ErrorEffectBlock { arms: MatchArm[], span: Span }
    | MetaBlock     { body: ASTNode[], parentContext: ParentContextKind, span: Span }
    | TextNode      { value: string, span: Span }
    | CommentNode   { value: string, span: Span }

  ParentContextKind = 'markup' | 'state' | 'logic' | 'sql' | 'css' | 'error' | 'meta'

  AttrNode = {
    name: string,
    value: AttrValue,
    span: Span,
  }

  AttrValue =
    | { kind: 'string-literal', value: string }
    | { kind: 'variable-ref',   name: string }
    | { kind: 'call-ref',       name: string, args: string[] }
    | { kind: 'absent' }         // boolean attribute

  LogicNode =
    | FunctionDecl { kind: "function-decl", name: string, params: string[], body: LogicNode[],
                     fnKind: "function" | "fn", isServer: boolean, span: Span }
    | BareExpr     { kind: "bare-expr", expr: string, span: Span }
    | LiftExpr     { kind: "lift-expr", expr: LiftTarget, span: Span }
    | ReactiveDecl { kind: "state-decl", name: string,
                     modifier: "plain" | "const" | "pinned" | "server" | ...,
                     rhsShape: "literal" | "render-spec" | "derived-expr",
                     rhsRaw: string, rhsAst: ASTNode | LiftTarget,
                     validators: AttrNode[],     // bare attribute list (req, length, pattern, ...)
                     defaultExpr: string | null, // from default= attribute
                     span: Span }
    | LetDecl      { kind: "let-decl", name: string, init: string, span: Span }
    | PureDecl     { kind: "pure-decl", name: string, params: string[], body: LogicNode[], span: Span }
    | ImportDecl   { kind: "import-decl", ... }
    | ExportDecl   { kind: "export-decl", ... }
    | TypeDecl     { kind: "type-decl", ... }
    | ComponentDef { kind: "component-def", ... }
    | EnumVariantRef { kind: "enum-variant-ref",
                       qualifier: string | null,  // null on bare-variant `.X` (resolved at TS)
                       variantName: string, span: Span }
    // + standard JS constructs: IfStmt, ForStmt, ReturnStmt, etc.

  LiftTarget =
    | { kind: 'markup', node: ASTNode }
    | { kind: 'expr',   expr: string }
  ```

  **`ReactiveDecl.rhsShape` (V5-strict, SPEC §6.1, §6.2):**
  - `"literal"` — RHS is a literal or expression value. `rhsAst` is a `LogicNode`.
  - `"render-spec"` — RHS is a markup element (Shape 2; e.g., `<input type="email"/>`).
    `rhsAst` is a `MarkupElement`; CG uses the render-spec at codegen time for `<x/>`
    render-by-tag expansion (cross-ref Stage 8 transformation).
  - `"derived-expr"` — declaration uses `const` modifier; RHS is a reactive expression.
    `rhsAst` is a `LogicNode`. Markup-typed derived cells are legal under L1.

  Bindable-vs-non-bindable classification of a `"render-spec"` RHS is performed at TS
  (Stage 6) using the per-element shape table — TAB records the shape; TS validates against
  the use-site form.

  **LogicNode `kind` wire-value table (Amendment 2, 2026-03-26):**

  Every `LogicNode` variant has a `kind` field whose value is a kebab-case string. Downstream
  stages MUST match on these exact string values. The type name (e.g., `FunctionDecl`) is a
  documentation-level name only and does not appear on the wire.

  | Type name      | `kind` string value  |
  |----------------|---------------------|
  | FunctionDecl   | `"function-decl"`   |
  | ReactiveDecl   | `"state-decl"`   |
  | PureDecl       | `"pure-decl"`       |
  | BareExpr       | `"bare-expr"`       |
  | LiftExpr       | `"lift-expr"`       |
  | LetDecl        | `"let-decl"`        |
  | ImportDecl     | `"import-decl"`     |
  | ExportDecl     | `"export-decl"`     |
  | TypeDecl       | `"type-decl"`       |
  | ComponentDef   | `"component-def"`   |
  | EnumVariantRef | `"enum-variant-ref"`|

  **FunctionDecl shape (Amendment 3, 2026-03-26):**

  The `FunctionDecl` node uses `kind: "function-decl"` as its discriminator (consistent with
  all other LogicNode variants). The function form (`function` keyword vs `fn` shorthand) is
  recorded in a separate `fnKind` field. The `isServer` field is a syntactic hint from the
  source (e.g., `server function`); the authoritative boundary assignment is made by RI at
  Stage 5.

  **Deferred body parsing (Amendment 4, 2026-03-26):**

  At the TAB stage, `FunctionDecl.body`, `PureDecl.body`, and `fn` shorthand bodies are stored
  as `[{ kind: "bare-expr", expr: rawBodyString, span }]` — a single `BareExpr` node wrapping
  the raw brace content as an unparsed string. The `body` field is typed as `LogicNode[]`, which
  is technically correct (`BareExpr` is a `LogicNode`), but the content is not recursively
  parsed into the full LogicNode grammar at this stage.

  Downstream stages (PA, RI, TS) receive ASTs that may contain `BareExpr` wrappers in body
  positions. Each downstream stage documents its handling of these wrappers in its own contract.

- Invariants:
  - Every node carries a `Span` referencing the preprocessed source. Spans are NEVER dropped.
  - The discriminated union tag (`kind` field) is always present and valid on every node.
  - Attribute values are fully classified into their quoting form. No unclassified raw attribute
    strings remain in the AST.
  - `lift` expressions are represented as `LiftExpr` nodes, not as raw JS strings.
  - `@variable` assignments are represented as `ReactiveDecl` nodes.
  - `fn name { ... }` shorthand is normalized to `FunctionDecl` with `fnKind: 'fn'`.
  - SQL blocks carry the raw query string and any chained method calls as structured nodes.
  - `import` and `export` statements are hoisted into `FileAST.imports` and `FileAST.exports`
    regardless of where they appear in source (inline imports are valid per spec Section 21).
  - **Amendment 6 (P2 / state-as-primary unification, 2026-04-30):** Top-level
    `export <ComponentName ...>...</>` (SPEC §21.2 Form 1) is recognized by
    the `liftBareDeclarations` pre-pass. The pattern (text block ending in
    bare `export` + immediately following PascalCase markup block) is paired
    into a single synthetic logic block of the form
    `${ export const ComponentName = <markup-raw> }`. The resulting
    `export-decl` carries `exportKind="const"` and `exportedName=ComponentName`,
    matching the legacy `${ export const Name = <markup> }` form
    byte-for-byte at the FileAST.exports level. Downstream stages (MOD, NR,
    CE, codegen) observe no contract change. Synthetic logic nodes carry
    advisory `_p2Form1: true` and `_p2Form1Name` markers for diagnostics.
  - **Amendment 7 (P3.B / cross-file engine resolution, 2026-05-02):** A
    Form 2 `export type X:kind = {...}` declaration SHALL produce BOTH a
    `type-decl` AST node (parsed `name`, `typeKind`, body) AND an `export-decl`
    AST node (`exportKind="type"`, `exportedName=X`). The `type-decl` SHALL
    be appended to `FileAST.typeDecls` so that downstream stages and cross-file
    consumers (notably `api.js` `importedTypesByFile` seeding) can resolve `X`
    in the same way as a non-exported type. This mirrors the existing dual-node
    behaviour for `export function f() {...}` (which produces both `function-decl`
    and `export-decl`). Closes F-ENGINE-001 by enabling `<engine for=ImportedType>`
    to resolve `ImportedType` across files. Per SPEC §21.2 normative addition
    and §51.16. Predicate behaviour for the `export-decl` node is unchanged;
    the change is purely additive.
  - **Structural-element classification (v0.next, SPEC §4.15 / §24.4):** the four
    scrml-defined structural elements are recognized at TAB time as distinct AST
    node kinds (per the table below). The block-splitter recognizes them as
    ordinary `<` openers (canonical no-space convention); TAB classifies them
    by name lookup against the structural-element registry. NR (Stage 3.05)
    is the authoritative routing source — TAB just stamps the kind.

    | Element | New AST node kind | Required attributes (TAB-validated) | Body recognition |
    |---|---|---|---|
    | `<engine>` | `engine-decl` (renamed from `machine-decl` per S53) | `for=Type` | bare-body OR `:`-shorthand state-children |
    | `<match>` | `match-block-decl` (NEW; distinct from JS-style `match` expr) | `for=Type` | bare-body of variant arms |
    | `<errors>` | `errors-elem` (NEW) | `of=expr` | optional bare-body (override template); `all` boolean attribute |
    | `<onTransition>` | `on-transition-elem` (NEW) | none required | bare-body or `:`-shorthand; `to=Variant`, `from=Variant`, `once`, `if=expr` attributes |

  - **`:`-shorthand body recognition (v0.next, SPEC §4.14):** a tag opener may
    end with ` : <single-expression>>` (whitespace before the colon, then a
    single scrml expression, then the closing `>` of the opener). TAB recognizes
    this form on `<engine>`, `<match>` arm state-children, `<onTransition>`, and
    any other element that admits the form per its owning section. The expression
    following `:` is parsed using the same grammar TAB uses for bare-call
    attribute values + `${...}` interpolation contents. A closer present on a
    `:`-shorthand body is `E-CLOSER-001`. Multi-statement intent (`;` outside
    expression-internal contexts) is `E-MULTI-STATEMENT-HANDLER`.
  - **Bare-variant inference parsing (v0.next, SPEC §14.10 / §18.0.3):**
    `.VariantName` (no preceding qualifier) is legal in expression positions
    where the type is fixed. TAB parses bare-variant references as
    `EnumVariantRef { kind: "enum-variant-ref", qualifier: null, variantName: string, span }`.
    TS resolves the qualifier from context.
  - **Positional binding parsing (v0.next, SPEC §14.11):** a struct-typed cell
    with a positional initialiser `<x>: T = (a, b, c)` is parsed as a
    `TupleLiteral` RHS. TS validates the tuple's arity and per-position types
    against the struct's field declaration order.
  - `MetaBlock` nodes record the `parentContext` from which the `^{ }` was entered. This is
    the discriminant the type system uses to determine the splicing coercion rules (spec
    Section 22.4): markup parent requires markup-coercible result, CSS parent requires CSS
    values, SQL parent requires SQL fragment, logic parent passes through as value, meta parent
    passes through as meta-layer value.
  - `MetaBlock.body` is a heterogeneous `ASTNode[]`. It may contain any node type that is valid
    inside a logic context (the meta context is compile-time code), plus nested `MetaBlock`
    nodes for `^{ ^{ } }` nesting.
  - Variables declared inside a `MetaBlock` are scoped to that block. The TAB stage records them
    as local declarations; it does NOT hoist them into the enclosing scope. Bindings from the
    enclosing scope are visible inside the meta block (scope inheritance, not scope isolation),
    but TAB does not resolve them -- that is TS's responsibility.
  - The AST is a pure value — no mutable shared state, no circular references.
- Consumer: Module Resolver (MOD, Stage 3.1). MOD's output feeds Component Expander (CE,
  Stage 3.2), which in turn feeds protect= Analyzer (PA) and Type System (TS).

**Error contract:**
- May throw: No — errors are returned as values in the `errors` field of the output.
- Error type: `TABError { code: string, message: string, span: Span }`
- Error codes (Amendment 5, 2026-03-26 -- four codes moved to TS):
  - `E-PARSE-001`: Token sequence is not valid in the current grammar position.
  - `E-PARSE-002`: `fn` shorthand used outside a logic context.
  - `E-ATTR-001`: `attr=fn()` on a non-event attribute where `fn` cannot return a compatible type.
  - `E-ATTR-002`: Boolean attribute assigned a quoted string literal instead of a boolean expression.
  - `E-META-002`: `^{ }` block contains a token sequence that is not valid as compile-time code
    (e.g., a bare HTML tag without a `lift` wrapper inside a meta block).
  - `E-CLOSER-001` (v0.next): `:`-shorthand body with a closer present (SPEC §4.14).
  - `E-MULTI-STATEMENT-HANDLER` (v0.next): bare-form event-handler attribute value or
    `:`-shorthand body contains multiple statements (`;` outside expression-internal
    contexts). Per SPEC §5.2.3, §4.14.
  - `E-NAME-COLLIDES-RESERVED` (v0.next): user component or state-type name collides with
    a reserved structural-element name (`engine`, `match`, `errors`, `onTransition`). Per
    SPEC §4.15, §24.4.
  - `E-IMPORT-PINNED-INVALID` (v0.next): `pinned` modifier on a non-cell, non-engine import
    (TAB detects at attribute-position parse time; full resolution at MOD). Per SPEC §21.8.1.
- Error codes removed from this stage (reassigned to Stage 6 TS — these require identifier
  resolution which TAB does not perform):
  - ~~`E-MARKUP-001`~~: Moved to TS. Tag name validation requires the component registry.
  - ~~`E-STATE-001`~~: Moved to TS. State identifier validation requires scope resolution.
  - ~~`E-REACTIVE-001`~~: Moved to TS. Reactive variable declaration checking requires scope.
  - ~~`E-SCOPE-001`~~: Moved to TS. Identifier resolution requires scope chain.
- Partial output: When `errors` is non-empty, the `ast` field contains a best-effort partial
  AST. Downstream stages MUST NOT proceed if `errors.length > 0`. The partial AST is provided
  for IDE integration (error reporting with location context) but is not structurally sound for
  compilation.

**Transformation:**
The tokenizer processes each `Block` from the BS output independently, according to that block's
`type`. Markup blocks are tokenized with the markup grammar (attributes, text nodes, child
blocks). Logic blocks are tokenized with the JS + scrml extension grammar (function declarations,
`lift`, `@reactive`, `fn` shorthand, inline markup expressions). SQL blocks extract the query
string and chained method calls. CSS blocks tokenize CSS rules. Meta blocks (`type === 'meta'`)
are tokenized with the same grammar as logic blocks (compile-time code is structurally JS +
scrml extensions); the resulting AST nodes are wrapped in a `MetaBlock` node that records the
`parentContext` from the enclosing block's `type`. Nested `^{ }` within a meta block produces a
child `MetaBlock` with `parentContext: 'meta'`. For each block type, the corresponding grammar
produces typed AST nodes with spans. Attribute values are classified into their quoting form.
`lift`, `fn`, `@`, `pure`, `~`, and the v0.next tokens (`pinned`, `is some`, `is not`,
`default=`) are recognized and represented as first-class AST nodes / attribute classifications,
not raw strings. The four scrml-defined structural elements (`<engine>`, `<match>`, `<errors>`,
`<onTransition>`) are classified at TAB time by name lookup against the structural-element
registry — TAB stamps the node kind; NR (Stage 3.05) decides routing.

For `ReactiveDecl` nodes, TAB classifies the RHS into one of three `rhsShape` values
(`"literal"` / `"render-spec"` / `"derived-expr"`) per V5-strict SPEC §6.1-§6.2. A `<x/>`
markup-position tag where `x` is a same-file or imported reactive-cell name is NOT
disambiguated at TAB; TAB produces a markup AST node and NR (Stage 3.05) decides
render-by-tag-vs-engine-statechild-vs-other via the unified state-type registry (§15.15).

Function, pure, and fn shorthand bodies may be stored as opaque `BareExpr` wrappers;
downstream stages handle these as documented in their own contracts. The output AST is a
discriminated union tree.

**What is NOT done by this stage:**
- No type resolution or type checking.
- No scope resolution beyond syntactic structure (identifiers are recorded but not resolved
  against a runtime scope).
- No protect= field filtering.
- No route inference.
- No evaluation of expressions (SQL queries are stored as raw strings).
- No HTML spec attribute validation (attribute names are recorded; validity is checked by TS).
- No dependency graph construction.
- No compile-time evaluation of meta block bodies (meta blocks are parsed into AST nodes but
  not executed; evaluation is performed by META stage).
- No import graph construction or circular dependency detection (performed by MOD, Stage 3.1).
- No component expansion (performed by CE, Stage 3.2).
- No identifier resolution for tag names, state types, reactive variables, or scope references
  (these checks are performed by TS using error codes `E-MARKUP-001`, `E-STATE-001`,
  `E-REACTIVE-001`, and `E-SCOPE-001`).

**Performance budget:** <= 25 ms per file (20 ms baseline + 5 ms for v0.next structural-element
recognition, render-spec classification, and bare-variant + positional inference parsing).
**Parallelism opportunity:** Yes — fully per-file.
**Dependencies:** Block Splitter (BS) must complete for the file.

---

## Stage 3.05: Name Resolution (NR) — AUTHORITATIVE

**Status (P3-FOLLOW, 2026-05-02):** NR is the authoritative source of
state-type / component routing for all downstream stages. The implementation
lives in `compiler/src/name-resolver.ts` (~470 LOC including diagnostics,
the unified registry construction, and the lift-expr walker extension) and
is wired into `compiler/src/api.js` between MOD (Stage 3.1) and CE (Stage
3.2). The `resolvedKind` / `resolvedCategory` advisory fields ARE populated
on every `MarkupNode`, `StateNode`, `StateConstructorDefNode`, and
`MachineDeclNode`. The `W-CASE-001` and `W-WHITESPACE-001` warnings ARE
emitted from NR. `W-DEPRECATED-001` continues to be emitted from TAB (the
`<machine>`-vs-`<engine>` keyword distinction is decided at TAB time).

**P3-FOLLOW changes:**
- Downstream stages (CE Phase 1, type-system §35 attribute validation,
  validators/post-ce-invariant.ts VP-2, name-resolver's own
  importedRegistry derivation, lsp/handlers.js cross-file completion) now
  route on `resolvedKind` / `resolvedCategory` directly. The legacy
  `isComponent` boolean is retained on AST markup nodes and on MOD's
  `exportRegistry` entries as a *derived backcompat field* (no longer the
  authoritative routing signal).
- MOD's exportRegistry vocabulary aligned with NR: components are
  `category: "user-component"` (was `"component"`).
- The transitional `compiler/src/state-type-routing.ts` (P3.A
  category-routing-table) is deleted.
- NR's walker traverses `lift-expr.expr.node` (markup nested inside `lift
  <wrapper>...<Component/></wrapper>`) — closes a coverage gap that
  prevented VP-2 from detecting residual components inside lift wrappers.

**Phased history:**
- **P1 / P1.E (2026-04-30):** NR ran in shadow mode; downstream routed on
  legacy `isComponent`.
- **P2 (2026-05-01):** Form 1 export landed; component routing remained
  legacy.
- **P3.A (2026-05-02):** `<channel>` routing became NR-authoritative;
  components stayed legacy.
- **P3-FOLLOW (2026-05-02):** ALL routing migrated to NR-authoritative.

**Input contract:**
- Type: `{ filePath: string, ast: FileAST, errors: TABError[] }`
- Invariants:
  - `errors.length === 0`. NR runs only on TAB-clean files.
  - `ast` is a fully-built FileAST per Stage 3 contract.
  - The unified state-type registry (per SPEC §15.15.1) is built lazily inside
    NR from the four sources: same-file declarations (from `ast.components`,
    `ast.typeDecls`, and `ast.machineDecls`), imported names (from MOD's
    `exportRegistry`, when MOD has run), built-in scrml lifecycle types
    (compile-time table; see html-elements.js sibling), and built-in HTML
    elements (from html-elements.js).
- Source: TAB (or MOD when cross-file resolution is required; in shadow mode
  NR's same-file resolution can run pre-MOD).

**Output contract:**
- Type: `{ filePath: string, ast: FileAST, errors: NRError[] }`
- Invariants (authoritative mode, P3-FOLLOW+):
  - Every tag-bearing AST node (`MarkupElement`, `StateBlock`,
    `StateConstructorDefNode`, `MachineDeclNode`) SHALL receive
    `resolvedKind: 'html-builtin' | 'scrml-lifecycle' | 'user-state-type' | 'user-component' | 'unknown'`
    and
    `resolvedCategory: 'html' | 'channel' | 'engine' | 'timer' | 'poll' | 'db' | 'schema' | 'request' | 'errorBoundary' | 'machine' | 'user-component' | 'user-state-type' | 'engine-state-child' | 'match-block' | 'match-arm' | 'errors-elem' | 'on-transition-elem' | 'render-by-tag' | 'unknown'`
    (the trailing six are v0.next additions).
  - NR SHALL NOT mutate any pre-existing AST field (additive only).
  - NR SHALL NOT block compilation on `unknown` resolutions; downstream
    stages (CE, MOD, TS) own the hard errors (`E-COMPONENT-020`,
    `E-MARKUP-001`, `E-STATE-001`).
  - NR's walker SHALL traverse `lift-expr.expr.node` so resolved fields
    stamp every reachable tag (P3-FOLLOW closed this gap).
  - Downstream stages route on `resolvedKind` / `resolvedCategory` (NR-
    authoritative). The legacy `isComponent` boolean is retained as a
    derived backcompat field but is no longer the routing signal.
  - The `< machine>` opener (deprecated) and `<machine>` no-space opener
    both resolve to `resolvedCategory: 'engine'`. The internal AST shape
    is `kind: "engine-decl"` with field `engineName` (renamed from the
    P1 `kind: "machine-decl"` / `machineName` in S53 by `ast-shape-rename`).
  - **Auto-declared engine variable (v0.next, SPEC §51.0.C):** for every
    `<engine for=Type>` declaration, NR registers a reactive cell named by
    `deriveEngineVarName(Type, varAttr)` in the same-file state-type registry
    with `resolvedKind: "scrml-lifecycle"`, `resolvedCategory: "engine"`,
    and a synthetic cell type of `EnumType` (the engine's `for=Type`).
    Conflict with a pre-existing same-file or imported declaration is
    `E-ENGINE-VAR-DUPLICATE`; the fix is to add `var=` to the engine.
  - **v0.next category routing (SPEC §15.15, §51, §55):** the additional
    `resolvedCategory` values are populated by NR per parent-context lookup,
    letting downstream stages route without re-walking parent chains:

    | Node | resolvedKind | resolvedCategory |
    |---|---|---|
    | `<engine>` decl | `"scrml-lifecycle"` | `"engine"` |
    | `<match>` block | `"scrml-lifecycle"` | `"match-block"` |
    | `<errors>` element | `"scrml-lifecycle"` | `"errors-elem"` |
    | `<onTransition>` element | `"scrml-lifecycle"` | `"on-transition-elem"` |
    | Engine state-child (`<Variant>` inside an `<engine>`) | `"scrml-lifecycle"` | `"engine-state-child"` |
    | Match arm (`<Variant>` inside a `<match>`) | `"scrml-lifecycle"` | `"match-arm"` |
    | `<x/>` render-by-tag (cell name in markup position) | `"user-state-type"` | `"render-by-tag"` |

**Error contract:**
- Error type: `NRError { code: string, message: string, span: Span, severity: 'warning' | 'error' }`
- Error codes:
  - `W-CASE-001`: lowercase user-declared state-type or component shadows a
    built-in HTML element (SPEC §15.15.4).
  - `W-WHITESPACE-001`: `< identifier>` opener uses whitespace; canonical form
    is no-space (SPEC §15.15.5).
  - `E-ENGINE-VAR-DUPLICATE` (v0.next): the engine's auto-derived (or
    `var=`-overridden) variable name collides with a same-file or imported
    declaration (SPEC §51.0.C). Severity: error.
  - `E-STATE-PINNED-FORWARD-REF` (v0.next): a `pinned` cell's initialiser
    depends on a cell declared LATER in source order (SPEC §6.10). Severity: error.
- Partial output: warnings only do not block; `error`-severity diagnostics
  block downstream stages.

**Transformation:**
NR walks the AST visiting every `MarkupElement` / `StateBlock`. For each opener,
it performs a registry lookup per SPEC §15.15.2 (same-file → imported → scrml
lifecycle → HTML built-in → unknown). The result populates the
`resolvedKind` / `resolvedCategory` AST fields. v0.next adds three side-channels
to the same walk:

1. **Engine auto-declared variable derivation (SPEC §51.0.C).** For each
   `<engine for=Type [var=X]>` node, NR derives the variable name and registers
   it in the same-file registry. The deterministic derivation is:

   ```
   deriveEngineVarName(typeName: string, varAttr: string | null) -> string:
     if varAttr is non-null:
       return varAttr   # explicit override
     return typeName[0].toLowerCase() + typeName.slice(1)   # literal lowercase-first; legacy `Machine` suffix KEPT per §51.0.C
   ```

   Examples: `<engine for=PhaseState>` declares `phaseState`; `<engine for=MarioMachine>`
   declares `marioMachine` (legacy suffix KEPT per §51.0.C — new code prefers names
   that don't end in `Machine`); `<engine for=AppMachine var=app>` declares `app`.

2. **`pinned` forward-reference detection (SPEC §6.10).** NR walks pinned-cell
   initialiser expressions and collects all referenced cell names; if any
   referenced cell has `decl.span.start > pinned.span.start`, NR emits
   `E-STATE-PINNED-FORWARD-REF`.

3. **Cross-cell expression dependency tracking.** NR records each reactive cell's
   initialiser-expression dependencies as a side table for Stage 7 (DG). NR does
   NOT construct the dependency graph; it provides the symbol-table-level
   information (which cells reference which other cells in their initialisers)
   that DG consumes.

Diagnostics for case shadowing and whitespace-opener emission fire as side
effects of the walk.

**Performance budget:** <= 8 ms per file (5 ms baseline + 3 ms for engine-variable
derivation + pinned forward-ref detection; verified P1.E: ~0-1 ms baseline in
practice — pure AST traversal).
**Parallelism opportunity:** Yes — fully per-file (same-file lookups have
no MOD dependency). Cross-file lookups defer to MOD's `exportRegistry`.
**Dependencies:** TAB must complete; MOD optional (only required for cross-file
lookups; same-file + lifecycle + HTML lookups run pre-MOD).

---

## Stage 3.1: Module Resolver (MOD)

**Input contract:**
- Type: `{ filePath: string, ast: FileAST, errors: TABError[] }[]` — the full array of TAB
  outputs for all files in the compilation unit.
- Invariants:
  - All TAB outputs are present. MOD is a project-wide synchronization point.
  - `errors` is empty for every file. MOD SHALL NOT run if any TAB returned errors.
  - Every `FileAST` has a valid `filePath` (absolute path).
  - `FileAST.imports` and `FileAST.exports` are populated from TAB.
- Source: Tokenizer + AST Builder (TAB) — all files complete

**Output contract:**
- Type:
  ```
  {
    compilationOrder: string[],
    exportRegistry: Map<string, Map<string, { kind: string, isComponent: boolean, category: string }>>,
    importGraph: Map<string, { imports: ImportEntry[], exports: ExportEntry[] }>,
    errors: ModuleError[],
  }

  ImportEntry = {
    names: string[],
    source: string,        // as written in the import statement
    absSource: string,     // absolute resolved path
    isDefault: boolean,
    span: Span | null,
  }

  ExportEntry = {
    name: string,
    kind: string,          // "const" | "function" | etc.
    reExportSource: string | null,  // absolute path if re-export; null otherwise
    span: Span | null,
  }
  ```

- Invariants:
  - `compilationOrder` is a topological sort of all file paths: dependencies come before
    dependents. Files with no imports appear first.
  - `exportRegistry` maps each file path to a `Map<name, {kind, isComponent, category}>`.
    `isComponent` is `true` for `const` exports with PascalCase names (first letter uppercase)
    and is retained as a derived backcompat field. `category` is the NR-aligned authoritative
    routing value (P3-FOLLOW). Named exports only — default exports are not supported in this
    version.

    | `category` | Trigger |
    |---|---|
    | `"user-component"` | `const Name = <markup ...>...</>` (PascalCase const export) |
    | `"channel"` | `export <channel name="..." topic="...">...</>` (P3.A) |
    | `"engine"` (v0.next) | `export <engine for=Type ...>...</>` (SPEC §21.8) |
    | `"user-state-type"` (v0.next) | non-engine, non-component user state-type export (rare; reserved for future use) |

    For `category: "engine"` exports, the registered NAME is the `var=`-overridden or
    auto-derived variable name (NOT the `for=Type` name) — importing files reference this
    exact name as `<engineVarName/>` at use-sites.
  - `importGraph` maps each file path to its parsed import and export entries. Relative paths
    in import statements are resolved to absolute paths in `absSource`.
  - No AST mutation. MOD is a pure analysis pass.
- Consumer: Component Expander (CE, Stage 3.2)

**Error contract:**
- May throw: No — errors are returned as values.
- Error type: `ModuleError { code: string, message: string, span: Span | null, severity: 'error' | 'warning' }`
- Error codes:
  - `E-IMPORT-001`: Export used outside a `${ }` context (detected at AST builder level;
    re-reported by MOD for clarity).
  - `E-IMPORT-002`: Circular import detected. The error message lists the full cycle as a
    chain of file names.
  - `E-IMPORT-003`: Import inside a function body (detected at AST builder level; re-reported
    by MOD for clarity).
  - `E-IMPORT-004`: Imported name not found in the target file's exports.
  - `E-IMPORT-PINNED-INVALID` (v0.next, SPEC §21.8.1): a `pinned` import resolves to an
    export whose `category` is neither `"engine"` nor a reactive cell. The fix is to drop
    the `pinned` modifier or import a different name.
- Partial output: All errors accumulated and returned. Circular imports (E-IMPORT-002) do not
  prevent the rest of the graph from being analyzed. The compilation order is best-effort when
  cycles exist. Downstream stages MUST NOT proceed if `errors` contains any `severity: 'error'`
  entries.

**Transformation:**
MOD performs five steps in sequence:
1. Build import graph: for each file, extract `FileAST.imports` and resolve relative paths to
   absolute paths. Build a `Map<filePath, {imports, exports}>` covering all files.
2. Detect circular imports: DFS over the import graph; report E-IMPORT-002 for each cycle.
3. Build export registry: for each file, map exported names to their `{kind, isComponent, category}`.
   A name is an `isComponent` candidate if its `kind` is `"const"` and the name starts with
   an uppercase ASCII letter. `category` is derived from the underlying export shape per
   the table in the Output contract (NR-aligned vocabulary post-P3-FOLLOW). For
   `category: "engine"`, the registered name is the engine's auto-derived (or `var=`-overridden)
   variable name.
4. Validate imports: for each import entry, verify every named import exists in the target
   file's export registry. Emit E-IMPORT-004 for each missing name. For each `pinned` import
   specifier, verify the resolved export's `category` is `"engine"` or that the export is a
   reactive cell — else emit `E-IMPORT-PINNED-INVALID` (SPEC §21.8.1).
5. Topological sort: produce `compilationOrder` — a valid build order for all files.

**What is NOT done by this stage:**
- No component expansion or inline resolution (performed by CE, Stage 3.2).
- No type resolution.
- No scope analysis.
- No AST mutation.

**Performance budget:** <= 5 ms for the full project (graph traversal; linear in file count;
v0.next category-derivation and pinned-import validation are constant-time per import).
**Parallelism opportunity:** None — this is a project-wide synchronization point.
**Dependencies:** TAB (Stage 3) must complete for ALL files.

---

## Stage 3.2: Component Expander (CE)

**Input contract:**
- Type: `{ filePath: string, ast: FileAST, errors: TABError[] }` — one TAB output at a time,
  plus the MOD output shared across all files.
- Invariants:
  - `errors` is empty. CE SHALL NOT run if TAB returned errors for this file.
  - MOD has completed successfully (all files, zero errors).
  - `ast.components` contains all `component-def` nodes for the file.
  - `ast.imports` and `ast.exports` are populated.
  - The `exportRegistry` from MOD maps file paths to their exported names and component flags.
  - The `fileASTMap` (a `Map<filePath, TABResult>`) is built from all TAB outputs before CE
    runs, so CE can look up cross-file component definitions. The map uses the pre-CE ASTs
    (CE consumes `ast.components`; the cross-file lookup must not use CE-mutated ASTs).
  - **W2 (2026-04-30):** `runCE`/`runCEFile` accept an OPTIONAL `importGraph` parameter
    (the `Map<filePath, ImportGraphNode>` from `moduleResult.importGraph`). When provided,
    CE resolves `imp.source` to its canonical absolute filesystem path via
    `importGraph.get(filePath).imports.find(e => e.source === imp.source).absSource` and
    uses that absolute path as the lookup key for `fileASTMap` and `exportRegistry`. This
    is the production path (mirrors the TS-pass pattern at api.js:626-660 and the LSP
    workspace pattern). When `importGraph` is omitted, CE falls back to using `imp.source`
    directly as the lookup key (legacy fallback for unit tests with synthetic fixtures).
    See SPEC §15.14.4 (test discipline) + §21.7 (auto-gather) + W2 deep-dive §6 (B2-b).
- Source: Tokenizer + AST Builder (TAB) and Module Resolver (MOD, Stage 3.1)

**Output contract:**
- Type: `{ filePath: string, ast: FileAST, errors: CEError[] }`
- Invariants:
  - No `component-def` node appears anywhere in the AST at any depth. All
    `component-def` nodes are consumed from `ast.components` and `ast.nodes` (removed).
  - No markup node with `isComponent: true` remains in the AST after a successful expansion.
    Resolved component references are replaced by expanded HTML markup subtrees. Unresolved
    references emit E-COMPONENT-020 from CE AND are left in place for the post-CE invariant
    check (Stage 3.3 / VP-2) to surface as E-COMPONENT-035. Either error fails the run.
  - Prop values passed at the call site are wired into the expanded subtree. Caller attributes
    become named identifiers in the component body. `${children}` placeholders receive the
    caller's child nodes.
  - The `FileAST` structure is otherwise intact. All non-component nodes are passed through
    unchanged. All spans are preserved.
  - Cross-file component references: if the file imports a PascalCase name from another file
    (registered as `isComponent: true` in `exportRegistry`), CE looks up the component
    definition in `fileASTMap` and expands it. The lookup uses the canonical absolute-path
    key (when `importGraph` is provided) or the raw `imp.source` (legacy fallback).
    The component-def is sourced from EITHER `targetTab.ast.components` (for direct
    `${ const Name = <markup/> }` declarations) OR `targetTab.ast.exports` (for
    `${ export const Name = <markup/> }` — W2 fix; the TAB pass classifies these as
    `export-decl` and the markup body is recovered by stripping the `export const NAME =`
    prefix from the export-decl `raw` field). If the target file is not in `fileASTMap`,
    E-COMPONENT-020 is emitted.
- Consumer: protect= Analyzer (PA, Stage 4) and Route Inferrer (RI, Stage 5)

**Error contract:**
- May throw: No — errors are returned as values.
- Error type: `CEError { code: string, message: string, span: object, severity?: string }`
- Error codes:
  - `E-COMPONENT-020`: Component reference not found in file scope or imported scope. The
    component name was used as a tag but is not defined in this file and is not resolvable via
    the MOD export registry.
  - `E-COMPONENT-021`: Component body failed to re-parse. The component definition's `raw`
    field could not be normalized and re-parsed as valid scrml markup.
- Partial output: Per-component fail-soft within CE itself. Components that fail with
  E-COMPONENT-020 or E-COMPONENT-021 are left in place as-is; other components in the same
  file continue processing within CE. Stage 3.3 (post-CE invariant validation, VP-2) then
  walks the resolved AST and surfaces every residual `isComponent: true` markup node as
  E-COMPONENT-035. The hard error at Stage 3.3 closes the silent-failure window where a
  residual reference would otherwise be silently emitted as `document.createElement("X")`.
  See SPEC.md §15.14 (post-CE invariant) and deep-dive
  `systemic-silent-failure-sweep-2026-04-30` §11.3 D3.

**Transformation:**
CE runs per-file. For each file, CE builds a same-file component registry from `ast.components`
(all `component-def` nodes). For each `isComponent: true` markup node in the AST (at any depth),
CE looks up the component name: first in the same-file registry, then in the cross-file registry
(via MOD `exportRegistry` + `fileASTMap`). On a successful match, CE expands the component by:
1. Normalizing the `component-def` node's `raw` field from logic-tokenizer form back to valid
   scrml markup source (the `raw` field uses space-joined token form from `collectExpr()`; CE
   normalizes `< tag` back to `<tag` before re-parsing).
2. Re-parsing the normalized source using BS + TAB.
3. Substituting caller attributes as named identifiers in the expanded subtree.
4. Wiring `${children}` placeholders to the caller's child nodes.
5. Replacing the original `isComponent: true` node with the expanded subtree in place.
After expansion, `component-def` nodes are removed from the AST.

**What is NOT done by this stage:**
- No type resolution or type checking.
- No route inference.
- No scope analysis.
- No typed props validation (that is TS's concern).
- No slot system beyond `${children}`.
- No circular component expansion detection in this version.

**Performance budget:** <= 5 ms per file.
**Parallelism opportunity:** Yes — per-file after MOD completes.
**Dependencies:** TAB (Stage 3) must complete for the file. MOD (Stage 3.1) must complete for
  all files (needed for cross-file component lookup).

---

### Stage 3.2 — Phase 2: Channel Expansion (CHX)

**Added:** P3.A (2026-05-02), per deep-dive `p3-cross-file-inline-expansion-2026-05-02.md`.

Under **UCD (Unified Category-Dispatch)** — ratified per OQ-P3-1 default (a) — the
state-type expander runs in two phases:

- **Phase 1: Component Expansion** (existing path, documented above).
  Routes via NR-authoritative `node.resolvedKind === "user-component"` (with a legacy
  `isComponent === true` fallback for unit-test paths that bypass NR) and the cross-file
  registry's `info.category === "user-component"`. P3-FOLLOW migrated CE phase 1 from
  the legacy `isComponent`-only path to the unified NR-authoritative routing.
- **Phase 2: Channel Expansion (CHX)** (NEW).
  Routes via `info.category === "channel"` (NR-authoritative for channels). Walks the
  consumer's AST after Phase 1 completes; for each markup node whose `tag` matches a
  cross-file channel import alias, replaces the node with a deep-cloned copy of the
  source file's `<channel>` markup body. The cloned copy carries fresh node IDs and is
  tagged `_p3aInlinedFrom: <sourceKey>` for diagnostics.

**Algorithm:**

```
Build aliasMap: Map<localAlias, { imported, sourceKey }>
  For each import { imported as local } from source:
    If exportRegistry[sourceKey][imported].category === "channel":
      aliasMap.set(local, { imported, sourceKey })
      // E-CHANNEL-008: detect cross-file `name=` collisions

Walk consumer.ast.nodes recursively:
  For each markup node M with M.tag in aliasMap:
    sourceTab = fileASTMap[aliasMap[M.tag].sourceKey]
    decl = sourceTab.ast.channelDecls.find(c =>
      c._p3aExportName === aliasMap[M.tag].imported)
    Replace M with deepClone(decl); fresh IDs from CE's counter
```

**Routing contract (post-P3-FOLLOW).**
The transitional `compiler/src/state-type-routing.ts` category-routing-table
introduced in P3.A has been deleted (P3-FOLLOW). All routing is now uniform:
downstream stages consume NR's `resolvedKind` / `resolvedCategory` directly,
and MOD's exportRegistry exposes `info.category` (matching NR's vocabulary).
The legacy `isComponent` boolean and `info.isComponent` field are retained
as derived backcompat fields for AST shape tests and direct unit-test
consumers that bypass NR — they are no longer the routing source.

The routing predicate used by stages where backcompat with NR-bypassing
unit-test paths matters:

```
resolvedKind === "user-component"
  OR (resolvedKind === undefined AND isComponent === true)
```

The first arm is NR-authoritative. The second arm is the legacy fallback
for tests that don't run NR; in production (api.js) the first arm always
applies.

**Error contract (P3.A additions):**
- `E-CHANNEL-008`: Two cross-file channel imports from different source files in the same
  consumer share the same `name=` attribute value (would conflict on the same
  WebSocket route). Mirrors the existing E-CHANNEL-003 (same-file duplicate) extended
  to cross-file.
- `E-CHANNEL-EXPORT-001`: `export <channel ...>` declared without a string-literal
  `name=` attribute. Wire-layer identity must be compile-time stable; reactive-ref
  forms (`name=@var`) are not supported for cross-file channel exports.
- `E-CHANNEL-EXPORT-002`: Internal — channel declared as exported in MOD's exportRegistry
  but the corresponding `<channel>` markup node was not collected in `ast.channelDecls`.
  Indicates a TAB-vs-MOD inconsistency.

**PURE-CHANNEL-FILE recognition:**
A `.scrml` file containing only `export <channel>` declarations and no top-level markup
other than logic blocks is a **pure-channel-file** (analogous to §21.5 PURE-TYPE-FILE).
The exporter file's `<channel>` markup nodes carry `_p3aIsExport: true`; codegen's
`collectChannelNodes` filters them out so the exporter file emits no per-channel
artifacts. Codegen happens at the inlined-consumer site. See SPEC §38.12.6.

**Backcompat:**
Per-page `<channel name="X">` declarations (without `export`) compile identically to
pre-P3.A behaviour. CHX SHALL NOT modify same-file channel decls.

**Performance budget:** <= 1 ms per file (most files have zero channel imports;
those with imports add a single AST walk + Map lookup per markup node).
**Parallelism opportunity:** Yes — per-file after MOD + Phase 1 complete.
**Dependencies:** Phase 1 (component expansion) must complete; CHX runs on the
post-Phase-1 AST.

---

## Stage 3.3: Unified Validation Bundle (UVB / VP-1, VP-2, VP-3)

**Added:** 2026-04-30 — UVB W1. Closes silent-failure mechanisms M1, M3, M4
identified in `docs/deep-dives/systemic-silent-failure-sweep-2026-04-30.md`.

**Input contract:**
- Type: `{ files: { filePath: string, ast: FileAST }[] }` — post-CE per-file
  results.
- Invariants: every file has passed TAB and CE without throwing. CE may have
  emitted E-COMPONENT-020 / E-COMPONENT-021 errors; those are forwarded along
  with any new errors this stage produces.
- Source: Component Expander (CE, Stage 3.2).

**Output contract:**
- Type: `{ errors: ValidatorDiagnostic[] }` per pass (VP-1, VP-2, VP-3 each
  return their own list).
- Diagnostic shape: `{ code: string, message: string, span: Span, severity: "error" | "warning" }`.
- VP-2 is mandatory and SHALL run before any downstream stage. VP-1 and VP-3
  are also mandatory in the standard pipeline.
- Consumer: protect= Analyzer (PA, Stage 4).

**Validation passes:**

- **VP-1 — Per-Element Attribute Allowlist** (`compiler/src/validators/attribute-allowlist.ts`)
  - Walks the AST and emits warnings for unrecognized attributes on
    scrml-special elements (those registered in
    `compiler/src/attribute-registry.js`).
  - W-ATTR-001: unrecognized attribute name on `<page>`, `<channel>`,
    `<machine>`, `<errorBoundary>`, `<program>`, or any v0.next structural
    element (`<engine>`, `<match>`, `<errors>`, `<onTransition>`).
  - W-ATTR-002: recognized attribute name with unrecognized value-shape
    (e.g. `auth="role:dispatcher"` — see SPEC §52.13).
  - Plain HTML elements (`<div>`, `<input>`, etc.) are NOT policed. Open-prefix
    forms (`bind:*`, `on:*`, `data-*`, `aria-*`, `onserver:*`, `onclient:*`,
    `class:*`, `style:*`) are accepted on every element.
  - **v0.next structural-element attribute catalogue** (registered in
    `attribute-registry.js`; SPEC §4.15 / §24.4 / §51 / §55):

    | Element | Attribute | Value-shape | Required |
    |---|---|---|---|
    | `<engine>` | `for` | type-name (PascalCase identifier resolving to an enum type) | yes |
    | `<engine>` | `initial` | bare-variant `.X` or qualified `Type.X` (omitted when `derived=` is present) | conditional |
    | `<engine>` | `var` | identifier (override for auto-declared variable name) | no |
    | `<engine>` | `derived` | reactive expression of the engine's `for=Type` | no (mutually exclusive with `initial=` per E-DERIVED-ENGINE-NO-INITIAL) |
    | `<match>` | `for` | type-name (PascalCase identifier resolving to an enum type) | yes |
    | `<match>` | `on` | reactive expression of the match's `for=Type` | no (defaults to the auto-declared engine variable for `for=Type` if one exists) |
    | `<errors>` | `of` | reactive expression resolving to a cell with synthesised validity surface | yes |
    | `<errors>` | `all` | boolean attribute | no |
    | `<onTransition>` | `to` | bare-variant `.X` of the parent engine's `for=Type` | no |
    | `<onTransition>` | `from` | bare-variant `.X` of the parent engine's `for=Type` | no |
    | `<onTransition>` | `once` | boolean attribute | no |
    | `<onTransition>` | `if` | reactive expression returning a boolean | no |

  - Severity: warning. Compilation continues; the warning surfaces
    silent-acceptance gaps without breaking forward-compat HTML attribute
    behaviour.

- **VP-2 — Post-CE Invariant Check** (`compiler/src/validators/post-ce-invariant.ts`)
  - Walks the AST and emits a hard error for every residual
    `isComponent: true` markup node — i.e. a component reference that
    survived CE without being expanded or rejected at CE time.
  - E-COMPONENT-035: residual `isComponent: true` markup node — closes the
    silent phantom DOM emission window (see SPEC §15.14).
  - **v0.next structural-shape invariants:**
    - `E-STRUCTURAL-ELEMENT-MISPLACED`: `<onTransition>` element outside an
      `<engine>` parent (SPEC §51.0.H).
    - `E-ERRORS-OF-MISSING`: `<errors>` element with absent or non-resolvable
      `of=` attribute (SPEC §55.8).
    - `E-COMPONENT-ENGINE-SCOPE`: `<engine>` declaration inside a component
      body (SPEC §51.0.K).
    - `E-CHANNEL-INSIDE-PROGRAM`: residual `<channel>` markup inside `<program>`
      body (SPEC §38.1; existing UVB W1/D3 invariant — listed here for completeness).
  - Severity: error. Compilation fails.

- **VP-3 — Attribute Interpolation Validation** (`compiler/src/validators/attribute-interpolation.ts`)
  - Walks the AST and emits a hard error when a `${...}` interpolation
    appears in an attribute value where the per-element registry flags
    `supportsInterpolation: false`.
  - E-CHANNEL-007: `${...}` in `<channel name=>` or `<channel topic=>`
    (see SPEC §38.11).
  - **v0.next interpolation rules:**
    - `<engine for=...>` — `for=` SHALL NOT contain `${...}` (type names are
      static; SPEC §51.0.B).
    - `<match for=...>` — same.
    - `<errors of=...>` — `of=` MAY be a reactive expression including indirect
      `${...}` via member access, but the attribute itself accepts a bare
      expression; no `${...}` template wrapping is allowed.
  - Severity: error. Compilation fails.

**Error contract:**
- May throw: No — errors are returned as values.
- Each pass operates independently. A given run may surface VP-1 warnings,
  VP-2 errors, and VP-3 errors simultaneously.
- All three passes traverse the same AST shape via the shared
  `validators/ast-walk.ts` helper. Any new validation pass added at this
  stage MUST use the shared walker to ensure consistent traversal.

**Performance budget:** <= 2 ms per file (1 ms baseline + 1 ms for v0.next attribute
allowlist + structural-element checks).
**Parallelism opportunity:** Yes — per-file after CE completes.
**Dependencies:** CE (Stage 3.2) must complete for the file.

---

## Stage 4: protect= Analyzer (PA)

**Input contract:**
- Type: `{ files: FileAST[] }` — all per-file ASTs from CE (Stage 3.2), plus filesystem access
- Invariants:
  - All `FileAST` entries have passed TAB and CE without errors.
  - Every `StateBlock` node with `stateType === 'db'` carries an `attrs` array where:
    - `src` attribute: MUST be present and MUST be a `string-literal` AttrValue (TAB enforces
      the quoted-string requirement via E-ATTR-001; PA never receives an unquoted `src=` value).
      If `src` is absent, PA emits E-PA-006 and skips that block.
    - `tables` attribute: MUST be present and MUST be a `string-literal` AttrValue. If `tables`
      is absent, PA emits E-PA-005 and skips that block.
    - `protect` attribute: MAY be present. If present, it is a `string-literal` AttrValue.
      An unquoted `protect=` is caught by TAB as E-ATTR-001 before PA runs.
  - All spans are intact from TAB.
  - `FileAST.filePath` is the resolved canonical absolute path of the source file (set by the
    pipeline coordinator at Stage 1).
  - No `isComponent: true` markup node or `component-def` node remains in any AST (CE invariant).
- Source: Component Expander (CE, Stage 3.2) — all files complete

**Output contract:**
- Type: `{ protectAnalysis: ProtectAnalysis, errors: PAError[] }`

  ```
  ProtectAnalysis = {
    // One entry per < db> state block across all files:
    views: Map<StateBlockId, DBTypeViews>,
  }

  DBTypeViews = {
    stateBlockId: StateBlockId,  // unique id referencing the StateBlock AST node
    dbPath: string,              // resolved canonical absolute path of the database file
    tables: Map<string, TableTypeView>,
  }

  TableTypeView = {
    tableName: string,
    fullSchema: ColumnDef[],          // all columns — server-side view
    clientSchema: ColumnDef[],        // protected fields excluded — client view
    protectedFields: Set<string>,     // field names from protect= that matched this table
  }

  ColumnDef = {
    name: string,
    sqlType: string,
    nullable: boolean,
    isPrimaryKey: boolean,
  }

  StateBlockId = string  // "{filePath}::{span.start}"
                         // filePath is the resolved canonical absolute path of the source file
                         // span.start is the character offset of the opening '<' in preprocessed source
  ```

- Invariants:
  - Every `< db>` state block in any `FileAST` that successfully passes E-PA-005 and E-PA-006
    checks has exactly one corresponding entry in `views`, keyed by its `StateBlockId`. This
    applies regardless of whether `protect=` is present on the block. A block without `protect=`
    receives an entry where `protectedFields` is the empty set and `clientSchema === fullSchema`.
  - `clientSchema` is `fullSchema` minus any column whose name appears in `protectedFields` for
    that table. Per-table: a name in `protectedFields` is removed from a table's client schema
    only if that table has a column with that name. Tables that do not have a column with a given
    protected field name are unaffected.
  - `protectedFields` per `TableTypeView` is the subset of the parsed `protect=` field names
    that match a column in that table. A name in `protect=` may appear in `protectedFields` for
    multiple tables if multiple tables have a column with that name.
  - `protect=` field names are parsed using the canonical four-step algorithm:
    1. Trim leading and trailing ASCII whitespace from the whole attribute string value.
    2. Split the trimmed string on the literal `,` character.
    3. Trim leading and trailing ASCII whitespace from each resulting token.
    4. Discard any token that is empty after trimming.
    ASCII whitespace for steps 1 and 3 means: U+0020 (space), U+0009 (horizontal tab),
    U+000A (line feed), U+000D (carriage return), U+000C (form feed). The same algorithm
    applies to `tables=` values. Empty tokens (e.g., from `protect=","`) are silently discarded.
    An empty `protect=` attribute after parsing produces the empty set (no error).
  - `tables=` values are parsed using the same four-step algorithm as `protect=`. An empty
    `tables=` value after parsing produces an empty table list, which is treated as equivalent
    to an absent `tables=` attribute — E-PA-005 is emitted.
  - `fullSchema` is populated from Bun SQLite schema introspection at compile time.
  - A field name in `protect=` that does not match any column in any table in `tables=` SHALL
    produce a compile error (E-PA-007). This is a security requirement. There is no warning-only
    mode for this condition.
  - `dbPath` is the resolved canonical absolute path of the database file (the `src=` attribute
    value resolved against the directory of the source file containing the `< db>` block).
  - The `filePath` component of `StateBlockId` is the resolved canonical absolute path of the
    source file (matching `FileAST.filePath`). PA does not re-resolve this; it uses the value
    already present in `FileAST.filePath`.
  - Two `< db>` blocks that reference the same physical database file but have different
    `protect=` lists produce two independent entries in `views`, each with its own
    `StateBlockId` key and its own `protectedFields` set. There is no merging of protection
    lists across blocks.
  - No AST mutation occurs. The AST from CE is not modified. `ProtectAnalysis` is a side table.
- Consumer: Route Inferrer (RI), Type System (TS)

**Architecture notes (PA-to-TS contract):**

- **`ColumnDef[]` to named type:** PA produces raw column lists (`ColumnDef[]`) per table.
  The translation of `ColumnDef[]` into a named, accessible type within the state block's
  lexical scope (naming conventions, structural vs. nominal typing, how fields are referenced
  as `tableName.fieldName`) is a Type System (TS, Stage 6) concern. PA implementers produce
  column data; TS implementers consume it and make it a typed scope entry.

- **`FunctionDecl.isServer` is a TAB syntactic hint:** The `isServer` field on `FunctionDecl`
  nodes in the TAB AST reflects the presence of the `server` keyword in source. It is a
  syntactic hint, not an authoritative boundary assignment. The Route Inferrer (RI, Stage 5)
  performs the authoritative route assignment and produces the `RouteMap`. TS SHALL use the
  `RouteMap` from RI to determine whether a function receives the full type or the client type
  when accessing a `< db>` state block's fields.

- **Scope resolution is a TS concern:** The determination of which functions are "inside the
  lexical scope of a `< db>` state block" (spec Section 11.3.3) requires scope chain analysis that PA
  does not perform. PA constructs the type views. TS, using PA's views and RI's route map,
  applies scope-based type assignment to functions. PA implementers SHALL NOT attempt scope
  resolution; this is architecturally outside PA's boundary.

**Error contract:**
- May throw: No.
- Error type: `PAError { code: string, message: string, span: Span }`
- Error codes:
  - `E-PA-001`: `src=` attribute on `< db>` block references a file that does not exist on disk.
  - ~~`E-PA-002`~~: Removed — TAB enforces attribute quoting via E-ATTR-001 before PA runs.
    PA never receives unquoted values. (SPEC-PA-018 resolution, 2026-03-26)
  - `E-PA-003`: Bun SQLite schema introspection failed (corrupt db, unsupported version, etc.).
  - `E-PA-004`: `tables=` attribute references a table name not found in the database schema.
  - `E-PA-005`: `tables=` attribute is absent from a `< db>` block, or its parsed value
    produces an empty table name list.
  - `E-PA-006`: `src=` attribute is absent from a `< db>` block. Distinct from E-PA-001:
    E-PA-006 fires when the attribute is absent; E-PA-001 fires when the attribute is present
    but the referenced file does not exist.
  - `E-PA-007`: A field name in `protect=` does not match any column in any table listed in
    `tables=`. This is a compile error (not a warning). The error message SHOULD list the
    available column names in the affected tables to help the developer identify the typo.
- Partial output: Fail-fast per `< db>` block. A block that produces any PA error does not
  receive a `views` entry and cannot proceed to RI or TS for that state block. Other state
  blocks in the project continue processing normally.

**Transformation:**
For each `< db>` state block found in any `FileAST`:
1. Verify `src=` is present; emit E-PA-006 and skip if absent.
2. Resolve the `src=` string value against the source file's directory to obtain the canonical
   absolute database path (`dbPath`).
3. Verify `tables=` is present; emit E-PA-005 and skip if absent.
4. Open the database at `dbPath` using Bun's built-in SQLite module at compile time.
5. Apply the four-step parse algorithm to `tables=` to obtain the table name list.
6. For each table name, query the schema using Bun SQLite. Emit E-PA-004 if a named table is
   not found. Emit E-PA-003 if schema introspection fails.
7. Apply the four-step parse algorithm to `protect=` (if present) to obtain the candidate
   field names. An absent or empty `protect=` produces an empty candidate list.
8. For each candidate field name: verify it matches at least one column across all tables.
   Emit E-PA-007 if no match is found in any table.
9. For each table, construct `fullSchema` (all columns) and `clientSchema` (columns not in the
   candidate list for that table). Compute per-table `protectedFields` (matched candidates for
   that table).
10. Construct a `StateBlockId` using `"{FileAST.filePath}::{block.span.start}"`.
11. Store the `DBTypeViews` in `ProtectAnalysis.views` under the `StateBlockId` key.

The PA stage MAY share a single SQLite connection or schema read across multiple blocks
referencing the same `dbPath` (I/O deduplication). This optimization does not affect the
output: each block still receives its own independent `DBTypeViews` entry.

**What is NOT done by this stage:**
- No SQL query execution or validation (that is TS's concern using the schema data produced here).
- No route assignment (that is RI's concern).
- No JS code analysis.
- No type resolution beyond column schema extraction.
- No scope analysis (which functions are inside which db block's lexical scope is a TS concern).
- No translation of `ColumnDef[]` into named types (that is TS's concern).

**Performance budget:** <= 50 ms per database file (I/O-bound; runs once per unique `dbPath`).
**Parallelism opportunity:** Partially — multiple distinct `dbPath` values can be opened in
  parallel. Multiple state blocks referencing the same database share one open.
**Dependencies:** All files must complete CE (Stage 3.2). This is a project-wide synchronization point.

---

## Stage 5: Route Inferrer (RI)

**Input contract:**
- Type:
  ```
  {
    files: FileAST[],
    protectAnalysis: ProtectAnalysis,
  }
  ```
- Invariants:
  - All `FileAST` entries are from CE (Stage 3.2) without errors.
  - `ProtectAnalysis` is the complete output of PA (all database views populated).
  - All spans are intact.
  - No `isComponent: true` markup node or `component-def` node remains in any AST (CE invariant).
- Source: protect= Analyzer (PA) and Component Expander (CE, Stage 3.2)

**Output contract:**
- Type: `{ routeMap: RouteMap, errors: RIError[] }`

  ```
  RouteMap = {
    // For each function declaration node in any FileAST:
    functions: Map<FunctionNodeId, FunctionRoute>,
  }

  FunctionRoute = {
    functionNodeId: FunctionNodeId,
    boundary: 'client' | 'server',
    escalationReasons: EscalationReason[],  // empty if client
    generatedRouteName: string | null,       // compiler-internal; null for client functions
    serverEntrySpan: Span | null,
  }

  EscalationReason =
    | { kind: 'protected-field-access', field: string, stateBlockId: StateBlockId }
    | { kind: 'server-only-resource',   resourceType: string, span: Span }
    | { kind: 'explicit-annotation',    span: Span }
    | { kind: 'explicit-config',        configKey: string }  // Reserved — §27 not yet written

  FunctionNodeId = string  // "{filePath}::{span.start}"
  ```

- Invariants:
  - Every `FunctionDecl`, `PureDecl`, and `fn` shorthand node in every `FileAST` has a
    corresponding entry in `functions`.
  - Default boundary is `'client'`. Boundary is `'server'` only when at least one escalation
    reason applies.
  - Escalation rule 1: Any code path that accesses a field in `protectedFields` of any state
    block's table forces `'server'`.
  - Escalation rule 2: Any code path that requires a resource inaccessible from the client
    (e.g., file-system SQLite access from a `< db>` block) forces `'server'`.
  - Escalation rule 3: Developer config `never-client: true` for a named function forces `'server'`.
  - `generatedRouteName` is a deterministic compiler-internal string (not exposed to the
    developer); it is non-null only when `boundary === 'server'`.
  - No AST mutation. `RouteMap` is a side table.
- Consumer: Type System (TS), Dependency Graph Builder (DG), Code Generator (CG)

**Error contract:**
- May throw: No.
- Error type: `RIError { code: string, message: string, span: Span }`
- Error codes:
  - ~~`E-RI-001`~~: **Retired 2026-04-21 (S37).** Formerly fired on `pure` + server-escalated
    co-declaration; retired when §33.3 and §48.10 converged on "server is an execution-site
    dispatch directive, not a body-level side effect." Was never actually emitted by this
    source — only referenced in a helper comment. See SPEC.md §33.4.
  - `E-RI-002`: A server-escalated function mutates an `@` reactive variable. Reactive state is
    client-side; server functions cannot mutate it directly.
  - `E-ROUTE-001`: Warning. Computed member access on a db-derived value (`row[fieldKey]`) where
    the field name is structurally unresolvable. The function is not escalated, but the developer
    is warned. Note: variable-stored function references are an accepted RI limitation (DC-011);
    TS (Stage 6) detects these authoritatively via full scope resolution.
- Partial output: All errors are accumulated and returned alongside the complete route map.
  `E-RI-002` is a compile error; `E-ROUTE-001` is a warning. The route map is always complete —
  error-producing functions still receive entries (with `boundary: 'server'` for E-RI-002 so
  downstream stages can proceed).

**Transformation:**
The route inferrer walks every `FunctionDecl`, `PureDecl`, and `fn` shorthand node in every
`FileAST`. For each function, RI determines whether any code path within the function body
(transitively) accesses a protected field (from `ProtectAnalysis`) or a server-only resource.
The default assignment is `'client'`. Any triggering condition escalates the function to
`'server'` and records the reason. A `server`-annotated function (`isServer: true`) is escalated
with reason kind `explicit-annotation`. Server-boundary functions receive a deterministic internal
route name. The result is a flat map from function node ID to its boundary assignment and reasons.
No code is emitted at this stage.

Protected field detection: RI finds `StateBlock` nodes with `stateType === "db"`, looks up their
`StateBlockId` in `ProtectAnalysis` to obtain the set of protected field names, then walks the
function body for `MemberExpr` or destructuring nodes that reference those field names within the
state block's lexical scope. This is structural name-matching, not scope resolution.

Transitive escalation algorithm: RI SHALL resolve transitive accesses through called functions
using a visited-set to detect and break cycles:

- If a function `f` calls a function `g` declared in the same or another file, and `g` is
  server-escalated, `f` SHALL be escalated with the same `EscalationReason`(s) as `g`.
- Transitive escalation SHALL propagate without limit: if `f` calls `g` which calls `h` which
  accesses a protected field, `f` is escalated.
- A function already in the visited set is not re-analyzed (cycle break). The break condition is that the function is already being analyzed (in the visited set), not that it "directly accesses a protected field."
- The visited-set SHALL be global across all `FileAST` entries for cross-file cycle detection. A cycle that closes through functions in different files is handled identically to a same-file cycle.
- Calls to functions not defined in any `FileAST` (built-ins, node modules, vanilla JS imports)
  are non-escalating by default. No transitive analysis through them.

**What is NOT done by this stage:**
- No code generation.
- No async scheduling.
- No type resolution.
- No validation of SQL query correctness.
- No dependency graph construction.

**Performance budget:** <= 15 ms for the full project (this is a graph traversal, not I/O).
**Parallelism opportunity:** Limited — the escalation analysis is per-function but requires the
  complete ProtectAnalysis. Functions within a single file can be analyzed in parallel once PA
  is complete.
**Dependencies:** protect= Analyzer (PA) must complete. All files must have CE output.

---

## Stage 5.5: Monotonicity Classifier (MC)

**Added:** 2026-05-09. Implements SPEC §19.9.6 static monotonicity classification (A9 Ext 5,
S5 replay safety). Mirrors the Stage 7.5 BP separation pattern.

**Input contract:**
- `RouteMap` (from RI Stage 5)
- `FileAST[]` (so the classifier can walk the body of each CPS-eligible function)

**Output contract:**
- Side-table extension: each `RouteMap.functions[fnId].cpsSplit` (when non-null) gains a
  `monotonicity` field of type `"monotone" | "non-monotone" | "machine-intrinsic"`.

**Responsibilities:**
1. For every `FunctionRoute` with a non-null `cpsSplit`, walk the statements indexed by
   `cpsSplit.serverStmtIndices`.
2. Apply the §19.9.6 (a)-(f) classification rules:
   (a) `?{}` SELECT-only batch → monotone.
   (b) `?{}` INSERT batch with no auto-increment column read-back → monotone.
   (c) `?{}` UPDATE batch where the assignment expression is independent of the prior column
       value (e.g., `SET status = 'approved'` is monotone; `SET counter = counter + 1` is
       non-monotone).
   (d) `?{}` DELETE-only → monotone.
   (e) Pure-function calls (per §48 `fn`) → monotone.
   (f) `<machine>` `.advance()` transitions whose §51 allowed-from-states guards make the
       transition idempotent → `machine-intrinsic`.
   Any other shape (channel broadcast, stdlib server-side I/O, non-deterministic RHS like
   `NOW()` / `random()`) → non-monotone.
3. Conservative default: any unrecognized statement shape returns `"non-monotone"`.
4. The `.idempotent()` modifier on the function declaration (§19.9.7) overrides the verdict
   to `"monotone"` (developer assertion).
5. Channel server-functions (`route.kind === "channel"` or analogous detection) skip
   classification entirely — no key emission, no rejection.

**Diagnostics emitted (consumed by TS Stage 6 + downstream codegen):**
- `D-CPS-MONOTONE` — verbose-only info diagnostic on monotone batches.
- `D-CPS-MACHINE-INTRINSIC-MONOTONE` — info diagnostic on machine-intrinsic batches.
- `D-CPS-IDEMPOTENT-OVERRIDE` — info diagnostic when `.idempotent()` overrides a non-monotone
  classifier verdict (fires from TS or here, depending on dispatch implementation).

**Static-rejection diagnostics** (`E-CPS-NONIDEM-NO-STORAGE`,
`E-CPS-IDEMPOTENCY-STORE-DRIVER-MISMATCH`, `E-CPS-IDEMPOTENCY-STORE-MISSING-IMPORT`) fire from
TS Stage 6 because they require resolved `<program>` ancestry context that is most
ergonomically threaded through the type-system pass.

**Invariants:**
- **Determinism:** same `RouteMap` + `FileAST[]` produces identical monotonicity verdicts.
- **No AST mutation:** verdicts attach to `RouteMap.functions[fnId].cpsSplit.monotonicity`
  only.
- **Conservative default:** ambiguous shapes map to `"non-monotone"`. Under-classification is
  the safe direction (extra keys emitted; no soundness violation).

**Performance budget:** <= 5 ms for the full project (per-function statement walk).

**Dependencies:** RI Stage 5 must complete (cpsSplit shape populated).

**Consumer:** TS Stage 6 (static-rejection diagnostics), CG Stage 8 (key-envelope emission
in emit-functions.ts + dedup middleware in emit-server.ts).

---

## Stage 6: Type System (TS)

**Input contract:**
- Type:
  ```
  {
    files: FileAST[],
    protectAnalysis: ProtectAnalysis,
    routeMap: RouteMap,
  }
  ```
- Invariants:
  - All `FileAST` entries from CE (Stage 3.2) without errors.
  - `ProtectAnalysis` is complete (PA succeeded).
  - `RouteMap` is complete (RI succeeded).
  - All spans are intact.
  - No `isComponent: true` markup node or `component-def` node remains in any AST (CE invariant).
- Source: Component Expander (CE, Stage 3.2), protect= Analyzer (PA), Route Inferrer (RI)

**Output contract:**
- Type: `{ typedAst: TypedFileAST[] }`

  ```
  TypedFileAST = FileAST & {
    // Every node in the AST gains a resolved type annotation.
    // The original AST structure is preserved — no nodes are removed or reordered.
    nodeTypes: Map<NodeId, ResolvedType>,
    componentShapes: Map<string, ComponentShape>,
    scopeChain: ScopeChain,   // for use by codegen
  }

  ResolvedType =
    | { kind: 'html-element', tag: string, attrs: AttrTypeMap }
    | { kind: 'struct',       name: string, fields: FieldTypeMap }
    | { kind: 'enum',         name: string, variants: VariantDef[] }
    | { kind: 'primitive',    name: 'string' | 'number' | 'boolean' | 'null' }
    | { kind: 'array',        element: ResolvedType }
    | { kind: 'union',        members: ResolvedType[] }
    | { kind: 'intersection', members: ResolvedType[] }
    | { kind: 'asIs',         constraint: ResolvedType | null }
    | { kind: 'cssClass' }
    | { kind: 'meta-splice',  resultType: ResolvedType, parentContext: ParentContextKind }
    // v0.next additions:
    | { kind: 'engine',             forType: ResolvedType /* enum */, varName: string, derived: boolean }
    | { kind: 'engine-state-child', engine: ResolvedType /* engine */, variant: VariantDef }
    | { kind: 'match-block',        forType: ResolvedType /* enum */, arms: MatchArmType[] }
    | { kind: 'validity-surface',   cell: ResolvedType, level: 'compound' | 'field' }   // synthesised — see Stage 6.7
    | { kind: 'unknown' }      // unresolvable — always an error if reached in codegen

  ComponentShape = {
    name: string,
    rootTag: string,
    props: PropDef[],
    slots: SlotDef[],
    fixedSubtree: ASTNode | null,
  }
  ```

- Invariants:
  - Every `ASTNode` in every `TypedFileAST` has a `ResolvedType` entry in `nodeTypes`.
  - No `{ kind: 'unknown' }` type survives into `nodeTypes` without a corresponding TS error.
  - `asIs` types are resolved by scope-exit: a prop with `asIs` that is used in a way
    constraining its type has its inferred constraint recorded. If `asIs` is consumed without
    resolution at scope exit, error `E-TYPE-003` is produced.
  - Component shapes reflect the HTML spec: a component rooted at `<div>` is valid anywhere
    `<div>` is valid. Shape compatibility is enforced at call sites.
  - Protected fields are absent from `clientSchema` types. Any code path (in a client-boundary
    function, per `RouteMap`) that accesses an absent field produces `E-TYPE-005`.
  - Enum match arms are checked for exhaustiveness: all variants must be covered or a default
    arm provided; violation produces `E-TYPE-020`.
  - `lin` variables (including `~`) are checked for exactly-once usage: unused `lin` produces
    `E-LIN-001`; double-use produces `E-LIN-002`.
  - HTML content model rules are applied at the configured strictness level
    (`html-content-model: strict | warn | off`).
  - Attribute types are validated against the HTML spec: wrong type on a known attribute
    produces `E-ATTR-003`.
  - `MetaBlock` nodes are type-checked with the splicing coercion rules from spec Section 22.4:
    the result type of the meta block body must be coercible to the type expected by
    `parentContext`. A meta block in a markup parent must produce a markup-coercible result; in
    a CSS parent, a CSS-coercible result; in a SQL parent, a SQL fragment; in a logic parent, any
    value; in a meta parent, any meta-layer value. Violation produces `E-META-001`.
  - Meta-layer state (variables declared at the meta level) persists across `^{ }` blocks within
    the same compilation unit in source order (spec Section 22.5). TS tracks meta-layer scope
    separately from runtime scope.
  - **Render-spec validity classification (v0.next, SPEC §6.4 / §5.4.1).** A `ReactiveDecl` with
    `rhsShape: "render-spec"` (Shape 2 declaration) has its render-spec markup classified as:
    - **bindable** — `<input type="text|email|number|...">`, `<textarea>`, `<select>`, `<input type="checkbox|radio|file">`, or a component declaring a bindable prop (`bind:value` etc.).
    - **non-bindable** — any other markup element.

    `<x/>` render-by-tag use-sites of a non-bindable Shape 2 cell emit
    `E-CELL-RENDER-SPEC-NOT-BINDABLE`. Non-`const` declarations carrying a non-bindable
    render-spec are also rejected. Bindable cells require bindable render-specs (L17 lock); use
    `const <derived>` for display-only.
  - **Engine `derived=expr` type compatibility (v0.next, SPEC §51.0.J).** A derived engine's
    `derived=expr` SHALL be type-compatible with the engine's `for=Type`. TS validates this at
    the engine declaration and at each cell-reference inside `derived=expr`. Type incompatibility
    is `E-TYPE-001` with a clarifying message about derived-engine type compatibility. Direct
    writes to a derived engine variable are `E-DERIVED-ENGINE-NO-WRITE`.
  - **Bare-variant inference type completion (v0.next, SPEC §14.10).** TS resolves the qualifier
    on `EnumVariantRef { qualifier: null, variantName }` from the position's expected type, in
    priority order:

    1. LHS type annotation (`<x>: T = .V` — fix to `T`).
    2. Cell's already-resolved type (`@cell = .V` where `@cell: T` — fix to `T`).
    3. Function parameter type (`f(.V)` where the parameter is typed `T`).
    4. Function return type (`return .V` where the function's return is `T`).
    5. Match on-expression type (`<match for=T>` — fix arm-pattern variants to `T`).
    6. Engine `for=` qualifier (`<engine for=T initial=.V>`).
    7. Other position with a fixed type.

    Ambiguity (multiple union members declare the same variant name, OR no type context) emits
    `E-VARIANT-AMBIGUOUS`.
  - **Positional binding for predefined-shape (v0.next, SPEC §14.11).** A struct-typed cell with
    a positional initialiser `<x>: T = (a, b, c)` is validated against the predefined struct's
    field order. Field count mismatch and per-position type mismatch are `E-TYPE-001`.
  - **Validators on derived cells rejected (v0.next, SPEC §55.14).** Validators on
    `const <derived>` cells are forbidden. TS emits `E-DERIVED-WITH-VALIDATORS` at the declaration.
    Use a refinement type (`const <x>: number(>=0) = ...`) for compile-time predicate enforcement.
  - **Derived-cell value-mutation forbidden (v0.next, SPEC §6.11 — L21 S59 lock).** Any mutation
    of a `const`-derived cell's value (mutating array methods, object property writes,
    compound-assignment, `delete`, in-compound derived sub-cells) is `E-DERIVED-VALUE-MUTATE`.
  - **`ValidationError` enum + `.Custom(tag)` (v0.next, SPEC §55.9).** `ValidationError` is a
    built-in enum (registered in `compiler/src/builtin-types.ts`) with the variants:
    `Required`, `TooShort(min: int)`, `TooLong(max: int)`, `PatternMismatch(pattern: string)`,
    `BelowMin(min: number)`, `AboveMax(max: number)`, `BelowGte(bound: number)`,
    `AboveLte(bound: number)`, `NotEqual(expected: any)`, `NotEqualTo(other: any)`,
    `NotIn(allowed: any[])`, `EmailInvalid`, `UrlInvalid`, `NotNumeric`, `NotInteger`,
    `Custom(tag: string)`. `.Custom(tag)` is the user-extension variant. Validity-surface
    `errors` arrays carry these enum tags (NOT strings).
  - The AST structure from CE is not mutated. `nodeTypes` is a side table.

  **Validity surface synthesis is its own sub-stage.** The auto-synthesized
  `isValid` / `errors` / `touched` / `submitted` properties on validator-carrying cells
  (and rollups for compounds with validator-carrying fields) are constructed in **Stage 6.7
  (Validity Surface Synthesis)** — a TS sub-pass surfaced as a distinct narrative section
  immediately following Stage 6.5 (META). See Stage 6.7 for the synth-cell registry,
  per-field walker, and `E-SYNTHESIZED-WRITE`.
- Consumer: META (Stage 6.5), Dependency Graph Builder (DG), Code Generator (CG)

**Error contract:**
- May throw: No.
- Error type: `TSError { code: string, message: string, span: Span }`
- Error codes:
  - `E-TYPE-001`: Type mismatch — inferred type is incompatible with expected type at usage site.
  - `E-TYPE-002`: Undefined identifier referenced in expression.
  - `E-TYPE-003`: `asIs` prop or variable consumed without type resolution before scope exit.
  - `E-TYPE-004`: Struct field does not exist on type.
  - `E-TYPE-005`: Protected field accessed from a client-boundary code path.
  - `E-TYPE-006`: Union type not handled — missing match arm(s) and no default.
  - `E-TYPE-007`: Shape incompatibility — component used in a context expecting an incompatible
    HTML element shape (e.g., `<span>`-rooted component where `<div>` is required).
  - `E-TYPE-008`: Component name collides with a built-in HTML element name in a misleading way
    (configurable: `warn` or `error`).
  - `E-TYPE-009`: `lift` used inside a named function body (spec prohibits this).
  - `E-TYPE-010`: Logic block in markup context produces a type not coercible to markup elements.
  - `E-TYPE-011`: Logic block in CSS context produces a type that is not `cssClass[]`.
  - `E-TYPE-012`: `pure` function body violates purity constraint (`@` mutation, server call, DOM
    mutation, or `lift` detected).
  - `E-ATTR-003`: Attribute value type is incompatible with the HTML spec type for that attribute.
  - `E-TYPE-020`: Match expression is not exhaustive (missing variant arm, no default).
  - `E-LIN-001`: `lin` variable (including `~`) initialized but not consumed before scope exit.
  - `E-LIN-002`: `lin` variable consumed more than once.
  - `E-MARKUP-003`: HTML content model violation (element type not valid in this parent).
    Severity governed by `html-content-model` compiler setting.
  - `E-REACTIVE-002`: Reactive variable (`@var`) assigned inside a `pure` function.
  - `E-META-001`: `^{ }` block result type is not coercible to the type expected by the parent
    context (e.g., meta block in markup context returns a non-markup value). Governed by the
    splicing coercion rules in spec Section 22.4. When `meta.runtime` is `false` and the meta
    block cannot be fully resolved at compile time, this error code is also used (spec
    Section 22.6).
  - `E-MARKUP-001`: Tag name is not a known HTML element and not a defined component.
    (Reassigned from TAB, Amendment 5, 2026-03-26.)
  - `E-STATE-001`: State identifier is not a known state type and not declared in scope.
    (Reassigned from TAB, Amendment 5, 2026-03-26.)
  - `E-REACTIVE-001`: `@variable` used without prior declaration in enclosing scope.
    (Reassigned from TAB, Amendment 5, 2026-03-26.)
  - `E-SCOPE-001`: Unquoted identifier attribute value cannot be resolved in current scope.
    (Reassigned from TAB, Amendment 5, 2026-03-26.)
  - `E-CELL-RENDER-SPEC-NOT-BINDABLE` (v0.next, SPEC §6.4): non-bindable render-spec on a
    non-`const` cell, or a `<x/>` render-by-tag use-site where the cell's render-spec is
    not bindable.
  - `E-VARIANT-AMBIGUOUS` (v0.next, SPEC §14.10): bare-variant `.X` cannot be uniquely
    resolved (multiple union members declare the same variant name, or no type context).
  - `E-DERIVED-WITH-VALIDATORS` (v0.next, SPEC §55.14): validator(s) on a `const <derived>` cell.
  - `E-DERIVED-VALUE-MUTATE` (v0.next, SPEC §6.11 — L21): value-mutation of a `const`-derived
    cell.
  - `E-DERIVED-ENGINE-NO-WRITE` (v0.next, SPEC §51.0.J): direct write to a derived engine
    variable.
  - `E-PARSEVARIANT-001` (v0.next, SPEC §14.10 — L22): `parseVariant(json, T)` called with a
    non-enum type argument.
- Partial output: TS collects all errors before failing (non-fail-fast within a file). Output
  is not emitted if any error of severity `error` is present. Warnings do not block output.

**Transformation:**
The type system performs a full type-resolution pass over each `TypedFileAST`. TS walks the AST
in dependency order: type declarations first, then component definitions (to build
`componentShapes`), then top-level statements. For each node, it resolves the type using the
scope chain, `ProtectAnalysis` type views, `RouteMap` boundary assignments, and the built-in
HTML element registry. `asIs` types are resolved by usage context. Enum match arms are checked
for exhaustiveness. `lin` variables (including `~`) are tracked for exactly-once usage. HTML
content model rules are applied. Attribute types are validated. `MetaBlock` nodes are
type-checked by resolving the body as compile-time code, then verifying that the result type is
compatible with the splicing coercion rules for the recorded `parentContext`. Meta-layer scope is
tracked per-file in source order.

For v0.next, the same pass:
- classifies `ReactiveDecl` render-specs as bindable / non-bindable per the input shape table;
- resolves bare-variant `EnumVariantRef` qualifiers from the seven priority sources above;
- validates positional struct initialisers against the predefined field order;
- validates derived-engine `derived=expr` type-compatibility against the engine's `for=Type`;
- rejects validators on `const <derived>` cells (`E-DERIVED-WITH-VALIDATORS`);
- rejects value-mutation of `const`-derived cells (`E-DERIVED-VALUE-MUTATE`);
- registers `parseVariant(json, T)` call sites and verifies `T` is an enum type
  (`E-PARSEVARIANT-001` if not — type-as-argument primitive per L22).

The output is the original AST enriched with a `nodeTypes` side table (carrying every v0.next
ResolvedType variant when applicable) and a `scopeChain` for downstream use. Validity-surface
synthesis runs as the **Stage 6.7** sub-pass after Stage 6.5 (META); see that section for the
synth-cell registry construction.

**What is NOT done by this stage:**
- No code generation.
- No async scheduling or dependency graph construction.
- No SQL query execution or validation.
- No route assignment (consumed from RouteMap, not produced here).
- No compile-time execution of meta block bodies (TS resolves types and validates coercion;
  META stage performs execution).
- No validity-surface synthesis emission — that is Stage 6.7's responsibility (see below).
  Stage 6 records the *typing* of synthesised properties; the surface itself is registered in
  the synth-cell registry constructed in Stage 6.7.

**Performance budget:** <= 25 ms per file (20 ms baseline + 5 ms for v0.next bare-variant
inference, render-spec classification, derived-engine type-compat, and parseVariant validation).
The validity-surface synthesis budget is accounted in Stage 6.7.
**Parallelism opportunity:** Yes — per-file, once PA and RI are complete.
**Dependencies:** CE (Stage 3.2), PA, and RI must all be complete.

---

## Stage 6.5: Meta Check + Eval (META)

**Input contract:**
- Type: `{ files: TypedFileAST[] }` — the full set of TS-annotated ASTs.
- Invariants:
  - All `TypedFileAST` entries from TS without errors.
  - All `MetaBlock` nodes have been type-checked by TS. `parentContext` fields are populated.
  - `nodeTypes` is complete — every node has a resolved type.
  - All spans are intact.
- Source: Type System (TS, Stage 6) — all files complete

**Output contract:**
- META does not produce a new typed output object. It operates by:
  - **MC (Meta Checker):** Accumulating errors only (no AST changes). MC validates phase
    separation and reflect() call validity.
  - **ME (Meta Eval):** Evaluating compile-time `^{}` blocks with `emit()` and splicing
    their results into the AST at the emission site.

  The effective output shape is `{ files: TypedFileAST[], errors: MetaError[] }` where
  `files` are the same `TypedFileAST` objects potentially modified by ME splicing.

- Invariants:
  - MC runs before ME within this stage.
  - ME only evaluates `^{}` blocks classified as compile-time deterministic by TS
    (`deterministic: true` in the corresponding DGNode shape, or flagged as compile-time by the
    context).
  - After META completes, no unresolved compile-time `^{}` blocks remain. All deterministic
    meta blocks have been evaluated and spliced; non-deterministic blocks (runtime meta) are
    left in place for CG to emit as runtime stubs.
  - DG (Stage 7) receives the post-META AST — the AST with all compile-time `emit()` splices
    applied. DG must not run on the pre-META AST.
  - No runtime meta blocks are evaluated at this stage. `meta.runtime: true` blocks pass
    through to CG unchanged.
- Consumer: Dependency Graph Builder (DG, Stage 7)

**Error contract:**
- May throw: No — errors are returned as values.
- Error type: `MetaError { code: string, message: string, span: Span }`
- Error codes:
  - `E-META-001`: Phase separation violation — compile-time meta block references a runtime
    value or side effect. (Shared with TS; META re-validates as defense-in-depth.)
  - `E-META-003`: `reflect()` call used in an invalid context or with an unsupported argument
    (e.g., reflecting a runtime-only identifier).
- Sub-passes:
  - **MC (Meta Checker):** validates that every `^{}` block in every `TypedFileAST` obeys phase
    separation rules (compile-time code must not reference runtime bindings) and that all
    `reflect()` calls are valid. Produces `E-META-001` and `E-META-003` errors.
  - **ME (Meta Eval):** evaluates compile-time `^{}` blocks by running their bodies as
    compile-time JS (using Bun's compile-time evaluation capability or equivalent). Calls to
    `emit()` within a meta block body splice the emitted value into the AST at the block's
    position in the parent context. Operates on the `TypedFileAST` array and modifies AST nodes
    in place where splicing occurs.
- Partial output: MC errors are fail-fast per block. ME only runs if MC passes. ME evaluation
  failures are reported as errors; the block is left in place if evaluation fails.

**Transformation:**
META runs as two sequential sub-passes:

**MC (Meta Checker):**
Walks every `MetaBlock` node in every `TypedFileAST`. For each block, verifies:
1. The block body does not reference any identifier that resolves to a runtime binding in the
   enclosing scope (phase separation, spec Section 22.3).
2. Any `reflect()` calls within the block use supported argument forms and reference
   compile-time-available identifiers.
Emits errors for violations; does not modify the AST.

**ME (Meta Eval):**
Walks every compile-time `MetaBlock` node (those not flagged as `meta.runtime: true`). For each:
1. Evaluates the block body as compile-time JS (Bun compile-time context).
2. Collects all `emit()` calls made during evaluation.
3. Splices the emitted values into the AST at the meta block's position, replacing the
   `MetaBlock` node with the emitted content in the parent context's node list.
   - In a markup parent: emitted value is inserted as child markup nodes.
   - In a logic parent: emitted value is inserted as logic nodes.
   - In a CSS parent: emitted value is inserted as CSS rules.
4. The resulting AST has compile-time meta blocks replaced by their evaluated outputs.
   DG and CG see only the spliced result, not the original `MetaBlock` nodes.

**What is NOT done by this stage:**
- No type checking (performed by TS).
- No route inference.
- No dependency graph construction.
- No evaluation of runtime meta blocks (`meta.runtime: true`).

**Performance budget:** <= 10 ms for the full project (compile-time meta evaluation is bounded
by meta block size and count; typical projects have few meta blocks).
**Parallelism opportunity:** Limited — MC can be per-file parallel; ME must run in source order
per file to respect meta-layer state persistence (spec Section 22.5).
**Dependencies:** TS (Stage 6) must complete for all files.

---

## Stage 6.7: Validity Surface Synthesis (VSS)

**Added:** 2026-05-09 (C23 prose pass). Surfaces the auto-synthesized validity surface
(SPEC §55 + L11) as a reader-discoverable distinct stage.

**Implementation note:** in the compiler, validity-surface synthesis runs as TS sub-passes
(B11 — synth-cell registry; B12 — per-field synth-surface walker; B17 — `<onTransition>`
walker integration) inside `compiler/src/type-system.ts`. The Stage 6.7 narrative is the
composite reader-facing view; the sub-passes are not re-orderable runtime stages. VSS is
positioned in the pipeline narrative AFTER Stage 6.5 (META) because DG (Stage 7) and CG
(Stage 8) consume the synth-cells and the surface must be complete before they run.

**Input contract:**
- Type: `{ files: TypedFileAST[] }` — the post-META TS-typed ASTs.
- Invariants:
  - All `TypedFileAST` entries have completed Stage 6 type resolution and Stage 6.5 META
    splicing without errors.
  - Every cell with at least one validator has its declaration node + validator attribute
    list resolved (TS invariant).
  - Every compound state-cell with at least one validator-carrying field is identified.
- Source: META (Stage 6.5).

**Output contract:**
- Type: `{ files: TypedFileAST[], synthCellRegistry: Map<NodeId, SynthCellEntry>, errors: VSSError[] }`

  ```
  SynthCellEntry = {
    cellNodeId: NodeId,                     // cell that carries the surface
    level: 'compound' | 'field',
    parentCompoundId: NodeId | null,        // non-null when level === 'field'
    isValidNodeId: NodeId,                  // synthesised computed-cell node
    errorsNodeId: NodeId,                   // synthesised computed-cell node (ValidationError[])
    touchedNodeId: NodeId,                  // synthesised state-cell node (boolean)
    submittedNodeId: NodeId,                // synthesised state-cell node (boolean)
    transitionEffectNodeIds: NodeId[],      // <onTransition> + effect= bodies that fire on this cell
  }
  ```

- Invariants:
  - For every cell with one or more validators: a `SynthCellEntry` is created with
    `level: 'field'` (when the cell is a field of a compound) or `level: 'compound'`.
  - For every compound carrying validator-bearing fields: a rollup `SynthCellEntry` is created
    with `level: 'compound'` and `parentCompoundId: null`. The compound's `isValid` is the
    AND of its fields' `isValid`; its `errors` is the concatenated array of field errors;
    `touched` and `submitted` are derived from any-field-touched / any-field-submitted.
  - Reads against `@cell.isValid` / `@cell.errors` / `@cell.touched` / `@cell.submitted`
    resolve at TS to the synth-cell node; the resolved type is taken from the `SynthCellEntry`
    (ResolvedType variants `validity-surface` `level: 'compound' | 'field'`).
  - Writes against any synthesised property emit `E-SYNTHESIZED-WRITE`.
  - The synth-cell registry is consumed by Stage 7 (DG) for `validator-arg` edge construction
    and by Stage 8 (CG) for accessor emission.
- Consumer: Dependency Graph Builder (DG, Stage 7); Code Generator (CG, Stage 8).

**Error contract:**
- Error type: `VSSError { code: string, message: string, span: Span }`.
- Error codes:
  - `E-SYNTHESIZED-WRITE` (SPEC §55.5–§55.7): a write expression targets a synthesised
    validity-surface property (`@x.isValid`, `@x.errors`, `@x.touched`, `@x.submitted`).
- Defense-in-depth: CG also catches this as `E-CG-VALIDITY-WRITE`.

**Transformation:**

VSS runs in three sub-passes (per SPEC §55 + steps B11 / B12 / B17 in the implementation):

1. **Synth-cell registry construction (B11).** Walk every cell declaration. For each cell
   with one or more validators, create a `SynthCellEntry` with synthesised node IDs for the
   four surface properties (`isValid`, `errors`, `touched`, `submitted`). Per SPEC §55.2, the
   surface is created if and only if the cell carries at least one validator (no auto-synthesis
   on validator-free cells).

2. **Per-field synth-surface walker (B12).** Walk every compound state declaration. For each
   compound carrying validator-bearing fields, create a rollup `SynthCellEntry` whose surface
   composes the field surfaces:
   - `compound.isValid` = AND over field `isValid`s.
   - `compound.errors` = concatenation of field `errors` arrays (preserving source order).
   - `compound.touched` = OR over field `touched`s (any-field-touched).
   - `compound.submitted` = OR over field `submitted`s (any-field-submitted; flips on first
     `<form onsubmit>` attempt or explicit `submit(@compound)` call).

3. **`<onTransition>` walker integration (B17).** For each `<onTransition>` element and each
   `effect=` attribute on a state-child rule, walk the effect body and identify every
   side-effect site that touches a synthesised cell. Register these in
   `transitionEffectNodeIds` so DG can wire `transition-effect` edges and CG can emit the
   handler at the correct flush point.

After the three sub-passes, every reader of `@cell.<surface-property>` in the AST has a
`SynthCellEntry` entry available; downstream stages (DG, CG) consume the registry by node-id
lookup.

**What is NOT done by this stage:**
- No DGNode / DGEdge construction — DG (Stage 7) builds those using the synth-cell registry.
- No CG accessor emission — CG (Stage 8) emits `Object.defineProperty` accessors.
- No validator predicate evaluation — predicates are declarative; their RUNTIME evaluation
  is performed by codegen-emitted reactive computed cells.

**Performance budget:** <= 5 ms per file (the synth-cell registry is linear in cell count;
per-field walker is linear in compound depth × field count; both are typically small).
**Parallelism opportunity:** Yes — fully per-file (synth-cell registry is per-file-local).
**Dependencies:** Stage 6.5 (META) must complete; Stage 6 (TS) must have resolved all cell
types and validator vocabularies.

---

## Stage 7: Dependency Graph Builder (DG)

**Input contract:**
- Type:
  ```
  {
    files: TypedFileAST[],
    routeMap: RouteMap,
    synthCellRegistry: Map<NodeId, SynthCellEntry>,   // v0.next — from VSS (Stage 6.7)
  }
  ```
- Invariants:
  - All `TypedFileAST` entries from TS without errors, with META splices applied.
  - `RouteMap` is complete from RI.
  - All node types are resolved (no `{ kind: 'unknown' }` in `nodeTypes`).
  - All spans are intact.
  - No unresolved compile-time `MetaBlock` nodes remain in any AST (META invariant). All
    compile-time `^{}` blocks have been evaluated and spliced by META (Stage 6.5). DG
    receives the post-META-expansion AST.
  - `synthCellRegistry` is complete (VSS / Stage 6.7 invariant) — every cell with a
    validity surface has a `SynthCellEntry`; v0.next `validator-arg` edges target the
    synth-cell nodes.
- Source: VSS (Stage 6.7)

**Output contract:**
- Type: `{ depGraph: DependencyGraph }`

  ```
  DependencyGraph = {
    nodes: Map<NodeId, DGNode>,
    edges: DGEdge[],
  }

  DGNode =
    | { kind: 'function',  nodeId: NodeId, boundary: 'client' | 'server', hasLift: boolean, span: Span }
    | { kind: 'reactive',  nodeId: NodeId, varName: string,               hasLift: boolean, span: Span }
    | { kind: 'render',    nodeId: NodeId, markupNodeId: NodeId,          hasLift: boolean, span: Span }
    | { kind: 'sql-query', nodeId: NodeId, query: string,                 hasLift: boolean, span: Span }
    | { kind: 'import',    nodeId: NodeId, source: string,                hasLift: boolean, span: Span }
    | { kind: 'meta',      nodeId: NodeId, deterministic: boolean,        hasLift: boolean, span: Span }
    // v0.next additions:
    | { kind: 'engine-decl',    nodeId: NodeId, forType: ResolvedType, varName: string, derived: boolean,  hasLift: boolean, span: Span }
    | { kind: 'engine-variant', nodeId: NodeId, engineNodeId: NodeId, variant: VariantDef,                 hasLift: boolean, span: Span }
    | { kind: 'validity',       nodeId: NodeId, cellNodeId: NodeId,
                                surfaceProp: 'isValid' | 'errors' | 'touched' | 'submitted',               hasLift: boolean, span: Span }
    | { kind: 'derived-cell',   nodeId: NodeId, cellNodeId: NodeId, expression: ASTNode,                   hasLift: boolean, span: Span }
    | { kind: 'validator-pred', nodeId: NodeId, ownerCellNodeId: NodeId, predicate: string, args: ASTNode[], hasLift: boolean, span: Span }

  DGEdge = {
    from: NodeId,
    to: NodeId,
    kind: 'calls' | 'reads' | 'writes' | 'renders' | 'awaits' | 'invalidates'
        // v0.next additions:
        | 'derives-from'        // const <derived> cell depends on RHS expression cells
        | 'engine-derives'      // <engine derived=expr> depends on cells in expr
        | 'validator-arg'       // validator predicate's expression-arg references a cell (cross-field)
        | 'rule-source'         // engine state-child rule="event -> Variant" — source of event/predicate
        | 'transition-effect',  // <onTransition> / effect= attaches to transition edges
  }
  ```

- Invariants:
  - The graph is a DAG (directed acyclic graph) with respect to `'awaits'` edges. A cycle in
    `'awaits'` edges is a compiler error `E-DG-001`.
  - Every `FunctionDecl` node in every `TypedFileAST` has a corresponding `DGNode`.
  - Every `ReactiveDecl` (`@variable`) has a corresponding `DGNode` of `kind: 'reactive'`.
  - Every `MetaBlock` node that is not fully resolved at compile time has a corresponding
    `DGNode` of `kind: 'meta'` with `deterministic: false`. Fully deterministic meta blocks
    (resolved at compile time by META) MAY have a `DGNode` with `deterministic: true` for
    traceability but are not required to, since they produce no runtime dependency.
  - `'invalidates'` edges connect `@variable` write nodes to every render node that reads
    the variable — these drive reactivity subscriptions in codegen.
  - `'awaits'` edges connect server-boundary function calls to their callers, enabling the
    code generator to insert `await` at the correct call sites.
  - `'calls'` edges are transitive: if A calls B and B calls C, A->B and B->C edges both exist.
  - Independent function calls (no data dependency between them) have no `'awaits'` edge
    between them — codegen will schedule them with `Promise.all`.
  - The graph is a pure value — no mutable shared state, no circular references.
  - **`hasLift` annotation:** `hasLift` is `true` on a `DGNode` N if and only if the statement
    or statement sequence that immediately follows N's corresponding AST node in the same
    anonymous `${ }` logic block contains at least one `LiftExpr` node at the direct body level
    of that block (not inside a nested function body). `hasLift` is `false` if no such
    `LiftExpr` exists or if the node does not appear in the direct body of an anonymous logic
    block. The annotation is computed during Phase 1 (per-file subgraph construction) and is
    immutable in the merged graph.
  - **v0.next derived-state and validator dependency invariants (SPEC §31.4 / §31.5):**
    - Every `const <derived>` cell has a `DGNode` of `kind: 'derived-cell'` with a
      `'derives-from'` edge from each cell referenced in its RHS expression.
    - Every `<engine derived=expr>` has its `engine-decl` node connected by `'engine-derives'`
      edges from each cell referenced in `expr`.
    - The union of `'derives-from'` and `'engine-derives'` edges is a DAG; cycle detection
      runs project-wide before DG output is emitted.
    - Every validator on every cell that takes an expression argument has a
      `validator-pred` node with `'validator-arg'` edges from each referenced cell to the
      synth-cell node for the cell carrying the validator. The `'validator-arg'` graph is
      a DAG; cycle detection runs project-wide.
  - **Engine transition-graph invariants (SPEC §51.0.F / §51.0.H):**
    - Every state-child `rule="event -> Variant"` registers the event at the engine node
      and adds a transition edge from source variant to target.
    - Every `<onTransition to=X from=Y>` element and every `effect=` attribute on a state-child
      rule has a `'transition-effect'` edge from the relevant transition edge to the effect's
      body node.
    - Multi-target rules with `effect=` attribute are `E-ENGINE-EFFECT-AMBIGUOUS` —
      `effect=` requires a single-target rule.
- Consumer: Code Generator (CG)

**Error contract:**
- May throw: No.
- Error type: `DGError { code: string, message: string, span: Span }`
- Error codes:
  - `E-DG-001`: Cyclic dependency detected in `'awaits'` edges (async cycle — cannot be scheduled).
  - `E-DG-002`: A reactive variable `@var` has no readers (declared but never consumed in a
    render or logic context). Severity: warning.
  - `E-LIFT-001`: Two or more `DGNode` entries in the same anonymous logic block have
    `hasLift: true` and have no `'awaits'` dependency edge between them (directly or
    transitively). These nodes would be parallelized by `Promise.all` in codegen, placing their
    `lift` calls in concurrent branches — a non-deterministic accumulator order. This is a
    compile error (spec §10.5.2). The error message SHALL identify all parallel nodes with
    `hasLift: true`, the `lift` call spans in each branch, and the logic block span. Severity:
    error (blocks codegen).
  - `E-VALIDATOR-CIRCULAR-DEP` (v0.next, SPEC §31.4 / §55.11.2 / §34): cycle in
    `'validator-arg'` edges (cross-field validators reference each other in a cycle).
  - `E-DERIVED-CIRCULAR-DEP` (v0.next, SPEC §31.5): cycle through `'derives-from'` edges (a
    `const <derived>` cell expression depends on itself directly or transitively); also fires
    on any `'derives-from'` ↔ `'engine-derives'` mixed-kind cycle.
  - `E-DERIVED-ENGINE-CIRCULAR` (v0.next, SPEC §51.0.J / §31.5): cycle through
    `'engine-derives'` edges only (a `<engine derived=expr>` chain forms a cycle).
  - `E-ENGINE-EFFECT-AMBIGUOUS` (v0.next, SPEC §51.0.H): `effect=` attribute on a multi-target
    rule (`rule="evt -> .A | .B"` with `effect=`). The fix is to use `<onTransition>` for
    multi-target.
- Partial output: Fail-fast on `E-DG-001` and `E-LIFT-001`. Warnings (`E-DG-002`) do not block
  output.

**Transformation:**

DG build proceeds in two sequential phases within this stage.

**Phase 1 — Graph construction (per-file subgraphs, merged project-wide):**
The dependency graph builder performs a project-wide traversal of all `TypedFileAST` nodes.
For each function declaration and reactive variable, it creates a `DGNode`. It analyzes data
flow: which functions call which, which reads which reactive variable, which writes which
reactive variable, and which markup nodes depend on which reactive variables. It classifies
each call site as `'awaits'` (server-boundary callee) or `'calls'` (client callee) based on
`RouteMap`. It checks for cycles in `'awaits'` edges (E-DG-001). Non-deterministic `MetaBlock`
nodes (those producing runtime macro stubs per spec Section 22.6) are added as `DGNode` entries
with `kind: 'meta'`. DG operates on the post-META-expansion AST — compile-time meta blocks have
already been replaced by their spliced outputs by META (Stage 6.5).

For v0.next, Phase 1 also constructs:
- A `derived-cell` node per `const <derived>` cell, with `'derives-from'` edges from each
  cell referenced in the RHS expression (SPEC §31.5).
- An `engine-decl` node per `<engine>` declaration; for derived engines, with
  `'engine-derives'` edges from each cell referenced in `derived=expr`.
- An `engine-variant` node per state-child of an engine; `rule=` attributes register
  transition edges and event triggers via `'rule-source'` edges.
- A `validator-pred` node per validator on each cell. For validators that take an expression
  argument, walk the predicate's argument tree and add `'validator-arg'` edges from every
  referenced cell's reactive node to the synth-cell node (`SynthCellEntry.isValidNodeId` /
  `errorsNodeId`) for the cell carrying the validator. Per SPEC §31.4.
- For each `<onTransition>` element and each `effect=` attribute on a state-child rule, add
  a `'transition-effect'` edge from the transition edge to the effect's body node. Multi-target
  rule with `effect=` is `E-ENGINE-EFFECT-AMBIGUOUS`.

During Phase 1, for each `DGNode` N created for a node that appears in the direct body of an
anonymous `${ }` logic block, DG inspects the `LogicNode[]` sequence of that block. It scans
the statements following N's corresponding AST position for `LiftExpr` nodes at the direct body
level (not inside nested function bodies). If any such `LiftExpr` exists before the next
server-call statement or the end of the block, N's `hasLift` field is set to `true`. Otherwise
`hasLift` is `false`.

Per-file subgraphs can be constructed in parallel across Bun workers and then merged into the
project-wide graph.

**Phase 2 — Lift concurrent detection + v0.next cycle detection (project-wide sub-pass):**
After the full project-wide graph is merged and `'awaits'` edges are complete, the lift checker
runs as a sub-pass within this stage. The same Phase-2 sub-pass also performs three v0.next
cycle checks on the merged graph:

1. **Validator-arg cycles.** A cycle in `'validator-arg'` edges is `E-VALIDATOR-CIRCULAR-DEP`
   (SPEC §55.11.2). Cross-field validators that reference each other in a cycle cannot be
   evaluated.
2. **Derived-cell cycles.** A cycle in `'derives-from'` edges is `E-DERIVED-CIRCULAR-DEP`
   (SPEC §31.5). A cycle that includes both `'derives-from'` and `'engine-derives'` edges
   uses the same code (the derived-cell error is the more general code).
3. **Derived-engine cycles.** A cycle in `'engine-derives'` edges only is
   `E-DERIVED-ENGINE-CIRCULAR` (SPEC §51.0.J).

Any of these errors fail the DG output. The lift-checker runs the algorithm below.

**Algorithm (inputs and detection decision):**

Inputs examined:
- The complete `nodes` map and `edges` list of the merged `DependencyGraph`.
- For each anonymous `${ }` logic block, the set of `DGNode` entries whose corresponding AST
  positions are in the direct body of that block. This set is called the **block node set**.
- The `hasLift` field on each node in the block node set.
- The `'awaits'` edges between nodes — both direct edges and transitive reachability through
  the `'awaits'` edge set.

Detection decision — E-LIFT-001 fires for a given anonymous logic block when:

> Given two nodes P1 and P2 in the block node set where `P1.hasLift === true` and
> `P2.hasLift === true` and P1 ≠ P2: if there is no `'awaits'` edge from P1 to P2 **and** no
> `'awaits'` edge from P2 to P1 (directly or transitively through any chain of `'awaits'`
> edges), then P1 and P2 are independent. Independent nodes in the same logic block whose
> `hasLift` is both `true` MUST NOT exist. E-LIFT-001 fires.

Stated precisely: E-LIFT-001 fires if and only if the block node set contains two nodes P1 and
P2 such that `P1.hasLift && P2.hasLift` is true, and neither P1 is reachable from P2 nor P2 is
reachable from P1 via `'awaits'` edges.

**Conservatism statement:** This detection is **conservative**. It rejects any program where
two nodes with `hasLift: true` have no `'awaits'` dependency, regardless of whether the runtime
would happen to serialize them for other reasons (e.g., a non-`'awaits'` `'calls'` edge, or
developer-written sequential guards). The compiler does not reason about non-`'awaits'` ordering
constraints for the purpose of lift safety. A program rejected by E-LIFT-001 is always fixable
by restructuring to separate the parallel fetches from the lift calls (§10.5.3 correct pattern).
The conservatism degree is bounded: only `'awaits'`-independent nodes with `hasLift: true` are
rejected; nodes connected by any `'awaits'` path are never flagged.

**What is NOT done by this stage:**
- No code emission.
- No type resolution (consumed from TS output).
- No route assignment (consumed from RI output).

**Performance budget:** <= 30 ms for the full project (20 ms baseline for graph construction +
lift-checker + 10 ms for v0.next derived-state, validator-arg, and transition-effect tracking +
three additional cycle checks; all checks linear in graph size).
**Parallelism opportunity:** Limited — edges cross file boundaries, so this is project-wide.
  Per-file subgraphs can be built in parallel and then merged.
**Dependencies:** VSS (Stage 6.7) must complete (synth-cell registry must exist before
`'validator-arg'` edges can target it). META (Stage 6.5) must complete for all files.

---

## Stage 7.5: Batch Planner (BP)

**Added:** 2026-04-14. Implements §8.9 / §8.10 / §8.11 SQL batching.

**Input contract:**
- `TypedFileAST` (from Stage 6)
- `DependencyGraph` (from Stage 7, finalized and lift-checked)
- `RouteSpecs` (from RI) with `handlerDGNodeIds` populated
- `ProtectAnalysis` (from PA) for §8.10.7 verification

**Output contract:**
```typescript
interface BatchPlan {
  coalescedHandlers: Map<RouteId, CoalescingGroup[]>;  // §8.9
  loopHoists: LoopHoist[];                             // §8.10
  mountHydrate: RouteId | null;                        // §8.11
  nobatchSites: Set<DGNodeId>;
  diagnostics: BatchDiagnostic[];                      // D-BATCH-001 near-misses
}

interface CoalescingGroup {
  nodes: DGNodeId[];
  envelopeKind: "implicit-handler-tx" | "prepare-lock-only";
}

interface LoopHoist {
  loopNode: DGNodeId;
  queryNode: DGNodeId;
  keyColumn: string;
  keyExpr: ExprNode;
  terminator: "get" | "all";
  rowCacheColumns: Set<string>;  // for E-PROTECT-003 check
}
```

**Preconditions:**
- DG is finalized and lift-checked.
- Lin-check (§35) has completed; E-LIN errors already flagged. Batch rewrite MUST NOT affect lin counts (§8.9.6).
- Route inference has assigned every DGNode to a route; `RouteSpec.handlerDGNodeIds` populated.

**Responsibilities:**
1. Compute coalescing candidate sets per handler (§8.9.1). Attach `envelopeKind` based on whether the handler is `!`.
2. Scan for Tier 2 candidates (§8.10.1). For matched loops, emit `LoopHoist`. For near-misses, emit D-BATCH-001.
3. If any `server @var` initial-reads exist, synthesize the `__mountHydrate` RouteSpec (§8.11.2).
4. Re-run E-LIFT-001 on the post-rewrite DG (§8.10.7).
5. Verify `rowCacheColumns` against `ProtectAnalysis` — any overlap between a `LoopHoist.rowCacheColumns` and a protected column appearing in the handler's client-visible return type is E-PROTECT-003.
6. Emit E-BATCH-001 when a handler contains both an implicit coalescing envelope and an explicit `transaction { }` block.

**Invariants:**
- **Determinism:** same input produces identical `BatchPlan`.
- **Idempotency:** re-running BP on a `BatchPlan`-annotated DG is a no-op.
- **No new boundary crossings:** `postBatchVerify()` asserts every node's route assignment is unchanged under the rewrite. Divergence is BOUNDARY_INVALID_CROSS (internal compiler invariant).

**CLI exposure:** `scrml compile --emit-batch-plan` emits the `BatchPlan` as JSON for debugging and test visibility.

**Complexity:** Linear in DGNode count for coalescing; linear in loop-body AST size for Tier 2 detection.

**Dependencies:** Stage 7 (DG), RI, PA must all complete.

---

## Stage 7.6: Reachability Solver (RS) — SPEC ANCHOR

**Added:** 2026-05-12 (v0.3 Approach A spec-amendment target — SPEC.md §40.9). Source: Insight 29 (`scrml-support/design-insights.md` line 1827; 5-voice debate verdict 2026-05-11 ratifying Approach A as the v0.3.0 spec-amendment target). Underwriting empirical study: S84 99-100% static-resolvability gate PASS (`scrml-support/docs/diagnostics/reactive-graph-static-resolvability-S84.md`).

**Status:** SPEC ANCHOR ONLY. The Stage 7.6 stage contract is defined here as normative spec text; the compiler implementation is staged across subsequent v0.3 waves (300-640h band per Insight 29 — markup-context edge emission ~40-80h, reachability solver ~120-240h, §40 auth-graph integration ~40-120h, per-route artifact splitter ~60-120h, integration tests ~40-80h). This stage is INACTIVE in the current pipeline; no compiler source emits it as of S86. Subsequent waves wire it on per the contract below.

**A-2.7 (S91) — outer fixed-point operator wired.** Components 1-5 wired across waves A-2.2..A-2.6 (S89-S90); A-2.7 closes the A-2 wave by wiring the outer `closure(...)` operator from SPEC §40.9.1. After Components 1-5 produce the initial union for each (entry-point, role) pair, the orchestrator (`compiler/src/reachability-solver.ts:runReachabilitySolver`) invokes `runOuterFixpoint` (`compiler/src/reachability/outer-fixpoint.ts`). The fixpoint iterates the closure step (re-runs Components 2/3/5 over the current `componentNodeIds` view; Component 1 is NOT re-run — entry-point seed is bound) until no operator admits new elements. Iteration cap defaults to 16 (`DEFAULT_ITER_CAP`); cap overflow surfaces `E-CLOSURE-001` per §40.9.11. Monotonicity invariant guards against closure steps that lose elements (subset-returning steps throw — under-inclusion is the disallowed failure mode per §40.9.2).

**Stage number rationale:** Stage 7.5 is taken by Batch Planner (BP). Stage 7.6 places Reachability Solver immediately after BP and before CG (Stage 8). Both BP and RS consume Stage 7 (DG) output; RS is downstream of BP (RS may consume BP's per-handler coalescing decisions when computing server-fn reachability for `N=0` calls, though the dependency is informational, not strict). The dispatch SCOPING.md §1.6 working title was "Stage 7.5"; renumbered to 7.6 to avoid collision with the landed Stage 7.5 (BP).

**Input contract:**
- `DependencyGraph` (from Stage 7, finalized; with markup-context `reads` edges lifted per SPEC.md §40.9.3 binding requirement — the closure-resolvability ceiling)
- `RouteMap` (from RI) — per-route entry-point list per v0.3 program shape (SPEC.md §40.8)
- `AuthGraph` — derived from §40 auth-attribute classification on `<program>` / `<page>` / `<auth role=>` / `<channel auth=>` declarations
- `ServerFnBoundary` (from RI / §52) — classified server-fn set
- `VendorUnitDeclarations` (from MOD / §41) — declared vendor units per file
- `RoleEnum` (from §40.1.1 static-role-classification) — the app-scope role enum declared in the entry file's `<program>` body
- `BatchPlan` (from Stage 7.5) — informational only (used for `N=0` server-fn pre-resolution opportunities; RS does NOT modify the batch plan)

**Output contract:**
```typescript
interface ReachabilityRecord {
  closures: Map<EntryPointId, RolePlayableSurface>;
  diagnostics: ReachabilityDiagnostic[];      // E-CLOSURE-001, W-AUTH-RUNTIME-FALLBACK
}

interface RolePlayableSurface {
  byRole: Map<RoleVariant, ChunkPlan>;        // one plan per role variant of the app-scope role enum
}

interface ChunkPlan {
  initialChunk: ChunkContents;                // playable_surface(E, N=0), payload-minimized
  prefetchTier1: ChunkContents;               // playable_surface(E, N=1) − initialChunk
  prefetchTier2: ChunkContents;               // playable_surface(E, N=2) − playable_surface(E, N=1)
  prefetchTierN: ChunkContents[];             // N ≥ 3, on-demand
}

interface ChunkContents {
  componentNodeIds: Set<NodeId>;              // from DG render-nodes + state-children
  reactiveCellNodeIds: Set<NodeId>;           // from DG reactive-nodes (via reactive_dep_closure)
  serverFnNodeIds: Set<NodeId>;               // from RI/§52 boundary (via server_fn_reachable_within)
  vendorUnitNames: Set<VendorUnitId>;         // from §41 (via vendor_units_used_by)
}
```

**Preconditions:**
- Stage 7 (DG) is finalized and lift-checked.
- Stage 7.5 (BP) has completed (informational only; not a hard dependency for correctness).
- Stage 7 DG MUST emit markup-context `reads` edges per SPEC.md §40.9.3 binding requirement. Without this, RS produces an incomplete reactive_dep_closure (the 256-edge ceiling identified by the S84 diagnostic) and the playable surface is structurally under-approximated. The Stage 7 extension is itself a subsequent-wave compiler-implementation item; RS's input contract checks for the lifted edges and aborts with a compiler-internal-invariant error if they are absent.
- §40 auth-graph derivation has completed (the AuthGraph input).
- §40.1.1 role enum is declared at app scope. If the application declares no role enum AND uses no auth gates, RS treats every entry point as having a single anonymous viewer role; if the application uses auth gates without declaring a role enum, RS aborts with a compiler error (subsequent wave; not v0.3.0 normative).

**Responsibilities:**
1. Enumerate entry points per v0.3 program shape (one per `<page>` declaration + the entry-file `<program>` body; SPEC.md §40.8).
2. For each entry point `E` and each role variant `R`, compute `playable_surface(E, N=0)` per SPEC.md §40.9.1 (the five-component union + closure fixed point).
3. Extend to `N=1` and `N=2` by chasing the interaction-graph projection of Stage 7 DG `calls` + `awaits` + event-handler-attachment AST edges.
4. Construct the `ChunkPlan` per role per entry point per SPEC.md §40.9.7.
5. Emit `W-AUTH-RUNTIME-FALLBACK` (info) for each auth gate whose role predicate is not closed-form over the role enum (per §40.1.1 / §40.9.5).
6. Emit `E-CLOSURE-001` (error, defensive) if the fixed-point operator fails to converge.

**Invariants:**
- **Determinism:** same input produces identical `ReachabilityRecord`. All inputs are static (no telemetry, no env, no timestamp) per SPEC.md §40.9.8. **A-2.8 (S91) hardens the JSON serializer** (`serializeReachabilityRecord` in `compiler/src/reachability-solver.ts`) to enforce bit-identical output: closures-map keys + byRole-map keys are codepoint-sorted; Set members are sorted via a stratified comparator (number stratum < string stratum < other) with numeric compare within the number stratum (so `7` sorts before `42`, not after as under naive string-coerce); diagnostics are canonical-ordered by `(code, severity, entryPoint ?? "", role ?? "", message)`; all object literals use fixed key sequences (ES2015 string-key order preservation). The `compiler/tests/unit/reachability-record-determinism.test.js` suite (21 tests) anchors the invariant including a 10-run defence-in-depth replay and a two-spawn CLI-output `diff` test.
- **Monotonicity in N:** for any `E` and `R`, `ChunkPlan.initialChunk ⊆ initialChunk ∪ prefetchTier1 ⊆ ... ∪ prefetchTierN`.
- **No mutation of upstream output:** RS produces a fresh `ReachabilityRecord` and does NOT mutate DG, BatchPlan, RouteMap, AuthGraph, ServerFnBoundary, or VendorUnitDeclarations.
- **Termination:** the fixed-point operator over finite input graphs terminates by construction; `E-CLOSURE-001` is defensive against compiler-internal-invariant violations only. (Wired S91 A-2.7 — implementation at `compiler/src/reachability/outer-fixpoint.ts`; iteration cap = 16; surfaced via `runReachabilitySolver` per-(entry-point, role) loop.)

**CLI exposure:** `scrml compile --emit-reachability` emits the `ReachabilityRecord` as canonical JSON to `<base>.reachability.json` next to compiled outputs (analogous to `--emit-batch-plan` at §Stage 7.5). Wired S89 A-2.1 (CLI flag + file write) + hardened S91 A-2.8 (canonical key ordering — see Determinism invariant above).

**Complexity:** Linear in the size of the union of (DG nodes × role-enum variants × per-route entry points). Per Insight 29 compiler-architect assessment, RS is whole-program at 1.5-3× SYM's total cost. Per S84 the corpus is well-bounded; RS terminates and produces a bounded output on all measured shapes.

**Dependencies:** Stage 7 (DG with markup-context edge emission) + Stage 7.5 (BP — informational) + RI (RouteMap + ServerFnBoundary) + MOD (VendorUnitDeclarations) + §40 auth-attribute classification (AuthGraph) + §40.1.1 role enum.

**Cross-references:**
- SPEC.md §40.9 (Closure Analysis — the normative spec surface RS implements).
- SPEC.md §40.1.1 (Static role classification — the role-enum input).
- SPEC.md §40.9.3 (Reactive dep closure — the markup-context edge-emission binding requirement).
- SPEC.md §40.9.4 (Server-fn reachable within N — the interaction-graph projection).
- SPEC.md §40.9.7 (Per-tier output structure — the ChunkPlan tier definitions).
- SPEC.md §40.9.8 (Determinism preservation — the no-telemetry-in-v0.3 invariant).
- Insight 29 (`scrml-support/design-insights.md` line 1827) — debate verdict ratifying A.
- S84 diagnostic (`scrml-support/docs/diagnostics/reactive-graph-static-resolvability-S84.md`) — 99-100% gate PASS.

---

## Stage 8: Code Generator (CG)

**Input contract:**
- Type:
  ```
  {
    files: TypedFileAST[],
    routeMap: RouteMap,
    depGraph: DependencyGraph,
    protectAnalysis: ProtectAnalysis,
    synthCellRegistry: Map<NodeId, SynthCellEntry>,   // v0.next — from VSS (Stage 6.7)
  }
  ```
- Invariants:
  - All `TypedFileAST` entries from TS without errors, with META splices applied.
  - `RouteMap` is complete (every function has a boundary assignment).
  - `DependencyGraph` is a valid DAG (no `'awaits'` cycles).
  - `ProtectAnalysis` is complete (all DB views resolved).
  - All spans are intact.
  - No `{ kind: 'unknown' }` types in any `nodeTypes` map.
  - No unresolved compile-time `MetaBlock` nodes remain (META invariant).
  - `synthCellRegistry` is complete (VSS / Stage 6.7 invariant) — every synth-cell node
    referenced by a `'validator-arg'` or `'transition-effect'` edge in `depGraph` has a
    `SynthCellEntry`. CG uses these entries to emit accessors.
- Source: Dependency Graph Builder (DG)

**Output contract:**
- Type: `{ outputs: FileOutput[] }`

  ```
  FileOutput = {
    sourceFile: string,     // absolute path of the .scrml source
    html: string | null,    // compiled HTML (null if file produces no markup)
    css: string | null,     // compiled CSS (null if file produces no styles)
    clientJs: string | null,  // client-side JS bundle for this file
    serverJs: string | null,  // server-side route handlers for this file
    sourceMaps: SourceMapSet, // maps output positions back to source spans
  }

  SourceMapSet = {
    html: SourceMap | null,
    css: SourceMap | null,
    clientJs: SourceMap | null,
    serverJs: SourceMap | null,
  }
  ```

- Invariants:
  - Client JS NEVER contains a reference to a protected field (server-side-only data).
  - Client JS NEVER contains SQL execution calls (`_scrml_sql_exec`, `_scrml_db`), server
    environment access (`process.env`, `Bun.env`, `bun.eval()`), or transaction control
    statements. These are server-only constructs. Any such construct found in client output
    is a security violation and produces `E-CG-006`.
  - Server JS contains route handler functions for every function with
    `boundary === 'server'` in `RouteMap`. Route names match `generatedRouteName` from RI.
  - Client JS contains `fetch` calls and event listener wiring for every server-boundary
    function call site. The developer-facing function name at the call site is preserved.
  - `await` is inserted at every call site whose callee has an `'awaits'` edge in the
    dependency graph. Independent calls are wrapped in `Promise.all`.
  - CSS custom properties use the `--variable-name: value` / `var(--variable-name, fallback)`
    form. The developer-written `variable-name = value` form is never in the output.
  - Component-scoped CSS applies compiler-generated scope IDs. Class names in component style
    blocks are hashed and applied to matching elements. `<style global>` blocks are emitted
    without scoping.
  - Tailwind utility classes: only the utility rules actually used in source are emitted into
    CSS. No unused rules are emitted.
  - Boolean HTML attributes are emitted as property assignments (`el.disabled = expr`), never
    as `setAttribute("disabled", ...)`.
  - Source maps are complete — every output token can be mapped back to its source span.
  - Generated output DOES NOT contain any `bun.eval()` calls or Bun-specific compile-time APIs.
    All compile-time evaluation has been completed by META (Stage 6.5).
  - Deterministic `MetaBlock` nodes (fully resolved by META at compile time) have their result
    inlined at the splice site in the parent context's output stream. CG receives the already-
    spliced AST — no re-evaluation of compile-time meta blocks occurs in CG.
  - Non-deterministic `MetaBlock` nodes (runtime-dependent, `meta.runtime: true`) emit a
    runtime macro stub in client JS that performs the expansion at execution time. The stub is a
    self-contained function that captures only the bindings referenced by the meta block body.
  - When `auth="required"` is configured and a POST handler is generated, the handler body
    begins with an auth check (`_scrml_auth_check`) that redirects unauthenticated requests.
  - When `csrf="auto"` is configured and a POST handler is generated, the handler body validates
    the `X-CSRF-Token` header via `_scrml_validate_csrf` and returns 403 on failure.
  - **v0.next render-by-tag, engine state-child, validity-surface, errors-elem, and
    reset(@cell) emission rules** are described in the Transformation section as numbered
    sub-blocks. The corresponding output invariants:
    - Every markup-position node with `resolvedCategory: "render-by-tag"` is replaced by the
      cell's render-spec (or interpolation, for literal cells) per the dispatch table; no
      `<x/>` cell-name tags survive into output HTML.
    - Every cell with at least one validator (per `synthCellRegistry`) has read-only
      computed-property accessors emitted (`isValid`, `errors`, `touched`, `submitted`); no
      setters are emitted (writes blocked at TS via `E-SYNTHESIZED-WRITE`; defense-in-depth
      at CG via `E-CG-VALIDITY-WRITE`).
    - Every `<errors of=expr/>` element produces a reactive renderer that reads the synth-cell
      `errors` array and dispatches to body override or `messageFor(...)` per SPEC §55.10.
    - Every `<engine>` declaration produces a render-time conditional dispatcher over the
      auto-declared (or `var=`-overridden) cell, plus a `_scrml_advance` runtime helper for
      transition validation.
    - Every `reset(@cell)` call expands to a γ-semantics rewrite using `default=`-captured
      expression when present, else re-evaluating the initialiser.
  - **Auto-name encoding for v0.next surfaces (SPEC §47.4):** auto-declared engine variables,
    synthesised validity properties, and transition-handler bodies use the encoded-name scheme
    of §47 (kind `t` for state cells, `p` for boolean computed cells, `a` for arrays, `f` for
    functions). `reflect()` decodes back to developer-visible dotted form.
  - **Per-route artifact splitter (S91, A-4.1):** when `CgInput.emitPerRoute === true` runCG
    invokes `compiler/src/codegen/route-splitter.ts:emitPerRouteChunks` after the per-file Emit
    phase completes. The splitter iterates `reachabilityRecord.closures` per (entry-point, role,
    tier) and produces per-chunk descriptors surfaced as `CgOutput.chunks` +
    `CgOutput.chunksManifest`. Chunk filenames follow OQ-A4-C
    `<route-path>/<RoleVariant>.<tier>.<8-char-hash>.js`; manifest follows OQ-A4-A always-emit
    when the flag is set. At A-4.1 the splitter is iteration-only — payload bodies are empty
    placeholders; A-4.2..A-4.7 populate per SPEC §40.9.7. Default-off during the A-4 wave per
    OQ-A4-F; default-on at the v0.3.0 cut release. Cross-ref:
    `docs/changes/a-4-per-route-artifact-splitter-SCOPING/SCOPING.md`.
  - **A-4.2 initial_chunk emission (S91):** the `initial` tier of each (entry-point, role) pair
    now carries real admission-filtered JS payload composed by
    `route-splitter.ts:composeInitialChunk`. The composer walks the four `ChunkContents` admission
    sets (vendor units → server-fn stubs → reactive cells → component mount markers) in canonical
    stratified order (numbers < strings; codepoint compare within stratum — mirrors A-2.8's
    `reachability-solver.ts:sortedArrayFromSet`) and concatenates atom output from
    `compiler/src/codegen/atom-emitter.ts`. Atom emitters: `emitReactiveCellAtom` (state-decl
    runtime registration), `emitServerFnStubAtom` (fetch wrapper with §57 wire-format decode),
    `emitVendorUnitRef` (§41 vendor-unit import), `emitComponentAtom` (per-id markup mount
    marker). Each atom is IDEMPOTENT — byte-identical output for byte-identical input — so the
    chunk payload is deterministic-from-source-only (§40.9.8 prerequisite for A-4.6
    content-addressing). The per-file `.client.js` emitter at `emit-client.ts:generateClientJs`
    is NOT modified by A-4.2 — the atom emitters are an ADDITIVE parallel emit surface that the
    route-splitter calls; per-file output remains byte-identical to pre-A-4.2 baseline.
    Tier 1 / Tier 2 / Tier N payloads remain empty placeholders pending A-4.3 / A-4.4 / A-4.5.
  - **A-4.3 tier-1 idle-prefetch emission (S91):** the `tier1` tier of each (entry-point, role)
    pair carries the §40.9.7 delta over the initial chunk
    (`prefetch_tier_1(E) := playable_surface(E, N=1) − initial_chunk(E)`). `composeTier1Chunk`
    reuses the same atom-emitters as `composeInitialChunk` so tier-1 byte composition follows the
    same canonical-order + idempotency contract. The initial-chunk IIFE tail is augmented with a
    `_scrml_prefetch_tier1(<chunk-url>)` call when (and only when) the (EP, role)'s
    `ChunkPlan.prefetchTier1` admits a non-empty set; empty admission elides both the file write
    AND the IIFE-tail call. The `_scrml_prefetch_tier1` runtime function lives at
    `compiler/src/runtime-template.js` in the new `prefetch` runtime chunk (per
    `compiler/src/codegen/runtime-chunks.ts:CHUNK_MARKERS.prefetch`). Tree-shake:
    `emit-client.ts:detectRuntimeChunks` scans the per-file `reachabilityRecord` and adds
    `'prefetch'` to `usedRuntimeChunks` iff some EP in this file has non-empty tier-1 admission;
    the worked-example §40.9.9 viewer=Driver case (`prefetch_tier_1(/) = {}`) is the canonical
    DEAD tree-shake. OQ-A4-G ratification (S91): Option γ — `requestIdleCallback` browser-side
    + `setTimeout(fn, 1)` Safari fallback + Bun-runtime extension point reserved for v0.4.
  - **A-4.4 tier-2 hover-prefetch emission (S91):** the §40.9.7 tier-2 surface has TWO
    distinct shapes wired in parallel at this sub-phase.
    (1) Intra-route deep-interaction prefetch — `composeTier2Chunk` in
    `route-splitter.ts` mirrors A-4.3's `composeTier1Chunk` contract for the
    `prefetchTier2` admission set. In v0.3 the RS A-2.5 Component 4 floor admits no
    components for this surface; the composer is present structurally for v0.4 RS
    refinement (OQ-A4-B deferred).
    (2) Cross-route hover prefetch (DOMINANT case) — `emit-html.ts` wires
    `data-scrml-prefetch="<route>"` attributes onto `<a href="/...">` elements whose
    static href resolves to a `RouteMap.pages` urlPattern; the wiring sets
    `ctx.hasPrefetchableLinks = true`. `composeInitialChunk` reads the flag and emits
    a hover-handler attachment block in the IIFE tail (`mouseenter` + `focus`
    once-listeners that call `_scrml_prefetch_tier2(route, role)`); the runtime
    function plus the `_SCRML_CHUNKS` manifest scaffold ship in the SAME `prefetch`
    runtime chunk as A-4.3's `_scrml_prefetch_tier1`. The hover-handler falls back
    to `"_anonymous"` role sentinel when `_scrml_current_role()` is not present at
    runtime (A-4.7 lands the real role-bootstrap). Tree-shake LIVE:
    `detectRuntimeChunks` activates the `prefetch` chunk on EITHER non-empty tier-1
    admission OR `hasPrefetchableLinks = true` (A-4.5 adds OR non-empty tier-N).
    Per OQ-A4-E ratification: `_SCRML_CHUNKS` manifest is the per-app chunk-URL
    lookup (route × role × tier → URL); A-4.4 ships the placeholder scaffold
    (`Object.create(null)`), A-4.6 populates with real URLs at HTML emission time.
  - **A-4.5 tier-N (N>=3) on-demand dispatch hook (S91):** ships the runtime-side dispatch
    surface — `_scrml_fetch_chunk(epId, role, tier)` in `compiler/src/runtime-template.js`,
    appended inside the existing `prefetch` runtime chunk alongside `_scrml_prefetch_tier1`
    and `_scrml_prefetch_tier2`. Per OQ-A2-B Option a (S89) + OQ-A4-D Option a (S91):
    RS in v0.3 always emits `prefetchTierN: []`, so no codegen path emits a call site
    for the new function — it is structural-scaffolding shipped for forward-compatibility
    with v0.4+ tier-N admission. `emit-client.ts:detectRuntimeChunks` extends the
    `prefetch` chunk activation gate so it lights up when ANY of: non-empty tier-1
    admission, non-empty tier-N admission, or `ctx.hasPrefetchableLinks = true`.
    The v0.3 floor with all three signals empty elides the chunk entirely; the function's
    call target is then dead-code-eliminated. Returns `Promise<string>` via
    `fetch().text()` for a registered tuple OR JS `null` for an unregistered tuple —
    adopters MUST null-check the return before chaining (canonical scrml absence per
    §42.5 / §42.8).
  - **A-4.6 content-addressed chunk hashing (S91):** the A-4.1 `"00000000"` placeholder on
    every emitted `ChunkOutput` is replaced by the real FNV-1a base36 8-char content-addressed
    hash per SPEC §47.5 / §40.9.8 / §47.1.3. The hash is computed over the canonical
    concatenation `(componentNodeIds, reactiveCellNodeIds, serverFnNodeIds, vendorUnitNames,
    payloadJs)` — admission-set ids sorted via the stratified comparator (numbers < strings,
    codepoint compare within stratum, mirrors A-2.8) and joined with `","`; the five top-level
    fields are joined with `"\x1F"` (ASCII Unit Separator — collision-safe boundary marker
    that cannot appear in well-formed chunk JS bytes). The shared primitive lives at
    `compiler/src/codegen/fnv1a-hash.ts` (`fnv1aHash` + the §47.1.3 normative parameters
    `FNV_PRIME = 16777619` / `FNV_OFFSET = 2166136261` as exported constants);
    `compiler/src/codegen/type-encoding.ts` re-exports it for the existing per-binding name
    encoding call site (byte-identical to pre-A-4.6). The chunk-side call site is
    `route-splitter.ts:computeChunkHash` + `finalizeChunkHash` (the latter overwrites the
    placeholder before any `ChunkOutput` surfaces externally). The on-disk `chunks.json`
    artifact carries URL-style filenames (e.g. `"/app/Driver.initial.a4b9c2d1.js"`) for the
    adopter cache layer (browser-cache / CDN / service-worker); the in-memory
    `ChunksManifestEntry` retains `ChunkKey` values for in-process lookup into the `chunks`
    Map (`serializeChunksManifest(manifest, chunks)` performs the on-disk transform).
    Determinism (§40.9.8 normative): identical source → identical admission sets → identical
    payload bytes → identical hash, byte-for-byte across builds. The A-4.2 R1 chunk-payload
    determinism test is the precondition; the A-4.6 hash byte-identity is asserted by 12
    unit tests in `compiler/tests/unit/chunk-content-addressing.test.js` + 4 integration
    tests in `compiler/tests/integration/initial-chunk-emission.test.js`'s §40.9.8 block.
    The `CHUNK_HASH_PLACEHOLDER` constant in `route-splitter.ts` is retained as the
    regression-guard sentinel — every emitted chunk's hash MUST NOT equal it.
- Consumer: Compiler output writer (writes files to disk)

**Error contract:**
- May throw: No.
- Error type: `CGError { code: string, message: string, span: Span, severity?: 'error' | 'warning' }`
  Default severity is `'error'`. Warnings use `severity: 'warning'`.
- Error codes:
  - `E-CG-001`: A node with `{ kind: 'unknown' }` type was encountered during codegen
    (should be unreachable if TS succeeded — indicates a TS invariant violation).
  - `E-CG-002`: A server-boundary function has no generated route name (RI invariant violation).
  - `E-CG-003`: Dependency graph edge references a node ID not present in any `TypedFileAST`
    (DG invariant violation).
  - `E-CG-004`: CSS scoping collision — two components produced the same scope ID hash
    (probabilistic; should be astronomically unlikely with a strong hash).
  - `E-CG-005`: A non-deterministic `MetaBlock` was encountered but `meta.runtime` is `false`
    (should be unreachable if TS emitted `E-META-001` — indicates a TS invariant violation).
  - `E-CG-006`: A SQL node (`kind: "sql"`), transaction-block node, or server-context meta node
    (`kind: "meta"` whose body references `process.env`, `Bun.env`, `bun.eval()`, or other
    server-only APIs) was found in a client-boundary function body or in the final client JS
    output. This is a security violation — server-only constructs must not reach client output.
    Indicates an RI invariant violation (RI should have escalated the containing function to
    `boundary: 'server'`).
  - `W-CG-001` (severity: warning): A top-level SQL block or transaction-block was found in a
    logic block body (outside any function). These constructs are server-only and cannot execute
    in client context. The node is suppressed from client output. The developer should move SQL
    operations inside a server-boundary function.
  - `E-CG-VALIDITY-WRITE` (v0.next, defense-in-depth): a write to a synthesised
    validity-surface property reached CG without TS catching it as `E-SYNTHESIZED-WRITE`.
    Indicates a TS invariant violation.
  - `E-CG-ENGINE-RULE-VIOLATION` (v0.next, defense-in-depth): codegen-detected static rule
    violation; fires in addition to TS's `E-ENGINE-INVALID-TRANSITION`.
  - `E-CELL-NO-RENDER-SPEC` (v0.next, SPEC §6.4): `<x/>` render-by-tag use of a cell whose
    `rhsShape` is `"literal"` (no render-spec) or `"derived-expr"` with a non-markup-typed
    RHS. The fix is to use `${@x}` interpolation, or to declare the cell with a render-spec
    (Shape 2). Severity: error.
- Partial output: Fail-fast on any `E-CG-*` error (severity `'error'`). Warnings (`W-CG-001`,
  `E-DG-002` propagated from DG) do not block output. CG errors indicate upstream invariant
  violations and should not occur in a correctly functioning pipeline. If reached, they are
  compiler bugs, not user errors.

**Transformation:**
The code generator walks each `TypedFileAST` in dependency order and emits three output streams
per file: HTML (markup nodes flattened to static HTML with dynamic placeholders), CSS (all CSS
blocks + scoped component styles + used Tailwind utilities), and JavaScript (client-side event
wiring + fetch calls for server functions, and server-side route handler modules). The dependency
graph drives async insertion: `await` at `'awaits'` edges, `Promise.all` for independent
concurrent calls. The route map drives the server/client split: server functions become POST
handlers in `serverJs`; their call sites in `clientJs` become typed `fetch` wrappers. Reactive
`@variable` bindings generate subscription registrations. Compile-time `MetaBlock` nodes have
already been spliced by META (Stage 6.5); CG emits their results as inline content.
Non-deterministic `MetaBlock` nodes emit runtime macro stubs in client JS. Source maps are built
in parallel with code emission.

The walk performs five v0.next emission sub-blocks per file:

1. **`<x/>` render-by-tag expansion (SPEC §6.4 / §5.4.1).** For each markup-position node with
   `resolvedCategory: "render-by-tag"` (NR-resolved cell name in markup), CG expands per the
   cell's `rhsShape`:

   | `rhsShape` | Expansion |
   |---|---|
   | `"literal"` | Plain interpolation: emit `${@x}` text. Non-display use of a literal cell as `<x/>` is `E-CELL-NO-RENDER-SPEC`. |
   | `"render-spec"` | Emit the render-spec's underlying element with `bind:value` / `bind:checked` / `bind:files` / `bind:group` injected per the dispatch table in SPEC §5.4.1. The element's other attributes flow through; the bind attribute is added. |
   | `"derived-expr"` (markup-typed) | Inline the derived markup value at the position. |
   | `"derived-expr"` (non-markup-typed) | `E-CELL-NO-RENDER-SPEC` if used as `<x/>` render-by-tag; valid via `${@x}` interpolation. |

2. **Engine state-child rendering (SPEC §51.0).** For each `<engine for=T initial=.X>`
   declaration, CG emits:
   - The auto-declared (or `var=`-overridden) reactive cell holding the current variant.
   - A render-time conditional dispatcher that selects the active state-child body based on
     the current variant value.
   - The transition contract enforcement: a runtime `_scrml_advance(engineVar, evt)` helper
     validates the transition against the compile-time-known rule set; invalid transitions
     throw at runtime (`E-ENGINE-INVALID-TRANSITION`). Where the from-state is statically
     knowable, TS rejects at compile time.
   - `<onTransition>` and `effect=` handlers as transition-edge effects: registered on the
     engine's variant-change observer, fire in the same reactive flush as the transition.
   - Derived engines (`derived=expr`): emit a reactive subscription on the cells referenced
     by `derived=expr`; the engine variable updates reactively as a `'derives-from'` consumer.
     Direct writes are rejected at TS (`E-DERIVED-ENGINE-NO-WRITE`).

3. **Auto-synthesized validity property emission (SPEC §55.5–§55.7).** For each cell with a
   `SynthCellEntry` in `synthCellRegistry`, CG emits computed-property accessors over the
   underlying cell object:

   ```js
   // Pseudocode for emitted code
   Object.defineProperty(_signup, "isValid",   { get: () => _signup_isValid_compute() })
   Object.defineProperty(_signup, "errors",    { get: () => _signup_errors_compute() })
   Object.defineProperty(_signup, "touched",   { get: () => _signup_touched_state })
   Object.defineProperty(_signup, "submitted", { get: () => _signup_submitted_state })
   ```

   The compute-fns are reactive — they re-evaluate when their `'validator-arg'` /
   `'derives-from'` dependency edges fire. CG emits no setters; writes are blocked at TS.

4. **`<errors of=expr/>` rendering (SPEC §55.8).** For each `<errors of=cellExpr [all] [body...]/>`
   element:
   - Resolve `cellExpr` to a reactive cell with a synthesised validity surface.
   - Read `@cellExpr.errors` (the array of `ValidationError` enum values).
   - If a body override is present, render the body with the per-error binding (`err`
     parameter to the body's arrow-function-shaped expression).
   - Otherwise, render the default form using `messageFor(err, fieldName, ...payload)`
     (cross-ref SPEC §55.10's 4-level resolution chain).
   - If `all` attribute is present, iterate all errors and render each; otherwise render only
     the first error (default).

5. **`reset(@cell)` keyword expansion (SPEC §6.8 — L18 lock).** For each `reset(@cell)` call:
   - If `@cell` is plain (Shape 1): emit `@cell = <default-expr>` where `<default-expr>` is the
     `default=` attribute's value if present, else the original initialiser expression
     (γ-semantics with β fallback per SPEC §55.13).
   - If `@cell` is Shape 2 with render-spec: same as above; the rendered input element
     re-mounts via the reactive flush.
   - If `@cell` is a compound: `reset(@compound.field)` resets a single field;
     `reset(@compound)` resets all fields.

   The `default=` attribute's value is captured at TAB time and re-evaluated at reset time.

Auto-name encoding (SPEC §47.4) runs alongside the five sub-blocks: auto-declared engine
variables use kind `t` (state); synthesised validity properties use kind `p` (boolean)
or `a` (array); transition-handler bodies use kind `f` (function). The name-builder uses the
cell's encoded name + a deterministic suffix (e.g., `_t1234abcd` cell →
`_t1234abcd_isValid` / `_t1234abcd_errors`). `reflect()` (SPEC §47.2) decodes the suffix-form
back to the developer-visible dotted form.

**What is NOT done by this stage:**
- No type resolution (all types consumed from TS output).
- No route inference (all boundaries consumed from RouteMap).
- No dependency analysis (all ordering consumed from DependencyGraph).
- No SQL query execution.
- No HTML spec validation (all validation completed in TS).
- No bundling, minification, or tree-shaking (out of scope for the compiler; handled by
  downstream tooling if desired).
- No compile-time meta evaluation (completed by META, Stage 6.5).

**Performance budget:** <= 35 ms per file (25 ms baseline + 10 ms for v0.next render-by-tag
dispatch, engine state-child rendering, validity-surface accessor emission, `<errors>`
renderer, and `reset(@cell)` expansion).
**Parallelism opportunity:** Yes — per-file, once DG is complete.
**Dependencies:** Dependency Graph Builder (DG) must complete for the project. VSS (Stage 6.7)
must complete (CG consumes the synth-cell registry).

**A-4 per-route artifact splitter (S91, A-4.1..A-4.7 — CLOSED):** When
`--emit-per-route` is set (opt-in during the A-4 wave per OQ-A4-F;
default-on at v0.3.0 cut), Stage 8 runs the per-route artifact splitter
(`compiler/src/codegen/route-splitter.ts`) AFTER per-file emit completes
but BEFORE returning CgOutput. The splitter iterates the Stage 7.6
ReachabilityRecord and produces:

  1. Per-(EntryPointId, RoleVariant, ChunkTier) chunk descriptors with
     real FNV-1a base36 content-addressed hashes (§47.5 / §47.1.3 /
     §40.9.8). Initial-tier and tier-1 / tier-2 chunks populated via
     atom-emitter composition (A-4.2 + A-4.3 + A-4.4 + A-4.5). Tier-N
     scaffolded but unpopulated in v0.3 per OQ-A2-B Option a.
  2. A per-app `chunks.json` manifest serialized via
     `serializeChunksManifest` (URL-style filename values for adopter
     cache layer consumption).
  3. Per-file HTML augmentation via `emit-html.ts:augmentHtmlForChunks`
     (A-4.7): inline `<script>window._SCRML_CHUNKS = { ... }</script>`
     (route-keyed manifest), `<link rel="modulepreload">` for non-empty
     tier-1 chunks, and a role-detection bootstrap `<script>` dispatching
     to the per-role initial chunk (per OQ-A4-E hybrid: ONE HTML per
     route + role-bootstrap; no per-(route, role) HTML variance).

The runtime helpers `_scrml_chunk_mount(id, tag)` and
`_scrml_vendor_require(unit)` referenced by atom-emitter output live in
the `mount` and `vendor-ref` runtime-chunk sections respectively;
`detectRuntimeChunks` activates them when any entry-point chunk admits
non-empty components / vendor units. Full per-app `SCRML_RUNTIME`
(scrml-runtime.js distribution) always carries both helpers; embed-mode
runtimes tree-shake them when no chunks emit references.

W-CG-CHUNK-* lint family fires from the splitter's post-emission scan
(W-CG-CHUNK-EMPTY / W-CG-CHUNK-LARGE / W-CG-CHUNK-NO-PREFETCH /
W-CG-CHUNK-MISSING-ROLE; see §34 / §40.9.11 catalog rows).

---

## Stage Dependency Summary

```
Per-file, parallel:
  PP -> BS -> TAB

Project-wide sync point (all TAB complete):
  TAB[] -> MOD

Per-file, parallel (after MOD complete):
  TAB + MOD -> CE

Project-wide sync point (all CE complete):
  CE[] -> PA
  CE[] + PA -> RI

Per-file, parallel (after PA + RI):
  CE + PA + RI -> TS

Project-wide sync point (all TS complete):
  TS[] -> META

Per-file, parallel (after META complete):
  META -> VSS

Project-wide sync point (VSS complete + RI):
  VSS + RI -> DG

Per-file, parallel (after DG):
  TS + RI + DG + PA -> CG
```

---

## Integration Failure Mode Catalog

The following failure modes are tracked per the pipeline reviewer's mandate. Any new stage
boundary must be audited against this list before integration. Entries are ordered by
detection stage (TAB → NR → MOD → UVB → TS → DG → CG → cross-cutting); v0.next entries are
tagged inline.

| Failure Mode | Description | Detection Point |
|---|---|---|
| Multi-statement bare-form handler (v0.next) | A bare-form event-handler attribute value or `:`-shorthand body contains multiple statements | TAB `E-MULTI-STATEMENT-HANDLER` (parse-time; SPEC §5.2.3, §4.14) |
| Pinned import not engine/cell (v0.next) | A `pinned` import resolves to an export with `category` neither `"engine"` nor a reactive cell | TAB `E-IMPORT-PINNED-INVALID` (parse-time hint) → MOD authoritative (SPEC §21.8.1) |
| Reserved-name collision (v0.next) | A user component or state-type name collides with a reserved structural-element name (`engine`, `match`, `errors`, `onTransition`) | TAB `E-NAME-COLLIDES-RESERVED` (SPEC §4.15, §24.4) |
| `:`-shorthand with closer (v0.next) | A `:`-shorthand body has a closer present (`<engine for=T : .X></engine>`) | TAB `E-CLOSER-001` (SPEC §4.14) |
| B14 path-shape mismatch (v0.next) | An engine binding `path` advances to a state-child whose shape doesn't match the path's expected target shape (surfaced in S74 wrap; B14 PASS 10.B) | TAB / TS path-shape consistency check; track as `E-ENGINE-PATH-SHAPE-MISMATCH` (SPEC §51 / B14 spec) |
| Engine variable shadow (v0.next) | A non-engine declaration uses the same name as an engine's auto-declared variable | NR `E-ENGINE-VAR-DUPLICATE`; resolved by `var=` override on the engine (SPEC §51.0.C) |
| Pinned forward-reference (v0.next) | A `pinned` cell's initialiser depends on a cell declared LATER in source order | NR `E-STATE-PINNED-FORWARD-REF` (SPEC §6.10) |
| Engine state-child outside engine (v0.next) | A `<Variant>` state-child markup node appears outside an `<engine>` parent | NR routes via `resolvedCategory`; downstream stages reject mis-placed state-children |
| `<onTransition>` outside engine (v0.next) | A `<onTransition>` element appears outside an `<engine>` parent | VP-2 (Stage 3.3) `E-STRUCTURAL-ELEMENT-MISPLACED` (SPEC §51.0.H) |
| Engine in component body (v0.next) | A `<engine>` declaration appears inside a `const Card = <article>...</>` component definition | VP-2 (Stage 3.3) `E-COMPONENT-ENGINE-SCOPE` (SPEC §51.0.K) |
| `<errors>` of= missing (v0.next) | A `<errors>` element has absent or non-resolvable `of=` attribute | VP-2 (Stage 3.3) `E-ERRORS-OF-MISSING` (SPEC §55.8) |
| Field name drift | Upstream contract uses a different field name than the implementation (e.g., `kind` vs `type`) | Pipeline reviewer audits implementation against contract at each stage boundary review |
| Span loss | Source spans dropped at a stage boundary, making error reporting impossible downstream | Any stage that transforms AST nodes must preserve all spans |
| Type information loss | AST does not carry sufficient type information for codegen | TS output must have 100% node coverage in `nodeTypes` |
| Protected field leak | A client-boundary function accesses server-only data | Caught by TS `E-TYPE-005`; codegen must re-verify as defense-in-depth |
| Meta splice type mismatch | `MetaBlock` result type incompatible with parent context's expected type | TS `E-META-001` — meta block body produces wrong type for splice site |
| Bare-variant ambiguity (v0.next) | `.VariantName` appears in a position whose type cannot be uniquely resolved (multiple union members declare the same variant name, or no type context) | TS `E-VARIANT-AMBIGUOUS` (SPEC §14.10) |
| Render-spec non-bindable use (v0.next) | A Shape 2 declaration (`<x req> = <markup>`) is used as `<x/>` render-by-tag but the render-spec markup is not a bindable form element | TS `E-CELL-RENDER-SPEC-NOT-BINDABLE`; CG defense-in-depth before bind injection (SPEC §6.4 / §5.4.1) |
| Validators on derived cell (v0.next) | A `const <derived>` cell carries one or more validators | TS `E-DERIVED-WITH-VALIDATORS` (SPEC §55.14) |
| Derived-cell value mutation (v0.next) | Any mutation of a `const`-derived cell's value (mutating array methods, property writes, compound-assignment, `delete`, in-compound derived sub-cells) | TS `E-DERIVED-VALUE-MUTATE` (SPEC §6.11; L21 lock S59) |
| Derived-engine direct write (v0.next) | A direct write targets a `<engine derived=expr>` variable | TS `E-DERIVED-ENGINE-NO-WRITE` (SPEC §51.0.J) |
| `parseVariant` non-enum arg (v0.next) | `parseVariant(json, T)` is called with a non-enum `T` | TS `E-PARSEVARIANT-001` (SPEC §14.10 — L22 type-as-argument primitive, S65) |
| Synthesised property write (v0.next) | An assignment targets an auto-synthesised validity-surface property (`@x.isValid`, `@x.errors`, `@x.touched`, `@x.submitted`) | VSS (Stage 6.7) `E-SYNTHESIZED-WRITE`; CG `E-CG-VALIDITY-WRITE` as defense-in-depth |
| Async cycle | `'awaits'` cycle in dependency graph produces unschedulable code | DG `E-DG-001` |
| Concurrent lift misordering | Two independent DG nodes in the same logic block both have `hasLift: true`; codegen would wrap them in `Promise.all`, producing non-deterministic accumulator order | DG `E-LIFT-001` (lift-checker Phase 2 sub-pass); blocks codegen |
| Validator circular dependency (v0.next) | Two or more validators reference each other via cross-field predicate args; the validator dependency graph is cyclic | DG `E-VALIDATOR-CIRCULAR-DEP` (SPEC §31.4 / §55.11.2) |
| Derived-cell circular dependency (v0.next) | A `const <derived>` cell expression depends on itself directly or transitively | DG `E-DERIVED-CIRCULAR-DEP` (SPEC §31.5) |
| Derived-engine circular dependency (v0.next) | A `<engine derived=expr>` chain forms a cycle | DG `E-DERIVED-ENGINE-CIRCULAR` (SPEC §51.0.J / §31.5) |
| Engine multi-target with effect= (v0.next) | A multi-target rule (`rule="evt -> .A | .B"`) carries an `effect=` attribute | DG `E-ENGINE-EFFECT-AMBIGUOUS` (SPEC §51.0.H) |
| Pre-META AST consumed by DG | DG receives AST before META has applied compile-time splice results, causing DG to build a dependency graph over unevaluated meta blocks | META must complete before DG runs; DG input contract requires post-META AST |
| Pre-VSS DG (v0.next) | DG receives input before VSS has constructed the synth-cell registry, leaving `'validator-arg'` edges with no valid target | VSS (Stage 6.7) must complete before DG; DG input contract requires `synthCellRegistry` |
| Route name skew | Server function in CG has no route name from RI | CG `E-CG-002` — indicates RI → DG → CG handoff gap |
| Meta determinism misclassification | A meta block classified as deterministic actually depends on runtime values, or vice versa | TS validates at type level; CG `E-CG-005` as defense-in-depth |
| SQL/server-context leak to client JS | SQL blocks, transaction blocks, or server-context meta blocks (those referencing `process.env`, `Bun.env`, `bun.eval()`, fs APIs) are emitted into `.client.js` output, exposing DB schema and server infrastructure to the browser | RI escalates containing functions to `'server'`; CG `E-CG-006` as defense-in-depth for nodes not caught by RI; `W-CG-001` for top-level SQL outside any function |
| Cell with no render-spec used as `<x/>` (v0.next) | `<x/>` render-by-tag use of a cell whose `rhsShape` is `"literal"` (no render-spec) or `"derived-expr"` with non-markup-typed RHS | CG `E-CELL-NO-RENDER-SPEC` (SPEC §6.4) |
| Closure cycle (v0.3 §40.9, INACTIVE) | Reachability Solver's fixed-point operator fails to converge — cycle in the reachability graph that the closure operator does not collapse. Defensive; SHOULD NOT fire on valid source given the finite-graph guarantees of §31 / §40 / §41 / §52. | RS `E-CLOSURE-001` (SPEC.md §40.9.11) — Stage 7.6 |
| Auth gate uses async-only check (v0.3 §40.9, INACTIVE) | An auth gate uses a check that is not a closed-form predicate over the app-scope role enum (per SPEC §40.1.1) — closure analysis treats the gated component as runtime-only and ships it eagerly. The gate remains legal; the lint surfaces the trade-off. | RS `W-AUTH-RUNTIME-FALLBACK` info-level lint (SPEC.md §40.1.1, §40.9.5, §40.9.11) — Stage 7.6 |
| Missing role enum with auth gates (v0.3 §40.9, INACTIVE — DEFERRED) | An application uses auth gates but declares no app-scope role enum. RS cannot classify auth gates statically. Subsequent-wave error; not v0.3.0 normative (the spec only requires synchronous role classification WHERE static analysis is desired — bare absence is acceptable). | RS pre-condition check; surface in a subsequent v0.3 wave with a dedicated diagnostic |
| Pre-markup-context-edge-emission DG (v0.3 §40.9.3, INACTIVE) | Reachability Solver receives Stage 7 DG output that has not been extended to lift markup-context reactive reads into `reads` edges (per the 256-edge S84 ceiling). The reactive_dep_closure is structurally under-approximated. | Stage 7 extension is a separate compiler-impl wave item; until landed, RS aborts with a compiler-internal-invariant error if any markup-context @-read is found in AST without a corresponding `reads` edge in DG |
| Implicit coupling | Two stages share a mutable data structure instead of passing by value | All stage outputs are pure values; mutation of upstream output is a contract violation |
| Undocumented field | Downstream stage uses a field not defined in the upstream contract | All consumed fields must appear in this document |
| Deferred parsing gap | A downstream stage receives opaque string wrappers where it expects recursively parsed AST nodes | TAB may produce `BareExpr` wrappers in function body positions; each stage documents its handling. BPP (Stage 3.5) was removed — downstream stages receive ASTs as-produced by CE. |
| Error code misassignment | An error code is assigned to a stage that lacks the information to detect the condition | Error codes must be assigned to the earliest stage with sufficient context (e.g., identifier resolution codes belong to TS, not TAB) |

---

## Contract Change Protocol

A change to any output contract defined in this document is a **breaking change**.

Before merging a contract change:
1. Update this document with the new contract.
2. Identify all downstream consumers of the changed output.
3. Update all downstream stage contracts accordingly.
4. Notify the pipeline-correctness-tester -- all contract tests for affected stages must be
   updated before the change ships.
