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
- [ ] 4a — cross-database write inside an envelope (§8.9.2, §19.10.5/.6, §8.1.1) + E-SQL-011 generalized
- [ ] 5 — §8.1.1 confirmed; gap filed
- [ ] §34 rows E-ERROR-011, E-SQL-011; gaps; generated docs; checks

## Measurements (impl#1 on 25677da72)

Probes compiled with `bun compiler/bin/scrml.js compile <f> -o <dir>`, emitted JS read; probe files
lived in `~/.cache/scrml-agent-tmp/s451-spec-ue-forks/` and are not committed.
