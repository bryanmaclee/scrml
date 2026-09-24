# progress — s430-p2-export-swallow

- startup gate passed; brief fetched; bun install + pretest ok
- LOCUS: hypothesis REFINED. The swallow is at ast-builder.js the export-decl branch's
  F1 synth re-parse (`_subErrors`, ~:12104-12134 on base), not ~:3920 (that is the
  `rejectFnEqualsBody` helper definition the grep hit). Root cause: the outer export
  path reads the whole declaration via collectExpr() (no statement parse), so the
  synth re-parse is the ONLY statement parse an exported function body ever gets —
  the "outer parse re-reports them" comment was false.
- FIX: surface every `_subErrors` entry, dedup by (code, span.start). Spans already
  point at source (the sub-parse runs over the original token slice).
- MEASURED (compileScrml per tracked file, 2,577 files; base run twice = identical):
  14 files change, 6 newly failing, 0 newly passing.
  Added codes: E-THROW-NOT-IN-SCRML 29, E-TRY-NOT-IN-SCRML 8, E-STMT-MISSING-SEMICOLON 1
  (counts include oauth/index.scrml re-reporting its siblings' sites transitively).
- Consumers are NOT affected: a user file importing scrml:test / scrml:oauth /
  scrml:crypto compiles unchanged (stdlib runtime = hand-written shims).
- Pre-commit gate with fix only: 1 fail — self-host-meta-checker "compiles without
  errors" (its green was the swallow). Re-pinned to the exact known residue.

## Migration dispositions
- MIGRATED: parse-markup.scrml:867 (`not isCodeDefault(...)` -> `!isCodeDefault(...)`,
  mirrors parse-markup.js:869); oauth/google.scrml:91 (throw -> fail
  OAuthError::ParseFailed, matches the shim's _parseError byte-for-byte);
  fs/index.scrml:113 (try/catch -> safeCall + !{}; emitted statSync differential-tested
  == shim on file / dir / missing path).
- FINALLY (P3-blocked): compiler/self-host/pa.scrml:281 — releases SchemaCache DB
  handles (cache.closeAll()). Only finally site in the newly-failing set.
- NOT MIGRATED, needs a ruling (see report): stdlib/test/index.scrml (15 sites —
  the assertion library's contract IS "throw to the test runner"); meta-checker
  reflect() throws :455/:460 (x2 copies); meta-checker :297 try (x2 copies —
  canonical form miscompiles, D9 below); config precondition throws in
  oauth/{google:52,github:48,discord:40,microsoft:51}, pkce:37, crypto:65;
  self-host/ast.scrml:549 (S428 D7 site).
- FOUND: D9 — a `let` bound via a `!{}` guarded expression is not registered as a
  declared local; a later bare reassignment in a nested block emits `const v = …`
  (shadow) — the write is silently lost, exit 0.
- FOUND: the export synth drops `errorType` (copies canFail only) — every exported
  `! -> T` function is typed as `! -> Error`, which is the source of the pre-existing
  E-ERROR-009 false positives in stdlib/oauth/google + crypto.

## Commits
- 6dbec305 fix(ast-builder): surface every export synth re-parse diagnostic (+ 11 unit tests;
  self-host-meta-checker compile test re-pinned to the exact 3-site residue).
- 1b4a6c88 migrate: parse-markup.scrml:867, oauth/google.scrml:91.
- 19df2286 migrate: stdlib/fs statSync (+ within-node allowlist +6 for fs, ALL from the
  added `import ... from 'scrml:host'` node — native parser drops it; same class already
  allowlisted for crypto/jwt/host). Droppable.
- 011287ea fix(ast-builder): export synth carries errorType (12 false E-ERROR-009 gone,
  0 added, stdlib/data/parse.scrml newly passing). Droppable.
- SPEC §34 E-CONDITION-HEAD-UNPARENTHESIZED row + §49 gap paragraph updated; SPEC-INDEX regen.

## Final measurement (base 15e60e4b vs branch, 2,577 tracked .scrml)
- fix only:        14 changed, 6 newly failing, 0 newly passing
- after migration: 13 changed, 6 newly failing (the migrated files returned to their base
  error sets; the 6 newly-failing files each still hold un-migrated sites)
- after errorType: additionally 1 newly passing (stdlib/data/parse.scrml)

## Follow-up (reviewer finding on 4ff064c0) — exported generators
- Root VERIFIED: export-decl declMatch `/^\s*(type|function|fn|const|let)\s+(\w+)/` misses
  `function * k` (collectExpr space-pads the star) -> exportKind null -> no synth, no re-parse.
- Fixed at the matcher (0c5334d4). Probe before -> after:
  `export function *k`, `export function* k`: none -> E-THROW-NOT-IN-SCRML @4:5;
  `export server function* k`: E-CODEGEN-INVALID-LOGIC (write:true only) -> E-THROW @4:5;
  un-exported twin `function *k`: E-THROW @4:5 (unchanged).
- Legal exported generator: library output now AST-emitted `function*` (runs, [0,1,2]);
  browser SPA use-site was E-SCOPE-001 on base, now compiles clean.
- Corpus A/B vs 4ff064c0: 0 of 2,577 files change.
- SPEC §34 row + §49 note reworded; arrow/expression-body caveat now says the truth:
  a writing build fails E-CODEGEN-INVALID-LOGIC, a write:false compile reports nothing.
