# s451-spec-ue-forks — progress

Branch `spec/s451-ue-forks`, cut from origin/main `25677da72`. SPEC text for the S451 rulings
"1a 2 yes 3 yes 4a" and "5 enforce" (user-voice-scrml.md).

## Log

- [x] BRIEF archived, branch cut, `bun install`.
- [x] 1a — value-position arms (§19.4.3, §19.4.4, §19.7.3) + E-ERROR-012 (§19.13 + §34 rows) + gap
  `g-impl1-value-position-arm-fallthrough-s451`. Measured: 64 `!{}` handlers (impl#1 AST), 35 in a
  value position, 19 with fall-through arms in 13 files, all conformance/cases; 0 examples/samples.
  5 match-on-failable sites, none falling through in a value position.
- [x] 2 — `| .V m :>` binds the payload (§19.4.3 paragraph + §19.4.4 bullet, §19.8.3 note) + Appendix B
  line struck as historical; multi-field / unit = E-TYPE-021 (§18.7). Gap `g-impl1-paren-free-binder-arity-s451`.
  Corpus: 46 paren-free binder arms in 12 samples/ files (legacy `::SQLError e` / `_ e`), 0 elsewhere.
- [x] 3 — `!{}` on a non-failable call + E-ERROR-013 (§19.4.3 paragraph, §19.4.4 bullet, §19.13 + §34 rows);
  gap `g-impl1-handler-on-non-failable-s451`. Corpus: 2 sites (samples/compilation-tests); login.scrml
  depends on §19.9.5 reach (open).
- [x] 4a — cross-database write inside an envelope (§8.9.2 bullet, §19.10.5 bullet, §19.10.6 bullet, §8.1.1
  bullet) + E-SQL-011 GENERALIZED ("a transaction spans two databases") with §34 + §44.7 rows; gap
  `g-impl1-cross-database-write-in-envelope-s451`. Why generalize, not a new code: impl#1's existing
  E-SQL-011 already means "one function's database work on two databases" and its emitter is
  unreachable from source; the ruling's shape is the same root (one atomic unit, two databases) with
  the same fix (split by database). The two impl#1-only triggers (own sites on two dbs w/o envelope;
  `watches=` in two scopes) are recorded in the row as implementation limits. Corpus: 0 files declare
  two different databases.
- [x] 5 — §8.1.1: no sentence carved out a single-database exemption (§44.7.1's module fallback is for
  files with no `<program>`); added one clarifying sentence + provenance to the E-SQL-004 bullet. Gap
  `g-impl1-unscoped-sql-single-db-accepted-s451` lists the 11 cases (all compile with no E-SQL-004 on
  impl#1). Correction to the relayed premise: 10 are logic-outside-`<program>`;
  `protect/channel-broadcast-strip` has its `?{}` INSIDE a `<program>` without `db=`, beside its
  `<db src>` — program-move does not migrate it.
- [ ] §34 rows E-ERROR-011, E-SQL-011; gaps; generated docs; checks

## Measurements (impl#1 on 25677da72)

Probes compiled with `bun compiler/bin/scrml.js compile <f> -o <dir>`, emitted JS read; probe files
lived in `~/.cache/scrml-agent-tmp/s451-spec-ue-forks/` and are not committed.
