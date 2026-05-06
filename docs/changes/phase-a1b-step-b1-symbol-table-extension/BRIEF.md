# Phase A1b Step B1 — Symbol-table extension for V5-strict

**Status:** DRAFT — first dispatch of Phase A1b. Authorized by S62 user "go" 2026-05-05.
**Estimate:** 5-7h focused work per A1b SCOPE-AND-DECOMPOSITION §4.1. Survey may discount (depth-of-survey discount has hit 9× in A1a).
**Authority:** SPEC §3 V5-strict-per-context table, §6.1 V5-strict access principle, §6.3 Variant C compound. A1b SCOPE-AND-DECOMPOSITION §3.1 (resolver subsystems) + §4.1 (Wave 1 foundational) + §4.2 (cell + derived; B1 powers B5+).
**Predecessor:** Phase A1a COMPLETE at S61 (`4b7e27d`). All 20 sub-steps done; tests baseline 8902/44/1/0/8947/439.
**Successor (immediate):** B2 (V5-strict bare-name resolution + E-NAME-COLLIDES-STATE) depends on B1.

---

## §1 What lands

A **per-scope state-cell symbol table** that registers every `state-decl` AST node (both `structuralForm:true` `<x> = init` and `structuralForm:false` legacy `@x = init`) into its containing scope. Distinguished from local-let/const tables. Compound (Variant C) parents register the parent name; child cells register on the parent's sub-scope under qualified-path keys.

**Before B1:**
- The compiler has Stage 3.05 NR (Name Resolver) at `compiler/src/name-resolver.ts` (~494 lines) that classifies tag-bearing nodes (markup, state-types, lifecycle, components, html) but does NOT maintain a scope-aware state-cell registry suitable for V5-strict bare-name vs `@name` resolution.
- There is NO `symbol-table.ts` or per-scope state-cell registry. Type-system has some scope concept (`compiler/src/types/ast.ts:662` "State type scope for functions inside state constructor defs") but not generalized.
- No annotated AST decoration carries "this `@name` resolved to state-cell X in scope Y."

**After B1:**
- A symbol-table data structure that holds, per scope: `{ stateCells: Map<name, StateCellRecord>, parent: Scope | null, kind: ScopeKind }`.
- Every `state-decl` node visited produces a registration. Variant C compound parents register the parent + recursively register children with qualified paths (e.g., `signup`, `signup.name`, `signup.email`).
- The output is a new sub-pass (or extension of NR) producing `FileAST` decorated with: a per-file root scope, scope objects attached to each block-introducing node (function bodies, engine bodies, component bodies), and a state-cell record on each `state-decl` carrying its symbol-table identity.
- This is **infrastructure only** — B1 fires NO diagnostics. B2 onward fires the first diagnostics (E-NAME-COLLIDES-STATE).

---

## §2 Scope

### §2.1 In-scope

1. **Symbol-table data structure.** Add a new module `compiler/src/symbol-table.ts` (or extend `name-resolver.ts` if survey reveals a cleaner extension point). Public types:
   - `StateCellRecord { name, declNode, scope, qualifiedPath, structuralForm, shape, isConst, isPinned, isCompoundParent, isCompoundChild, hasValidators, hasDefaultExpr, hasTypeAnnotation }`.
   - `Scope { kind: ScopeKind, parent: Scope | null, stateCells: Map<string, StateCellRecord>, qualifiedPath: string }`.
   - `ScopeKind = "file" | "function" | "engine" | "component" | "compound"`.
2. **Scope-construction walker.** Walks `FileAST` and constructs a tree of `Scope` objects:
   - File-level root scope.
   - Function body → child scope (kind `"function"`).
   - Engine body → child scope (kind `"engine"`).
   - Component body → child scope (kind `"component"`).
   - Variant C compound parent → child scope (kind `"compound"`).
3. **State-cell registration.** Each `state-decl` walked registers into its containing scope's `stateCells` map:
   - Both `structuralForm:true` (`<x> = init`) and `structuralForm:false` (`@x = init`, legacy) register.
   - Variant C compound parents register the parent name AND recursively register children — child registrations land in the parent's `compound`-kind sub-scope, with `qualifiedPath` like `signup.name`.
   - **§S11D.5 .todo absorption:** B1's compound-aware registration handles top-level Variant C compound automatically — when the parser eventually emits the AST shape (currently held as .todo at A1a), B1's symbol-table walker is already prepared. No B1 work blocks on the parser fix; the .todo lifts to a parser-only follow-up if/when prioritized.
4. **Annotated-AST decoration.** Each `state-decl` node gains a back-pointer to its `StateCellRecord`. Each scope-introducing node (FunctionDecl, MachineDecl/Engine, ComponentDecl, compound parent) gains a `_scope` reference. (Field name `_scope` underscore-prefixed to mark as compiler-internal annotation per existing convention.)
5. **Pipeline wiring.** Insert as a new sub-stage between MOD (Stage 3.1) and CE (Stage 3.2), OR fold into NR (Stage 3.05) by extending NR's walker. **Survey decides.** PA leans new sub-stage `Stage 3.06 SYM` if NR's classification work is cleanly separable from state-cell registration; leans NR-extension if there's substantial node-walk overlap.
6. **Public API.** Export functions for B2-B22 consumers:
   - `lookupStateCell(scope: Scope, name: string): StateCellRecord | null` — walks parent chain.
   - `lookupQualifiedStateCell(scope: Scope, path: string[]): StateCellRecord | null` — for `@signup.name` resolution.
   - `getScopeForNode(node: ASTNode): Scope | null` — reverse lookup.
7. **Tests.** Per §4 below — invariant tests that the symbol table is constructed correctly. NO error-firing tests (those are B2+).
8. Update progress.md + cumulative log.

### §2.2 Out-of-scope (handled by later B-steps)

- **E-NAME-COLLIDES-STATE** detection (B2).
- **`@name` resolver decoration** of ExprNode read sites (B3).
- **Import binding / `pinned` cycle detection** (B4).
- **Cell classifier flags** (`bindable`, `markup-typed`) (B5).
- **Render-by-tag E-CELL-NO-RENDER-SPEC** (B6).
- **Derived dep DAG** (B7).
- **L21 walker** (B8).
- **Validator typer** (B9-B13).
- **Engine typer** (B14-B17).
- **Cross-cutting** (B18-B22).
- **Self-host parity** — defer per Phase A1a Steps 4-7 policy. v0.next is engineering target; self-host catches up at A2+ scope.
- **Synthesized validity-surface cells** (`@compound.isValid`, etc.) — register at B11/B12 land time. B1 does NOT pre-register these; the symbol-table API must be re-entrant so B11/B12 can add records to existing scopes.
- **Synthesized-name reservation logic** — B1 records nothing about reserved names; B11/B12 + B8 enforce `E-SYNTHESIZED-WRITE`.

---

## §3 Survey-first mandate (depth-of-survey discount; **9× pattern likely applies**)

A1a's depth-of-survey discount fired 9 times. B1 has high-prior chance of similar discount: NR may already do more state-cell-aware work than the audit assumes; type-system may have a proto-symbol-table; ast-builder may already attach scope info we can leverage.

**Survey questions (answer in `progress.md` BEFORE source edits):**

1. **Existing scope concept.** `compiler/src/types/ast.ts:662` mentions "State type scope for functions inside state constructor defs." How extensive is this concept today? Is it generalized scope-tree or constructor-defs only? File:line for the implementation if any.
2. **NR's state-decl handling.** Does `name-resolver.ts` currently visit `state-decl` nodes at all? If yes, does it record anything per-scope? If no, would extending NR to also walk state-decls add coupling, or is the walker already structured to accommodate?
3. **Variant C compound walking.** A1a Step 11.0a established `state-decl.children: ReactiveDeclNode[]` for compound parents. Is there an existing recursive walker for `children` that B1 can reuse, or does B1 need its own?
4. **Function/engine/component body walking.** What walker visits FunctionDecl bodies, MachineDeclNode bodies, ComponentDecl bodies today? Does it traverse uniformly, or are there separate per-kind walkers? B1 needs uniform-traversal infrastructure.
5. **Annotated-AST decoration convention.** Looking at NR's `resolvedKind`/`resolvedCategory` decoration, what's the existing convention for adding compiler-internal annotation fields to AST nodes? Underscore-prefix? Side-table? B1 should match.
6. **Pipeline insertion point.** Should B1 land as new Stage 3.06 SYM between MOD and CE? Or as an extension of NR (Stage 3.05)? PIPELINE.md naming convention check at `compiler/PIPELINE.md` Stage 3.05 section. Recommend the insertion point in `progress.md` BEFORE source edits.
7. **Test infrastructure.** Where do current parser/AST tests live? Likely `compiler/tests/integration/parse-shapes-v0next.test.js` or unit-tests under `compiler/tests/unit/`. How would symbol-table assertions naturally compose — separate test file `compiler/tests/integration/symbol-table.test.js`, or extend an existing AST test?
8. **`@`-prefix preservation in `name` field.** Per A1a Step 10, `ident.name` preserves `@` verbatim. Verify state-decl `name` field stores **without** the `@` prefix (B1 needs the bare identifier for symbol-table key) — or document the canonical form so the registration normalizes consistently.

**You are AUTHORIZED to correct the touchpoint** if survey reveals divergent locus or smaller surface than this brief assumes. Per S60+S61 pattern, the survey-first phase is the time to push back on the brief if survey shows it's wrong.

---

## §4 Test plan

### §4.1 Symbol-table construction invariants (`compiler/tests/integration/symbol-table.test.js` or extend existing)

§B1.1: file-level state-decl registers in file scope.
- Input: `<count> = 0` at top level.
- Assert: `fileAST._scope.stateCells.has("count")`. Record fields: `structuralForm:true`, `shape:"plain"`, `isConst:false`.

§B1.2: legacy @-form state-decl registers in same scope.
- Input: `${ @count = 0 }` at top level (inside `<program>`).
- Assert: scope contains "count" with `structuralForm:false`.

§B1.3: function body creates child scope.
- Input: `function foo() { @x = 1 }` (or scrml-equivalent).
- Assert: function-body scope is child of file scope; "x" registered in function-body scope, NOT file scope.

§B1.4: Variant C compound parent + children register correctly.
- Input: `<formRes>\n  <name> = ""\n  <email> = ""\n</>`.
- Assert: file scope has "formRes" (compound parent). Compound sub-scope has "name" + "email". Qualified paths: `formRes.name`, `formRes.email`.

§B1.5: nested compound supports qualified-path registration.
- Input: `<outer>\n  <inner>\n    <leaf> = ""\n  </>\n</>`.
- Assert: qualified paths `outer`, `outer.inner`, `outer.inner.leaf` all resolvable via `lookupQualifiedStateCell`.

§B1.6: derived cell registers with `isConst:true` + `shape:"derived"`.
- Input: `<count> = 0`; `const <doubled> = @count * 2`.
- Assert: "doubled" record has `isConst:true`, `shape:"derived"`.

§B1.7: pinned modifier captured in record.
- Input: `<chatMachine pinned> = ...` (or whatever Step 6's pinned-on-decl form is).
- Assert: record's `isPinned:true`.

§B1.8: typed-decl annotation captured.
- Input: `<count>: number = 0`.
- Assert: record's `hasTypeAnnotation:true`.

§B1.9: validator presence captured.
- Input: `<email req email> = <input type="email"/>`.
- Assert: record's `hasValidators:true`.

§B1.10: defaultExpr presence captured.
- Input: `<startTime default=null> = Date.now()`.
- Assert: record's `hasDefaultExpr:true`.

§B1.11: lookupStateCell walks parent chain.
- Input: file-level `<count> = 0`; function body that does NOT redeclare; query inside function body.
- Assert: `lookupStateCell(functionScope, "count")` returns the file-scope record.

§B1.12: scope of distinct kinds receives correct ScopeKind label.
- Input: file with one function-decl, one engine-decl, one component-decl.
- Assert: each block's scope has the corresponding ScopeKind.

§B1.13: empty compound parent registers without children.
- Input: `<empty>\n</>`.
- Assert: parent registered; sub-scope exists but has empty stateCells map.

§B1.14: getScopeForNode reverse-lookup works.
- Input: any test fixture; pick a state-decl node; call `getScopeForNode(node)`.
- Assert: returns the scope where the cell is registered.

§B1.15: re-entrancy invariant — simulating B11 adding records post-B1.
- Construct file AST; build symbol table; programmatically add a synthesized record; assert lookup returns it. (Validates re-entrancy contract for B11/B12 future work.)

### §4.2 Existing-test no-regression invariant

Full `bun run test` MUST pass with **0 regressions** on existing 8902/44/1/0/8947/439 baseline. Any pre-existing test newly broken by B1's pass insertion is a B1 regression — not a wave-2 finding.

### §4.3 Anti-folklore guard

For each invariant test, assert BOTH the symbol-table state AND the underlying record-field shape (not just "exists"). Defends against silent-shape regressions when B2+ extends the records.

---

## §5 Definition of done

1. ✅ Symbol-table data structure defined (`StateCellRecord`, `Scope`, `ScopeKind`).
2. ✅ Scope-construction walker covers file / function / engine / component / compound scope kinds.
3. ✅ Every `state-decl` (both `structuralForm:true` and `structuralForm:false`) registered into its containing scope.
4. ✅ Variant C compound parent + children correctly registered with qualified paths.
5. ✅ Public API (`lookupStateCell`, `lookupQualifiedStateCell`, `getScopeForNode`) exported and tested.
6. ✅ Pipeline wiring landed at chosen insertion point (Stage 3.06 SYM OR NR-extension; survey decides).
7. ✅ ~12-15 new invariant tests landing in §B1 block; full `bun run test` 0 regressions.
8. ✅ progress.md updated with cumulative log + survey findings + insertion-point decision rationale.
9. ✅ Self-host parity: NO-OP per A1a Steps 4-7 policy.
10. ✅ Branch clean. NO `--no-verify`.
11. ✅ Test count delta: ~+12 to ~+15. Final count target: ~8914-8917 / 44 / 1 / 0 / 8959-8962 / 440 (+1 file: new symbol-table test).

---

## §6 Risk surface

- **Symbol-table-as-new-subsystem risk.** This is the single biggest design-churn risk in B1. Survey-first is mandated to push back if NR or type-system already has the right substrate.
- **Compound qualified-path key collisions.** If two compound parents have a child of the same name (e.g., `<a><x>=0</>` and `<b><x>=0</>`), the qualified paths must be `a.x` and `b.x`, not collide on `x`. Verify the design key-shape uses qualified paths AS the Map key, not just leaf names.
- **`@`-prefix normalization edge case.** State-decl `name` field MUST NOT contain `@` prefix in the symbol-table key. If it does (legacy `@x = init` form may store the prefix), normalize at registration time and document.
- **Scope-walker missing kind.** Engine state-children, match arms, errors-of bodies — these may introduce new sub-scopes that B1 doesn't enumerate. Survey must catch; if missed, B14-B17 (engine typer) will surface the gap.
- **Re-entrancy contract.** B11/B12 will add synthesized validity-surface cells post-B1. The symbol-table API must support add-after-construction. Don't freeze scopes after B1 builds them.
- **NR coupling.** If B1 lands as NR-extension, ensure NR's existing classification work still produces correct `resolvedKind`/`resolvedCategory` outputs. NR's category routing IS authoritative downstream — B1 must not regress it.
- **Annotated-AST mutation invariant.** B1 mutates the AST by attaching `_scope` and `_record` fields. If any downstream consumer freezes the AST (e.g., for serialization or LSP cache), the freezing must happen AFTER B1.
- **Performance.** Per NR's "<= 5ms per file" budget, B1 should add no more than ~1-2ms (single AST traversal + Map inserts). Validate informally if the test suite slows noticeably.

---

## §7 Branch + commit hygiene

- Per-step branch: `phase-a1b-step-b1-symbol-table-extension`, parented from main HEAD at dispatch time (`4b7e27d` at brief draft time).
- WIP commits expected (incremental per `pa.md` Background Agents directive):
  - `WIP(a1b-step-b1): survey + insertion-point decision`
  - `WIP(a1b-step-b1): symbol-table types + Scope construction`
  - `WIP(a1b-step-b1): state-decl registration walker`
  - `WIP(a1b-step-b1): compound qualified-path support`
  - `WIP(a1b-step-b1): pipeline wiring + annotated-AST decoration`
  - `WIP(a1b-step-b1): tests §B1.1-§B1.15`
  - Final: `compile(a1b-step-b1): symbol-table extension for V5-strict`
- Commit early and often. Hand-off + progress.md log every step. WIP commits expected.

---

## §8 PA cherry-pick + integration pattern

Per A1a established pattern:
1. Agent dispatches in worktree, lands all WIP commits + final commit on per-step branch.
2. Agent reports done with: final commit SHA, test counts, files modified, survey findings, insertion-point decision.
3. PA cherry-picks the branch onto main (after user authorization for the cherry-pick).
4. PA confirms tests stable on main post-cherry-pick.
5. PA updates `master-list.md` + `docs/changelog.md` at session-close (or per-step if appropriate).

---

## §9 Worktree + path discipline

Per `pa.md` §"Worktree-isolation: startup verification + path discipline":

The dispatch brief MUST include the absolute worktree path + the F4 path-discipline block verbatim. Agent MUST:
1. Run `pwd` — output equals worktree root.
2. Run `git rev-parse --show-toplevel` — equals worktree root.
3. Run `git status --short` — clean tree.
4. Run `bun install` — fresh worktrees don't inherit node_modules.
5. Run `bun run pretest` — populate `samples/compilation-tests/dist/` so browser tests don't ECONNREFUSED.
6. Confirm baseline `bun run test` passes (8902/44/1/0/8947/439).
7. **All Write/Edit calls use absolute paths under WORKTREE_ROOT.** No relative paths. No main-rooted absolute paths.

---

## §10 Tags

#phase-a1b #step-b1 #symbol-table #v5-strict #foundational #wave-1 #depth-of-survey-mandate #s11d5-todo-absorbed #re-entrancy-contract
