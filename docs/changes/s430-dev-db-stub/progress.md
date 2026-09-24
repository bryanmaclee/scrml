- 2026-09-23T21:37:49-06:00 start at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a65be3aac4fb5a48c
- 2026-09-23T21:42:26-06:00 REPRODUCED on .scratch/fx (compile other.scrml src/app.scrml -o src/dist; compile src/app.scrml; dev src/app.scrml -> 0-byte src/x.db; compile -> E-PA-004). Also reproduced on rsync copy of flogence. Trigger: stale multi-root artifact src/dist/src/app.server.js emits sqlite:src/x.db (ss19#9 re-relativization, base=root); dev loadServerRoutes imports EVERY *.server.js under serveDir; Bun.SQL creates file.
- 2026-09-23T21:56 ROOT CAUSE (full chain, reproduced on .scratch/fx2 = adopter shape):
  1. `compile src/` where src/ports/tool.scrml imports ../../lib.scrml (flogence: src/ports/graph-read-tool.scrml
     imports ../../graph-read.scrml) -> computeOutputBaseDir (api.js:231) = common ancestor = REPO ROOT.
  2. emit-server.ts ~6530 (ss19 #9 re-relativization): source dir src/ != base root -> the runtime literal for
     src/app.scrml's db="./x.db" becomes `sqlite:src/x.db` (file-relative resolve, re-relativized to base).
     The SAME source compiled alone (`compile src/app.scrml`, base = src/) emits `sqlite:./x.db`.
  3. That multi-root output lands at src/dist/src/app.server.js; a later single-file compile writes
     src/dist/app.server.js beside it. Neither cleans the other.
  4. `dev src/app.scrml` -> loadServerRoutes (dev.js:321) imports EVERY *.server.js under serveDir
     (findOutputFiles, recursive) incl. the stale src/dist/src/app.server.js. Child cwd = launch cwd (repo root).
     Module-init `new SQL("sqlite:src/x.db")` -> Bun creates 0-byte root/src/x.db. (Not the compiler: PA opens
     readonly + existsSync-gated.)
  5. Next compile: protect-analyzer resolves src="./x.db" file-relative -> src/x.db now EXISTS (0 bytes) ->
     opened instead of the shadow schema -> E-PA-004.
  Underlying: compile-time (file-relative) and runtime (literal opened CWD-relative, literal itself
  compile-unit-dependent) never agree for this adopter; the adopter's `./flogence.db` works only because
  runtime cwd = repo root while compile falls through to the shadow schema.
- GOVERNING SENTENCE: none found. Searched §8.1.1 (L6500-6560: "A plain path without prefix ... SHALL be
  treated as sqlite:./app.db" — prefix only, no base), §44.1/44.2/44.7/44.7.1, §4.12.2/§4.12.6, §39
  (L22620/22638/22674 "database path is read from the enclosing <program db>", §39.7, §39.8 "alongside the
  database path"), §52 (only <db src="app.db"> example L33997), §34 E-PA-001..007 rows, §41 (L23956 defines
  "project root = directory containing the <program> file" for vendor: only). grep "relative" x db/sqlite/src.
  => resolution base is a RULING. Stopped at diagnosis for that part; no resolution change made.
- a0cf97ae: E-PA-004 names resolved abs path + src= + base dir; ZERO-BYTE front-loaded; tests.
- 2026-09-24 FIX ROUND (adversarial review of eac84828). main unmoved (15e60e4b); no merge needed.
  F4 SECURITY 64194551: new compiler/src/db-uri-redact.ts (redactDbUri / redactCredentialsInText).
    URI-echo site survey (grep of compiler/src for db=/src=/connection-string interpolation into messages):
      REDACTED   protect-analyzer.ts E-PA-002 `what` (Driver URI `...`)         compile-time diag
      REDACTED   protect-analyzer.ts E-PA-002 db-migrate remedy --db ...        compile-time diag (placeholder when
                 credentials present; verbatim when credential-free so it stays copy-pasteable)
      REDACTED   protect-analyzer.ts Note(PA) stderr line                       compile-time note
      REDACTED   codegen/db-driver.ts E-SQL-005 (mongo:// branch)               compile-time diag
      REDACTED   codegen/db-driver.ts E-SQL-005 (unrecognized-scheme branch)    compile-time diag
      REDACTED   commands/compile.js getSourceContext code frame (the source line printed under every diag)
      REDACTED   commands/introspect.js non-postgres driver error (CLI; echoes the URL argument)
      NOT A DIAG emit-server.ts / emit-tool.ts / emit-channel.ts write the conn string into the SERVER bundle
                 (runtime needs it; server-only). Hard-coded creds in a server artifact is a separate hygiene
                 question (env-var indirection) — surfaced, not touched.
      NOT ECHOED db-migrate.js (only a SQLite path at :485); Bun.SQL connection-error e.message text not audited.
      NOT ECHOED protect-analyzer E-PA-003 (file paths only; openDb never sees a driver URI).
  F1/F2/F3/F5 0aaffd32:
    F1 openSchemaReadHandle: no -wal present -> file: URI + immutable=1 + READONLY|URI (no side files, measured);
       -wal present (live writer) -> plain readonly (measured: immutable misses an un-checkpointed CREATE TABLE).
    F2 shadow cache key = path + sorted exact CREATE set; shadow wording names ?{} AND <schema> (both feed the map).
    F5 "<512" premise measured FALSE on bun:sqlite: only 0/1-byte files open as empty dbs; every 2..600-byte
       non-db (zero-filled or junk) -> "file is not a database" (E-PA-003). A real tableless db (4096B WAL
       header) is equally empty. Predicate is now sqlite_master table count == 0; message states byte size.
    F3 mutation proof (mirror copy in .scratch/mut; each applied, test run, reverted):
       M1 open -> new Database(dbPath)       : 2 red     M4 cache key = dbPath          : 2 red
       M2 drop readonly, live-WAL branch     : 1 red     M5 driver URI into detail      : 1 red
       M3 drop immutable                     : 1 red     M6 empty = size===0            : 2 red
       F4a..d unredact Note / E-PA-002 / E-SQL-005 / code frame : 2 red each
  F6 LEFT: dev.js:630 / build.js:907 print message.slice(0,120) — a long absolute path pushes the rest of
     E-PA-004 out (EMPTY is front-loaded so it survives; the path itself may be cut).
  F7 LEFT: a backtick inside a path breaks the code span in the message.
  Pre-existing, noticed: E-PA-002 text + Note(PA) say "?{} block(s)" though <schema> DDL also feeds the shadow map.
