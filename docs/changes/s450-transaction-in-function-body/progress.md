# progress — s450-transaction-in-function-body

- 2026-10-02 startup: branch cut from origin/main daca85d8 (origin moved past bc4bca1f during fetch: #1240 native-parser freeze). bun install + pretest OK, samples/compilation-tests/dist produced.
- 2026-10-02 repro: committed sample fails E-SCOPE-001 + "statement boundary not detected" on base. Root: `parseOneStatement` (every nested body; all 5 fn-decl sites incl. the `export` re-parse reach it via parseRecursiveBody) had no `transaction` arm — only the top-level loop did. Gap's locus hypothesis held in substance.
- 2026-10-02 parse fix: shared `parseTransactionBlock()` called from both loops (87f50a38).
- 2026-10-02 lowering bug found one level away: ROLLBACK was inserted only before a DIRECT-child `fail`; a `fail` in an `if` (the §19.10.2 example's own shape) left the transaction open (PA-visible in the emitted server.js). Rewrote: rollback-before-return for every marked `fail` / `?` at any depth + `finally` backstop + never-COMMIT-past-a-rollback guard.
- 2026-10-02 §19.10.4 checker `validators/lint-transaction.ts` (6cd3beb8): E-ERROR-001, E-ERROR-007, interim fail-closed E-TRANSACTION-CONTROL-FLOW (return/break/continue/yield out of the block: searched §19.10, §8.9 — no governing sentence).
- 2026-10-02 found: a `fail` in a statement-`match` arm returns from the arm IIFE only — pre-existing g-stmt-match-block-return-falls-through (HIGH, open). Not fixed; inside a transaction it now rolls back and throws loudly instead of committing.
- 2026-10-02 tests: unit 27 + integration 10 (real bun:sqlite, executed handlers) — both BITE on base; conformance: 1 runtime (sqlEngine:"real") + 4 codes + E-BATCH-001 (now source-reachable).
- 2026-10-02 corpus (975 files: examples 71, samples 877, aM 5, flogenceP 22), base vs head per-file fatal codes: 1 changed (sql-transaction-001: E-SCOPE-001 → E-ERROR-001, the sample is itself non-`!`). Sample then made §19.10.4-conformant. aM whole-program compile: base/head both exit 0, 26 emitted files byte-identical, identical diagnostic counts.
- 2026-10-02 transaction usage census: top level 0, in functions 1 (the sample, non-`!`).
- 2026-10-02 gap entry resolved; facts/state/spec-index --write + --check PASS.
