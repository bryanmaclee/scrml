# A1b B16 — Phase-0 Survey Notes

**Session:** 2026-05-07
**Branch:** `phase-a1b-step-b16-derived-engines`
**Spec authority:** `compiler/SPEC.md` §51.0.J (line 20377+), §51.0.F, §51.0.G,
§31.5, §34.

## Survey gates (per BRIEF §7-point brief item 7)

### (a) B14's `engineMeta.derivedExpr` annotation reliability

**Status:** PARTIAL — `derivedExpr` is populated only for the legacy
`derived=@varname` single-source form via `engine-decl.sourceVar` parsing
(`compiler/src/ast-builder.js:8449`). The §51.0.J rich
`derived=match @x { ... }` form is NOT yet structurally parsed by ast-builder.

**Implication:** B16 can detect cycle dependencies via the single-source
`sourceVar` form (a one-edge graph: derived-engine A → upstream cell). For
multi-cell derivation expressions (which the §51.0.J spec text uses), B16
records the derived-engine has *some* derivation but cannot enumerate
upstream reads beyond `sourceVar`. The cycle-detection mechanism is
*fully wired* and *correct against the data B14 produces*; richer expressions
land when ast-builder gains §51.0.J-shape parsing (deferred to future
parser-expansion step).

The `makeEngineRecord` annotation pattern in `symbol-table.ts:3599`:

```ts
const derivedExpr: unknown | null = engineDecl.sourceVar != null
  ? { kind: "legacy-source-var", varName: engineDecl.sourceVar }
  : null;
```

B16 reads `derivedExpr.kind === "legacy-source-var"` and uses `varName` as
the upstream cell.

### (b) §34 catalog rows present for the four B16 errors

**Status:** PASS — all four codes are documented in `compiler/SPEC.md` §34:

| Code | Line | Status |
|---|---|---|
| `E-DERIVED-ENGINE-NO-RULES` | 14234 | OK |
| `E-DERIVED-ENGINE-NO-INITIAL` | 14235 | OK |
| `E-DERIVED-ENGINE-NO-WRITE` | 14236 | OK |
| `E-DERIVED-ENGINE-CIRCULAR` | 14238 | OK |

`E-DERIVED-ENGINE-INITIAL-UNDEFINED` (line 14237) is OUT OF B16 scope — runtime/A1c.

### (c) B7's `detectCycle` API callable from B16's location

**Status:** PASS. `detectCycle(adj, allNodes)` lives at
`dependency-graph.ts:835`. B16 lives in the same file, calls it directly.
B10 (`buildValidatorArgsAdj` at line 765) already established the
"second-consumer" pattern with `buildEngineDerivedAdj` as the natural
sibling.

### (d) Existing walker for direct-write + `.advance` calls

**Status:** PARTIAL — patterns exist in two places:

1. **B8's `walkDerivedValueMutate`** (`symbol-table.ts:2159`) handles
   member-shape chains (`@a.method(...)`, `@a.foo = x`) — i.e. the
   case-1/2 of E-DERIVED-VALUE-MUTATE. Bare-ident assignment
   (`@phase = .X`) is NOT in B8's scope (it's a §6.6.8 E-DERIVED-WRITE
   case, deferred per primer §13.7 B8 specifics).

2. **`type-system.ts:rejectWritesToDerivedVars`** (line 2118) walks
   `bare-expr` nodes and matches `^@varname (op)?=` regex against a
   projected-var allowlist. B16 mirrors this pattern — the regex-match
   on `bare-expr.exprNode` (string-emitted) is *the* canonical detection
   for direct-write to an engine variable.

**Decision:** B16 implements its own walker (mirroring `rejectWritesToDerivedVars`)
rather than extending B8. B8's walker is member-chain-shaped; bare-ident
writes are a different AST profile.

For `.advance(.X)`: AST shape is `bare-expr` containing
`call` with `callee.kind === "member"`, `callee.object.kind === "ident"`
(name `@varname`), and `callee.property === "advance"`. B16 walks
this exact shape.

### (e) `rule=` attribute on state-children of derived engines

**Status:** DEFERRED-IN-DETECTION. The current `parseMachineRules`
(`type-system.ts:2451`) parses rule LINES (`.From => .To [given]
[{effect}]`) inside `engine-decl.rulesRaw`. State-children with `rule=`
attributes (the §51.0.B-J Move 14 syntax) are not yet a parsed shape.

**Implication:** B16 fires `E-DERIVED-ENGINE-NO-RULES` when the rules-body
of a derived engine contains ANY transition rules. Per §51.0.J line
20406, derived engines REJECT `rule=` on state-children — the spec
language is "transitions are determined by the source, not authored",
which we interpret as "any user-authored transition logic is wrong".
A derived engine should have an EMPTY rules body (or only `<onTransition>`
elements + `effect=` per §51.0.J line 20409). When the parser learns
Move 14 syntax, the same walker reads `engine-decl._record` and inspects
state-children for `rule=` attribute presence.

**Decision:** B16 fires NO-RULES when a derived engine's `rulesRaw`
contains any non-empty rule lines (anything that isn't a comment, audit
clause, or an `<onTransition>` block). Best-effort against today's
parser; full attribute-level walking deferred to post-Move-14.

### (f) Existing engine-decl handling in DG

**Status:** ABSENT. `dependency-graph.ts` does not currently know about
engine cells. There is no DG node for engine cells today, no edge
emission. B16 introduces them.

## Implementation Decisions

### DG-side: new edge kind `engine-derived-reads`

To keep the engine-derived cycle subgraph distinct from the derived-cell
read subgraph (§31.5 requires they be reported separately —
`E-DERIVED-CIRCULAR-DEP` for cells, `E-DERIVED-ENGINE-CIRCULAR` for
engines), B16 introduces a **new edge kind** `engine-derived-reads` in
the `DGEdgeKind` union (mirrors B10's introduction of `validator-reads`).

`buildEngineDerivedAdj(edges, nodes)` filters the edge list to only
`engine-derived-reads` edges between `reactive` DG nodes. This isolates
the engine-derived subgraph from cells.

### SYM-side: PASS 11 — derived-engine rejections

A new PASS 11 walker (`walkDerivedEngineRejections`) in `symbol-table.ts`
runs after PASS 10.A/B (engine registration). For each engine-decl with
`engineMeta.derivedExpr !== null`:

1. Fire `E-DERIVED-ENGINE-NO-INITIAL` if `engineMeta.initialVariant !== null`.
2. Fire `E-DERIVED-ENGINE-NO-RULES` for any rule-line in the engine's
   `rulesRaw` body (best-effort against today's parser shape).
3. Fire `E-DERIVED-ENGINE-NO-WRITE` for direct writes:
   - `bare-expr` `assign` with target ident `@<engineVarName>`.
   - `bare-expr` `call` with member-callee `@<engineVarName>.advance(...)`.

Walker dispatched from `runSYMBatch` after engine-cell registration
completes (engines are in scope).

### Cycle detection wiring

`runDG` adds engine cells as `reactive` DG nodes (via the engine-decl's
`_record` annotation set by SYM PASS 10.A). For each derived engine with
`engineMeta.derivedExpr` of `kind: "legacy-source-var"`, B16 emits an
`engine-derived-reads` edge to the upstream cell's DG node. After all
edges are collected, `buildEngineDerivedAdj` + `detectCycle` runs.

Self-references (a derived engine whose `sourceVar` is itself —
unrepresentable today since `derived=@varname` requires a different
variable name to parse, but defensively handled) fire as a degenerate
1-cycle case (mirrors B7 + B10 patterns).

## Out of Scope / Deferred

- **Rich `derived=expr` parsing:** awaits ast-builder Move 14 work.
  When landed, B16's walker reads `derivedExpr` as a parsed expression
  tree and uses `forEachIdentInExprNode` to collect all `@cell` reads.
- **`E-DERIVED-ENGINE-INITIAL-UNDEFINED`:** runtime/A1c (per §34 + brief).
- **General `E-ENGINE-INVALID-TRANSITION`:** B15 (compile-time non-derived)
  and A1c (runtime).
- **State-child structural walking:** awaits Move 14 ast-builder.
- **`<onTransition>` validation:** B17.

