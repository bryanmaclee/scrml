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
