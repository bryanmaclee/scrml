# s441-ex23-run-changes progress

- [x] startup verified (HEAD == origin/main 5c366fe15), bun install, pretest OK
- [x] SPEC §8.3 / §8.5 (8.5.1-8.5.4) read; anti-pattern briefing read
- [x] Reproduced by execution (repro/ex23-consume-twice.ts against the compiled example):
      BOL same token twice -> both ok; never-issued tokens accepted on all 3 sites;
      concurrent double-submit of acceptance + payment -> both ok
- [x] Fixed 3 sites: UPDATE ... AND consumed_at IS NULL RETURNING token + .get() + `is not`
      (§8.5.1: "Use a RETURNING clause ... if the write outcome is needed"). Re-run: replay,
      forged, concurrent all rejected; first consume still ok. Smoke baseline W-SQL-ROW-UNTYPED 6->9.
- [x] Sweep: fixed examples/09-error-handling.scrml (result.changes) + ex23 comment/FRICTION note;
      listed samples/ hits in the gap entry (not fixed). docs/ + stdlib/: zero hits.
- [x] Gaps filed §S441: g-run-result-field-read-compiles-silently (MED),
      g-server-error-envelope-returns-http-200 (MED), g-enum-variant-httpstatus-attribute-drops-variant (MED, surfaced)
- [ ] suites + conformance + push
