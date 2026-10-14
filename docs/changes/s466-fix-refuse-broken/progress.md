# progress — s466-fix-refuse-broken
- start: branch cut from f28b58a31, BRIEF archived
- repro: brace loss is REAL on disk (not the diff printer) — it is the `unwrap-logic` rule (fix-s66.js,
  depth-0 `${}` of items inside `<program>` unwrapped). It does the same on the compiling twin (intended
  migration); on the broken file its "same codes before/after" verify is vacuous.
- built: CLI whole-file gate (fix.js, compileErrorsInPlace in fix-verify-shared.js), exit 3 on refusal;
  in-rule refusal in client-server-call + sql-failable; applyFixRules split out; tests
  (fix-refuse-broken.test.js new; non-compiling fixtures in fix-s66 / csc / sql-failable tests now pin
  the refusal). Commands suite 545/0.
- SPEC §63.4 bullet + provenance; SPEC-INDEX regenerated.

## Fix round 1 (S239 review of fd5a10764 → FIX)
- item 1 (HIGH): ONE scratch builder `writeScratchProject` (fix-verify-shared.js) used by every rule
  (arm-pipe, is-some, given-presence, client-server-call/sql-failable `scratchProject`, s66
  `compiledReading`): file + project + every SQLite file named by `db=` / `<db src=>` (resolved by
  db-target.ts `resolveDbFilePath`) + `-wal`/`-shm`, + sibling DBs, laid out under one common root.
  Rule refusals go through `scratchRefusalReason`: "cannot verify: the scratch compile diverges (CODE)"
  when the file compiles in place (CLI passes `inPlaceClean`; otherwise an in-place compile decides).
- item 2 (MED): CLI gate `judgeTargets` — file mode = `scrml compile <file>`; dir mode = target set
  compiled together, errors attributed to a file + its import closure; refused files dropped and the
  rest recompiled until no new refusal (one file's front-end error suppresses the emitted-JS check
  for the whole joint compile — measured, it hid a sibling's E-CODEGEN-INVALID-LOGIC).
- item 3 (MED): STOPPED — see the hand-off report. impl#1 has no §66-dialect class: a §66 file
  (`let <count:number=0/>`) yields generic E-SCOPE-001 / E-STATE-UNDECLARED, identical to real errors.
- item 4 (LOW): fix-s66 pre-migrate + structural verify now require the original to compile;
  pre-migrate tolerates E-DEPRECATED-001 (the `<machine>` hard error it exists to clear) and then
  requires the migrated file to compile. `allowNonCompiling` opt for scripts/bootstrap-conformance.ts
  (twins conformance error cases by design) — bootstrap --check stays current.
- item 5: `isNonFatalDiagnostic` exported from api.js and used; no second emitted-JS run (api.js
  already runs it on write:false); a line-less error prints `file CODE: msg`.
- Round-1 regression found + fixed: the round-1 gate refused every `<machine>` file (E-DEPRECATED-001),
  i.e. blocked pre-migrate's own migration.

## Gap for the PA to file (do not fix here)
- Standalone compile of a component module emits invalid library JS: `scrml compile
  examples/22-multifile/components.scrml` → E-CODEGEN-INVALID-LOGIC, no source line ("artifact:
  components.js (byte 184, line 6, column 25) Unexpected token … export const UserBadge = <span
  class="badge" props={ na…" — the component markup is emitted raw into the library output). The
  same file compiles clean as part of `scrml compile examples/22-multifile`.

- SPEC §63.4 bullet updated for round 1 (project-aware judgement, divergence wording, removed-form exception) + a `PA reading (S466, owner veto)` note recording the §66-dialect question as open; SPEC-INDEX + FACTS regenerated.
