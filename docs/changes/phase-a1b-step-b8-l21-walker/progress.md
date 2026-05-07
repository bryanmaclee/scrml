# A1b B8 — progress log

Branch: `phase-a1b-step-b8-l21-walker-derived-value-mutate`
Baseline: `bd3a0aa`
Scope: E-DERIVED-VALUE-MUTATE only (E-SYNTHESIZED-WRITE deferred to B11)

## 2026-05-07T00:00 — Phase 0 SURVEY

- Verified worktree, baseline `bd3a0aa`, branch created.
- `bun install` + `bun run pretest` clean.
- Survey written to `SURVEY.md`. Findings:
  - E-DERIVED-WRITE has spec definition but NO implementation — B8 lands a fresh PASS 6, structured for E-DERIVED-WRITE to join later.
  - AST shape coverage: 3 paths (`reactive-array-mutation` / `reactive-nested-assign` / `bare-expr` with embedded ExprNode patterns).
  - Receiver-root resolution: leverage PASS 3's `_resolvedStateCell` + `lookupQualifiedStateCell` for compound paths.
  - `isConst` flag is reliable on `StateCellRecord`.
- Verdict: CLEAR. Proceed.

Next: Phase 1 — constants module(s) for mutating-method list + compound-assignment list.

## 2026-05-07T00:30 — Phase 1: constants module

- Added `compiler/src/derived-mutation-ops.ts`:
  - `ARRAY_MUTATING_METHODS` (9 names per §6.5.1, frozen set)
  - `COMPOUND_ASSIGNMENT_OPS` (14 forms per §6.6.18, frozen set)
  - `isDerivedMutatingAssignOp`, `isArrayMutatingMethod` helpers
- Committed.

## 2026-05-07T01:00 — Phases 2-5: PASS 6 walker

- Added `walkDerivedValueMutate` to symbol-table.ts as PASS 6.
- Three AST shape paths handled:
  - `reactive-array-mutation` (specialized lowering)
  - `reactive-nested-assign` (specialized, '=' only)
  - `bare-expr` containing `assign` / `call` / `unary` ExprNodes
- Helpers added: `leafIdentInChain`, `collectMemberPath`, `buildReceiverPath`,
  `findDeepestRegisteredOnPrefix`, `scanPrefixesAndFireAssign`,
  `checkExprNodeForMutations`, `checkReactiveArrayMutation`,
  `checkReactiveNestedAssign`, `spanFromMutationNode`, `formatReceiver`,
  `fireMethodCall`, `firePropertyAssign`, `fireDelete`.
- Wired into `runSYM` after PASS 5.
- Initial test surface revealed receiver-path bug: `target.kind === "member"`
  property segment was being included in receiver path instead of stopping at
  `target.object`. Fixed by walking from `n.target.object` for assigns and
  `n.argument.object` for delete.
- Full test suite still passes (0 fail).

## 2026-05-07T01:30 — Phase 6: tests

- `compiler/tests/unit/derived-value-mutate.test.js` written — 47 tests:
  - §B8.1 case 1 — 9 mutating methods (each fires) + 3 negatives
  - §B8.2a — plain `=` on derived (fires) + non-derived (doesn't)
  - §B8.2b — 12 compound-assign ops (each fires); 3 bit-shift forms `.skip`
    with parser-deferred rationale (parser today splits `<<=` as `<<` + `=`
    inside `${...}` due to markup `<` boundary)
  - §B8.2c — delete (fires) + computed-index delete (fires) + non-derived (doesn't)
  - §B8.3 case 3 — in-compound derived sub-cell (4 tests `.skip` with
    rationale: parser declines `const`-inside-compound path today per S11A.8;
    walker logic IS correct, activates when parser support lands)
  - §B8.3-neg — non-derived in-compound (does NOT fire) — passes
  - §B8.4 — E-DERIVED-WRITE territory (`@derived = newval`) does NOT fire B8
  - §B8.5 — computed-index assign (fires for derived; doesn't for non-derived)
  - §B8.6 — multi-segment receiver — `.skip` (parser-deferred, see §B8.3)
  - §B8.7 — negatives: bare-name no-@, reads, destructuring, local copies
  - §B8.8 — diagnostic shape (code/severity/span/message references §6.6.18)
  - §B8.9 — multiple mutations fire independently
- 39 pass, 8 skip (parser-deferred), 0 fail.

## 2026-05-07T02:00 — Phase 7: primer §13.7 update

- Added B8 row to the annotated-AST contracts table.
- Added "B8 specifics" block: PASS 6 walker description, three AST shape
  paths, mutating-method/compound-assign catalog reference, receiver-chain
  resolution, same-pass affordance for E-DERIVED-WRITE, E-SYNTHESIZED-WRITE
  B11 deferral note, in-compound `const <derived>` parser-deferred note,
  markup-typed uniform handling.

## 2026-05-07T02:15 — Phase 8: final tests

- Full `bun test`: 9129 pass, 52 skip, 1 todo, 0 fail. Up from baseline
  9090 → 9129 = +39 new passing (the +8 skip are parser-deferred B8 tests).
- 0 regressions.

## Summary

- Branch: `phase-a1b-step-b8-l21-walker-derived-value-mutate`
- Tests added: +47 (39 pass, 8 skip, 0 fail).
- Files changed:
  - NEW `compiler/src/derived-mutation-ops.ts`
  - MOD `compiler/src/symbol-table.ts` (PASS 6 walker added)
  - NEW `compiler/tests/unit/derived-value-mutate.test.js`
  - NEW `docs/audits/...` (audit was pre-dispatch, untouched here)
  - NEW `docs/changes/phase-a1b-step-b8-l21-walker/SURVEY.md`
  - NEW `docs/changes/phase-a1b-step-b8-l21-walker/progress.md`
  - MOD `docs/PA-SCRML-PRIMER.md` (§13.7 B8 row + specifics)
- Deferred items:
  - **E-SYNTHESIZED-WRITE** → B11 (synth-cell registry birthplace per audit §1.3).
  - **E-DERIVED-WRITE** (§6.6.8) — sibling rule, will join PASS 6 when implemented.
  - **In-compound `const <derived>` parse** — parser declines today (per
    `parse-shapes-v0next §S11A.8`); walker handles correctly when AST is shaped.
  - **Bit-shift compound assigns** (`<<=`, `>>=`, `>>>=`) — parser tokenizer
    splits these inside `${...}`; walker handles correctly via
    `COMPOUND_ASSIGNMENT_OPS` set.
- Cost: ~2.5h vs 3-4h estimate (survey-discount path).
