# Fix: g-lift-concurrent-transitive-exclusion-tdz (HIGH) — change-id g-lift-concurrent-transitive-tdz-2026-06-21
Dispatched S212 2026-06-21 · scrml-js-codegen-engineer · isolation:worktree · opus · agent ad8a0863304529a95 · base 56530d3c

Root: scheduling.ts scheduleStatements — Bug 56 fix excludes statements DIRECTLY reading an await-bound local
(forces batch boundary via body-DG depth-1) but does NOT propagate the exclusion TRANSITIVELY → n/scored (dep on
the excluded sync `profiles`, which deps on await `rows`) get batched into the Promise.all ahead of `const
profiles` → TDZ. + let-accumulator facet (reassigned `let acc=[]` const-destructured → "Assignment to constant
variable"). FIX (read SPEC §10.5.5 + §19.9.9 first, Rule 4): (1) transitive exclusion FIXPOINT over body-DG edges
— never batch a statement transitively dependent on a batched await; don't over-restrict independent pure consts
(qtf must still batch); (2) never lift a let/reassigned binding into the const-destructure. R26: emitted client.js
declares `const profiles` BEFORE use, profiles.length/.map NOT in Promise.all, node --check clean; let-accum facet;
qtf still batched. Extend bug-56 test family. FULL bun run test; update + NOTE any fixture asserting the old shape;
within-node unaffected. Full mandatory-block brief as dispatched verbatim in the transcript. PA lands via S67.
