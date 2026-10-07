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
