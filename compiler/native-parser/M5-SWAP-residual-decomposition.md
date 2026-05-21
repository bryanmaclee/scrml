# M5-swap residual-work decomposition

> **⚠ SUPERSEDED S117 (2026-05-21).** This Phase-0 decomposition's R1-R5 / 46-78h
> estimate was itself under-counted — R1 + R2 surfaced that DD #27's F2-RETIRE
> (expression catalog) and F3 (hoist) were both incomplete, and the native-parser
> Tier-B feature gaps were never scoped. The honest re-decomposition is
> `scrml-support/docs/deep-dives/m5-swap-redecomposition-2026-05-21.md` (corrected
> total 96-160h; swap deferred to v0.7). Use that document, not this one.

status: superseded
superseded-by: scrml-support/docs/deep-dives/m5-swap-redecomposition-2026-05-21.md
last-reviewed: 2026-05-21
date: 2026-05-21 (S117)
authority: BRIEF-M5-SWAP.md Phase 0 STOP GATE · DD #27
companion: M5-divergence-ledger.md (the refreshed per-feature ledger)

The M5-swap brief Phase 0 STOP GATE: *"if the residual swap work exceeds ~14h
— i.e. the F1/F7/F8 bridge did NOT close the divergence and real bridge work
remains — STOP, write the refreshed ledger + a residual-work decomposition,
and report."*

The residual is **46-78h**. This document decomposes it into independently
dispatchable units so PA can re-scope. The STOP GATE is tripped; no swap code
was written.

---

## Why the premise missed

DD #27 (Shape α, ratified S115) compressed the MD ladder. Its F2 row —
"ESTree decorations: RETIRE" — was graded against `emit-expr.ts` and concluded
the downstream codegen walks the **native ExprNode catalog** already. That is
**correct and confirmed** — the *expression* layer needs no bridge.

But DD #27 collapsed MD.2 entirely to that expression-ESTree retirement
(3-5h). It did not separately price two surfaces:

1. The **statement** catalog. The native `parseProgram` emits a PascalCase
   ESTree-shaped `Stmt[]` (`VarDecl`/`If`/`For`/...). The live `logic` node
   carries a scrml-specific lowercase `LogicStatement[]` union
   (`let-decl`/`if-stmt`/`for-stmt`/...). 37 downstream files walk the live
   union by lowercase kind. This catalog is NOT a case-rename — it is an
   N×M structural translation.
2. The **declaration hoisting** of `<type>` / component-def / `<engine>`.
   `collect-hoisted.js` returns those three collections as hard-coded empty
   (its own v0.5 header says so). DD #27 F3 graded "hoisted collections:
   BRIDGE-LIGHT, ~60 LOC transplant" — but the transplant only covers
   import/export/channel; the type/component/engine slice needs native
   declaration-kind recognition that does not exist.

Neither is a fault of the F1/F7/F8 dispatches — those closed exactly their
briefed scope (attrs, state/sql/css, error/meta). The gap is in DD #27's
compression accounting, surfaced now by the Phase 0 re-survey as the brief
intends.

---

## Residual unit decomposition

### Unit R1 — statement-catalog bridge (native `Stmt[]` → live `LogicStatement[]`)

**Estimate: 18-30h.** The single largest residual; alone exceeds the STOP-GATE
threshold.

Scope:
- Author the native-`StmtKind` → live-`LogicStatement.kind` map. Non-trivial
  per-kind: `VarDecl{kind:"let"|"const"}` → `let-decl`/`const-decl`; native
  ESTree `If{test,consequent,alternate}` → live `if-stmt{cond,then[],else[]}`
  (array-shaped branches); `For`/`ForIn`/`ForOf` → `for-stmt` variants;
  `ExprStmt` → `bare-expr`; `FunctionDecl` → `function-decl`; `Return` →
  `return-stmt`; `Throw` → (scrml has no throw — must reconcile against the
  forbidden-vocabulary rule); the scrml-only kinds `tilde-decl` / `lin-decl` /
  `reactive-decl` / `lift-expr` / `fail-expr` / `propagate-expr` /
  `guarded-expr` need their native productions identified and mapped.
- Decide WHERE the translation lives: inside `nativeParseFile` (adapter) vs a
  native-parser exit-shaping pass. Adapter-side keeps the native parser pure;
  exit-shaping aligns with M6's "native parser IS the front-end."
- Verify against the 37 `logic.body` consumer files — codegen `emit-logic.ts`
  is the deepest (dispatches ~40 lowercase kinds).
- Tests: per-kind translation unit tests + a corpus diff.

**Dependency:** none — can dispatch immediately.

### Unit R2 — declaration hoist gap (type / component / engine)

**Estimate: 10-16h.**

Scope:
- The native parser parses `<type>` / component definitions / `<engine>` as
  markup + state-shape constructs but emits no hoistable top-level
  declaration kind. Either (a) add native declaration-kind productions, or
  (b) extend `collect-hoisted` to recognize them from the Markup/LogicEscape
  block stream. Option (b) is lighter and M6-neutral.
- Extend `collectHoisted` to populate `typeDecls`/`components`/`machineDecls`.
- Verify the `name-resolver.ts` / `symbol-table.ts` / `component-expander.ts` /
  `auth-graph.ts` consumers see the populated collections.
- Tests: hoist-walk unit tests against type/component/engine exemplars.

**Dependency:** none — file-disjoint from R1; can dispatch in parallel.

### Unit R3 — FileAST assembler (`nativeParseFile`)

**Estimate: 6-10h** (thin ONLY once R1 + R2 land; blocked otherwise).

Scope:
- Build `nativeParseFile(filePath, source)` → `{ filePath, ast: FileAST, errors }`.
- Map Block-stream PascalCase kinds → `ast.nodes` lowercase ASTNode union
  (`Markup`→`markup`, `Text`→`text`, `Comment`→`comment`, `Sql`→`sql`,
  `Css`→`css-inline`, `Meta`→`meta`, `ErrorEffect`→`error-effect`,
  `LogicEscape`→`logic`).
- Assemble the hoisted collections (uses R2's collectHoisted output).
- Produce the top-level `FileAST` shape. PRECG (Stage 3.004) then derives
  has*/authConfig/middlewareConfig pipeline-agnostically — no extra work.

**Dependency:** R1 + R2 (it consumes both their outputs).

### Unit R4 — SPEC §34 reconciliation (the Phase 1 STOP-GATE work)

**Estimate: 6-12h.** Independent of R1-R3. The native parser fires ~66
diagnostic codes (`E-EXPR-*` ~32, `E-STMT-*` ~34) not in SPEC §34. Once the
pipeline swaps, these become adopter-visible. This is the brief's Phase 1 —
itself gated by a second STOP GATE (the family-level approach must be PA-
ratified before 66 catalog rows are written).

**Dependency:** none — can dispatch in parallel with R1/R2. Should run before
R3's swap lands (a routed code with no §34 row is a spec divergence).

### Unit R5 — the swap wiring + canary + conformance promotion

**Estimate: 6-10h.** The actual api.js routing (Phase 2) + the dual-pipeline
canary + conformance promotion (Phase 3). This is the ~6-12h the DD #27
premise assumed was the WHOLE swap — it is in fact only the final unit.

**Dependency:** R1 + R2 + R3 + R4 all landed.

---

## Dispatch ordering

```
R1 (stmt bridge)  ──┐
R2 (hoist gap)    ──┼──> R3 (FileAST assembler) ──> R5 (swap + canary)
R4 (§34 recon)    ──┘                              ↗
                       (R4 lands before R5)
```

R1 ∥ R2 ∥ R4 (file-disjoint). R3 needs R1+R2. R5 needs all of R1-R4.

## Residual total

| Unit | Estimate |
|---|---|
| R1 — statement-catalog bridge | 18-30h |
| R2 — declaration hoist gap | 10-16h |
| R3 — FileAST assembler | 6-10h |
| R4 — SPEC §34 reconciliation | 6-12h |
| R5 — swap wiring + canary + conformance | 6-10h |
| **TOTAL** | **46-78h** |

vs the DD #27 swap premise of **6-12h**.

---

## Recommendation to PA

The M5-swap brief premised a single ~6-12h dispatch. The re-survey shows the
swap is genuinely a **multi-unit milestone (46-78h)** — the F-units closed the
parser-side block-payload work but the catalog-reconciliation tier
(statements + declarations) was under-counted by DD #27's MD-ladder
compression.

Three paths for PA:

1. **Re-scope M5-swap as a 5-unit sub-milestone** (R1-R5) and dispatch R1/R2/R4
   in parallel as the next wave, R3 then R5 after. This is the
   right-answer-beats-easy-answer path (pa.md Rule 3) — it does not absorb a
   hidden MD-ladder remnant into one over-budget dispatch.
2. **Targeted DD-#27 corrigendum** — a short deep-dive amending the MD.2 +
   MD.3 accounting to add the statement-catalog tier + the type/component/
   engine hoist, then a fresh scope-lock. Warranted because DD #27 is the
   ratified authority and its compression table is now known-incomplete.
3. **Defer M5-swap to v0.7** and ship v0.6 without the pipeline swap (v0.6
   keeps the F1/F7/F8 bridge-lights as landed; the swap waits for the
   catalog tier). DD #27's own Open Question #6 surfaced a comparable
   F7-deferral compromise — but for the *swap* itself, not F7.

**Recommended: path 1** — re-scope as R1-R5, dispatch R1/R2/R4 in parallel.
The decomposition is clean (file-disjoint units, explicit dependency DAG) and
each unit is independently dispatchable + verifiable. Path 2 adds a research
cycle that the Phase-0 re-survey has largely already done (this document IS
the corrigendum content); path 3 leaves v0.6 without its headline milestone.

This dispatch wrote NO swap code, NO SPEC §34 rows. It produced: the refreshed
divergence ledger, this decomposition, and the progress doc. Awaiting PA's
re-scope decision.

## Tags

#scrmlts #m5-swap #phase-0 #stop-gate #residual-decomposition #DD-27
#statement-catalog-bridge #hoist-gap #S117

## Links

- [M5-divergence-ledger.md](./M5-divergence-ledger.md)
- [M5-ast-bridge-scoping.md](./M5-ast-bridge-scoping.md)
- [BRIEF-M5-SWAP.md](../../docs/changes/m5-v0.5-compressed-ladder/BRIEF-M5-SWAP.md)
- [DD #27](../../../scrml-support/docs/deep-dives/m5-m6-scope-revision-2026-05-21.md)
