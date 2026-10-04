# s451-spec-db-src-program — progress

Branch `spec/s451-db-src-program` off origin/main `dbb671c2d`.

## Probes (impl#1, `dbb671c2d`)
- `conformance/cases/protect/channel-broadcast-strip/case.scrml` compiled as-is: the channel's `pushUser` `?{}` runs on `_scrml_sql` = `app.db` (the `<db src>`'s database; owned handle); the row is `_scrml_protect_tag(…, ["passwordHash"])` and `broadcast` publishes `JSON.stringify(_scrml_protect_redact(data))`; `I-PROTECT-STRIP-001` fires. **Agrees with 11a.**
- Same compile reports **E-SCHEMA-001** on the `<schema>` (program has no `db=`) — "FAILED — 1 error" (artifacts still written). Under 11a the program has a database, so §39.3 is amended → impl#1 divergence, filed.
- Two direct-child `<db src>` in a db-less program (different srcs, and same src + a `?{}` outside both): impl#1 compiles both at exit 0 → new E-SQL-012 not emitted, filed.
- Generated table type names (`let u: Users = …`) are E-TYPE-UNKNOWN-NAME in impl#1 even INSIDE a `<db>` block — pre-existing, not an 11a divergence; not filed here.

## Steps
- [x] BRIEF + progress
- [ ] SPEC edits
- [ ] known-gaps edits + state.ts
- [ ] regen-spec-index, s34-census, facts
