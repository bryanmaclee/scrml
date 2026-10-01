# s447-dev-db-r5 — progress (append-only)

## 2026-10-01 10:05 — startup
- WT = /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-ae3007278485636a2, clean, bun install + pretest OK.
- Leaked scrml-dev children observed (NOT started by me, NOT killed): PIDs 443349, 892523 (worktree agent-a92d7cfc42e15dd09),
  4119655 (scratchpad rev-approot). Reported to PA.
- Merged worktree-agent-a357de622e258554c (a1123e931) → 2797f0f02. Conflicts: SPEC-INDEX.md + FACTS.md generated counts
  only → took ours + regen (regen-spec-index, facts --write). state.ts --write touched master-list.md (PA-owned
  recent-sessions block) — reverted, not part of this change. Pre-commit full suite passed on the merge commit.
- Merged origin/main (bca39b61a, s445 wrap) clean → fbe0fb85f.

## Governing sentences (verbatim, scrml-support/user-voice-scrml.md §S445)
- Item 6 "db= resolution + creation": *"A `db=` path resolves against the directory of the `.scrml` file that
  declares it, and I'd add that sentence to SPEC. A program that declares its own schema (its own `CREATE TABLE`s or
  a `<schema>`) owns the database, so the runtime may create the file. A program that only references a database
  never creates it and fails loudly if the file is missing."*
- "a built server's data root; ownership is per declaring file", A: *"At build time, record each database path
  relative to the project root. At runtime, resolve those paths against a single data root. That root is the
  `SCRML_DATA_DIR` environment variable if set, otherwise the project root. The Docker/Fly adapters set
  `SCRML_DATA_DIR` to their volume."*
- same, B: *"keep your literal ruling, so only a file that declares the schema may create the database. Other modules
  then open it once it exists, rather than at load time. That way the answer doesn't depend on which files are in the
  build."*
- Direction of change (R4-1): NEWLY-REJECTING at runtime. An owning handle whose recorded path is absolute and lies
  outside SCRML_DATA_DIR, with SCRML_DATA_DIR set and the file missing, now REFUSES to create (previously created at
  the build machine's absolute path). Reading: the ruling says the deploy adapters point SCRML_DATA_DIR at the volume
  so databases live there; creating one outside it in a deployed server contradicts the ruling's intent, and the
  data root "does not move" an absolute path (§47.14), so the only fail-closed option is refusal.

## 2026-10-01 10:18 — R4-1 reproduced on the merged, unfixed branch (fbe0fb85f)
Project: scratchpad/r41/proj (scrml.toml at proj/), src/app.scrml = examples/09 with
`<program db="../../shared/app.db">` (owning: CREATE TABLE IF NOT EXISTS contact_messages).
```
$ cd r41/proj && bun <wt>/compiler/bin/scrml.js build src --target docker -o r41/proj/dist
  -> no warning about the outside-root db
$ grep _scrml_sqlite_owned dist/app.server.js
const _scrml_sql = new SQL(_scrml_sqlite_owned("/tmp/.../r41/shared/app.db", "../../shared/app.db", "app.scrml"));
$ cd dist && SCRML_DATA_DIR=r41/data PORT=38471 bun _server.js
scrml: created new database /tmp/.../r41/shared/app.db (declared as "../../shared/app.db" in app.scrml)
scrml server listening on http://localhost:38471
$ ls r41/shared  -> app.db (4096 bytes)       $ ls r41/data -> (empty)
```
Confirmed: SCRML_DATA_DIR is ignored and the owning handle creates at the build machine's absolute path.

## 2026-10-01 10:35 — fix landed (b729f34f8), code + tests one commit, pre-commit full suite green
- R4-1 runtime: `_scrml_sqlite_owned` refuses (throws at module load) when SCRML_DATA_DIR is set, the file is missing,
  and the path is not inside SCRML_DATA_DIR (only possible for a path recorded absolute). New emitted helpers
  `_scrml_sqlite_data_dir` (normalizes; relative → CWD) and `_scrml_sqlite_inside`. Existing file still opens; an
  absolute path inside SCRML_DATA_DIR still creates; unset SCRML_DATA_DIR unchanged. Referencing error gains a note when
  SCRML_DATA_DIR did not apply to an absolute path.
- R4-1 build: W-DEPLOY-DB-OUTSIDE-DATA-ROOT on docker/fly/render/railway (skipped when the absolute path is under /data).
- R4-2 build: W-DEPLOY-DB-NO-PROJECT-ROOT when the project root came from the build root (no scrml.toml / .git).
- R4-3: `_server.js` bakes the referenced-only dbs (no server module owns them); startup prints one error per missing
  one; /_scrml/health answers 503 (count only — public route, no paths) until they exist. Chose 503 over exit:
  ruling B ("Other modules then open it once it exists") accepts a referenced db appearing after load, and a server that
  exits at boot crash-loops so the operator cannot seed the volume through the running machine (`fly ssh sftp`);
  the failing health check still keeps the deploy from going green. Checked always (SCRML_DATA_DIR ?? recorded root).
- R4-4: build prints "Databases expected under $SCRML_DATA_DIR (unset: the project root recorded at build, <root>;
  a relative SCRML_DATA_DIR resolves against the server's working directory):" + one line per db
  (owning — created on first run / referencing — seed it / absolute — NOT under $SCRML_DATA_DIR).
- R4-5: documented in SPEC §47.14 ("Known: the recorded project root" — server-side only, never client); relative
  SCRML_DATA_DIR → CWD documented in the build report header + emitted helper comment + §47.14. Not "fixed".
- Plumbing: emit-server/emit-tool `noteSqliteHandle` → fileAST._sqliteFileHandles → `compileScrml().sqliteDatabases`;
  build.js `sqliteBuildReport` (pure) + `generateServerEntry(..., referencedDbs)` (byte-identical when empty).
- Tests: NEW compiler/tests/commands/build-sqlite-data-root.test.js (12 tests: R4-1 runtime refuse/relative/unset/
  inside/existing + build warning matrix; R4-2; R4-3 live server 503→200 + entry byte-identity + referenced-only
  filter; R4-4 two CLI e2e builds). Updated: dev-db-no-side-file §1 (handle.record), emit-server-sql-emission (helper).

## 2026-10-01 10:37 — empirical, after the fix
R4-1 (same r41 project, rebuilt):
```
$ scrml build src --target docker -o dist
  [warn] W-DEPLOY-DB-OUTSIDE-DATA-ROOT: "../../shared/app.db" in src/app.scrml names $SP/r41/shared/app.db, outside
  the project root ($SP/r41/proj) or written absolute, so it is recorded as that absolute path and SCRML_DATA_DIR
  (/data on --target docker) does not move it. In the deployed server the program refuses to create it ...
Databases expected under $SCRML_DATA_DIR (...):
  $SP/r41/shared/app.db  (absolute — NOT under $SCRML_DATA_DIR; owning — created on first run only when SCRML_DATA_DIR is unset or contains it)
$ cd dist && SCRML_DATA_DIR=../../data PORT=38472 bun _server.js
error: scrml: refusing to create database $SP/r41/shared/app.db: SCRML_DATA_DIR is set ($SP/r41/data) but this path
  is not inside it. "../../shared/app.db" in app.scrml is outside the project root (or written absolute), ... Fix: move
  the database inside the project root so it resolves under SCRML_DATA_DIR, declare it as an absolute path inside
  SCRML_DATA_DIR, or create $SP/r41/shared/app.db yourself if that location is persistent.
exit=1     ls shared/ -> (empty)    ls data/ -> (empty)
```
examples/09 (copy at $SP/ex09 with scrml.toml) — build:
```
$ scrml build src --target fly -o out
Databases expected under $SCRML_DATA_DIR (unset: the project root recorded at build, $SP/ex09; ...):
  src/contact.db  (owning — created on first run)
$ cd out && SCRML_DATA_DIR=../vol PORT=38473 bun _server.js      (relative data dir)
scrml: created new database $SP/ex09/vol/src/contact.db (declared as "contact.db" in app.scrml)
GET /_scrml/health -> 200 {"status":"ok",...}
```
examples/09 — dev:
```
$ scrml dev src/app.scrml --port 38474     -> GET /app.html 200
scrml: created new database $SP/ex09/src/contact.db (declared as "contact.db" in app.scrml)   (beside the source)
POST /_scrml/__ri_route_submit_1 {} -> 500 "NOT NULL constraint failed: contact_messages.name"
  (the CREATE TABLE ran on that file; the empty body is my probe's, not a defect)
```
Referencing-only program (`<program db="./ref.db">`, SELECT only), db missing — build + run:
```
  src/ref.db  (referencing — seed it)
$ SCRML_DATA_DIR=../vol PORT=38475 bun _server.js
scrml: database file not found: $SP/refonly/vol/src/ref.db — declared as "./ref.db" in src/app.scrml, which only uses
  it, so this server never creates it. Seed it (...). /_scrml/health answers 503 until it exists.
GET /_scrml/health -> 503 {"status":"unavailable","reason":"1 database file(s) missing — see the server log"}
POST count -> 500; log: scrml: database file not found: $SP/refonly/vol/src/ref.db — ... never creates it ...
ls vol -> (empty)
```
Referencing-only — dev:
```
$ scrml dev src/app.scrml --port 38476 ; POST count ->
500 {"detail":"scrml: database file not found: $SP/refonly/src/ref.db — declared as \"./ref.db\" in app.scrml, which only uses it ..."}
find . -name '*.db*' (excluding out/) -> nothing created
```
Processes: killed by PID only my own dev servers (2091898/2091944, 2094578/2094638) and three orphaned dev children
from MY worktree's earlier hook run (2073263, 2073340, 2073425 — `agent-ae3007278485636a2/.../--__dev-child`, ppid 1-reaped).
Left alone: 443349, 892523 (agent-a92d7cfc42e15dd09), 4119655 (rev-approot), and agent-a5977877acc5cf4dd test children.

## 2026-10-01 11:40 — merged origin/main again, final verification
- origin/main moved (2fc4605cb #1212, 310eee4c4 #1209) → merged e996ef0fa; SPEC-INDEX/FACTS: took main's, re-applied the
  §47 row note, regen. Pre-commit on the merge: 33758 pass / 0 fail.
- One combined run (unit+integration+conformance+commands) that overlapped a concurrent pre-commit hook gave 6
  timing fails (5 dev-watcher tests at ~11 s + my R4-3 server test at the 5 s default). All pass in isolation and
  `compiler/tests/commands` alone is 286/0; my test file now sets a 60 s default timeout (5db3b49ab).
- Post-merge: commands + dev-db + the two helper-stripping browser tests + parser-conformance canary/markup:
  1070 pass / 0 fail.
- FINDING (not fixed, out of scope): every full-suite run in this worktree left 3 orphaned
  `scrml dev --__dev-child /tmp/scrml-dev-child-<pid>-1.json` processes (generation-1 children, i.e. the child a
  dev server respawned after a restart; parent killed by the test → child reparented to the user systemd). This is
  the source of the leaked servers the brief warns about. Killed mine by PID (9 total over the session).

## 2026-10-01 r5b — S239 review of e0692a8ae (LAND-WITH-NITS); each claim reproduced before fixing
- Item 5 (ruling conformance), e1de8384d. REPRODUCED: `SCRML_DATA_DIR=devvol scrml dev src/app.scrml` (ex09 copy)
  → `created new database …/ex09/devvol/src/contact.db`. Ruling text: "(dev / compile keep S445 item 6: relative to the
  declaring `.scrml` file.)". FIX: runDev drops SCRML_DATA_DIR before any module loads (parent prints one
  "ignoring" line; app child inherits the cleaned env). SPEC §47.14 data-root bullet narrowed + new "`scrml dev` ignores
  SCRML_DATA_DIR" bullet; provenance records the round-4 reading as superseded. AFTER: `scrml dev: ignoring
  SCRML_DATA_DIR=devvol …` + `created new database …/ex09/src/contact.db`; devvol/ empty. Test: dev-db §3 "IGNORES".
  `scrml compile` (the compile step) never read SCRML_DATA_DIR; compile OUTPUT run standalone still honours it
  (§47.14 "any emitted module run on its own") — flagged to PA as a reading.
- Item 1, 075b2e2f4. REPRODUCED: mono/subA (owning ./app.db) + mono/subB (referencing ./app.db), each with
  scrml.toml; `scrml build . -o out` listed one `src/app.db (owning)` with subA's root only; _server.js had no
  _SCRML_REFERENCED_DBS. FIX: key = (projectRoot, dbPath) (absolute paths key by path); W-DEPLOY-DB-SHARED-PATH when
  ≥2 roots record the same relative path; report lines suffixed "— project <root>" when the build has >1 root.
  AFTER: both listed with their project; SHARED-PATH warning; `_SCRML_REFERENCED_DBS` has subB's src/app.db.
- Item 2, 075b2e2f4. FIX: health/startup check uses statSync(file).isFile(). AFTER (refonly): directory at
  vol/src/ref.db → 503; replaced with a real db → 200. Test: live server dir → 503 → file → 200.
- Item 3, 075b2e2f4. FIX: emitted `_scrml_sqlite_real` (realpath, via nearest existing ancestor; null → not inside =
  fail closed) used by `_scrml_sqlite_inside`; import line gains `realpathSync as _scrml_db_realpath` (harness strip
  regex still matches). Tests: SCRML_DATA_DIR symlink → created; db path through a symlink into the volume → created;
  a symlink inside the volume pointing OUT → refused (stricter than before: textual containment would have created).
- Item 4, 075b2e2f4. Message now: "Fix: move the db= path inside the project (so it resolves under SCRML_DATA_DIR),
  or set SCRML_DATA_DIR to a directory that contains it, then rebuild." SPEC §47.14 sentence: owning refusal exits
  (fixed by rebuild / config) vs referenced-missing health 503 (fixed by seeding, possibly into the running server).
  AFTER (r41): refusal with the new text, shared/ and data/ empty.
- Item 6, 075b2e2f4. Referencing report line: "(referencing — seed it; /_scrml/health reports unavailable until it
  is seeded)" — on every server build (the 503 happens whatever the target). examples/23 source untouched.
- Pre-commit on 075b2e2f4: 33759 pass / 0 fail. Commands + dev-db + emission + wal + ssr + 2 browser: 403/0;
  build-sqlite-data-root: 17/0. Items 1/2/3/4/6 landed as ONE commit (they share build.js / sqlite-file-target.ts /
  the one test file); item 5 separately.
