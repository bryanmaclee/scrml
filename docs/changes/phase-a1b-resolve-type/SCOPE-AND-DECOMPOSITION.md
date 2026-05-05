# A1b — Resolve + Type: scope and per-step decomposition (DRAFT)

**Status:** RATIFIED 2026-05-05 (S60). All 7 open Qs ratified per PA recommendations. User verbatim: "ratify all".
**Predecessor:** A1a (lex+parse) — see `docs/changes/phase-a1a-lex-parse/AST-CONTRACTS-AND-DECOMPOSITION.md`. A1a 9/14 done at draft time; A1b begins after A1a-COMPLETE (Step 13 wraps).
**Successor:** A1c (codegen + PIPELINE.md prose pass).
**Authority:** SPEC v0.next (post-D4 + L21). Each A1a Step (1-13 + 11.5) extends an AST shape; A1b wires every consumer that depends on those shapes.

---

## §1 What A1b is

A1b's scope is **resolver + typer + semantic-validator** — everything between "the AST is correctly shaped" (A1a's deliverable) and "JavaScript is emitted" (A1c's deliverable). It is the **enforcement phase**: the spec's locks (L1-L21), the spec's error codes (§34), and the spec's invariants (V5-strict, derived-cell read-only-from-developer-perspective, validity-surface auto-synthesis) all fire here.

A1b does NOT change the AST shape. It walks the A1a-produced AST, builds symbol tables, performs type inference + checking, fires errors and warnings, and produces an **annotated AST** that A1c emits to JavaScript.

A1b's outputs:
- **Symbol table** — registered state cells per scope, registered import bindings (incl. `pinned` flag), registered engine identifiers, registered components.
- **Annotated AST** — the A1a AST decorated with: resolved targets for `@name` reads, classifier flags on cells (bindable / markup-typed / derived-with-validators), validity-surface skeletons, dependency graphs for derived cells.
- **Diagnostics** — every error and warning the spec calls out.

A1b is a **single phase** in the compiler pipeline contract — but per per-step decomposition (§4 below), the implementation work splits into ~18-22 focused dispatches. Each step is a per-step branch with PA cherry-pick to main between steps, mirroring A1a's pattern.

---

## §2 Spec authority — sections + locks

A1b enforces the following **Spec sections**:
- **§1** Pillars — markup-as-value, V5-strict, etc. (mostly already enforced; A1b verifies at this phase)
- **§3** Context model — V5-strict-per-context table (the resolver's basis for `<x>` vs `@x` semantics)
- **§4** Structural elements registry + tag-context disambiguation (E-STRUCTURAL-ELEMENT-MISPLACED)
- **§5** Event handlers — bare-call/bare-assignment/bare-single-expression rule (E-MULTI-STATEMENT-HANDLER, L19)
- **§6** Reactivity — V5-strict (§6.1), three RHS shapes (§6.2), Variant C compound (§6.3), render-by-tag (§6.4), mutable arrays (§6.5), derived cells (§6.6), E-DERIVED-WRITE (§6.6.8), in-compound derived (§6.6.16), markup-typed derived (§6.6.17), **E-DERIVED-VALUE-MUTATE** (§6.6.18, L21), lifecycle cells (§6.7), `default=` + `reset(@cell)` (§6.8)
- **§14** Type system — bare-variant inference (M9, §14.10)
- **§15** Components — components vs engines (E-COMPONENT-ENGINE-SCOPE, M20)
- **§19** No exceptions — no `throw new Error`; `fail` keyword only
- **§21** Imports — cross-file engine import (M18, §21.8); pinned-import legality (E-IMPORT-PINNED-INVALID); forward-ref cycle detection
- **§24** Structural elements registry (E-STRUCTURAL-ELEMENT-MISPLACED)
- **§34** All error codes A1b fires (full list §3.6 below)
- **§38** Channels — file-level only (E-CHANNEL-INSIDE-PROGRAM); no `@shared` modifier (E-CHANNEL-SHARED-MODIFIER)
- **§39** Schema — additive shared-core lowering (lowering itself is A1c; A1b validates the source-level grammar)
- **§40.7** Documentary attributes on `<program>` (S59)
- **§42** `not` keyword + `is some` predicate
- **§43** Nested-program `name=` (worker identity); `title=` synonym to keep names orthogonal
- **§51** Engines — auto-declared variable, rules, `derived=expr`, cross-file mount, exhaustiveness, `<onTransition>` cross-state effects (M16 + L20 + M18)
- **§53** Refinement type predicates (compile-time + boundary-check)
- **§55** Validators + auto-synthesized validity surface — `@form.isValid`, `@form.errors`, `@form.touched`, `@form.submitted` + per-field. Cross-field via predicate args (L11, L12, L13, L14)

A1b enforces the following **Locks**:
- **L1** Markup-as-first-class-value — type-system entry point
- **L2** Compound state Variant C — canonical access
- **L3** Decl-coupled-with-render-spec — the bindable classifier
- **L4** Validator vocabulary unification — across state-validator / refinement-type / schema
- **L5** `is some` vs `req` distinction
- **L11** Auto-derived validity surface
- **L12** 4-level error-message resolution chain
- **L13** `<errors of=expr/>` element
- **L14** Cross-field validation
- **L15** `const <derived>` ALL-SCOPE
- **L16** Multi-render via existing access paths (no override)
- **L17** Compiler dispatches binding by render-spec
- **L18** `reset(@cell)` keyword + `default=` attribute γ-semantics
- **L19** Multi-statement event handlers force named function
- **L20** `derived=expr` engine attribute
- **L21** E-DERIVED-VALUE-MUTATE (S59, ratified)

A1b enforces the following **Moves** (M1-M20):
- **M9** Bare-variant inference (§14.10)
- **M11** `not` keyword on imports/decls (§42)
- **M15** `:` shorthand body (single-expression body for state-children)
- **M16** Auto-declared engine variable (§51)
- **M18** Cross-file engine import (§21.8)
- **M20** Components-vs-engines distinction (§15.13.5)

---

## §3 Compiler subsystems touched

### §3.1 Resolver — `compiler/src/resolver*.ts` / `resolve.ts` / `name-resolution.ts`

The largest A1b workload. Survey will confirm exact files (the resolver may be split across multiple modules). Responsibilities:

- **Scope construction** — per-file, per-block, per-component-body scopes; per-engine state-children scopes.
- **State-cell registration** — every `state-decl` AST node registers a name in its containing scope's state-cell table.
- **V5-strict bare-name handling** — bare `name` in expression position resolves to a LOCAL only. If a state cell with the same name exists in scope, **E-NAME-COLLIDES-STATE** when a local declaration shadows it.
- **`@name` resolution** — `@name` in expression position MUST resolve to a registered state cell. If not: existing parse-or-resolve error (verify wording).
- **`<name>` resolution** — at decl-site (state-cell decl), use site (render-by-tag), engine state-child tag, structural-element tag. Disambiguation per §3 V5-strict-per-context table.
- **Import binding registration** — including `pinned: boolean` flag from A1a Step 7.
- **Forward-ref cycle detection** — for `pinned`-flagged imports + decls. **E-IMPORT-PINNED-INVALID**, **E-STATE-PINNED-FORWARD-REF**.
- **Structural-element tag-context disambiguation** — `<engine>`, `<match>`, `<errors>`, `<onTransition>` legal only in their owning context. **E-STRUCTURAL-ELEMENT-MISPLACED**.

### §3.2 Type system / typer — `compiler/src/typer*.ts` / `type-check.ts`

- **Type inference** — for derived cells, function params, return types, validator args.
- **Bare-variant inference** (§14.10, M9) — when LHS or parameter type is statically known, allow `.Variant` without `EnumName.Variant` qualification. Union-typed contexts force qualification.
- **Refinement-type predicates** (§53) — `<email>: string(pattern(/.../))` predicates type-check at compile time + boundary check at runtime. Three-zone enforcement (SPARK model).
- **Type compatibility for `default=`** — the `defaultExpr` must be compatible with the cell's declared type (or inferred init type).
- **Markup-typed derived classifier** (§6.6.17, L1) — `const <badge> = <span>...</span>` is a derived cell whose value is markup. Classifier flag on the cell.
- **Derived dep tracking** — DAG of derived → upstream `@cell` references. Cycle detection: **E-DERIVED-CIRCULAR-DEP**.

### §3.3 Validator typer + validity surface — `compiler/src/validators*.ts` (NEW or extended)

A new sub-system likely; existing `attribute-registry.js` covers W-ATTR-001 surface but not validator semantics. Responsibilities:

- **Validator-arg type checking** — `length(>=2)`, `min(0)`, `pattern(/.../)`, `oneOf(["x","y"])`, etc. Each predicate has a type signature; arg types must match.
- **`string[]` → `ExprNode[]` conversion** for validator args (Step 5 deferral). Final shape per AST-CONTRACTS §1.1.
- **Validator-vocabulary universality (L4)** — same word fires in three loci (state-validator, refinement-type predicate, schema constraint). Validate vocabulary alignment.
- **Auto-synthesized validity surface (L11)** — for compound state with validators, auto-create reactive cells:
  - `@compound.isValid` (rollup boolean)
  - `@compound.errors` (rollup array of enum tags)
  - `@compound.touched` (any field touched)
  - `@compound.submitted` (was first submit attempted)
  - `@compound.<field>.isValid` (per-field)
  - `@compound.<field>.errors` (per-field; enum tags, NOT strings)
  - `@compound.<field>.touched` (per-field)
- **Synthesized-name reservation** — names like `isValid`, `errors`, `touched`, `submitted` on a compound become read-only synthesized cells. Writes are **E-SYNTHESIZED-WRITE**.
- **`is some` vs `req` distinction (L5)** — both predicates exist; firing semantics distinct.
- **Cross-field validation (L14)** — `<confirm req eq(@signup.password)>` — predicate arg references another cell. Resolver wires the cross-cell dep; typer checks compatibility.
- **`<errors of=expr/>` (L13)** — first-class element; the expression resolves to a per-cell or rollup errors source.
- **4-level error-message resolution chain (L12)** — inline / project-registered / scrml:data defaults / match escape hatch. A1b records the chain decision; A1c emits the right runtime path.
- **Validators on derived cells forbidden** — **E-DERIVED-WITH-VALIDATORS** (§55, §6.6).

### §3.4 Engine typer — `compiler/src/engine*.ts` (NEW or extended)

- **Auto-declared engine variable (M16)** — first `<engine for=Phase>` in a scope auto-declares `<phase>` (lowercase first-letter). `var=<name>` overrides.
- **Engine type-binding** — `<engine for=Phase>` ties the engine to enum type `Phase`; state-children must cover every variant (exhaustiveness, **E-MATCH-NOT-EXHAUSTIVE** equivalent).
- **Rule typer** — `rule="event -> Variant"` — variant must exist on Phase; event syntax tier-validated (event-driven, predicate, wildcard).
- **`.advance(.event)` access path** — only legal write path. Direct `@phase = .Loading` writes: **E-ENGINE-INVALID-TRANSITION**.
- **`derived=expr` engine (L20)** — reactively recomputes the variant; no rules, no writes (**E-DERIVED-ENGINE-NO-WRITE**). `initial=` forbidden.
- **`<onTransition from=A to=B>`** — cross-state-effect block; only valid as engine state-child.
- **Cross-file engine import (M18)** — `import { MarioMachine } from './engines.scrml'` then `<MarioMachine/>` mount. Singleton semantics across all use-sites in importer's file. Resolver verifies single mount-point semantics.
- **Components-vs-engines (M20)** — component-instance with internal state is fresh per instance; engine is one app-lifecycle singleton. Component body cannot instantiate an engine — **E-COMPONENT-ENGINE-SCOPE**.

### §3.5 Mutation-shape walker — L21 enforcement (B8)

**Dual-path walker required** (Step 10 verification finding, S60):

- **Path 1: specialized kinds.** `ast-builder.js` lowers some shapes ahead of A1b:
  - `kind: "reactive-array-mutation"` — direct `@arr.method(args)` form
  - `kind: "reactive-nested-assign"` — simple `@obj.path = value` form
  - These are pre-classified; B8 walks them with direct field access.
- **Path 2: structural walk into `bare-expr.exprNode`.** Other shapes (compound-assigns `+=`/`*=`/etc., computed-index assigns `@arr[i] = x`, `delete @obj.foo`, nested-receiver method calls) flow through `kind: "bare-expr"` with the full ExprNode tree preserved on the `exprNode` field. B8 walks the ExprNode trees within these.
- **Discrimination of `@name`-rooted vs local-rooted:** every receiver chain ends in an `ident` node; the `name` field is preserved verbatim including the `@` prefix. B8 checks `ident.name.startsWith("@")` to identify state-cell-rooted mutations. Pure string-shape inspection — no parser work needed.

**Coverage requirements:**
- Array mutating methods (`.push`, `.pop`, `.shift`, `.unshift`, `.splice`, `.reverse`, `.sort`, `.fill`, `.copyWithin`); property assign / compound-assign / delete; in-compound derived sub-cells.
- For each receiver: walk to leaf `ident`; resolve via symbol table; if root cell is `shape: "derived" && isConst: true` → **E-DERIVED-VALUE-MUTATE**; if root is a synthesized validity-surface cell → **E-SYNTHESIZED-WRITE**.

**Step 11.5 (FOLD) prerequisite:** walker is single-pass on unified `state-decl` kind (no separate `reactive-derived-decl` walk). Without 11.5, walker would need three resolution paths per receiver (state-decl{shape:"derived"}, reactive-derived-decl, synthesized-cell) — refactoring cost amortizes if 11.5 lands first.

### §3.6 Diagnostics — error code consumers

A1b fires the following error codes (full list per §34):
- **Resolver-fired:** `E-NAME-COLLIDES-STATE`, `E-IMPORT-PINNED-INVALID`, `E-STATE-PINNED-FORWARD-REF`, `E-STRUCTURAL-ELEMENT-MISPLACED`
- **Cell-shape-fired:** `E-DERIVED-WRITE` (reassignment), `E-DERIVED-VALUE-MUTATE` (in-place mutation, L21), `E-CELL-NO-RENDER-SPEC`, `E-CELL-RENDER-SPEC-NOT-BINDABLE`, `E-DERIVED-WITH-VALIDATORS`, `E-SYNTHESIZED-WRITE`, `E-DERIVED-CIRCULAR-DEP`
- **Engine-fired:** `E-ENGINE-INVALID-TRANSITION`, `E-DERIVED-ENGINE-NO-WRITE`, `E-COMPONENT-ENGINE-SCOPE`
- **Channel-fired:** `E-CHANNEL-INSIDE-PROGRAM`, `E-CHANNEL-SHARED-MODIFIER`
- **Handler-fired:** `E-MULTI-STATEMENT-HANDLER` (L19)
- **Match-fired:** `E-MATCH-NOT-EXHAUSTIVE`, `E-MATCH-RULE-INERT` (W-MATCH-RULE-INERT lint)
- **Type-fired:** `E-EQ-004` (use `==` not `===`), `E-USE-INVALID-CTX`
- **Reset-fired (A1b's contribution):** target shape validation — must be `@cell` or `@compound.field`. Step 9 accepts any ExprNode; A1b rejects non-canonical.

### §3.7 Tests — extensive

Each error code needs positive + negative tests. Each lock needs invariant tests. Each move needs sample-corpus tests. The validity-surface synthesis needs comprehensive composition tests (validator + cross-field + nested compound + array-of-compound). Engines need exhaustiveness + transition + cross-file-import tests.

Estimate: **+200-400 tests** added across A1b. Existing test suite (~8,800-8,900 baseline post-A1a) should grow to ~9,000-9,300 post-A1b.

---

## §4 Decomposition into per-step dispatches

Each step is a per-step branch with PA cherry-pick to main, mirroring A1a's pattern. **Total estimated: 80-120 h** focused work; ~18-22 steps.

### §4.1 Foundational resolver (Steps B1-B4) — ~25-35 h

| # | Step | Files | Est | Notes |
|---|---|---|---|---|
| B1 | **Symbol-table extension** for V5-strict — register `state-decl` (both `structuralForm:true` and `false`) into a per-scope state-cell table. Distinguish from local-let/const tables. | resolver / name-resolution sources; `types/ast.ts` for symbol-record shape | 5-7 h | Foundational; B2-B4 depend on it |
| B2 | **V5-strict bare-name resolution + E-NAME-COLLIDES-STATE** — when a local `let`/`const` declaration uses a name registered in the state-cell table, fire E-NAME-COLLIDES-STATE | resolver | 4-6 h | First lock-firing step; high test surface |
| B3 | **`@name` resolution** — bare-`@`-prefix in expression position resolves to state cell; record resolved-target on the ExprNode (annotated AST output) | resolver | 4-6 h | Powers B5+ |
| B4 | **Import binding + `pinned` flag forward-ref cycle detection** — registers import items; for `pinned`-flagged imports, builds + walks dep graph; fires E-IMPORT-PINNED-INVALID on invalid context, E-STATE-PINNED-FORWARD-REF on cycles | resolver + import handler | 6-9 h | Larger; cycle-detection algorithm work |

### §4.2 Cell classification + derived-cell wiring (Steps B5-B8) — ~12-18 h

| # | Step | Files | Est | Notes |
|---|---|---|---|---|
| B5 | **Cell classifier** — for each `state-decl`, classify: `bindable` (Shape 2 markup-RHS is input/textarea/select), `markup-typed` (derived RHS is markup), `compound-parent` (Variant C). Set classifier flags. | typer or new `cell-classifier.ts` | 3-5 h | Powers B6, B7 |
| B6 | **Render-by-tag classifier — E-CELL-NO-RENDER-SPEC + E-CELL-RENDER-SPEC-NOT-BINDABLE** — at every `<x/>` use-site in markup, look up cell `x`; verify renderable shape; fire if not | resolver + markup walker | 3-5 h | Cross-references B5 |
| B7 | **Derived-cell dep tracking** — for `const <name> = expr`, walk `expr` collecting `@cell` references; build derived → upstream DAG; cycle detection (E-DERIVED-CIRCULAR-DEP) | typer / dep-graph builder | 4-6 h | Powers B8 + L21 walker |
| B8 | **L21 walker — E-DERIVED-VALUE-MUTATE + E-SYNTHESIZED-WRITE** — walks ExprNode trees; for each MemberCall/MemberAssignment/UnaryDelete with derived-cell or synthesized-cell as root, fire | typer / mutation walker | 4-6 h | Step 11.5 prerequisite for unified walk |

### §4.3 Validator typer + validity surface (Steps B9-B13) — ~22-30 h

| # | Step | Files | Est | Notes |
|---|---|---|---|---|
| B9 | **Validator-arg ExprNode conversion** — Step 5 deferral: convert `validator.args` from `string[]` to `ExprNode[]` per AST-CONTRACTS §1.1. Sub-grammar parser. | ast-builder / new validator-arg-parser | 4-6 h | Touches every validator AST node from Step 5 |
| B10 | **Validator type-checking** — predicate vocabulary type signatures; arg-type matching; cross-field args resolved via B3's @name | typer + validator catalog | 5-7 h | Powers B11-B13 |
| B11 | **Auto-synthesized validity surface — compound rollup** — for compound-with-validators, synthesize `.isValid`, `.errors`, `.touched`, `.submitted` cells | typer / synthesis pass | 4-6 h | Adds entries to symbol table; B8 must already be in place to reject synthesized-write |
| B12 | **Auto-synthesized validity surface — per-field** — same per validator-tagged child cell | typer / synthesis pass | 3-4 h | Builds on B11 |
| B13 | **E-DERIVED-WITH-VALIDATORS + 4-level error-message resolution-chain recording** — derived cells reject validator attrs (Step 5 left them as syntactic but A1b rejects); inline / project-registered / data-defaults / match-escape decision recorded on each validator | typer | 4-6 h | A1c emits the chosen path |

### §4.4 Engine typer (Steps B14-B17) — ~15-22 h

| # | Step | Files | Est | Notes |
|---|---|---|---|---|
| B14 | **Engine binding + auto-declared variable (M16)** — first `<engine for=Phase>` auto-declares `<phase>`; `var=<name>` override; cross-file mount via `<EngineName/>` (M18) | resolver + engine | 5-7 h | Foundational for B15-B17 |
| B15 | **Engine state-child exhaustiveness + transition rule typer** — every variant of `Phase` must have a state-child; `rule="event -> Variant"` validated against Phase variants | engine typer | 4-6 h | Tier 2 commitment moment in the ladder |
| B16 | **`derived=expr` engine (L20) + E-DERIVED-ENGINE-NO-WRITE + E-ENGINE-INVALID-TRANSITION** — derived-engine rules-forbidden; direct-write rejection via .advance() invariant | engine typer | 3-5 h | |
| B17 | **`<onTransition from=A to=B>` + components-vs-engines (M20)** — onTransition only as engine state-child; component body cannot instantiate engine (E-COMPONENT-ENGINE-SCOPE) | engine typer + component checker | 3-4 h | |

### §4.5 Cross-cutting (Steps B18-B22) — ~10-15 h

| # | Step | Files | Est | Notes |
|---|---|---|---|---|
| B18 | **L19 — Multi-statement event handler** (E-MULTI-STATEMENT-HANDLER) — bare-form attr value: bare-call OR bare-assignment OR bare-single-expression. Anything with `;` outside expression-internal: error | typer + attr scanner | 2-3 h | Small but high test surface |
| B19 | **Channels (§38) — E-CHANNEL-INSIDE-PROGRAM + E-CHANNEL-SHARED-MODIFIER** — channels at file-level only; `@shared` modifier rejected | resolver / channel checker | 2-3 h | |
| B20 | **Bare-variant inference (§14.10, M9)** — when LHS or param type statically known, accept `.Variant` without qualification; union-typed contexts force qualification | typer | 3-4 h | Type-system surface |
| B21 | **Refinement-type predicates (§53) basic three-zone** — static-zone literal-conformance check; boundary-zone runtime hook recorded; trusted-zone elision marker | typer | 4-6 h | A1c emits the runtime hooks |
| B22 | **`reset(@cell)` target shape validation** — Step 9's permissive parser accepts any ExprNode; A1b rejects non-canonical (must be `@cell` or `@compound.field`) | typer | 1-2 h | Small; closes A1a Step 9 deferral |

**Total: ~85-120 h** focused work across 22 steps. Largest steps: B1 (foundational symbol table), B4 (cycle detection), B7 (dep DAG), B10 + B11 (validator typer + validity surface).

### §4.6 Step-to-lock + step-to-error-code mapping

| Step | Locks fired | Error codes fired | Warning codes fired |
|---|---|---|---|
| B2 | — | E-NAME-COLLIDES-STATE | — |
| B3 | — | (resolution-fail catch-all; existing infra) | — |
| B4 | — | E-IMPORT-PINNED-INVALID, E-STATE-PINNED-FORWARD-REF | — |
| B5 | L1, L3 | — (annotates AST only) | — |
| B6 | L3, L17 | E-CELL-NO-RENDER-SPEC, E-CELL-RENDER-SPEC-NOT-BINDABLE | — |
| B7 | L15 | E-DERIVED-CIRCULAR-DEP | — |
| B8 | **L21** | **E-DERIVED-VALUE-MUTATE**, E-SYNTHESIZED-WRITE | — |
| B9 | L4 (vocabulary alignment) | — | — |
| B10 | L4, L5 | (validator-arg-type mismatches; existing infra) | — |
| B11 | L11 | — (synthesizes cells; powers B8) | — |
| B12 | L11 | — | — |
| B13 | L12 | E-DERIVED-WITH-VALIDATORS | W-VALIDATOR-MSG-DEFAULT (lint when no inline + no project-registered + no match-escape — falls through to scrml:data default) |
| B14 | M16, M18 | — (resolves engine binding) | — |
| B15 | L6, L7 | E-MATCH-NOT-EXHAUSTIVE | W-ENGINE-INITIAL-MISSING |
| B16 | L20 | E-DERIVED-ENGINE-NO-WRITE, E-ENGINE-INVALID-TRANSITION | — |
| B17 | M20 | E-COMPONENT-ENGINE-SCOPE, E-STRUCTURAL-ELEMENT-MISPLACED | — |
| B18 | L19 | E-MULTI-STATEMENT-HANDLER | — |
| B19 | — | E-CHANNEL-INSIDE-PROGRAM, E-CHANNEL-SHARED-MODIFIER | — |
| B20 | M9 | (type-mismatch; existing infra) | — |
| B21 | L4 | (refinement-zone errors per §53.4) | — |
| B22 | L18 | (reset target shape; tighter than parser-accepted) | — |

(Locks not in this table — L2, L8, L9, L10, L13, L14, L16 — are either A1c work, A1a-already-done, or no-op enforcement at A1b. L13 `<errors of=expr/>` element semantics may need a small slice of B11/B12; defer until survey.)

### §4.7 Step-to-A1a-dependency table

Each B-step's prerequisite A1a deliverables. Critical: **B8 depends on Step 10 (IN FLIGHT at draft time)**.

| Step | Required A1a deliverables |
|---|---|
| B1 | Step 3 (state-decl rename); Step 4 (shape discriminant); Step 5 (validators); Step 6 (defaultExpr, pinned); Step 7 (import-item.pinned) |
| B2 | B1 + bare-name AST positions (existing infra) |
| B3 | B1 + `@name` ExprNode (existing infra) |
| B4 | B1 + Step 7 (import-item.pinned); Step 6 (state-decl.pinned) |
| B5 | B1 + Step 4 (shape); Step 5 (renderSpec); Step 6 (defaultExpr) |
| B6 | B5 + render-by-tag use-site (Step 11 verifies; existing markup parser) |
| B7 | B3 + Step 4 (isConst) + Step 5 (initExpr in derived RHS) |
| B8 | B7 + **Step 10 (MemberCall/MemberAssignment/UnaryDelete with `op`)** + **Step 11.5 FOLD** (unified state-decl kind so walker is single-pass) |
| B9 | Step 5 (validators[] with string args) |
| B10 | B9 + B3 |
| B11 | B5 + B10 + Variant C compound (Step 11 verifies) |
| B12 | B11 |
| B13 | B11 + B12 + Step 4 (isConst, to reject derived-with-validators) |
| B14 | B1 + Step 7 (import-item with possible engine bindings) + existing engine AST |
| B15 | B14 + existing engine AST + Step 11 smoke |
| B16 | B14 + Step 4 (isConst → derived) |
| B17 | B14 + B5 (component-vs-engine classifier) |
| B18 | existing event-handler attr AST |
| B19 | existing channel AST |
| B20 | existing typer + B5 |
| B21 | B10 (predicate vocabulary) + existing type-annotation parser |
| B22 | Step 9 (`reset-expr` AST kind) + B3 (`@name` resolution) |

### §4.8 Test-delta forecast (rough)

Per-step test additions are approximate; survey + DoD adjusts at dispatch time.

| Wave | Steps | Approx test delta |
|---|---|---|
| 1 (foundational) | B1, B2, B3, B4 | +60 to +90 |
| 2 (cell + derived) | B5, B6, B7, B8 | +50 to +80 |
| 3 (validator + surface) | B9, B10, B11, B12, B13 | +60 to +100 |
| 4 (engine) | B14, B15, B16, B17 | +40 to +70 |
| 5 (cross-cutting) | B18, B19, B20, B21, B22 | +30 to +60 |
| **Total** | **22 steps** | **+240 to +400** |

A1b-close baseline forecast: ~9,050 to ~9,200 pass tests, depending on Step 12 (existing-test deltas, A1a tail) churn.

---

## §5 Sequencing rationale

**Strict dependencies:**
- B1 (symbol table) before everything — foundational
- B2, B3 are siblings off B1, can run in parallel-dispatch shape if needed
- B5 depends on B1 + AST shapes from A1a Steps 4-6 (already done)
- B6 depends on B5
- B7 depends on B3 (`@name` resolution provides the dep edges)
- B8 depends on B7 (must know which cells are derived) + Step 11.5 (unified state-decl kind for L21 walk)
- B11/B12 depend on B5 (compound parent classifier) + B10 (validator typer)
- B14 foundational for B15-B17 (engine binding precedes engine typing)
- B18 independent (cross-cutting)
- B19 independent
- B20 independent (type-system layer; touches existing typer)
- B21 depends on B10 (predicate vocabulary)
- B22 depends on B3 (`@name` resolution)

**Parallel-dispatch opportunity:** B18, B19, B20 are independent of the resolver/typer trunk. Could run in parallel-dispatch waves if PA wants to compress wall-time.

**Recommended sequence:**

Wave 1 (foundational): B1 → B2 → B3 → B5 (in series; later steps depend on early)
Wave 2 (typer + dep): B4, B7 in parallel (different concerns); then B6, B8 sequential
Wave 3 (validator + surface): B9 → B10 → B11 → B12 → B13 (sequential)
Wave 4 (engine): B14 → B15 → B16 → B17 (sequential)
Wave 5 (cross-cutting): B18, B19, B20, B21, B22 in parallel (mostly independent)

**Wall-time estimate (sequential):** 85-120 h ≈ 10-15 working days at 8h/day.
**Wall-time estimate (with Wave 2 + Wave 5 parallelism):** 60-85 h.

---

## §6 Risk surface

### §6.1 Architectural risks

- **Resolver may be split across multiple files** — A1b survey-first must locate all of them. Risk: hidden coupling between scope-construction and tag-context-disambiguation.
- **Type system maturity** — current TS-based compiler has type checking but it's pragmatic, not formal. A1b's refinement-type predicate work (§53) may surface gaps.
- **Validator typer is a NEW subsystem** — not extension of an existing one. Higher risk of design churn.
- **Engine typer may be partial today** — current compiler has SOME engine support (per existing samples and tests) but may need substantial extension for v0.next exhaustiveness + cross-file import. Survey-first.

### §6.2 Behavioral risks

- **Test suite breakage on lock firing** — every existing test that USES a now-illegal pattern (e.g., bare-name access to state, multi-statement handler, `===`) will start failing once A1b fires the error. Per S59 user pre-authorization, A1a Step 12 will rewrite or drop these tests; A1b must coordinate with that work to avoid double-work.
- **Validity-surface synthesis cell explosion** — a compound with 10 validators creates 10 × 4 = 40+ synthesized cells. Memory + symbol-table size implications.
- **Cycle-detection performance** — naive cycle detection on a deep import graph or deep derived-DAG can be slow. Use Tarjan or topological-sort with incremental update.

### §6.3 Coordination risks

- **A1a Step 11.5 (FOLD) MUST land before B8** — L21 walker assumes unified state-decl kind. If B8 starts before 11.5, walker has to handle two kinds and gets refactored on 11.5 land.
- **A1a Step 12 (existing-test deltas) overlap** — if Step 12 lands BEFORE A1b, the test suite is already cleaned and A1b's test-write surface is smaller. If after, every A1b step lands tests that may need test-suite rewrites in parallel. PA recommendation: Step 12 lands before A1b begins.

---

## §7 Test invariant strengthening (carry-forward from A1a)

A1a established the **anti-html-fragment guard** as non-negotiable on every Shape-1/2/3 positive test. A1b carries forward AND extends:

- **Anti-folklore guard.** Every lock-firing test asserts BOTH the error code fires AND the diagnostic message contains the lock identifier (e.g., "L21" or "E-DERIVED-VALUE-MUTATE"). Defends against silent-message regressions.
- **Anti-suppression guard.** Every error-firing test asserts that compilation FAILS, not just that a warning is emitted. Defends against severity downgrades.
- **Annotated-AST shape assertions.** Beyond compile-clean, B-step tests assert the annotated-AST carries the resolver-decoration + classifier-flags + dep-graph entries.

---

## §8 What this doc does NOT cover (read elsewhere)

- A1a status — see `docs/changes/phase-a1a-lex-parse/AST-CONTRACTS-AND-DECOMPOSITION.md`
- A1c (codegen) scope — drafted later, post-A1b ratification
- Per-step BRIEFs — drafted at-dispatch-time, like A1a's per-step briefs
- L21 SPEC text — `compiler/SPEC.md` §6.6.18
- Validity-surface SPEC text — `compiler/SPEC.md` §55
- Engine SPEC text — `compiler/SPEC.md` §51

---

## §9 Ratified decisions (S60 — user verbatim "ratify all")

1. **[RATIFIED] A1a Step 12 ordering** — Step 12 (existing-test deltas) lands BEFORE A1b begins. **Definitive sequence: Step 11.0b → 11.0c → 11.5 → 12 → 13 → A1b.** Step 13 wraps A1a; A1b begins after.

2. **[RATIFIED, carries from S60 ADR] Step 11.5 (Option A FOLD) ordering** — AFTER Step 11 BEFORE Step 12. The dual-path L21 walker (B8) only needs single-kind walk after fold lands.

3. **[RATIFIED] A1b dispatch granularity** — identical per-step pattern as A1a. One B-step per dispatch, PA cherry-pick to main between, per-step branch `phase-a1b-step-bN-<slug>`, per-step doc dir `docs/changes/phase-a1b-step-bN-<slug>/` with BRIEF + progress.md.

4. **[RATIFIED] Wave parallelism** — serial within waves; selective parallel-dispatch on Wave 5 (B18-B22) where file-touch independence is verified. Wave 2 (B5-B8) strictly serial (B5 ⇒ B6, B7 ⇒ B8). **Cap: 2-3 concurrent agents max at peak Wave 5.** PA writes briefs + cherry-picks + pushes; this is the throughput ceiling without quality loss.

5. **[RATIFIED, with deferred final call] Validator typer placement** — PA leans new file `compiler/src/validators.ts`. **Final call deferred to B9 dispatch survey** — depth-of-survey discount has hit 8× and may surface that existing infra is more amenable to extension than expected. The B9 dispatch is authorized to make the call based on survey findings.

6. **[RATIFIED] Refinement-type scope (B21)** — subset for A1b: static-zone literal-conformance + boundary-zone hook recording. Trusted-zone elision deferred to A1c C16 OR post-v0.2.0 optimization. Saves ~+8h on B21. **Full SPARK three-zone is a v0.3.0 candidate.**

7. **[RATIFIED] Step count** — 22 steps (B1-B22). Per-step focus is the methodology that's been working through A1a (depth-of-survey discount × 8 + clean dispatches × 7). Compression would re-bundle multi-concern work; declined.

---

---

## §10 Self-host parity + branch-naming policy

**Self-host parity (carry-forward from A1a Steps 4-7):** `compiler/self-host/ast.scrml` + sibling self-host modules are out-of-sync by design at this phase. v0.next is the engineering target; once the TS compiler implements v0.next end-to-end (A1a + A1b + A1c COMPLETE), self-host parity is restored as a separate dispatch (likely Phase A2+ scope). **A1b dispatches do NOT mirror to self-host unless survey reveals self-host has independent code paths producing the relevant AST/diagnostics that ALSO need v0.next behavior.** Document any divergence in per-step `progress.md`.

**Per-step branch naming:** `phase-a1b-step-bN-<slug>` (parallel to A1a's `phase-a1a-step-N-<slug>`). The `b` prefix on the step number disambiguates from A1a step numbers when both phases' branches coexist briefly.

**Per-step doc directory:** `docs/changes/phase-a1b-step-bN-<slug>/` containing `BRIEF.md` + `progress.md`.

---

## §11 Engine subsystem survey-first warning

The current TS compiler has SOME engine support (`<engine>` element parses; transitions exist; samples 14, 18 use engines). **Extent of v0.next engine compliance is UNKNOWN at draft time.** B14-B17 may surface gaps requiring spec → implementation drift work — concretely:

- **Cross-file engine import (M18)** — may not be implemented today. If absent, B14 expands to also include the parser+resolver work for `import { MarioMachine } from './engines.scrml'` then `<MarioMachine/>` mount.
- **Auto-declared engine variable (M16)** — unknown.
- **`derived=expr` engine attribute (L20)** — unknown.
- **`<onTransition from=A to=B>`** — partial today; v0.next semantics unknown.
- **Components-vs-engines distinction (M20, E-COMPONENT-ENGINE-SCOPE)** — likely not enforced today.

**Mitigation:** B14 dispatch brief MUST include a substantial survey-first phase enumerating which engine semantics are already implemented vs what gaps need filling. Cost forecasts for B14-B17 are therefore wider than other waves (15-22h is the documented range; +6-10h additional contingency reasonable).

---

## §12 Diagnostic infrastructure note

A1b uses the **existing compiler diagnostics infrastructure** — there is no new diagnostics subsystem to build. B-step dispatches focus on producing the right AST decoration + firing the right diagnostic at the right place. The infra (file:line ranges, error codes, severity, message templates) is already in place from prior compiler work.

**Inline error-message templates** for new error codes (not present in §34) need to be added to whatever template registry the compiler uses. Survey at first lock-firing dispatch (B2 or B4).

---

## §13 Tags

#phase-a1b #scope-doc #resolve-type #decomposition #22-steps #80-120h #ratified-s60 #step-10-folded-in #b8-dual-path-walker #self-host-parity-deferred #wave-5-selective-parallel #refinement-zone-subset
