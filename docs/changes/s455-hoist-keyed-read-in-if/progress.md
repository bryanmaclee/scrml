# progress — s455-hoist-keyed-read-in-if (append-only)

- start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ac0b2605613446744 (base ebd4be2d4 = origin/main). bun install + pretest OK.

## Maps
- primary.map.md: ZERO rows for §8.10 / Tier-2 hoist / batch-planner / `substituteHoistedSqlInBody` (grep `8.10|hoist|N+1` → only §14.8.10 tenant hits). NOT load-bearing. The locus came from grepping `client cannot evaluate` + the #1322 progress.md (load-bearing: it named the emit-control-flow §8.10 hoist as the site of its defect 11).

## Governing (compiler/SPEC.md §8.10 at ebd4be2d4, quoted)
- §8.10: "A for-loop whose body contains a single keyed `?{}` read SHALL be rewritten to a single `WHERE IN (...)` pre-fetch plus per-iteration `Map` lookup."
- §8.10.1 cond 2: "Loop body contains exactly one `?{}` block whose template matches `... WHERE <column> = ${x.<field>} ...`" — "contains": no depth restriction; the planner's detector (batch-planner.ts walkAst) walks every depth.
- §8.10.2: "`.get()` in the loop becomes `Map<key, Row>`; missing keys yield `not`, preserving §8.7." / "`.all()` in the loop becomes `Map<key, Row[]>` with per-key grouping; per-iteration lookup yields a possibly-empty array."
- §8.10.3: "The rewritten loop is observationally equivalent to the un-rewritten loop on all side-effect orderings."
- §8.10.4: "The key column is the column referenced by the single equality predicate in the `?{}` template."

## Reproduction at base ebd4be2d4 (real bun:sqlite via conformance runner; .tmp/gen.ts + .tmp/probe.ts)
Each case: a server fn over [{id:7},{id:8}] against notes(7→"hello") → @found; same over a declared-never-created table → @failed.
ORACLE = the identical source with `.nobatch()` (per-iteration queries): 38/38 PASS (found "hello,none"; failed: handled "none,none", unhandled "init" = host-backstop runtime error — pre-existing unhandled semantics, the oracle not the subject).
HOISTED at base: 5/38 PASS (direct-handled, direct-unhandled, inner-for ×2, ternary-unhandled — all with the key projected).
- every nested shape (in-if, in-else, else-if, nested-if, let-reassign-in-if) reads `not` on SUCCESS ("none,none"); handled failure throws past its arm ("init").
- `.all()` in if → `null.length` throws ("init").
- bare reassignment `row = ?{…}` DIRECT in the body → `const row` re-declared (E-CODEGEN-INVALID-LOGIC); handled → `var row` shadows `let row`.
- every `-noproj` (`SELECT body … WHERE id=`) → "none,none" even direct.
Emitted fragment (in-if-handled, case.server.js):
    for (const it of items) {
      if (( it . on )) {
      let _scrml__scrml_result_6 = null /* SQL query — client cannot evaluate _scrml_sql (E-CG-006); use a server-side function */;
