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
- 2026-09-24 ROUND 3 (re-review of 14e61077: F1/F2/F3/F5 held; F4 approach rejected — pattern redaction is
  enumerate-forever + mangles frames). Merged origin/main (f554e171, maps-only) -> 43a74eac.
  b1915379: VALUE-based redaction.
    compiler/src/diagnostic-secrets.ts: collectFromAst (db/src/store/*-store string attrs anywhere in the tree),
      harvestFromSource (narrow db=/src=/*-store= VALUE harvest, quoted or unquoted — needed because the tree
      misses single-quoted <db src='…'> [pre-existing mis-tokenization into attr NAMES], unquoted db=scheme://…
      [also shredded into names], and files that fail BS), deriveSecrets (userinfo password under WHATWG and
      last-@ readings; password|pass|pwd|passwd|sslpassword query/keyword values; raw/unquoted/decoded),
      SecretRedactor.redact (whole echoed value -> display form, then exact secret substrings; secrets < 6 chars
      only at non-word boundaries so they cannot shred prose).
    SINK LIST (every place compiler output can carry a connection value):
      1. compileScrml (api.js) — THE chokepoint. Redacts every string field of result.errors / warnings /
         lintDiagnostics, a thrown compiler error's message+stack, and Note(PA) lines via runPA onNote; exposes
         result.redact. Downstream readers of those messages: commands/compile.js, dev.js (console, error page,
         JSON), build.js, serve.js, semdiff.js, migrate.js, promote.js.
      2. commands/compile.js — result.redact over each printed lint/warning/error block (covers the source
         excerpt read from disk).
      3. commands/generate.js — `detected <db src=…>` line (R2-2).
      4. commands/introspect.js — every error after URL parse (`say`), incl. driver error text.
      5. lsp/handlers.js analyzeText — every editor diagnostic + PA notes to the server log.
      Not covered: a direct runPA caller that passes no onNote writes notes raw to stderr (unit tests; the
      self-host runPA override ignores onNote — self-host is out of scope). PA's own messages still display the
      value via redactDbUri (defense in depth for direct callers).
    compiler/src/db-target.ts classifyDbTarget: THE classifier (trim, case-insensitive scheme; Bun.SQL accepts
      POSTGRES:// — measured). resolveDbDriver + protect-analyzer both use it; PA never treats a scheme:// value as
      a file, and strips sqlite:/sqlite:// to the path. Behaviour change: POSTGRES:// / PostgreSQL:// / leading
      space now resolve to the postgres driver (were E-SQL-005 / file path).
    redactCredentialsInText (pattern) deleted; redactDbUri kept only as a value's display form.
    R2-5: EMPTY = zero user tables+views (name NOT LIKE 'sqlite\_%'); views-only db not EMPTY; sqlite_sequence-only IS.
    Mutation proof (mirror in .scratch/mut): C1 api diag loop, C2 compile.js excerpt, C3 Note onNote, C4 no
      harvest, C5 no tree, C6 LSP, C7 generate, C8 introspect, C9 PA classifier revert, C10 PA display — each
      turns >=1 test red (C2: 16).
  ROUND 3b (coordinator: no newly-accepting change inside a security fix):
    SPEC searched for a sentence making URI schemes / db= prefixes case-insensitive: grep "case-insensitiv" x
      scheme/prefix/db/uri/url/driver, and "prefix|scheme ... case" — only hits are §4.17/§34 E-SCRIPT-001 /
      E-STYLE-001 close-tag matching. None governs db=. => reverted, not stopped.
    classifyDbTarget now reproduces base resolveDbDriver EXACTLY: trim kept; postgres:// postgresql:// mysql://
      sqlite: mongo:// mongodb:// matched case-SENSITIVELY; any other scheme:// (case-insensitive regex, as base)
      -> unsupported-scheme with the scheme quoted AS WRITTEN. So POSTGRES:// / PostgreSQL:// / MONGODB:// /
      SQLITE:// are E-SQL-005 exactly as before; SQLITE:./x.db still falls to the path heuristic.
    Verified against MAIN's compiler (read-only) for 9 edge values x {<program db>, <db src> + DDL}: identical
      diagnostic codes and exit status in all 18 runs.
    protect-analyzer: postgres/mysql -> driver; mongo/unsupported-scheme -> "unsupported" = NOT a file (R2-1 fix
      kept) but reported as "Database target ... uses a URI scheme no ?{} driver accepts (E-SQL-005 ...)"
      (E-PA-002 wording + Note(PA) wording), never as a driver and never as a resolved path. Fire conditions are
      unchanged from base (base resolved these to a path that never exists -> the same E-PA-002 / shadow outcomes).
    DEFERRED TO BRYAN: case-insensitive scheme acceptance. Reason for it: RFC 3986 §3.1 says schemes are
      case-insensitive and Bun.SQL accepts POSTGRES:// / MYSQL:// (measured). That is a reason, not a ruling —
      it would newly ACCEPT values that are E-SQL-005 today and needs a SPEC sentence.
    Kept (has a governing sentence): the protect-analyzer strips a `sqlite:` prefix to its path before the
      schema read. SPEC §8.1.1 driver table (L6512) "`sqlite:./path` | bun:sqlite via Bun.SQL | Local SQLite
      file" + L6533 "A plain path without prefix (e.g., db="./app.db") SHALL be treated as sqlite:./app.db".
      Base resolved `sqlite:./x.db` to the nonexistent `<dir>/sqlite:/x.db`, so a <db src="sqlite:…"> never
      read its real file. This CAN change outcomes: such a block now reads the real file (and may newly report
      E-PA-004 where the shadow schema used to pass). Surfaced for the re-review.
  R2-6 LEFT (per coordinator): a crashed writer can leave a -shm with no -wal; openSchemaReadHandle then takes
    the immutable path and the stray -shm persists (base behaved the same). A checkpoint racing the existsSync
    (-wal) probe can pick the immutable path while a writer is mid-flight; immutable then reads the main file
    only. immutable did improve the hot-journal case (no journal replay attempt, no side file).
- 2026-09-24 ROUND 4 (re-review of 241a33ab: 333-file db corpus identical base vs fix; default paths clean).
  Merged origin/main 3676d2ae (#1042) -> b724547a. Fix 1bb6c49a:
  A (verbose leak): compileScrml harvests the inputs UP FRONT, each source as BS reads it (covers gathered
    imports), and the tree after TAB; wraps the `log` callback; and intercepts console.log/error/warn/info +
    process.stdout/stderr.write for the duration of the (synchronous) compile, restored in finally.
    Grep of api.js + stages for direct writes that can carry a message or a value (all now under the
    interception): api.js verbose collectErrors log (the reported leak) + every other log(); protect-analyzer
    Note(PA) (default stderr writer; api passes onNote too); expression-parser.ts:3071 console.warn (source
    preview); codegen/log-loc.ts:339/365; codegen/runtime-chunks.ts:401; reachability-solver.ts:166 perfLog.
  B (thrown values): re-thrown as a NEW object via SecretRedactor.redactThrown — message, stack, cause
    (recursive, depth 4), every own string prop (filePath, path, …); a thrown string is redacted. dev's
    compileThrowDiagnostic receives the redacted object (String(err), e.filePath).
  C (over-redaction — design correction):
    (1) values collected ONLY from <program db>, <page db>, <db src>, <program idempotency-store> (the SPEC's
        only *-store= attribute; session-store= is a mentioned follow-up, not defined). Never a generic src=.
        Tree walker + an opening-tag scanner that records value offsets (handles quotes, \-escapes, unquoted).
    (2) messages: each WHOLE value replaced by its POSITIONAL display form (userinfo span + password-param value
        spans -> <redacted>), plus the forms messages actually echo: trimmed, the sqlite:-stripped path (in
        resolved-path messages), and two self-anchored fragments — `user:password` (the ':' joins the pair) and
        `key=value` for password params. The fragments exist because an unquoted `db=scheme://…` is split by the
        tokenizer into attribute NAMES and W-ATTR-001 then quotes `admin:s3cret@db=` — found while testing.
    (3) excerpts: redacted by attribute SPAN first (stateless — correct even if the file changed on disk after
        the compile, which watch mode prints), then exact copies of a registered whole value.
    (4) LONG_SECRET_RULE: a bare secret is replaced on its own only if >= 12 chars AND not purely alphabetic.
        Every compiler token that could collide (codes like E-PA-002 [8], commands, element/attr names, SQL
        identifiers, dictionary words, line numbers, §-refs) is shorter or single-class; a strong password is
        12+ and mixed. Backstop only — for a message that echoes the value transformed (normalized path).
        Known residue: a value whose resolved path is normalized (`a//b`, `..`) and whose secret is < 12 or
        purely alphabetic can still print in E-PA-002's path. Not reproduced in the corpus; noted.
    redactDbUri is now the positional display: postgres://postgres:postgres@h -> postgres://<redacted>@h.
  Mutation proof (mirror .scratch/mut, db-uri-redaction + -r4 tests): A1 log callback unredacted -> 3 red;
    A2 no interception -> 1 red; B rethrow raw -> 2 red; B2 own props/cause raw -> 1 red; C3 excerpt not
    span-redacted -> 26 red; C3b excerpt by whole-value substring only (no span) -> 1 red (stale-registry case);
    C1 <img src> harvested -> 2 red; C4 bare secrets any length -> 6 red.
  UNVERIFIED (per coordinator, not chased): self-host compiler/self-host/pa.scrml:228 Note(PA) writes its own
    stderr (self-host out of scope; api's interception would still catch it when run under compileScrml);
    db-migrate.js error prints and dev.js:1074 route-handler error print are RUNTIME error text, not compile
    diagnostics — follow-up.
  DECLARED BEHAVIOUR CHANGES riding this arc (for the PR description):
    1. `sqlite:` prefix strip in the protect-analyzer: `<db src="sqlite:./x.db">` now behaves exactly like
       `<db src="./x.db">` (SPEC §8.1.1 L6512 + L6533). Base resolved it to the nonexistent `<dir>/sqlite:/x.db`
       and always fell to the shadow schema. Newly fires E-PA-004 ONLY when a real db file sits beside the
       source and lacks a listed table.
    2. F2 shadow-cache key (path + exact CREATE set): removes a false E-PA-004 -> newly ACCEPTS two `<db>`
       blocks sharing a `src=` with different `tables=` (same file or across files).
