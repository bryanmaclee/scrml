# progress — s457-reexport-and-dev-tenant-check

- [2026-10-07] start; base 0d8e9d8ce == origin/main. bun install + pretest OK (34 dist files).
- [2026-10-07] A REPRODUCED on base:
  - reA (c: `export server fn w`, b: `export { w as helper } from "./c.scrml"`, a: server fn calls helper):
    b emits NO .server.js; `bun -e 'await import("./a.server.js")'` -> `Cannot find module './b.server.js'`; W-SERVER-IMPORT-UNEMITTED fires.
  - reB (b also has its own server fn): `SyntaxError: Export named 'helper' not found in module .../b.server.js` (the reviewer's message).
    Client: `_scrml_modules["b.client.js"] = { own: ... }` (no helper/p/K); a.html never loads c.client.js.
  - reC (`export * from "./c.scrml"`): E-IMPORT-004 x3 (w/p/K "not exported by ./b.scrml") — star never enumerated.
  - control (a imports straight from c): works.
  - locus: emit-server.ts emitModuleValueExportLines skips re-export/re-export-all; emit-client buildModuleRegistryFooter
    registers only locally-declared bindings; codegen/index.ts computeDependencyClientScripts follows imports only;
    module-resolver buildExportRegistry/validateImports never enumerate `export *`.
- [2026-10-07] B REPRODUCED on base: project `<program db="./app.db">` + `<schema>` declaring `assets`; db seeded with an
  extra `invoices(tenant_id)` table. `scrml dev src --port 37411`:
  `/_scrml/health` -> 404 Not found; `/app.html` -> 200; `POST /_scrml/__ri_route_listAssets_1` -> 403 (CSRF — i.e. dispatched).
  No E-DEPLOY-DB-TENANT-UNDECLARED in the log. dev.js loadServerRoutes skips the `_scrml_tenant_startup_check` export
  (not a {path,method,handler}); the gate lives only as emitted text in build.js generateServerEntry.
  NB: SPEC §34 row E-DEPLOY-DB-TENANT-UNDECLARED says "`scrml dev` does not run it" — needs amending with the fix.
- [2026-10-07] A FIXED (pending gate): module-resolver star enumeration + resolveExportedBinding/exportedNamesOf/
  localReExportEdges/isReExportedByAnother; emit-server `export { … } from "./c.server.js"` (dist-space spec);
  api.js value-only fixpoint over re-export lines + reconcileServerReExports (decide off emitted output);
  emit-client footer re-export pairs + source module gets a footer/modules chunk; index.ts dep-script order follows
  re-exports, isCrossFileLinked, #358 client-read seed followed through re-exports; emit-client-esm namespace re-read.
  New tests: integration/s457-reexport-scrml-module (7; 7 fail on base by file-copy flip), unit/s457-reexport-resolution (5).
  Empirical: reB/reC route -> 200 "from-c|p:kay|own-b" (control identical); happy-dom page load clean, registry identity.
- [2026-10-07] B FIXED (pending gate): gate text moved to codegen/tenant-startup-check.ts TENANT_GATE_LINES (+ header,
  tenantGateEntryLines, createTenantGate via new Function over the same text). build.js emits it verbatim —
  generateServerEntry output BYTE-IDENTICAL to base (cmp on a 2-module entry). dev.js loadServerRoutes collects
  `_scrml_tenant_startup_check`, builds the gate; buildServeConfig fetch gates after compile-failure (WS included);
  `/_scrml/health` answers like _server.js while armed. Empirical `scrml dev` (.tmp/run-dev.sh):
  dirty -> health 503 {count}, app.html 503, route 503, E-DEPLOY-DB-TENANT-UNDECLARED logged;
  clean -> health 200, app.html 200, route 403 (CSRF = dispatched). SPEC §14.8.10 item 3, §34 row, §47.14 amended.
  New test unit/s457-dev-tenant-startup-check (5).
- [2026-10-07] first B commit refused by the hook: integration/dev-db-no-side-file §3 (REFERENCING program, missing db)
  expected dev's old 500-at-first-use; dev now refuses 503 like _server.js has since S456 (a db that cannot be
  inspected SHALL NOT be served, §14.8.10 item 3). Empirical (.tmp/run-ref.sh): route/app.html/health 503,
  log "E-DEPLOY-DB-TENANT-UNDECLARED: database ./ref.db could not be checked … database file not found: <path> —
  declared as "./ref.db" in app.scrml", no db file created. Test updated to that contract (path-in-log, value-free
  client body, nothing created kept). All 19 dev-driving test files: 270 pass / 0 fail.
- [2026-10-07] B committed 4d2d91ad1 (hook: 31873 tests, 0 fail). Conformance: 1341 pass + 50 xfail / 1391.
- [2026-10-07] Measurement (.tmp/measure.sh, base = git-archived 0d8e9d8ce compiler vs worktree): ex23 — 9 pages now
  load ../schema.client.js (models/auth.scrml re-exports UserRole from ../schema.scrml); diagnostics identical;
  sample phase1-export-reexport-008 + a scrml:auth/store/oauth probe: 0 differing lines. The measurement exposed a
  wrong client filter: a re-exported ENUM (kind "type") was skipped although its variant object is a real client
  value — fixed (client pairs mirror a direct import; only channels skipped). New test (enum) fails on the old filter.
  ex23 auth.client.js footer now registers `UserRole: _scrml_modules["schema.client.js"].UserRole`.
