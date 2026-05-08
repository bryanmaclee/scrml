# Progress: phase-a1c-step-c1-shape-aware-cell-emit

## Tier classification
**T2 — Standard.** Single-subsystem dispatch (codegen `case "state-decl"` extension); the gap is wider than the BRIEF flagged on Variant C compound (no handler today) but bounded. Reuses existing `_scrml_derived_declare` runtime infrastructure for compound-parent proxy; one new helper (`_scrml_default_set`) recommended.

---

## Phase 0 SURVEY

- [start] Worktree branch `worktree-agent-ac5b6dcfb8d28d416` from main HEAD `e62bb5a`. Tree clean. `bun install` 114 pkgs. `bun run pretest` 12 samples 0 errors.
- [baseline] `bun run test` → 9,733 pass / 64 skip / 1 todo / **5 fail** / 33,861 expects. Three pre-existing fails (`F-BUILD-002 §3`, `Bootstrap L3`, `Self-host: tokenizer parity`) — predate C1, originate at commits `2585a36` / `44c1054`. Test invariant for C1 = no new fails (5 ≤ 5).
- [survey] Read in full: BRIEF, SPEC §6.1/§6.2/§6.3/§6.6/§6.8, current dispatch at `emit-logic.ts:572-602`, A1b annotations (`symbol-table.ts:200-310, 428-596, 1430-1560`), AST shapes (`types/ast.ts:420-630`), A1c SCOPE §3.1/§4.1/§4.5/§4.7/§4.8, C0 SURVEY, S61 11.5 progress.md (gap statement at line 79).
- [survey] SURVEY.md drafted with all 10 deliverables per BRIEF §5. Verdict **SCOPE-AMENDMENT-SUGGESTED**.

## Findings highlight

1. **Variant C compound: critical gap** — `emit-logic.ts case "state-decl"` has NO handler for compound parents today. Children silently dropped. Wider gap than BRIEF flagged.
2. **Shape 3 V5-strict gap (S61 11.5 deferred)**: confirmed at `emit-logic.ts:575` (`structuralForm === false` guard). One-line fix.
3. **Markup-typed derived consumption already works via runtime** — `runtime-template.js:181` routes `_scrml_reactive_get` → `_scrml_derived_get` for any derived-registered name. C1 emits declaration; runtime + emit-html handle interpolation unchanged.
4. **`default=` storage needs ONE new runtime helper** (`_scrml_default_set`). BRIEF §4.3 "ZERO new helpers" not achievable with clean design.
5. **Tier 3 positional sugar latent bug** — `(a, b, c)` SequenceExpression evaluates to JS comma-operator (last operand). Out of C1 scope; defer to C21 (or new C1.5).
6. **A1c SCOPE §4.5 C21 needs revision** — Variant C + markup-typed-derived now in C1; only Tier 3 remains for C21 (~2-3 h).

## Estimated cost
4-6 h holds (BRIEF estimate). Sub-step decomposition in SURVEY §9.

## Verdict
**SCOPE-AMENDMENT-SUGGESTED** — three amendments before implementation:
1. Accept +1 runtime helper (`_scrml_default_set`).
2. Reduce A1c SCOPE C21 (Tier 3 only).
3. Update test invariant: 5-or-fewer fails post-SHIP.

## Stop-and-report
SURVEY.md committed; Phase 0 closed. Awaiting PA acknowledgment before implementation dispatch (which should re-dispatch via `scrml-dev-pipeline` once that agent file is staged).

---

## IMPLEMENTATION PHASE — dispatched S71 (post-amendment)

### Worktree state
- WORKTREE_ROOT: `/home/bryan/scrmlMaster/scrmlTS/.claude/worktrees/agent-acba92b63c3e3950a`
- Branch: `worktree-agent-acba92b63c3e3950a`
- HEAD pre-implementation: `e8dd6c8` (S71 wrap; SURVEY landed + amendments applied)
- Baseline `bun run test` (post-pretest): **9,733 pass / 64 skip / 1 todo / 5 fail / 33,861 expects** (3 unique pre-existing self-host fails). Brief stated 9,734 pass — 1-test delta within tolerance; baseline reproducible.

### WIP-1 — pre-existing fixture audit + corpus grep — DONE
- `bun install` → 114 packages clean.
- `bun run pretest` → 12 samples 0 errors.
- Baseline established (above).
- Audit findings (Shape 3 V5-strict diff envelope, §7.3 SURVEY):
  - **Zero `samples/compilation-tests/*.scrml` use `const <` form.** Diff envelope at sample level: ZERO bytes change.
  - Unit tests using `const <` form: cell-classifier, at-name-resolution, derived-{value-mutate, with-validators, circular-dep}, render-by-tag, usage-analyzer — none assert on `_scrml_reactive_set`/`_scrml_derived_declare` byte-output. Diff envelope at unit-test level: ZERO assertions break.
  - Integration tests using `const <` form: kickstarter-v2-smoke, symbol-table, parse-shapes-v0next — all PARSE-side assertions only (shape/isConst/structuralForm field checks); no byte-output assertions. Diff envelope at integration level: ZERO assertions break.
  - Existing reactive-derived.test.js + code-generator.test.js Shape 3 byte-output assertions all use `structuralForm: false` (legacy `@x` form). My WIP-2 admits `structuralForm: true` to the SAME path — the existing tests continue passing unchanged.
  - **Bottom line: WIP-2 diff envelope is much smaller than SURVEY §7.3 estimated** (5-15 fixtures) — actual is essentially 0 fixture changes. The change is silent in the existing corpus.
  - This means WIP-2 needs NEW tests (no existing test exercises `structuralForm: true` AND `shape: "derived"` with byte-output assertions). Adding a fixture in c1-shape-aware-cell-emit.test.js (WIP-6) is appropriate.
- Also confirmed: Variant C compound + markup-typed-derived have no existing byte-output coverage. WIP-4 + WIP-5 are net-new test surface.

### WIP-2 — Shape 3 V5-strict gap closure — DONE
- Dropped `structuralForm === false` check at `emit-logic.ts:572-602`. Now both `structuralForm: true` (V5-strict `const <x> = expr`) AND `structuralForm: false` (legacy `const @x = expr`) route to `_scrml_derived_declare`.
- Replaced legacy block-comment block with a C1 shape-dispatch comment block.
- Closes the S61 Step 11.5 deferred gap.
- `bun test` post-WIP-2: **9,734 pass / 64 skip / 1 todo / 3 fail / 33,914 expects**. 3 fails = pre-existing self-host parity (untouched). ZERO new fails.
- Note: `bun test` (pre-commit subset) shows 3 fails, not 5 — pre-commit hook skips self-host integration duplicates.
- Diff: 1 file, +14/−11 LOC. Survey-predicted "one-line change" was understated; the comment block also got rewritten, but the functional change is removal of the structuralForm guard.

### WIP-3 — `default=` storage sidecar — DONE
- Added `_scrml_default_fns` map + `_scrml_default_set(name, fn)` runtime helper to `runtime-template.js` (placed before §6.6 marker, so part of the always-included `core` chunk; tree-shake-friendly since helper is only called if compiler emits the call).
- Added `_emitDefaultSidecar(node, qualifiedName, opts)` helper in `emit-logic.ts` that synthesizes `_scrml_default_set("name", () => <defaultExpr>);` from the `node.defaultExpr` ExprNode. Defensive: returns a comment marker if `defaultExpr` is set on a `const` derived (E-DERIVED-WRITE territory; A1b/B22 should reject before codegen).
- Threaded `compoundPathPrefix` through `EmitLogicOpts` interface (forward-compat for WIP-5; not used yet at top-level scope where `_qualifiedName === node.name`).
- Wired `_appendSidecar` wrapper across all return paths in `case "state-decl"` so each shape arm appends the sidecar after its main emission.
- `bun test` post-WIP-3: **9,734 pass / 64 skip / 1 todo / 3 fail / 33,914 expects**. ZERO new fails. Tree-shaking subset (`runtime-tree-shaking.test.js`): 28/28 pass.
- The sidecar fires only when `defaultExpr !== null`; existing code paths emit identically because no test today exercises `default=` codegen — net byte-output diff in existing fixtures: 0 lines.

### WIP-4 — Markup-typed derived placeholder declaration — DONE
- Added a new dispatch arm in `case "state-decl"` for `_cellKind === "markup-typed"` AND `isConst === true`. Per SURVEY §5.2 Option (b), C1 emits a placeholder declaration: `_scrml_derived_declare("badge", _scrml_markup_factory_N)` plus a top-level factory function shell that returns `null`. C2 will lift the shell into a real markup-emit factory with `_scrml_derived_subscribe` dep-tracking.
- The arm fires BEFORE the Shape 3 derived arm so markup-typed (which carries `shape: "decl-with-spec"` per ast-builder) routes correctly. The B5 cell-classifier discriminates Shape 3 markup-typed from Shape 2 bindable via `_cellKind`.
- Use-site `${@badge}` interpolation routes through runtime-template.js:181 (`_scrml_reactive_get` → `_scrml_derived_get` for derived-registered names) — no emit-html.ts changes required.
- `bun test` post-WIP-4: **9,734 pass / 64 skip / 1 todo / 3 fail / 33,914 expects**. ZERO new fails. No existing test exercises markup-typed-derived through codegen end-to-end, so this arm is currently dormant in the existing corpus; WIP-6 adds tests that exercise it.

### WIP-5 — Variant C compound parent + recursive child emission — DONE
- Added a new dispatch arm in `case "state-decl"` for `_cellKind === "compound-parent"` OR `Array.isArray(node.children)`. Per SURVEY §3.3 Option A-prime, the parent cell uses `_scrml_derived_declare` with a reconstruction closure: `() => ({ field1: _scrml_reactive_get("parent.field1"), ... })`.
- Recursively emits each child state-decl with `compoundPathPrefix` threaded through `EmitLogicOpts` so each child's storage key is the qualified path (`formRes.name`, `signup.email`) — matches `StateCellRecord.qualifiedPath`.
- Emits `_scrml_derived_subscribe` edges from each child to the parent so writes to children dirty the parent (lazy-pull semantics on next read of `@formRes`).
- Emit order: children first (so they exist when the parent's first lazy pull reads them), then parent declaration + subscribe edges, then `default=` sidecar (applied via `_appendSidecar`).
- In-compound derived (§6.6.16) and bindable children route through recursion naturally — same dispatch handles them.
- Empty compound (`children: []`) emits an empty object literal `({})` as the value (legal per SPEC §6.3.2).
- `bun test` post-WIP-5: **9,734 pass / 64 skip / 1 todo / 3 fail / 33,914 expects**. ZERO new fails. Compound parent arm is currently dormant in the existing corpus (no `<formRes>` / `<signup>` samples); WIP-6 exercises it via dedicated tests.
- This arm fires BEFORE the markup-typed-derived arm so a compound that contains markup-typed children walks through the compound dispatch first, then recursively routes each child's emit.

### WIP-6 — c1-shape-aware-cell-emit.test.js (NEW unit test suite) — DONE
- Created `compiler/tests/unit/c1-shape-aware-cell-emit.test.js` with **25 tests** covering all 10 sections per BRIEF §4.5:
  - §C1.1 Shape 1 plain regression guard (V5-strict + legacy `@`-form): 2 tests
  - §C1.2 Shape 2 decl-with-spec regression guard: 1 test
  - §C1.3 Shape 3 derived plain (both structural forms + multi-dep dedup): 3 tests
  - §C1.4 Shape 3 markup-typed derived placeholder + factory shell: 3 tests
  - §C1.5 Variant C compound (parent proxy, qualified-path keys, subscribe edges, child-first ordering, empty compound, nested compound, in-compound derived per §6.6.16): 7 tests
  - §C1.6 default= storage sidecar (Shape 1 emits, no-default omits, defensive comment for const derived): 3 tests
  - §C1.7 Engine cells SKIP — structural invariant: 1 test
  - §C1.8 S61 11.5 gap closure regression guard: 1 test
  - §C1.9 Output stability — legacy emission preserved: 2 tests
  - §C1.10 Compound-child default= per-field qualified path: 2 tests
- Two minor source fixups while debugging tests:
  - `genVar("markup_factory_<name>")` instead of `genVar("_scrml_markup_factory_<name>")` to avoid double-prefix (`_scrml__scrml_...`).
  - Test fixtures use `kind: "lit"` + `raw` field (matches `LitExpr` type) rather than non-existent `kind: "literal"`.
- `bun test` post-WIP-6: **9,759 pass / 64 skip / 1 todo / 3 fail / 33,971 expects**. +25 new tests, ZERO new regressions vs. baseline. Pre-existing 3 self-host parity fails remain unchanged.
- `bun run test` (full suite incl. integration): same numbers — 9,759 pass / 3 fail.

### WIP-7 — Output-stability validation + commit-cadence wrap — DONE
- **Sample-corpus diff envelope:** ZERO bytes changed. Grep over `samples/` confirms NO sample uses Shape 3 V5-strict (`const <x>`), Variant C compound (`<formRes>`/`<signup>`), markup-typed derived, or `default=` attributes. The C1 dispatch arms are dormant in the existing corpus — they only fire on net-new code. This matches SURVEY §8.3 envelope (existing fixtures unaffected).
- **Compilation-test smoke:** `bun run pretest` compiles all 12 sample apps cleanly (no errors, normal warnings). `node --check` passes on the regenerated `samples/compilation-tests/dist/scrml-runtime.js` — `_scrml_default_set` helper landed without breaking runtime syntax.
- **Tests-corpus diff envelope:** ZERO existing assertions break. New WIP-6 test file covers the new dispatch arms with synthetic AST nodes.
- **Test invariant compliance:** baseline 9,733/64/1/3 (per `bun run test`); post-C1 9,759/64/1/3. Net delta: +26 tests added (25 from WIP-6 + 1 floating drift), 0 regressions, 0 new fails. The 3 pre-existing self-host parity fails are untouched (per S66 user direction — out of C1 scope).
- **S61 11.5 gap closure verified:** §C1.8 test asserts `const <doubled> = @count * 2` (V5-strict) emits `_scrml_derived_declare`, NOT `_scrml_reactive_set`. Pre-C1 this test would have failed; post-C1 it passes.

## Final SHIP commit pending — sub-WIP commits chronological:
- e3e5d89  WIP(c1): WIP-1 — corpus audit + baseline 9733/64/1/5
- 645b666  WIP(c1): WIP-2 — drop structuralForm===false guard (closes S61 11.5 gap)
- 561e16a  WIP(c1): WIP-3 — default= storage sidecar
- 5e4a0c5  WIP(c1): WIP-4 — markup-typed derived placeholder declaration
- 4453083  WIP(c1): WIP-5 — Variant C compound parent + recursive child emission
- eb4f5e9  WIP(c1): WIP-6 — c1-shape-aware-cell-emit.test.js +25 tests
- (pending) WIP-7 SHIP commit


