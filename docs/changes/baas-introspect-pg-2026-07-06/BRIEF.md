# Dispatch BRIEF (S136 archival) — BaaS #3 Postgres schema introspection

**Dispatched:** 2026-07-06 (S242). **Agent:** scrml-js-codegen-engineer, isolation:worktree, base `c6c353bc`. **Change-id:** `baas-introspect-pg-2026-07-06`.
**PA post-dispatch:** run the adversarial `/code-review` (S239 — agent cannot run it in-agent) before landing; S67 file-delta; push (fix #1/#2 gate).

---

## Design (as briefed)

Add `scrml introspect` — read a live Postgres DB's schema and emit the equivalent scrml `<schema>` source. Additive; eases adopter migration. Three pieces:

**Piece 1 — `readActualSchemaPg(sql)` in `compiler/src/schema-differ.js`** — sibling to the SQLite `readActualSchema(db)` (L242). `async` (Bun.SQL is async). Reads `information_schema.tables`/`columns` + `table_constraints`/`key_column_usage`/`constraint_column_usage`. Returns the SAME structure as `readActualSchema`, as a superset adding `unique` + `references` (both already read by `diffSchema`/`generateCreateTable` on desired cols): `{ tables: [{ name, columns: [{ name, type(raw PG data_type), notNull, default, primaryKey, unique, references:{table,column}|null, sharedCorePredicates:[] }] }] }`.

**Piece 2 — `emitScrmlSchemaSource(actual)` in `compiler/src/schema-differ.js`** — actual structure → scrml `<schema>` SOURCE (not SQL DDL). Target SPEC §39: `name: <scrmlType> [primary key] [not null] [unique] [references t(c)] [default(lit)]`, tables wrapped `<schema>\n  <tbl> {\n … }\n</>`. PG `data_type` → scrml type map: int-family→`integer`; text/varchar/char→`text`; bool→`boolean`; numeric/real/double→`real`; timestamp/timestamptz/date→`timestamp`; json/jsonb/uuid/unmapped→`text` + `W-INTROSPECT-TYPE-UNMAPPED`. Verify the scrml `<schema>` column-type vocabulary against §39 + the SQLite `generateCreateTable` path (don't assume `real`/`boolean` are valid column types — fall back + warn if not).

**Piece 3 — `scrml introspect` CLI — new `compiler/src/commands/introspect.js` + register in `cli.js`.** `scrml introspect <pg-url> [--out f] [--table n]`. Validate postgres driver (`resolveDbDriver`, `db-driver.ts`); `new SQL(url)`; `await readActualSchemaPg(sql)`; `emitScrmlSchemaSource`; stdout or `--out`; warnings→stderr; close handle.

**Tests (no live PG):** `schema-introspect-pg.test.js` — `readActualSchemaPg` with a STUB `sql` returning canned information_schema rows (users/posts fixture); **round-trip** (emit → `parseSchemaBlock` → structure matches fixture — the load-bearing check); type-map table. Pre-commit subset green before DONE.

**Scope v1:** base tables, columns, single-col PK/NOT NULL/UNIQUE/DEFAULT/single-col FK, type map. OUT: CHECK→shared-core-predicate recovery (SQLite reader also punts, L258), composite PK/FK, indexes, enums, views, sequences (serial→integer), non-public schemas.

Standard F4/S88/S90/S99/S126 startup-verification + path-discipline + S83 commit-discipline blocks included in the dispatched prompt. Maps flagged ~stale (66a3afb1). Authority: BaaS-parity DD `../../../../scrml-support/docs/deep-dives/baas-parity-worth-it-2026-07-05.md` #3.
