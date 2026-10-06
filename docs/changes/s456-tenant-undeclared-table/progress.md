# progress — s456-tenant-undeclared-table

- startup: base 2dd6d35d9 == origin/main; bun install + pretest OK; branch fix/s456-tenant-undeclared-table
- maps: primary.map.md S455 block LOAD-BEARING — `compilationTenantSet` (tenant-egress.ts:369) computed ONCE at api.js TENANT-SCHEMA stage; the (1)/(2) checks must read that one set, not recompute.
- governing: SPEC §14.8.10 read in full (11998-12887); §47.14 read in full (31910+); user-voice §S456 read.
- loci: compile-time DB opens = protect-analyzer.ts ONLY (processDbBlock: real file via SchemaCache.openDb / shadow via openShadowDb; `sqlite_master` scan :1489). `<program db=>` live files are NOT opened at compile time → they fall to (3) startup check. Startup family = build.js generateServerEntry `_SCRML_REFERENCED_DBS` + health 503.
- PHASE 0 (measured): superset grep over samples/ examples/ stdlib/ conformance/ compiler/self-host-v2/ benchmarks/ + flogence/src — 18 .scrml name tenant_id; EVERY `CREATE TABLE … tenant_id` is inside `<schema>` (0 program-body). 19 corpus SQLite files scanned (sqlite_master ⋈ pragma_table_info): 0 carry a tenant_id table/view. → NEWLY REJECTED by (1)/(2): 0. Proceeding.
