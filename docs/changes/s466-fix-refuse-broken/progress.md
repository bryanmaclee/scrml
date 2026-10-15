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

- Acceptance r1 (first pass): examples 0 refused, 23/23 rewrites byte-identical to base, 105/105 trucking sql-failable back. samples + conformance were ALL refused: `scrml compile samples` crashes (stack overflow, no file) and conformance/cases joint compile reports errors with no file (E-IMPORT-002, E-CG-003, E-TYPE-031, E-META-EVAL-002, E-VALIDATOR-INLINE-DYNAMIC). Fix: attributed errors refuse first + recompile; when only no-file errors (or a crash) remain, each remaining file is judged by its own compile; a note says so (stderr + `notes` in --json).
- Gaps for the PA: `scrml compile samples` crashes (Maximum call stack size exceeded); those five codes carry no file in a joint compile.

## Fix round 1, resumed after process exit
- salvage committed e56a92433; joint-compile no-file fallback 9a784de04 (superseded below).
- Directory judgement REPLACED by per-root compiles (judgeTargets): a root = a `<program>` file or a file no other target imports (route page); each root = `scrml compile <root>`; other files judged inside the roots that reach them (+ own compile when a reaching root reports a no-file error). Reason, measured: one joint compile of a directory of unrelated programs reports cross-program E-PROTECT-006 / E-CG-001 (conformance: 480 false refusals), no-file errors, and crashes on samples.
- Acceptance (base f28b58a31 vs tip, `fix <dir> --dry-run`, text diffs compared byte-for-byte + JSON records):
  - examples: 71 files, 0 refused, 23/23 rewrites identical, 105/105 trucking sql-failable rewrites.
  - samples: 881 files, 210 refused (all 210 fail real `scrml compile <file>`), 593/593 rewrites identical, 0 lost.
  - conformance/cases: 1827 files, 888 refused (887 fail `scrml compile <file>`; writer.scrml in tenant/floor-imported-module-write-neg fails inside its importing case.scrml), 571/571 identical, 0 lost.
- Gaps for the PA: `scrml compile samples` crashes (Maximum call stack size exceeded); E-IMPORT-002/E-CG-003/E-TYPE-031/E-META-EVAL-002/E-VALIDATOR-INLINE-DYNAMIC (+ E-COMPONENT-012/-020/-035, E-THEME-TOKEN-UNKNOWN, E-IF-IN-DISPATCHED-ARM) carry no file in a multi-file compile; protected-field scan (E-CG-001) is compile-unit-global (one program's protect= fails another's client JS in a joint compile).

## Fix round 2 (S239 re-review of 9d59b0141 → N1, N2)
- N1 (MED): judgeTargets returns `deprecatedOnly` (files let through only by the E-DEPRECATED-001
  tolerance). The CLI runs pre-migrate alone on such a file first; if it does not apply, or the
  migrated text does not compile (compileErrorsOfText: the text compiled as the file with its project
  + databases), the whole file is refused before any later rule. fixS66 also stops (no later rule) when
  the original carries E-DEPRECATED-001 and pre-migrate did not apply (direct callers; not under
  allowNonCompiling). r1repro/b1/machbad.scrml: refused, exit 3, under --s66, --s66 --write, default,
  --dry-run; mach.scrml still migrates.
- N2 (LOW): a module whose every reaching root has fatal errors is also judged by its own compile.
  r1repro/a2: app.scrml + mod.scrml both refused.
- Tests: fix-refuse-broken.test.js §9 (7) + §10 (1); 37 in the file.
- Acceptance unchanged from 9d59b0141: examples 0 refused / 23 of 23 identical; samples 210 refused
  (same set) / 593 of 593 identical; conformance 888 refused (same set) / 571 of 571 identical; 0 lost.
