# BRIEF r4 — s452-impl1-pipeless-arms (archived verbatim)

PA → impl#1 pipe-less agent: a small r4 on the same branch. Archive this as BRIEF-r4.md.
1. Pipe-less `::Bad m :>`, accepted while `.Bad m :>` is now an error. §19.4.5 (main, #1273): the paren-free binder is legal ONLY after a leading `|` in a `!{}` (`legacy-arm-pattern … ('.' | '::') VariantName Identifier … `!{}` only`, under `legacy-handler-arm ::= '|' …`).
   - MEASURE first: count corpus sites (examples/, samples/, conformance/cases/, stdlib/) where a `!{}` arm is a pipe-less `::V <ident> :>`. Use your differential harness or a structural scan, not a bare grep.
   - If the count is ZERO: make it the same E-PARSE-001 as `.Bad m` (message: write `::Bad(m) :>`, or add the legacy `|`), with a test. Record `prov=pa-ruled:§19.4.5 paren-free binder only after | — newly-rejecting, corpus measured zero` in your progress.md (the PA records it in the ledger).
   - If NON-ZERO: do not change it. Report the count and the files.
2. E-TYPE-ARM-QUALIFIER-MISMATCH needs its §34 row in THIS PR (codes land with their impl). Add one row to compiler/SPEC.md §34 in the shape of a neighbouring E-TYPE row: Code | Section (§19.4.5 / §18.2) | Trigger (an arm's `TypeName.V` qualifier names a type other than the handled error type) | Error. Cite the emit site by function name. Then run `bun run scripts/regen-spec-index.ts` + `--check`, `bun scripts/s34-census.ts --check-new`, and `bun scripts/facts.ts --check` (write if needed). Revert any master-list.md hunk.
Then `git merge origin/main` (main moved: #1273). Resolve as a real 3-way; for docs/known-gaps.md, resolve ONLY the conflicting hunks, never take a whole side. Mark `g-impl1-handler-arm-pipeless-dropped-s452` (now on main) status=resolved with your SHA. Regenerate counts. Push.
Reply with FINAL_SHA, the item-1 count and outcome, and the gates (≤150 words).
