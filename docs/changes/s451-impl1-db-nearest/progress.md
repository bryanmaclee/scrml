# progress — s451-impl1-db-nearest

- started at /home/bryan-maclee/scrmlMaster/scrml/.claude/worktrees/agent-a9f1b93c1827a0774 on origin/main c58ce8121
- `04c27e299` resolver + one handle per database + deep `_dbVar` tags (+ tests pinning old `_scrml_sql_<n>` numbering updated)
- `f4e2b3cdf` per-server-function handle, §8.9.2 envelope, §52 load routes, `watches=` feed, E-SQL-011, E-SQL-004 (multi-db unscoped) + unit/runtime tests
- gap `g-impl1-db-resolution-not-nearest-s451` → resolved; `bun scripts/state.ts --write` / `--check` PASS

## Governing text (SPEC at c58ce8121, read in full)

§8.1.1: "A `?{}` context resolves its database by walking up the ancestor tree from the `?{}` block's position to the closest **database scope**. Two elements are database scopes: a `<program>` with a `db=` attribute, and a `<db>` state block (its `src=` attribute). The NEAREST one wins, whichever of the two kinds it is."

§8.1.1 normative: "The compiler SHALL resolve the database for each `?{}` block by finding its closest ancestor database scope … 'Closest' means fewest nesting levels up the element tree, counting both kinds; the `?{}` runs on that scope's database and on no other." / "If no ancestor is a database scope, the `?{}` block SHALL be a compile error (E-SQL-004 …), except in a module-with-db-context (§44.7.1), where the file's top-level `<db src=>` applies."

§8.1.1 Ownership: "*That database* for a `?{}` block is the database the block runs against, as the resolution rule above gives it: its nearest enclosing database scope … A file can therefore own more than one database, one per scope that declares schema." Creation: "Only an owning file's handle SHALL create a SQLite database file."

§44.2: "The first database scope reached — a `<program>` with `db=` or a `<db src=>` block — determines the driver and the database." §44.7.1: "The module OWNS its connection." §43.6: "A nested `<program db="...">` creates its own database driver scope. `?{}` blocks inside resolve to the nested program's `db=`, not the parent's."

## Design

- `db-ownership.ts resolveDbScopes(nodes, filePath)` — one DFS over structural fields carries the nearest scope down; every node's scope comes from its ancestor chain. Document order only numbers handles.
- One handle per DATABASE (same resolved sqlite file / same connection string → same handle = one connection, one §19.10.6 guard). `_scrml_sql` = the file default (`fileDefaultDbDecl`, unchanged), others `_scrml_sql_<n>` → single-db files emit identical handles.
- codegen/index.ts tags every node under a scope `_dbVar = handle` (was: one level under `<program db>` only, `<db src>` never).
- emit-server: `collectDbScopes` declares from the resolution; each server fn's opts carry `dbVar` = handle of the `?{}` sites it contains (`_fnDbVar`); the implicit envelope BEGIN/COMMIT/ROLLBACK uses it (and its dialect); Tier-1 / Pattern-C load + SSR seed queries use the cell's scope; `watches=` feed uses its channel's scope.
- Two databases in one fn → E-SQL-011 (fail closed; NOT in SPEC §44.7 — open question). Not reachable from source found: `lift <db src>` inside a fn body is dropped by the server emitter (`return null; /* server-lift: non-expr form */` — separate silent drop, not this gap).
- Unscoped `?{}` → E-SQL-004 only when the file has ≥2 databases (the wrong-database hazard). Single-db file: unchanged (open question below).
- Ownership: `collectOwnedDbFiles` uses the same resolution (a `?{}` CREATE TABLE owns its nearest scope's file).

## Corpus measure (compile alone, before = c58ce8121 tree, after = this branch)

386 files containing `?{`, `<db `, or `db=` under examples/, samples/, conformance/cases/, scrml-support gauntlet-r25. Per emitted server/js module: every query site (`handle\``, `.unsafe(`, `.begin(`) → enclosing function + the database its handle declaration names; plus E-SQL-*/E-PROG-* codes.

| change | files |
|---|---|
| query hits a different database | 0 |
| new/removed E-SQL / E-PROG code | 0 |

With an intermediate version (E-SQL-004 for ANY unscoped `?{}` in a file with ≥1 scope) 11 conformance cases flipped to E-SQL-004 (file-top `${ … }` beside `<program db=>`): codegen/cg-001-server-block-warn-pos, sql/{prepare-server-fn-e-sql-006-neg, param-query-no-e-sql-003, runtime-expr-body-e-sql-003-neg, comment-cloaked-body-e-sql-003-neg, commented-query-no-e-sql-003, clean-pos, batch-warn-info, bad-conn-prefix-neg, bare-identifier-body-e-sql-003-neg}, protect/channel-broadcast-strip. Scoped out (see open questions).

## Fix round (S239 review of 50721508b = FIX)

All tests below were written first and confirmed RED against `50721508b` (an archive of HEAD), then GREEN.

- HIGH-1: `wrapPrincipalTxn` matched only `_scrml_sql`, so the db-authoritative principal wrap skipped every `_scrml_sql_<n>` query. With a sibling `<db src>` the protection was inverted: the other database was wrapped and the authoritative one left bare (reproduced). The fix covers the whole class. NEW `codegen/sql-handle-name.ts` is the ONE handle-name list (default, scoped, unresolved), with a word-bounded matcher and a sort order. Its users: `wrapPrincipalTxn` (which now also receives the declared handle set from `collectDbScopes`), the server and tool declaration scans, the tool missing-scope check, and the client SQL-leak guard. Other `_scrml_sql` text matches in compiler/src: protect-flow knows the SQL client by binding identity, not by name (no change needed). tenant-egress matches SQL text, not handle names.
- Silent fallbacks: rewrite.ts pass 8, the server-pass default, `rewriteSqlRefs` / `rewriteServerExpr` default params, context.ts, emit-logic (sql + transaction), emit-control-flow, the 3 codegen/index.ts ctx sites, and emit-server's envelope, server-load, SSR-seed and watches defaults now all use `fallbackSqlHandle()`. That is `_scrml_sql` in a single-database file (byte-identical) and `_scrml_sql_UNRESOLVED` with two or more databases. That name is never declared: emit-server and emit-tool report E-INTERNAL-DB-HANDLE-UNRESOLVED instead, and there is no `:memory:` stand-in. The fallback is set per file at the start of the emission loop (codegen/index.ts) and in `generateServerJs`.
- Consequence: a §44.7.1 library-shaped file with TWO top-level `<db src>` and an unscoped `?{}` used to run on the first one. It is now E-SQL-004 too, because §44.7.1 allows "at most one top-level `<db src>`", so there is no fallback database. dev-db-no-side-file F6 pinned the old behaviour: both statements ran on a.db, including `CREATE TABLE u`, which is b.db's table. I rewrote it to assert the refusal, plus a scoped twin in which each database is owned by its own scope.
- MED-2: `:memory:` scopes are now keyed per declaring ELEMENT (`db-ownership.ts databaseIdentity`). Runtime test: a table created through one `:memory:` block is absent from the other.
- Corpus re-measured (386 files, E-SQL / E-PROG / E-INTERNAL-DB codes + query targets): 0 changes.

## Open questions

0. MED-1 (recorded at PA's request — a language question for bryan): a `fail` exit rolls back the §8.9.2 implicit envelope on database A. It does NOT roll back a write the handler made by calling a function that runs on database B: B's handle is outside the envelope. The §8.9.2 "fail rolls back" promise is silently partial across databases. E-SQL-011 only inspects a function's OWN `?{}` sites, not its callees'. Options: refuse cross-database calls inside an enveloped handler; give each touched handle its own envelope (still not atomic across databases); or state in SPEC that the envelope covers its own database only. PA files the gap.
0b. A db-authoritative Postgres program with a sibling SQLite `<db src>`: the principal wrap is applied to the SQLite handle's queries too (`set_config` / `SET LOCAL ROLE`, which SQLite rejects at run time). This is unchanged from before ("wrapped exactly as before"), and `E-DBAUTH-SQLITE` checks only the first scope's driver. A mixed-driver db-authoritative file needs its own rule.

1. §8.1.1 makes a `?{}` with no scope above it E-SQL-004 even when the file has ONE database (file-top `${}` beside `<program db=>`). impl#1 accepts it (pre-S451 divergence too). Refusing = 11 conformance cases newly rejecting. Needs a ruling (and probably a gap).
2. E-SQL-011 needs a §44.7 row (or a ruling that it is E-SQL-004-class).
3. (fixed in the fix round) Two `<db src=":memory:">` scopes are now two handles.
4. Conformance runtime adapter (`conformance/adapters/impl1-ts.ts`) binds only `_scrml_sql`; a multi-database conformance case would need it to bind `_scrml_sql_<n>` too.
