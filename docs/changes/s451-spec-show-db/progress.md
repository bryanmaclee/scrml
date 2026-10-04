# s451-spec-show-db — progress

- [x] Branch spec/s451-show-db cut from origin/main 086f8f209.
- [x] Ruling 1 (`show=` not a narrowing guard): §42.3.5 struck `show=`; §17.2 bullet added. Measured 0/12 corpus files affected (temp-patched impl#1 filter, compiled before/after, positive control 0→1). Gap g-impl1-show-narrows-s451 filed.
- [x] Ruling 2 (§8.1.1 nearest database scope): §8.1.1 prose + normative + E-SQL-004 + Ownership "that database" + nested-precedence bullet; §8.6 / §34 / §44.7 E-SQL-004 rows; §44.1 / §44.2. impl#1 probes (4 fixtures): DIVERGES (one per-file handle). Gap g-impl1-db-resolution-not-nearest-s451 filed.
- [x] regen-spec-index, s34-census (PASS after emitter provenance on the 3 E-SQL-004 rows), facts (--write: SPEC line count), state checks.
- [ ] rebase + push.
