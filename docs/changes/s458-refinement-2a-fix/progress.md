# progress — s458-refinement-2a-fix (append-only)

- 2026-10-08 start: worktree verified (.claude/worktrees/agent-a956eaa623dd550e4); reset to bacf30adf (= worktree-agent-a8d0ca5626d2a3728 tip, slice 2a merged with main c4eb2c589); BRIEF archived 7ef16413d; bun install + pretest OK (34 dist files).
- Read: PLAN.md, progress.md (slice 1 + 2a), SPEC §53 in full (39703-40977). Maps: primary.map.md — the load-bearing row is the "page DEAD IN THE BROWSER while its conformance case PASSES" row: the conformance runtime half executes the FULL runtime template, never the pruned per-app runtime, so a new runtime helper must be placed in a chunk that ships whenever it is called (checked separately below, not trusted to conformance).
- Base / 2a copies for differentials: `git archive` of c4eb2c589 and bacf30adf into .tmp/base, .tmp/h2a (scratch).

## F1 — one accessor for a refinement; bind:value judges the bound position

Governing sentence: §53.7.2 "`bind:value` on a constrained variable SHALL emit a runtime check at every input event, before the reactive assignment is applied. If the check fails, the assignment is not applied and the reactive variable retains its prior value." (the check is the bound value's own constraint; an unrefined field has none). §53.3.1: a union is inhabited by inhabiting a member.

- emit-predicates.ts: `Refinement` is now `{ judge, label }` only — no `predicate`, no `baseType`. `refinementOf` turns a plain stamp (predicate + wrap) into the container judge. New: `refinementAtPath` (a field / element's own judge, null for an unrefined field), `judgeBaseType`, `htmlPredicateOf` (the ONE accessor that hands out a raw predicate — only for a judge that is exactly one refinement, for §53.7.1 attrs), `emitRefinementCheck` / `emitServerRefinementCheck` (consumers' entry points).
- Consumers switched: emit-logic (6 decl / reassign / return sites), emit-server (2 param sites), emit-bindings (both bind:value gates), emit-html (§53.7.1 attrs by path).
- bind:value: the gate judges `_scrml_bv` = the value that is WRITTEN (after coercion), with the bound field's judge by path; a numeric refinement coerces with Number() (§53.7.1 renders it `type="number"`). This also closes g-bind-value-check-skips-base-type-s458 (the 2b item) because the judge now tests the base type and must see the written value.
- Structural guard (unit test): no codegen file other than emit-predicates.ts reads `.predicate` off a stamp or calls predicateToJsExpr / judgeExpr / emitRuntimeCheck / emitServerParamCheck.
- Executed (conformance runtime half, base c4eb2c589 / 2a bacf30adf / head):
  - refinement/bind-unrefined-field-accept-neg (`@p.name` unrefined field of a refined struct; `@u: number(>0) | string`): base PASS, 2a FAIL (p.name stays "a", u stays 1), head PASS.
  - refinement/bind-refined-field-reject-rt (`@p.n: number(>0)` typed "-5"; `@q.n` typed "7"): base FAIL (p.n = "-5", q.n = "7" — string, unchecked), 2a FAIL, head PASS.
- Tests updated: predicate-codegen §21-24 read `result.judge.*`; s457 url test expects `_scrml_url_shape_ok(_scrml_bv)`.

## F3 — one hoisted judge per struct / enum type per bundle (+ the F2 union arm)

Governing sentence: §53.1 "A stateless predicate can be verified by evaluating a single boolean expression over the incoming value … minimal runtime overhead — an O(1) boolean expression" (the check is per-value work, not per-type-graph copies); §53.4.5 report contents ("the constraint expression … the variable name and location"). The union arm: §53.3.1 (a union is inhabited by inhabiting a member).

- refinement-obligations.ts: a struct / enum inside a JudgeType is now a REFERENCE `{ k, name, id }` into a content-addressed registry (`structJudgeDef` / `enumJudgeDef`; id = FNV-1a of the definition, so the same type gets the same id in any compilation). `judgeTypeOf` memoizes per resolved-type object (only results with no recursion cut beneath them). Before: every judge, stamp and emitted check carried a full copy of every nested struct (k^depth).
- emit-predicates.ts: `structJudgeName` / `enumJudgeName` register ONE function per type (`_scrml_judge_<Type>_<id>(v)`, preceded by a `// §53 judge — Type { field: … }` comment that spells the fields once, nested types by name); `judgeTypeExpr` calls it. `judgeDefinitionsFor` / `appendJudgeDefinitions` append the definitions an artifact calls; every emitter appends BEFORE its runtime-helper scan (a judge may call `_scrml_url_shape_ok`): emit-client (before the POST_EMIT chunk gates; inside the chunk scope), emit-server (both bundle assemblies), emit-worker, emit-library (`withRuntimeHelpers` + the unmet-helper scan exempts registered judges), emit-tool (main + library + serve-harness extra body, which skips judges the headless module already defines — a module may not declare a function twice). Failure reports describe a struct by NAME (constraint text by reference).
- Union arm (F2, entangled with the judgeTypeOf rewrite, same commit): an unrefined non-primitive member gets its SHAPE judge — struct → object, enum → one of its variants (unit = the tag string; payload = `{ variant, data }`; an object spelling a unit variant is refused), array → Array.isArray + element shape; `any` only for kinds with no runtime shape (map, function).
- Measured (repro/gen-stress.mjs: 4 levels, 40 refined fields, 30 functions; repro/measure.mjs; client.js bytes):
  | case | base c4eb2c589 | 2a bacf30adf | head |
  |---|---|---|---|
  | stress K=3 | 0.62 s / 133 MB / 18,046 B | 2.41 s / 498 MB / 1,428,254 B | 0.66 s / 144 MB / 35,633 B |
  | stress K=6 | 0.53 s / 134 MB / 18,046 B | 10.27 s / 1,604 MB / 9,196,778 B | 0.63 s / 155 MB / 36,043 B |
  | Order/Customer/Address/Item (repro/order-model.scrml) | 0.52 s / 106 MB / 4,004 B | 0.51 s / 120 MB / 21,743 B | 0.51 s / 112 MB / 10,105 B |
  K=3 → K=6: head +410 B (+1.2 %), 2a ×6.4. Head vs base on the stress case is the 30 struct-param guards base never emitted (base did not judge struct params at all). The Order model is smaller than 2a (-54 %).
- Conformance: refinement/union-nonprimitive-member-reject-rt (`number(>0) | Role` with -5 and "Owner"; `number(>0) | string[]` with -5): base FAIL, 2a FAIL, head PASS. refinement/union-nonprimitive-member-accept-neg (`.Editor`, ["x","y"]): passes on all three.
- TYPES-BASELINE: one pre-existing diagnostic (type-system TS2678 'machine') re-recorded — the same diagnostic, its union text re-ordered.
