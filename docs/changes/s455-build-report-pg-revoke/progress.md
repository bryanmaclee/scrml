# s455-build-report-pg-revoke — progress

- Base 61f4b8e5b (origin/main). Startup checks clean; bun install + pretest OK.
- FINDING: the SPEC §14.8.11 "No `CREATE` on a schema in the search path (S455)" bullet and the
  `g-tenant-pg-overload-hijack-s455` gap are NOT on origin/main — they live on the unmerged
  `origin/docs/s455-overload-revoke` (412c90053). An ff onto that branch was denied by the
  permission classifier, so the SPEC parenthetical edit is left for PA (exact text in the report).
- Plan: `compileScrml` result gains `dbAuthoritative` (the same `appDeclaresDbAuthoritative`
  recognizer emit-server's engagement gate uses); `scrml build` prints a plain report line.
  A db-authoritative build that reaches the report is Postgres by construction (E-DBAUTH-SQLITE
  hard-fails any other resolved driver per file in codegen/index.ts).
