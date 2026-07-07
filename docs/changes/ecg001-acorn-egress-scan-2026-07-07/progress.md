# progress — ecg001-acorn-egress-scan-2026-07-07

Gap: `g-ecg001-protected-field-regex-division-evasion` (HIGH, S244).
Base: FF'd worktree to main `f9d37153`. Dispatch: scrml-js-codegen-engineer, isolation:worktree.

## Status: COMPLETE

## Done
- Reproduced the scanner-level leak (`rewriteCodeSegments` masked view drops `.ssn` on the
  `of`-as-variable division shape → `/\.ssn\b/` = false → no fire) AND confirmed the acorn
  token/AST view catches it.
- NEW `compiler/src/codegen/egress-field-scan.ts` — acorn-exact, fail-closed egress scan
  (`scanClientEgress`). AST walk detects protected-field access in code position:
  `.ssn`, `?.ssn`, computed `["ssn"]`/`` [`ssn`] ``, destructuring `{ssn}`/`{ssn: x}`.
  String/comment/regex + object-LITERAL keys correctly do NOT fire. Parse error -> parseError:true.
- Wired into `emit-client.ts` E-CG-001 region (replaced the `rewriteCodeSegments` code-only view).
  `code-segments.ts` left UNTOUCHED (mask-bias stays correct for the fn-name mangle) — decouples
  the two opposite-bias uses (the real root fix).
- Fail-closed wired: `egress.parseError` -> "could not verify" E-CG-001, never a silent pass.
- Tests: NEW `egress-field-scan.test.js` (23 pass) + `code-generator.test.js` integration
  (evasion-now-fires + fail-closed).

## Verification
- Full blocking gate `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail`:
  19550 pass / 65 skip / 1 todo / 0 fail (193s). Committed under the same hook (passed).
- Commit: `b5820674` (non-empty, 4 files, +412/-28).

## Scope fence honored
Touched ONLY emit-client.ts (E-CG-001 region) + NEW egress-field-scan.ts + the two test files.
Did NOT touch code-segments.ts / expression-parser.ts / route-inference.ts / the SQL-leak scan /
known-gaps.md (PA marks resolved at landing).
