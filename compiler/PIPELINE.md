# scrml Compiler Pipeline — Stage Contracts

**Version:** 0.7.0
**Date:** 2026-05-04
**Owner:** scrml Integration Pipeline Reviewer
**Status:** Authoritative — no stage integration proceeds without a reviewed contract here.

**Change log:**
- **0.7.0 (2026-05-04, Stage 0b D4):** v0.next pipeline updates — engineering target for Phase A1+ implementation. Per SPEC.md §1.4–§1.6 (markup-as-value pillar, north-star Tier ladder, V5-strict access), §6 (V5-strict reactivity), §18.0 (match block-form), §38 (file-level channels), §51.0 (engines as Tier 2), §55 (validators + auto-synthesized validity surface), and §4.14–§4.16 (`:`-shorthand, structural-elements registry, M7 negative-space). Affected stages get a v0.next addendum at each stage's end documenting the new contract surface; existing contract content remains authoritative for v1 features.
  - **Stage 3 TAB:** new tokens (`pinned`, `is some`, `is not`), recognition of `<engine>`/`<match>`/`<errors>`/`<onTransition>` as scrml-defined structural elements, `:`-shorthand body recognition, V5-strict `<x>` decl AST shape, render-spec-RHS classification, `default=` attribute capture.
  - **Stage 3.05 NR:** auto-declared engine variable resolution; auto-derived variable name (lowercase first run, strip trailing "Machine"); category routing for new structural elements; `pinned` forward-reference detection.
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

The scrml compiler transforms `.scrml` source files into HTML, CSS, and JavaScript through eleven
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
| 6 | Type System | TS | per-file (after PA+RI complete) |
| 6.5 | Meta Check + Eval | META | project-wide |
| 7 | Dependency Graph Builder | DG | project-wide |
| 8 | Code Generator | CG | per-file (after DG complete) |

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
    spans: SpanTable,           // node id -> Span (never dropped)
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
    | ReactiveDecl { kind: "reactive-decl", name: string, init: string, span: Span }
    | LetDecl      { kind: "let-decl", name: string, init: string, span: Span }
    | PureDecl     { kind: "pure-decl", name: string, params: string[], body: LogicNode[], span: Span }
    | ImportDecl   { kind: "import-decl", ... }
    | ExportDecl   { kind: "export-decl", ... }
    | TypeDecl     { kind: "type-decl", ... }
    | ComponentDef { kind: "component-def", ... }
    // + standard JS constructs: IfStmt, ForStmt, ReturnStmt, etc.

  LiftTarget =
    | { kind: 'markup', node: ASTNode }
    | { kind: 'expr',   expr: string }
  ```

  **LogicNode `kind` wire-value table (Amendment 2, 2026-03-26):**

  Every `LogicNode` variant has a `kind` field whose value is a kebab-case string. Downstream
  stages MUST match on these exact string values. The type name (e.g., `FunctionDecl`) is a
  documentation-level name only and does not appear on the wire.

  | Type name      | `kind` string value  |
  |----------------|---------------------|
  | FunctionDecl   | `"function-decl"`   |
  | ReactiveDecl   | `"reactive-decl"`   |
  | PureDecl       | `"pure-decl"`       |
  | BareExpr       | `"bare-expr"`       |
  | LiftExpr       | `"lift-expr"`       |
  | LetDecl        | `"let-decl"`        |
  | ImportDecl     | `"import-decl"`     |
  | ExportDecl     | `"export-decl"`     |
  | TypeDecl       | `"type-decl"`       |
  | ComponentDef   | `"component-def"`   |

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
`lift`, `fn`, `@`, `pure`, and `~` constructs are recognized and represented as first-class AST
nodes, not raw strings. Function, pure, and fn shorthand bodies may be stored as opaque `BareExpr`
wrappers; downstream stages handle these as documented in their own contracts. The output AST is a
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

**Performance budget:** <= 20 ms per file.
**Parallelism opportunity:** Yes — fully per-file.
**Dependencies:** Block Splitter (BS) must complete for the file.

### Stage 3 v0.next addendum (Pipeline 0.7.0 — SPEC §6 / §18 / §51 / §55 engineering target)

**Status:** ENGINEERING TARGET. Implementation lands in Phase A1+. Existing v1 TAB behaviour above remains authoritative until A1 lands.

**New tokens (lexer-level):**

- `pinned` — keyword. Recognised on declaration sites (`<x pinned> = init`, `pinned import { ... } from '...'`), in import specifiers (`import { name pinned } from './x.scrml'`), and in cell modifier positions. Per SPEC §6.10, §21.8.1.
- `is some` — composite operator (two tokens lexed as a phrase). Recognised in expression position. Cross-ref §42.2.5.
- `is not` — composite operator. Existing in v1 (§42.2.4); v0.next preserves the form.
- `default=` — attribute name on cell declarations. Per SPEC §6.8.

**Structural-element recognition (additive to existing markup grammar):**

The following four tag names are scrml-defined structural elements (cross-ref SPEC §4.15, §24.4) and SHALL be classified at TAB time as a distinct AST node kind from generic markup. The block-splitter recognises them as ordinary `<` openers (no whitespace before identifier — they follow the canonical no-space convention); TAB classifies them by name lookup against the structural-element registry.

| Element | New AST node kind | Required attributes (TAB-validated) | Body recognition |
|---|---|---|---|
| `<engine>` | `engine-decl` (existing v1 path renamed from `machine-decl` per S53; v0.next adds the new attribute slots) | `for=Type` | bare-body OR `:`-shorthand state-children |
| `<match>` | `match-block-decl` (NEW for v0.next — distinct from JS-style `match` expr) | `for=Type` | bare-body of variant arms |
| `<errors>` | `errors-elem` (NEW) | `of=expr` | optional bare-body (override template); `all` boolean attribute |
| `<onTransition>` | `on-transition-elem` (NEW) | none required | bare-body or `:`-shorthand; `to=Variant`, `from=Variant`, `once`, `if=expr` attributes |

**`:`-shorthand body recognition:**

Per SPEC §4.14, a tag opener may end with ` : <single-expression>>` (whitespace before the colon, then a single scrml expression, then the closing `>` of the opener). TAB SHALL recognise this form on `<engine>`, `<match>` arm state-children, `<onTransition>`, and any other element that admits the form per its owning section.

- The expression following `:` is parsed using the same expression grammar TAB uses for bare-call attribute values + `${...}` interpolation contents.
- Multi-statement intent (`;` outside expression-internal contexts) is `E-MULTI-STATEMENT-HANDLER`. TAB enforces this at parse time.
- A closer present on a `:`-shorthand body is `E-CLOSER-001`.

**V5-strict declaration AST shape (cross-ref SPEC §6.1, §6.2):**

V5-strict introduces three RHS shapes for state-cell declarations. TAB classifies the RHS at parse time and records the shape on the AST node:

```
ReactiveDecl = {
  kind: "reactive-decl",
  name: string,
  modifier: "plain" | "const" | "pinned" | "server" | ...,
  rhsShape: "literal" | "render-spec" | "derived-expr",   // NEW v0.next
  rhsRaw: string,                                          // verbatim source slice
  rhsAst: ASTNode | LiftTarget,                            // shape-dependent typed payload
  validators: AttrNode[],                                  // bare attribute list (req, length, pattern, ...)
  defaultExpr: string | null,                              // from default= attribute
  span: Span,
}
```

- `rhsShape: "literal"` — RHS is a literal or expression value. `rhsAst` is a `LogicNode`.
- `rhsShape: "render-spec"` — RHS is a markup element (Shape 2). `rhsAst` is a `MarkupElement`. The compiler uses the render-spec at codegen for `<x/>` render-by-tag expansion (cross-ref CG addendum below).
- `rhsShape: "derived-expr"` — declaration uses `const` modifier; RHS is a reactive expression. `rhsAst` is a `LogicNode`.

**Render-spec validation (parse-time):**

A Shape 2 declaration's RHS markup element SHALL be classified as bindable or non-bindable at parse time. Non-bindable RHS markup (e.g., `<div>`) on a non-`const` declaration produces `E-CELL-RENDER-SPEC-NOT-BINDABLE` from TS (Stage 6) — TAB records the shape; TS validates against the use-site form.

**Bare-variant inference parsing:**

Per SPEC §14.10 / §18.0.3, `.VariantName` (no preceding qualifier) is legal in expression positions where the type is fixed. TAB parses bare-variant references as `EnumVariantRef { kind: "enum-variant-ref", qualifier: null, variantName: string, span }`. TS resolves the qualifier from context.

**Positional binding parsing:**

Per SPEC §14.11, a struct-typed cell with a positional initialiser `<x>: T = (a, b, c)` is parsed as a `TupleLiteral` RHS. TS validates the tuple's arity and per-position types against the struct's field declaration order.

**Multi-statement-handler restriction:**

Per SPEC §5.2.3, bare-form event-handler attribute values containing multiple statements emit `E-MULTI-STATEMENT-HANDLER`. TAB enforces this at attribute-value parse time. The check is: a bare-form (non-`${...}`) handler attribute value may not contain `;` outside expression-internal contexts (string literals, nested function bodies). The same rule applies to `:`-shorthand bodies.

**`<x/>` render-by-tag disambiguation (TAB → NR handoff):**

A markup-position tag `<x/>` (or `<x ...>...</>`) where `x` is a same-file or imported reactive-cell name resolves to render-by-tag at NR (Stage 3.05) using the unified state-type registry (§15.15). TAB does NOT itself disambiguate decl-vs-render-by-tag-vs-engine-statechild — it produces a markup AST node, and NR's category routing decides the kind. TAB's job is structural; the routing is NR's authoritative output.

**New error codes emitted by TAB (v0.next additions):**

- `E-CLOSER-001` — `:`-shorthand body with closer present (§4.14).
- `E-MULTI-STATEMENT-HANDLER` — bare-form handler with multiple statements (§5.2.3, §4.14).
- `E-NAME-COLLIDES-RESERVED` — user component or state-type name collides with a reserved structural-element name (§4.15, §24.4).
- `E-IMPORT-PINNED-INVALID` — `pinned` modifier on a non-cell, non-engine import (§21.8.1; TAB detects at attribute-position parse time when the import resolves at MOD).
- `E-VARIANT-AMBIGUOUS` (escalated from a TAB warning to TS error per ambiguity-resolution time; bare-variant references are accepted by TAB regardless and resolved at TS).

**Performance budget:** <= 25 ms per file (existing 20 ms budget + 5 ms for v0.next additional structural-element recognition + render-spec classification). Verify in A1 implementation.

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
    `resolvedCategory: 'html' | 'channel' | 'engine' | 'timer' | 'poll' | 'db' | 'schema' | 'request' | 'errorBoundary' | 'machine' | 'user-component' | 'user-state-type' | 'unknown'`.
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

**Error contract:**
- Error type: `NRError { code: string, message: string, span: Span, severity: 'warning' }`
- Error codes:
  - `W-CASE-001`: lowercase user-declared state-type or component shadows a
    built-in HTML element (SPEC §15.15.4).
  - `W-WHITESPACE-001`: `< identifier>` opener uses whitespace; canonical form
    is no-space (SPEC §15.15.5).
- Partial output: warnings only; never blocks compilation in P1-P2.

**Transformation:**
NR walks the AST visiting every `MarkupElement` / `StateBlock`. For each opener,
it performs a registry lookup per SPEC §15.15.2 (same-file → imported → scrml
lifecycle → HTML built-in → unknown). The result populates the new
`resolvedKind` / `resolvedCategory` AST fields. Diagnostics for case
shadowing and whitespace-opener emission fire as side effects of the walk.

**Performance budget:** <= 5 ms per file (verified P1.E: ~0-1ms per file in practice; pure AST traversal).
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
    exportRegistry: Map<string, Map<string, { kind: string, isComponent: boolean }>>,
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
  - `exportRegistry` maps each file path to a `Map<name, {kind, isComponent}>`. `isComponent`
    is `true` for `const` exports with PascalCase names (first letter uppercase). Named exports
    only — default exports are not supported in this version.
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
- Partial output: All errors accumulated and returned. Circular imports (E-IMPORT-002) do not
  prevent the rest of the graph from being analyzed. The compilation order is best-effort when
  cycles exist. Downstream stages MUST NOT proceed if `errors` contains any `severity: 'error'`
  entries.

**Transformation:**
MOD performs five steps in sequence:
1. Build import graph: for each file, extract `FileAST.imports` and resolve relative paths to
   absolute paths. Build a `Map<filePath, {imports, exports}>` covering all files.
2. Detect circular imports: DFS over the import graph; report E-IMPORT-002 for each cycle.
3. Build export registry: for each file, map exported names to their `{kind, isComponent}`.
   A name is an `isComponent` candidate if its `kind` is `"const"` and the name starts with
   an uppercase ASCII letter.
4. Validate imports: for each import entry, verify every named import exists in the target
   file's export registry. Emit E-IMPORT-004 for each missing name.
5. Topological sort: produce `compilationOrder` — a valid build order for all files.

**What is NOT done by this stage:**
- No component expansion or inline resolution (performed by CE, Stage 3.2).
- No type resolution.
- No scope analysis.
- No AST mutation.

**Performance budget:** <= 5 ms for the full project (graph traversal; linear in file count).
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
    `<machine>`, `<errorBoundary>`, or `<program>`.
  - W-ATTR-002: recognized attribute name with unrecognized value-shape
    (e.g. `auth="role:dispatcher"` — see SPEC §52.13).
  - Plain HTML elements (`<div>`, `<input>`, etc.) are NOT policed. Open-prefix
    forms (`bind:*`, `on:*`, `data-*`, `aria-*`, `onserver:*`, `onclient:*`,
    `class:*`, `style:*`) are accepted on every element.
  - Severity: warning. Compilation continues; the warning surfaces
    silent-acceptance gaps without breaking forward-compat HTML attribute
    behaviour.

- **VP-2 — Post-CE Invariant Check** (`compiler/src/validators/post-ce-invariant.ts`)
  - Walks the AST and emits a hard error for every residual
    `isComponent: true` markup node — i.e. a component reference that
    survived CE without being expanded or rejected at CE time.
  - E-COMPONENT-035: residual `isComponent: true` markup node — closes the
    silent phantom DOM emission window (see SPEC §15.14).
  - Severity: error. Compilation fails.

- **VP-3 — Attribute Interpolation Validation** (`compiler/src/validators/attribute-interpolation.ts`)
  - Walks the AST and emits a hard error when a `${...}` interpolation
    appears in an attribute value where the per-element registry flags
    `supportsInterpolation: false`.
  - E-CHANNEL-007: `${...}` in `<channel name=>` or `<channel topic=>`
    (see SPEC §38.11).
  - Severity: error. Compilation fails.

**Error contract:**
- May throw: No — errors are returned as values.
- Each pass operates independently. A given run may surface VP-1 warnings,
  VP-2 errors, and VP-3 errors simultaneously.
- All three passes traverse the same AST shape via the shared
  `validators/ast-walk.ts` helper. Any new validation pass added at this
  stage MUST use the shared walker to ensure consistent traversal.

**Performance budget:** <= 1 ms per file (combined for all three passes).
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
  - The AST structure from CE is not mutated. `nodeTypes` is a side table.
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
tracked per-file in source order. The output is the original AST enriched with a `nodeTypes` side
table and a `scopeChain` for downstream use.

**What is NOT done by this stage:**
- No code generation.
- No async scheduling or dependency graph construction.
- No SQL query execution or validation.
- No route assignment (consumed from RouteMap, not produced here).
- No compile-time execution of meta block bodies (TS resolves types and validates coercion;
  META stage performs execution).

**Performance budget:** <= 20 ms per file (runs per-file once PA and RI are complete).
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

## Stage 7: Dependency Graph Builder (DG)

**Input contract:**
- Type:
  ```
  {
    files: TypedFileAST[],
    routeMap: RouteMap,
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
- Source: META (Stage 6.5)

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

  DGEdge = {
    from: NodeId,
    to: NodeId,
    kind: 'calls' | 'reads' | 'writes' | 'renders' | 'awaits' | 'invalidates',
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

During Phase 1, for each `DGNode` N created for a node that appears in the direct body of an
anonymous `${ }` logic block, DG inspects the `LogicNode[]` sequence of that block. It scans
the statements following N's corresponding AST position for `LiftExpr` nodes at the direct body
level (not inside nested function bodies). If any such `LiftExpr` exists before the next
server-call statement or the end of the block, N's `hasLift` field is set to `true`. Otherwise
`hasLift` is `false`.

Per-file subgraphs can be constructed in parallel across Bun workers and then merged into the
project-wide graph.

**Phase 2 — Lift concurrent detection (lift-checker sub-pass):**
After the full project-wide graph is merged and `'awaits'` edges are complete, the lift checker
runs as a sub-pass within this stage. It does not produce a separate output — E-LIFT-001 errors
are emitted into the DG error list and block the DG output if any are found.

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

**Performance budget:** <= 20 ms for the full project (graph construction is linear in AST size;
lift checker is linear in the number of nodes with `hasLift: true` per logic block).
**Parallelism opportunity:** Limited — edges cross file boundaries, so this is project-wide.
  Per-file subgraphs can be built in parallel and then merged.
**Dependencies:** META (Stage 6.5) must complete for all files.

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

## Stage 8: Code Generator (CG)

**Input contract:**
- Type:
  ```
  {
    files: TypedFileAST[],
    routeMap: RouteMap,
    depGraph: DependencyGraph,
    protectAnalysis: ProtectAnalysis,
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

**What is NOT done by this stage:**
- No type resolution (all types consumed from TS output).
- No route inference (all boundaries consumed from RouteMap).
- No dependency analysis (all ordering consumed from DependencyGraph).
- No SQL query execution.
- No HTML spec validation (all validation completed in TS).
- No bundling, minification, or tree-shaking (out of scope for the compiler; handled by
  downstream tooling if desired).
- No compile-time meta evaluation (completed by META, Stage 6.5).

**Performance budget:** <= 25 ms per file.
**Parallelism opportunity:** Yes — per-file, once DG is complete.
**Dependencies:** Dependency Graph Builder (DG) must complete for the project.

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

Project-wide sync point (META complete):
  META + RI -> DG

Per-file, parallel (after DG):
  TS + RI + DG + PA -> CG
```

---

## Integration Failure Mode Catalog

The following failure modes are tracked per the pipeline reviewer's mandate. Any new stage
boundary must be audited against this list before integration.

| Failure Mode | Description | Detection Point |
|---|---|---|
| Span loss | Source spans dropped at a stage boundary, making error reporting impossible downstream | Any stage that transforms AST nodes must preserve all spans |
| Type information loss | AST does not carry sufficient type information for codegen | TS output must have 100% node coverage in `nodeTypes` |
| Implicit coupling | Two stages share a mutable data structure instead of passing by value | All stage outputs are pure values; mutation of upstream output is a contract violation |
| Undocumented field | Downstream stage uses a field not defined in the upstream contract | All consumed fields must appear in this document |
| Protected field leak | A client-boundary function accesses server-only data | Caught by TS `E-TYPE-005`; codegen must re-verify as defense-in-depth |
| Async cycle | `'awaits'` cycle in dependency graph produces unschedulable code | DG `E-DG-001` |
| Route name skew | Server function in CG has no route name from RI | CG `E-CG-002` -- indicates RI->DG->CG handoff gap |
| Meta splice type mismatch | `MetaBlock` result type incompatible with parent context's expected type | TS `E-META-001` -- meta block body produces wrong type for splice site |
| Meta determinism misclassification | A meta block classified as deterministic actually depends on runtime values, or vice versa | TS validates at type level; CG `E-CG-005` as defense-in-depth |
| Field name drift | Upstream contract uses a different field name than the implementation (e.g., `kind` vs `type`) | Pipeline reviewer audits implementation against contract at each stage boundary review |
| Deferred parsing gap | A downstream stage receives opaque string wrappers where it expects recursively parsed AST nodes | TAB may produce `BareExpr` wrappers in function body positions; each stage documents its handling. BPP (Stage 3.5) was removed — downstream stages receive ASTs as-produced by CE. |
| Error code misassignment | An error code is assigned to a stage that lacks the information to detect the condition | Error codes must be assigned to the earliest stage with sufficient context (e.g., identifier resolution codes belong to TS, not TAB) |
| Concurrent lift misordering | Two independent DG nodes in the same logic block both have `hasLift: true`; codegen would wrap them in `Promise.all`, producing non-deterministic accumulator order | DG `E-LIFT-001` (lift-checker Phase 2 sub-pass); blocks codegen |
| SQL/server-context leak to client JS | SQL blocks, transaction blocks, or server-context meta blocks (those referencing `process.env`, `Bun.env`, `bun.eval()`, fs APIs) are emitted into `.client.js` output, exposing DB schema and server infrastructure to the browser | RI escalates containing functions to `'server'`; CG `E-CG-006` as defense-in-depth for nodes not caught by RI; `W-CG-001` for top-level SQL outside any function |
| Pre-META AST consumed by DG | DG receives AST before META has applied compile-time splice results, causing DG to build a dependency graph over unevaluated meta blocks | META must complete before DG runs; DG input contract requires post-META AST |

---

## Contract Change Protocol

A change to any output contract defined in this document is a **breaking change**.

Before merging a contract change:
1. Update this document with the new contract.
2. Identify all downstream consumers of the changed output.
3. Update all downstream stage contracts accordingly.
4. Notify the pipeline-correctness-tester -- all contract tests for affected stages must be
   updated before the change ships.
