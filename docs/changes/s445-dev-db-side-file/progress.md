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

## Round 3 — S239 review of 955816ba2 (DO-NOT-LAND) — mechanical findings
- merged origin/main 3a4d869a3 (90e2c5e0c): protect-analyzer.ts 3-way (declaredTables param from #1198 + ownedDbFiles
  kept, both threaded); FACTS / SPEC-INDEX theirs + regen.
- CORRECTION to round 1: "no stubs with stale artifacts" was measured with the round-1 helper on artifacts the
  round-1 compiler had just regenerated; artifacts left by an OLDER compiler (literal `sqlite:src/flogence.db`)
  still created stubs when dev imported them (review F3, reproduced by the reviewer). Fixed below (F3).
- F1 (a) runtime: owning handle that creates the file prints one stderr line
  `scrml: created new database <abs> (declared as "<v>" in <file>)`; (b) compile-time W-DB-PATH-RESOLVES-ELSEWHERE
  (protect-analyzer.ts checkDbPathsResolvingElsewhere): relative path → missing/zero-table file while the same path
  from CWD / build root / project root names a db with tables. §34 row added.
- F3: api.js returns `serverModules` (the .server.js this compile wrote); dev passes it to the app child;
  loadServerRoutes mounts only those and reports leftovers in one line (never imports, never deletes).
- F5: db-ownership.ts sqlDeclaresTable — tokenizer drops comments + string literals; CTAS + VIRTUAL own; TEMP and
  other-schema-qualified do not; `main.` does.
- F6: one rule — db-ownership.ts fileDefaultDbValue is what codegen binds `_scrml_sql` to (collectDbScopes now
  calls it) and what a `?{}` declaration owns.
- F7: dev mounts a failed module's declared routes as 500s carrying the import error (failedModuleRoutes).
- F8: SPEC drops `scrml serve`; db-target.ts comment cites §8.1.1; `file:` URI → unsupported-scheme → E-SQL-005.
- Structure: runtime path = sqlite-file-target.ts runtimeDbSpecifier (one function; F2 pending);
  ownership = db-ownership.ts decideOwnedDbFiles (one function; F4 pending).

## Round 4 — bryan ruled F2 (data root) + F4 (per-file ownership)
- merged origin/main (9d6ba08b6; FACTS theirs + regen).
- F4: ownership per DECLARING file (decideOwnedDbFiles over one file; program-wide stamp removed from
  codegen/index.ts and PA). Owning handle: `new SQL(_scrml_sqlite_owned(...))` opens at load, may create, prints
  the created line. Referencing: `_scrml_sqlite_referenced(...)` — a Proxy that opens on first use (query / method),
  configures (§44 WAL/busy-timeout) before the first statement, never creates, throws the not-found error at that
  use. Same module alone vs in a build → identical handle (pinned with examples/23 pages vs `scrml build`).
- F2: handle records the db path relative to the project root (projectRootFor: scrml.toml dir via findManifest,
  else .git checkout, else build root) + `_scrml_project_root` (absolute, recorded at build); runtime resolves
  SCRML_DATA_DIR ?? recorded root (`_scrml_sqlite_path`). Moved build with no env → error naming SCRML_DATA_DIR
  (owning: at load; referencing: at first use). `scrml dev` follows the same one rule (honours SCRML_DATA_DIR).
  Outside-root / authored-absolute paths recorded absolute (data root does not move them).
- Adapters: Dockerfile ENV SCRML_DATA_DIR=/data + VOLUME; fly.toml [env] + [mounts] data→/data; render.yaml envVars +
  disk /data; railway: build prints "set SCRML_DATA_DIR to your volume mount path" (volumes are dashboard-attached).
- SPEC §8.1.1 (ownership per file, lazy referencing, supersedes program-wide sentences) + §44.2 step 5 + §39.7 +
  NEW §47.14 Runtime Data Root, both with the S445 provenance.
- The round-1..3 outputDir plumbing (api.js → runCG → fileAST._outputDir) is removed: the runtime path no longer
  depends on the module's output location.
