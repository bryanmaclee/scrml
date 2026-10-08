# progress — s458-reexport-dev-tenant-current

- [2026-10-07] start. `git rev-parse worktree-agent-a32af25e7d4658f1a` = 700cb88aae9c… (confirmed). `git reset --hard 700cb88aa`,
  `git merge origin/main` (origin/main = 46ed1f8ff) -> merge commit 70585eeb0. NO textual conflicts: git auto-merged all seven
  files both sides touched (compiler/SPEC.md, src/api.js, codegen/emit-client.ts, codegen/emit-server.ts, codegen/index.ts,
  commands/build.js, commands/dev.js). Auto-merge is not proof of semantic merge — each reviewed below.
  BRIEF commit 41d39ecce. bun install + pretest OK (34 dist files).
- [2026-10-07] Main commits since 0d8e9d8ce touching build.js / tenant-startup-check.ts / dev.js
  (`git log 0d8e9d8ce..origin/main -- …`): ONLY 125486345 (#1348 §2.2.1). tenant-startup-check.ts: main did not touch it
  (`git diff --stat 0d8e9d8ce origin/main -- compiler/src/codegen/tenant-startup-check.ts` empty), so no main tenant check
  needs carrying into the relocated text. How #1348 survives, checked by reading the merged hunks:
  - build.js: #1348 rewrote `beforeWrite` (only E-MW-007 onion refusal decided there; `!result.artifactsWritten` drives the
    no-files line). The branch's hunk is ~800 lines earlier (generateServerEntry gate text -> `tenantGateEntryLines`).
    Merged file carries both, untouched by each other (`git diff 46ed1f8ff HEAD -- compiler/src/commands/build.js` shows only
    the branch's import + gate-text hunk).
  - dev.js: #1348 removed the `beforeWrite: hasApplicationScopeRefusal` callback + its import (compileScrml now refuses the
    write on any Error). Merged file: callback still absent, import still absent; branch's additions (gate import,
    registeredTenantGate, devTenantGateResponse, loadServerRoutes collect, fetch gate after compileFailure) present.
  - api.js: #1348's pre-write decision (hasFatalBeforeWrite / writeEligible / artifactsWritten) and #1346's
    scrubPlaceholderTokenDeep run around the branch's emitValueOnly fixpoint + reconcileServerReExports, which only
    rewrite in-memory `output.serverJs` before the pre-write decision and before the emit gate — so the gate and the
    no-write decision see the reconciled text.
  - emit-client.ts / emit-server.ts / index.ts: main's hunks (#1341 urlguard chunk gates, #1347 url-shape helper,
    #1344 program-body SQL policy set/reset/drain) are disjoint from the branch's re-export hunks.
- [2026-10-07] `bun run types:check` on the merge: 1 NEW — emit-client.ts TS7016 for '../module-resolver.js' (the branch's
  new import). Same diagnostic is already baselined for 7 other importers of module-resolver.js (no .d.ts exists).
  Recorded with `bun scripts/types-gate.ts --write` (186/119) rather than authoring a module-resolver.d.ts (that would
  re-key all 8 importers — out of scope for a currency merge; surfaced for the PA).
- [2026-10-07] Branch tests on merged tree: s457-reexport-scrml-module, s457-reexport-resolution,
  s457-dev-tenant-startup-check, dev-db-no-side-file, imported-enum-match-binding — 119 pass / 0 fail.
- [2026-10-07] regen of SPEC-INDEX / FACTS (`regen-spec-index.ts`, `facts.ts --write`) was DENIED by the harness
  permission classifier ("Modify Shared Resources"); not run, files untouched (main's versions as merged). Left for the PA.
- [2026-10-07] Gates on f284a456b: pre-commit core suite 32161 pass / 58 skip / 12 todo / 0 fail (32231 tests, 1486 files);
  `bun conformance/run.ts` 1346/1396 pass + 50 xfail, 0 FAIL; CI gauntlet step (todomvc compile + node --check) OK;
  `bun scripts/browser-baseline.ts --check` PASS (48 asserted, 0 of 2 env-excluded observed); types:check OK 186/119.
- [2026-10-07] EMPIRICAL A (.tmp/empA, `scrml build src -o dist`, `PORT=37581 bun dist/_server.js`, page driven in
  happy-dom with scripts fetched from the live server, .tmp/drive.mjs):
  c.scrml: `export type Color:enum`, `export const Card = <div class="card">…`, `export server fn w()`.
  b.scrml: `export { w as helper, Card, Color } from "./c.scrml"`; b2.scrml: `export * from "./c.scrml"`.
  FIRST BUILD (Card + Color + server fn all imported through b / b2) FAILED on the merged tree:
    app.scrml:21 E-COMPONENT-020 `Card` is not defined (+ VP-2 E-COMPONENT-035) — a component re-exported through an
      intermediate module does not expand (CE). star.scrml: same E-COMPONENT-020, and star.scrml:9 E-TYPE-025
      "Cannot match on asIs-typed subject" — an enum reached through `export *` is untyped in TS, so `match` refuses.
  Same project on origin/main's compiler (git-archived to .tmp/maincomp): app E-COMPONENT-020/035 identical (pre-existing);
    star E-IMPORT-004 ×3 (w/Card/Color "not exported by ./b2.scrml") + the same E-COMPONENT-020/E-TYPE-025.
  So the branch closes: server link + client registry + page script order for named and star re-exports; named enum
  `match`. It does NOT close: (i) component through a re-export (CE), (ii) enum `match` through `export *` (TS).
  SECOND BUILD (Card imported straight from c; star's label without `match`): builds, 3 routes, run:
    health 200; app.html 200 initial out="" lab="is-red" card="card-from-c" -> click srv + flip -> out="from-c|app"
    lab="is-green"; star.html 200 -> out="from-c|star" lab="is-Green"; 0 page errors.
    b.server.js `export { w as helper } from "./c.server.js";` b2.server.js `export { w } from "./c.server.js";`
    page scripts: runtime, c.client, b.client, app.client.
- [2026-10-07] EMPIRICAL B (.tmp/empB/run.sh: `scrml dev src --port P` then `scrml build src -o dist` +
  `PORT=P+1 bun _server.js`; same three probes each; dbs seeded by bun:sqlite):
  Governing: SPEC §47.14 "A server built by `scrml build`, and `scrml dev`'s app server, SHALL, before it serves, ask every
  database it opens which relations carry a `tenant_id` column outside the compiled tenant set … While any does, or a
  database cannot be inspected, it SHALL print `E-DEPLOY-DB-TENANT-UNDECLARED` once per finding, answer `503` to EVERY request".
  dirty (src/app.db + undeclared `invoices(tenant_id)`): dev AND built identical —
    health 503 {"status":"unavailable","reason":"1 undeclared tenant table(s) or unchecked database(s) — see the server log"},
    app.html 503, POST /_scrml/__ri_route_listAssets_1 503 "Service Unavailable"; log
    `scrml: E-DEPLOY-DB-TENANT-UNDECLARED: database ./app.db holds "invoices", which has a tenant_id column, …` once.
  clean: dev AND built — health 200 {"status":"ok",…}, app.html 200, route 403 CSRF (= dispatched).
  no database: dev starts and serves (app.html 200, route 403 CSRF); health 404 under dev vs 200 built — dev has no
    /_scrml/health unless the tenant gate is armed (pre-existing on base: dev never had the route). Not changed.
  Postgres `db="postgres://…@127.0.0.1:59999/nodb"` (nothing listening): no crash at startup in either host; both answer
    503 everywhere + log "database postgres://<redacted>@127.0.0.1:59999/nodb could not be checked — … (Failed to
    connect) …". Fail-closed per §14.8.10 item 3 — NB this means `scrml dev` on a PG app without a live PG no longer
    serves even the page (semantics change for dev; built server has done so since S456).
- [2026-10-07] Corpus measurement: `bun scripts/corpus-emit-differential.ts capture` base = git-archived origin/main
  46ed1f8ff (.tmp/base, node_modules symlinked) vs head 6093dc064; `diff` verdict INCOMPARABLE only because base is not a
  git checkout (rev "<unknown>") and absolute paths differ. Enumerated 2425/2425, compiled 1450/1450, failure SET
  identical (0 newly failing / 0 newly passing), 0 diagnostic-code changes, 0 syntax delta, artifact set delta 0.
  200 content diffs: 162 are only `_scrml_project_root` (path-stripping normalizer .tmp/norm.ts: 7084 files, 38 differ
  after stripping "/.tmp/base"); all 38 are examples/23-trucking-dispatch (pages now load ../schema.client.js;
  models/auth.client.js footer registers re-exported UserRole; schema.client.js gains its registry footer) — same as the
  predecessor's measurement. `corpus-compile-floor --check` PASS; `snippet-gate` 122/122.
- [2026-10-07] `regen-spec-index.ts --check` OK (0 stale). `facts.ts --check` FAIL: `@generated:facts-table` STALE —
  needs `bun scripts/facts.ts --write` (denied to this agent by the harness classifier; PA to run).
- [2026-10-07] FIX ROUND (PA S458 review: F1 MED, F2-F4 LOW). Governing §21.3: "Circular imports SHALL be a compile error
  (E-IMPORT-002). The compiler SHALL detect cycles in the import graph before any stage runs and report all files in
  the cycle." / "Importing a name that is not exported by the target file SHALL be a compile error (E-IMPORT-004 …)".
  Reproduced on 0b2e11e31 (.tmp/repro.ts, compileScrml): f1-named / f1-pure / f1-star / f1-mixed (x re-exports from y,
  y imports x) all compile with 0 errors; f2 `export { K, Nope } from "./c.scrml"` 0 errors; f4 two stars binding `w`
  differently -> E-IMPORT-004 "not exported … add `export w`" + W-SERVER-IMPORT-UNEMITTED "b.scrml has no server
  content"; f3 lattice depth 12 full compile 2370 ms, depth 16 77892 ms.
  Fix (module-resolver.js): detectCircularImports walks `exports[].reExportSource` (named + star) as edges, message
  notes the re-export, errors carry cycleFiles; new validateReExports (named re-exports, in-graph source, cycle files
  skipped) wired as resolveModules step 4b; resolveExportedBinding memoized per graph (WeakMap, reset in
  buildExportRegistry; cycle-tainted answers not memoized); ambiguousStarSources + "ambiguous" E-IMPORT-004 text in
  validateImports and validateReExports (errors carry ambiguousStarName/importerFile/targetFile). api.js
  checkServerImportInvariant skips importer/target pairs with an ambiguous E-IMPORT-004.
  After: all four F1 shapes E-IMPORT-002 (pure cycle: no extra E-IMPORT-004); f2 E-IMPORT-004 at the re-export; f4
  ambiguous message, no W; depth 16 full compile 253 ms.
  Tests: unit/s458-reexport-review-fixes 13 pass; conformance +6 (module/e-import-002-reexport-cycle-named-reject,
  -cycle-star-reject, -import-cycle-mixed-reject, e-import-004-reexport-missing-name-reject, -ambiguous-star-reject,
  -chain-clean) all PASS; run 1352/1402 + 50 xfail. types:check OK unchanged. SPEC not touched (§21.3 already governs).
- [2026-10-07] Fix committed 091b1c6aa (hook: 32180 pass / 58 skip / 12 todo / 0 fail, 32250 tests, 1487 files).
  browser-baseline --check PASS (48 asserted). Corpus by COMPILE, corpus-emit-differential base = git-archived
  46ed1f8ff vs head 091b1c6aa: common sources 2425 (+20 new = the 6 new conformance dirs), compile-failure SET delta
  0 newly failing / 0 newly passing; diagnostic-CODE change in 1 source: stdlib/data/index.scrml (already failing on
  base with E-CODEGEN-INVALID-LOGIC; head E-IMPORT-004 instead) — `export { tableFor, TableSort } from
  './table-for.scrml'` while table-for.scrml declares `type TableSort:struct` WITHOUT `export` (line 112). A real,
  previously silent §21.3 violation in stdlib; NOT migrated (PA instruction). Adopter blast radius: an app doing
  `import { pick } from "scrml:data"` compiles clean on head and base (the stdlib module is not in the user graph).
  Effective syntax delta 0; script-goggle +12 = library chunks of the new conformance sources (module syntax). Artifact
  diffs after path normalization: 38, all examples/23-trucking-dispatch (the s457 re-export change, identical to the
  pre-fix measurement) — the F-round itself changes no emitted artifact.
