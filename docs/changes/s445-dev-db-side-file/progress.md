# progress s445-dev-db-side-file

- start: worktree /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a357de622e258554c, base af5f85808
- REPRODUCED before fix (worktree compiler, base af5f85808):
  - devdb shape (src/app.db real, `scrml dev src/app.scrml` from project root): dev CREATES ./app.db (4096 bytes).
  - flogence copy (scratch rsync of ../flogence src/ + root flogence.db): `scrml compile src/` (multi-root,
    base = repo root because ports import ../../graph-read.scrml) leaves src/dist/src/{app,ports/*}.server.js
    with `sqlite:src/flogence.db` / `sqlite:src/ports/flogence.db`; `scrml dev src/app.scrml` imports them
    (dev loads every *.server.js under the output dir) -> creates src/flogence.db + src/ports/flogence.db
    (4096 each) -> next compile E-PA-004 "EMPTY database .../src/flogence.db". Exact adopter symptom.
- ROOT CAUSE: compile resolves db=/src= against the declaring file's dir; the emitted handle was a
  `sqlite:` literal opened CWD-relative (literal re-relativized per compile unit, ss19 #9) and Bun
  sqlite creates on open.
- GOVERNING SENTENCE: none in SPEC for the resolution base (§8.1.1/§44.2: "A plain path without prefix
  (e.g., db="./app.db") SHALL be treated as sqlite:./app.db" — prefix only). §39.7 ("supports the workflow
  where the schema is written before the database file is created" — creation is migrate's) and the §34
  E-PA-001 row ("`src=` file does not exist | Error") lean to "the db exists"; SPEC silent on runtime
  creation -> chose fail-closed/no-create per brief.
- FIX: db-target.ts resolveDbFilePath (THE resolver; protect-analyzer + codegen); codegen/sqlite-file-target.ts
  emits `_scrml_sqlite_file("<module-relative spec>", "<declared>")` -> { adapter: "sqlite", filename,
  create: false, readwrite: true }, throws naming the path when absent. emit-server.ts + emit-tool.ts use it;
  api.js/codegen index.ts thread outputDir. ss19 #9 re-relativization deleted.
- AFTER: devdb -> no ./app.db; flogence copy (stale multi-root artifacts present) -> no stubs, compile exit 0,
  dev log names the missing src/flogence.db + src/ports/flogence.db loudly; flogence copy with paths
  migrated to ../flogence.db / ../../flogence.db -> compile reads the REAL db, dev serves, 0 import failures.
- Tests: new compiler/tests/integration/dev-db-no-side-file.test.js (8; mutation-proven: 4 red with the
  helper disabled); 28 existing test files migrated (literal pins, CWD-seeded dbs, harness regexes).
- Suite (unit+integration+conformance): 26690 pass / 0 fail / 70 skip / 12 todo.

## Round 2 — bryan ruling (user-voice-scrml.md S445 item 6)
- merged origin/main (5f5753e3c; FACTS.md conflict → theirs + regen).
- SPEC §8.1.1: Resolution base / Ownership / Creation / owned-empty-at-compile-time bullets + Provenance;
  §44.2 step 5 cross-ref; §39.7 cross-ref.
- compiler/src/db-ownership.ts (NEW): collectOwnedDbFiles / collectProgramOwnedDbFiles — per resolved db
  file, program-wide (all files compiled together); innermost <program db=>/<db src=> scope; an unscoped
  declaration belongs to the file's single target (else owns nothing).
- codegen: `_scrml_sqlite_file(spec, declared, ownsSchema)` → create: ownsSchema; the existence check only
  when !ownsSchema. codegen/index.ts stamps `_ownedDbFiles` program-wide (per-file fallback for direct callers).
- protect-analyzer: an OWNED db whose file exists with zero user tables/views → shadow schema (Note(PA) says
  "has no tables yet"); referencing → E-PA-004 EMPTY as before.
- tests: W5b + conf-W5B back to no pre-seed (rm the declared db; W5b (1) asserts it is CREATED beside the
  source, not in dist); csrf DOC_PROBE no-create seed removed; pins carry the ownership flag; dev-db test
  13 (referencing-missing loud, owning-fresh creates+uses, owned-empty touch compiles, referenced-empty
  E-PA-004, program-wide ownership, <schema> owner).
- suites: unit+integration+conformance 26801/0/70/12; browser-baseline --check PASS (48 asserted).
