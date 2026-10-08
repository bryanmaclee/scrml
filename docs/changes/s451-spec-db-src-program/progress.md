# s451-spec-db-src-program — progress

Branch `spec/s451-db-src-program` off origin/main `dbb671c2d`.

## Probes (impl#1, `dbb671c2d`)
- `conformance/cases/protect/channel-broadcast-strip/case.scrml` compiled as-is: the channel's `pushUser` `?{}` runs on `_scrml_sql` = `app.db` (the `<db src>`'s database; owned handle); the row is `_scrml_protect_tag(…, ["passwordHash"])` and `broadcast` publishes `JSON.stringify(_scrml_protect_redact(data))`; `I-PROTECT-STRIP-001` fires. **Agrees with 11a.**
- Same compile reports **E-SCHEMA-001** on the `<schema>` (program has no `db=`) — "FAILED — 1 error" (artifacts still written). Under 11a the program has a database, so §39.3 is amended → impl#1 divergence, filed.
- Two direct-child `<db src>` in a db-less program (different srcs, and same src + a `?{}` outside both): impl#1 compiles both at exit 0 → new E-SQL-012 not emitted, filed.
- Generated table type names (`let u: Users = …`) are E-TYPE-UNKNOWN-NAME in impl#1 even INSIDE a `<db>` block — pre-existing, not an 11a divergence; not filed here.

## Steps
- [x] BRIEF + progress
- [x] SPEC edits — §8.1.1 (prose + new normative bullet + E-SQL-004 note + worked examples + §8 table), §6.12.1, §14.8.4, §14.8.9 (coverage paragraph), §34 rows (E-SQL-004, E-SQL-012 new, E-SCHEMA-001), §39.1/§39.2/§39.3/§39.9 + §39 table, §43.6, §44.1, §44.2, §44.7 table
- [x] known-gaps: channel-broadcast-strip removed from g-impl1-unscoped-sql-single-db-accepted-s451; new g-impl1-db-src-program-supply-divergences-s451; state.ts --write/--check PASS
- [x] regen-spec-index --check OK; s34-census --check-new PASS; facts --write/--check PASS
