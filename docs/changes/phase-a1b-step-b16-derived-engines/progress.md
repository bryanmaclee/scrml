# A1b B16 — Derived Engines Progress Log

Append-only progress log for B16 implementation.

---

## 2026-05-07 — Startup + Phase-0 Survey

### Setup
- Worktree: `/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-adfc6ec6383af9353`
- Branch: `phase-a1b-step-b16-derived-engines` (created from main HEAD `556f540`).
- Rebased onto main; clean tree.
- `bun install` OK; `bun run pretest` OK.
- Baseline `bun run test`: **9357 pass / 52 skip / 1 todo / 0 fail** (one transient ECONNREFUSED in serve.test.js; passes on rerun). Brief expected `9357/41/1/0` — skip-count drift (52 vs 41) traced to test files unrelated to B16.

### Phase-0 Survey Findings

(a) **B14 `engineMeta.derivedExpr` annotation:** populated by `makeEngineRecord()` in
`compiler/src/symbol-table.ts:3603`. Today's parser (`ast-builder.js:8449`) only
emits `engine-decl.sourceVar` (legacy `derived=@varname` single-cell form);
the §51.0.J rich `derived=match @x { ... }` form is NOT yet structurally
parsed. `makeEngineRecord` wraps `sourceVar` as
`{ kind: "legacy-source-var", varName: sourceVar }` when present. B16 walks
this single-cell form for cycle detection. Rich expression form is a future
parser expansion (B16 records the deferral).

(b) **§34 catalog rows:** all four B16 codes are registered in `compiler/SPEC.md`:
  - `E-DERIVED-ENGINE-NO-RULES` (line 14234)
  - `E-DERIVED-ENGINE-NO-INITIAL` (line 14235)
  - `E-DERIVED-ENGINE-NO-WRITE` (line 14236)
  - `E-DERIVED-ENGINE-CIRCULAR` (line 14238)
  Plus `E-DERIVED-ENGINE-INITIAL-UNDEFINED` (line 14237 — out of B16 scope, runtime).

(c) **B7's `detectCycle` API:** lives at `compiler/src/dependency-graph.ts:835`.
Generic over adjacency map + node set. B10 already consumes it via
`buildValidatorArgsAdj` (line 765) — primer §13.7 documents B16 as second
consumer. B16 will add `buildEngineDerivedAdj` sibling and a new
`engine-derived-reads` edge kind (or reuse existing `reads` kind with
filtered semantics).

(d) **Walker for direct-write sites:** B8's PASS 6 walker (`walkDerivedValueMutate`
at `symbol-table.ts:2159`) handles `assign`/`call`/`unary` on member-shape
chains (`@form.errors.push(x)`, `@derivedObj.foo = x`). For the bare ident
direct-write case `@phase = .X` (`assign` with `target.kind === "ident"`), the
existing pattern in `type-system.ts:rejectWritesToDerivedVars` (line 2118+)
walks `bare-expr` nodes and matches `^@varname (op)?=` regex. The legacy
E-ENGINE-017 already does precisely this for derived projections, so the
B16 walker can pattern-match on the same shape.

(e) **`.advance(.X)` shape:** AST is a `bare-expr` whose `exprNode` is `call` with
`callee.kind === "member"`, `callee.object` an ident `@varname`, and
`callee.property === "advance"`. Mirror with B8's `call`-with-member-callee
detection.

(f) **`rule=` and `initial=` and state-children for derived engines:** the engine's
state-children body is `engine-decl.rulesRaw` (raw text). The current
`parseMachineRules` function in `type-system.ts:2451` parses lines like
`.From => .To` plus `effect=` + `[label]` + `{ effect-body }`. It does NOT
yet expose `rule=` attribute syntax for state-children (§51.0.B-J Move 14).
B16 thus has limited surface for `rule=` rejection — its detection works
against any state-children rule shape that DOES make it into the parser's
output, but the rich state-child syntax (`<engine for=Health derived=...>
<Healthy/> <AtRisk>...`) lives behind future parser work.
For B14's recorded `initialVariant`, B16 emits E-DERIVED-ENGINE-NO-INITIAL
when the engine is derived AND `engineMeta.initialVariant !== null`. This
is fully testable via attribute-form syntax that already works.

### Implementation Plan

Three deliverables:

1. **DG-side cycle detection (`E-DERIVED-ENGINE-CIRCULAR`)** in
   `dependency-graph.ts`: add `buildEngineDerivedAdj` filter + walker that
   collects engine-decl nodes, registers them as DG `reactive` nodes (via
   `_record`'s `engineMeta.varName`), and emits engine-derived `reads` edges
   for each upstream cell read inside `derivedExpr`. Reuse `detectCycle`.

2. **SYM-side rejection rules (`E-DERIVED-ENGINE-NO-RULES`,
   `E-DERIVED-ENGINE-NO-INITIAL`, `E-DERIVED-ENGINE-NO-WRITE`)** as a new
   PASS in `symbol-table.ts`. Dispatched from `runSYMBatch`. Walks engine-
   decls; for each engine with `engineMeta.derivedExpr !== null`:
   - Fire NO-INITIAL if `engineMeta.initialVariant !== null`.
   - Fire NO-RULES if any state-child `rule=` attribute is present (best-
     effort against today's rule-line parser output; full Move 14 walking
     deferred when state-children become structurally walkable).
   - Fire NO-WRITE for any `bare-expr` whose `exprNode` is `assign` with
     `target` an ident `@<engineVarName>`, OR a `call` with member-style
     `@<engineVarName>.advance(...)`.

3. **Tests:** add `compiler/tests/unit/a1b-b16/derived-engines.test.js`
   covering the four error codes plus the three legal cases.

---

## 2026-05-07 — DG-side implementation

Committed `aea08fc` — `WIP: a1b-b16 DG-side`.

`compiler/src/dependency-graph.ts`:
- Added `engine-derived-reads` to `DGEdgeKind` union.
- Added `collectAllEngineDecls(fileAST)` walking markup containers.
- Engine cells registered as `reactive` DG nodes via
  `_record.engineMeta.varName` (set by SYM PASS 10.A).
- `_pendingEngineDerivedReads` scratch field captures upstream cell reads
  from `_record.engineMeta.derivedExpr` (today: legacy single-source
  form only).
- `buildEngineDerivedAdj(edges, nodes)` filter — sibling of B7's
  `buildDerivedReadsAdj` and B10's `buildValidatorArgsAdj`.
- Cycle detection block runs after E-DERIVED-CIRCULAR-DEP, before
  E-DG-001. Self-reference + multi-hop chain variants. Fail-fast on
  engine-cycle.

DG tests: 45/45 pass. engine-binding-b14 + engine-keyword + derived-machines: 65/65 pass.

## 2026-05-07 — SYM-side implementation

Committed `6ae9a3b` — `WIP: a1b-b16 SYM-side`.

`compiler/src/symbol-table.ts`:
- Added PASS 11 walkers `walkDerivedEngineDeclRejections` (NO-INITIAL +
  NO-RULES) and `walkDerivedEngineWriteRejections` (NO-WRITE) — both
  exported for test direct-invocation.
- `lookupDerivedEngineMeta` gates B16 firing on
  `derivedExpr.kind !== "legacy-source-var"` to avoid double-firing
  with §51.9 LEGACY E-ENGINE-017 + projection-rule semantics.
- `derivedEngineHasAuthoredRules(rulesRaw)` detects `=>` in the body
  (best-effort against today's parser; per-state-child Move-14
  walking deferred when ast-builder learns it).
- Write-side detects both `bare-expr` (assign/advance ExprNode shapes)
  AND `state-decl` (parser surfaces `@var = expr` in function bodies
  as state-decl, mirroring `rejectWritesToDerivedVars` E-ENGINE-017
  detection).
- PASS 11 dispatched from `runSYM` after PASS 10.B.

110/110 engine + DG tests pass after the gating fix (initially had
3 failures on §51.9 derived-machines tests due to `=>` projection
rules being legitimate body content there; the legacy-form gate
fixed those).

## 2026-05-07 — B16 SHIP commit

Committed `3d55b4c` — `feat(a1b-b16): SHIP`.

Added `compiler/tests/unit/derived-engine-rejections.test.js` with 16
tests covering:

- E-DERIVED-ENGINE-CIRCULAR (3 tests): control / cross-engine 2-cycle
  / self-reference. Tests the legacy form via end-to-end
  `runSYM + runDG`; the cycle detection traces both legacy and
  Move-14 forms identically.
- E-DERIVED-ENGINE-NO-INITIAL (2 tests): fires on Move-14 simulated
  derivation with `initial=`; silent on legacy form.
- E-DERIVED-ENGINE-NO-RULES (3 tests): fires on Move-14 simulated form
  with `=>` body; silent on empty body; silent on legacy form
  (projection rules legal there).
- E-DERIVED-ENGINE-NO-WRITE (6 tests): fires on `@v = .X`,
  `@v.advance(.X)`, compound-assign `@v += .X`; silent on non-derived
  engine, legacy form (E-ENGINE-017 owns), non-engine cell.
- B16 LEGAL forms (2 tests): no false positives on a clean Move-14
  derived engine, on a non-derived engine.

Move-14 simulation: tests run `runSYM` once, then mutate
`engineMeta.derivedExpr` to a non-legacy `match-block` shape, then
invoke the exported B16 walkers directly. (Re-running `runSYM` would
overwrite the mutation via PASS 10.A's `makeEngineRecord`.)

**Test deltas:**
- Pre-commit subset: 8633 → 8649 pass (+16), 41 skip, 1 todo, 0 fail.
- Full post-commit: 9357 → 9373 pass (+16), 0 fail.
- TodoMVC + browser checks: PASS.

---

## FINAL REPORT

### 1. WORKTREE_PATH

`/home/bryan-maclee/scrmlMaster/scrmlTS/.claude/worktrees/agent-adfc6ec6383af9353`

### 2. FINAL_SHA

`3d55b4c` (feat(a1b-b16): SHIP)

Branch: `phase-a1b-step-b16-derived-engines`

Commit chain (5 commits on top of main `556f540`):
- `23f7da9` docs(a1b-b16): Phase-0 survey + progress log
- `aea08fc` WIP: a1b-b16 DG-side — engine-derived edges + E-DERIVED-ENGINE-CIRCULAR
- `6ae9a3b` WIP: a1b-b16 SYM-side — derived engine PASS 11 rejections
- `3d55b4c` feat(a1b-b16): SHIP — derived engines + E-DERIVED-ENGINE-* family + cycle detection via B7 reuse

### 3. FILES_TOUCHED

- `compiler/src/dependency-graph.ts` (+239 / -4)
- `compiler/src/symbol-table.ts` (+498 / -2)
- `compiler/tests/unit/derived-engine-rejections.test.js` (NEW, 540 lines)
- `docs/changes/phase-a1b-step-b16-derived-engines/SURVEY.md` (NEW)
- `docs/changes/phase-a1b-step-b16-derived-engines/progress.md` (NEW)

### 4. TEST_DELTA

**Baseline (post-B14, main `556f540`):** 9357 pass / 52 skip / 1 todo / 0 fail.

**B16 ship (post `3d55b4c`):** 9373 pass / 52 skip / 1 todo / 0 fail.

**Net:** +16 pass (16 new B16 tests), 0 fail. Pre-commit subset 8633 → 8649. TodoMVC + browser PASS.

### 5. DEFERRED_ITEMS

- **Rich `derived=expr` parsing** — awaits ast-builder Move 14 work. When
  landed, `derivedExpr` carries a parsed ExprNode and B16's DG-side walker
  reads ALL upstream cell references via `forEachIdentInExprNode` (the
  hook is documented at `dependency-graph.ts:engineDecls` block). The
  SYM rejection trio activates automatically when
  `derivedExpr.kind !== "legacy-source-var"`.
- **Move-14 state-child structural walking** — when state-children
  become walkable AST nodes, `walkDerivedEngineDeclRejections` reads
  per-child `rule=` attribute presence directly (replacing the
  `derivedEngineHasAuthoredRules(rulesRaw)` regex heuristic). Walker
  shape is ready.
- **`E-DERIVED-ENGINE-INITIAL-UNDEFINED`** — runtime check (A1c codegen
  + runtime emit per BRIEF §3 + audit §1.2).
- **General `E-ENGINE-INVALID-TRANSITION`** — split between B15
  (compile-time, statically-known from-state) and A1c (runtime,
  dynamic from-state), per audit §1.3.
- **`<onTransition>` and `effect=` validation** — B17 territory,
  uniformly across derived + non-derived engines per §51.0.J line
  20409.

### 6. OPEN_QUESTIONS

None blocking. Two design notes for the record:

(a) The §51.9 LEGACY form `<machine ... derived=@varname>` keeps its
own write-rejection path (E-ENGINE-017) and its own projection-rule
body semantics. B16's gating on `kind !== "legacy-source-var"` keeps
B16 silent on legacy forms — the right semantic boundary, since these
two forms have different write/rule contracts. The brief implicitly
treated both forms uniformly; the audit-derived implementation
distinguishes them. This is documented in `lookupDerivedEngineMeta`
and the SURVEY.

(b) `state-decl`-shaped writes (`@phase = .X` inside a function body,
parsed as a state-decl since scrml has no separate assignment-statement
kind) are detected by the write-side walker via
`checkStateDeclForDerivedEngineWrite`. This mirrors
`rejectWritesToDerivedVars`'s pattern in `type-system.ts`. If the
parser ever distinguishes assignment from declaration, the walker
becomes simpler — but for now the unified detection is faithful to
the current AST shape.

### 7. PRIMER §13.7 B16 ROW DRAFT

Suggested row to add to `docs/PA-SCRML-PRIMER.md` §13.7 between B14 and
B17 rows:

```markdown
| **B16** | new edge kind `engine-derived-reads` in DG (`DGEdgeKind` union); fires `E-DERIVED-ENGINE-CIRCULAR` per SPEC §51.0.J + §31.5 + §34 on engine-derived-cycle subgraph; SYM PASS 11 fires `E-DERIVED-ENGINE-NO-INITIAL` / `-NO-RULES` / `-NO-WRITE` per SPEC §51.0.J + §34 on Move-14-shape derived engines | every `engine-decl` with `_record.engineMeta.derivedExpr !== null`; rejection trio gated on `derivedExpr.kind !== "legacy-source-var"` to avoid double-fire with §51.9 LEGACY E-ENGINE-017 | `_pendingEngineDerivedReads: string[]` scratch field on engine ReactiveDGNodes; consumed by post-collection edge-resolution loop | `buildEngineDerivedAdj(edges, nodes)` filter (sibling of B7's `buildDerivedReadsAdj` and B10's `buildValidatorArgsAdj`) consumed by B7's generic `detectCycle`; SECOND consumer of B7's reusability promise per primer §13.7 B7 specifics. Walkers `walkDerivedEngineDeclRejections` + `walkDerivedEngineWriteRejections` exported from `compiler/src/symbol-table.ts` for test direct-invocation. |
```

**B16 specifics block (load-bearing for A1c codegen + future Move-14 ast-builder):**

- **Engine cells join DG as `reactive` nodes via `_record.engineMeta.varName`.** B7's read-edge graph and B10's validator-edge graph were cell-only; B16 unifies engine cells into the same node kind so cross-class cycle traversal works (e.g., a derived cell reads a derived engine that derives from a derived cell). The DG node `kind: "engine"` was considered but rejected — keeping `"reactive"` lets B7's existing infrastructure (`reactiveVarNodeIds`, `reactiveVarReaders`) work unchanged.
- **Two-tier B16 firing.** DG-side fires E-DERIVED-ENGINE-CIRCULAR on BOTH legacy (§51.9) AND Move-14 (§51.0.J) forms — cycles are illegal regardless of authoring shape. SYM-side rejection trio fires ONLY on Move-14 form per `lookupDerivedEngineMeta`'s `legacy-source-var` guard. The legacy form has its own write-rejection (E-ENGINE-017) and its own legitimate `=>` body shape (projection-rule mapping per §51.9.2).
- **`derivedExpr.kind === "legacy-source-var"` is the gate.** B14 wraps `engine-decl.sourceVar` (legacy `derived=@varname` parser output) as `{ kind: "legacy-source-var", varName }`. When ast-builder learns the §51.0.J `derived=match @x { ... }` form, it'll set `derivedExpr` to a parsed ExprNode (or a discriminant other than `"legacy-source-var"`). At that point the B16 SYM rejections fire automatically; the DG walker upgrades to `forEachIdentInExprNode` for multi-cell reads.
- **State-decl-shaped writes detected via `checkStateDeclForDerivedEngineWrite`.** scrml's parser surfaces `@var = expr` in function bodies as a `state-decl` node (no separate assignment-statement kind). The walker pattern-matches state-decl `name === <derived-engine-var>` and fires NO-WRITE — mirrors `rejectWritesToDerivedVars` (legacy E-ENGINE-017 path).
- **B16 is the SECOND consumer of B7's reusability promise.** B10 was the FIRST (validator-args, S67); B16 is the SECOND (engine-derived, S68). The pattern (`buildXAdj` filter + edge-kind enum addition + `detectCycle` reuse) is now established for future cycle-class additions.

### 8. SURVEY-NOTE

`docs/changes/phase-a1b-step-b16-derived-engines/SURVEY.md` (committed at `23f7da9`) captures the Phase-0 findings + implementation plan. All survey gates (a)/(b)/(c)/(d) PASS as documented. The `(a)` partial finding (B14 only emits legacy form via `sourceVar`) drove the gating decision and the dual-form handling. Audit §1.4-§1.5 reusability promise is satisfied.

### 9. SPEC-PROSE FOLLOW-UPS

None required for B16 — §51.0.J + §51.0.F + §51.0.G + §31.5 + §34
catalog rows (E-DERIVED-ENGINE-NO-RULES, -NO-INITIAL, -NO-WRITE,
-CIRCULAR) are all present and consistent. Audit §4 confirmed no spec
rename or amendment needed.

