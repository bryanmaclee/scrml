# s469-impl1-arm-commas — progress

Branch `s469-impl1-arm-commas`, cut from `origin/land/s469-batch-5` at aa341cda0 (PR #1501 still open at start).
Gap: `g-impl1-arm-commas-refused-owed-by-dpa-073-f5-s469` (dpa-073 F5(1): impl#1 ACCEPTS arm commas).

## Baselines (taken before any edit, from this worktree at aa341cda0)
- corpus emit capture: 2860 enumerated · 1708 compiled · 8609 emitted · 0 syntax-failing.
- bootstrap conformance: PASS 252 / 1808.
- pre-commit gate: one pre-existing failure on the batch-5 base — slice-m4 `sources.test.js` §66.19.4 drift
  guard (the batch-5 SPEC edit "O61 RULED S469" changed the block's comment; the bootstrap source kept the old
  one). Fixed by a comment-only sync (c62604b87) so the hook could run.

## Steps
- [x] ast-builder: `match` arm level reads `,` as separator (collectExpr break + body loop), `,,`/leading → E-PARSE-001
- [x] ast-builder `parseErrorTokens` (`!{}` arms): same
- [x] engine-statechild-parser `parseMessageArms` + symbol-table E-PARSE-001 for stray commas
- [x] expression-parser `splitMatchArms` + codegen `collectMatchArms` raw-arm paths
- [x] emit-expr: a stray depth-0 `,` left in an expression-position raw arm → E-PARSE-001 (never a JS comma operator)
- [x] retire the old-meaning E-MATCH-ARM-SEPARATOR typer check; S144 test §1–§3 re-pinned to acceptance
- [x] corpus emit diff: NO DIFFERENCES (2860 sources, 8609 artifacts, 0 diagnostic changes) — after each impl change
- [x] unit tests: compiler/tests/unit/match-arm-commas-s469.test.js (49)
- [x] gap resolved, SPEC §18.2 / §34 rows, state.ts counts, SPEC-INDEX regen
- [x] codemod `arm-commas-codemod.ts` + conformance/cases migration (separate final commit):
      132 files / 265 commas kept (impl#1 emit + diagnostics identical, per file); 3 reverted by verification —
      `match-codes/e-type-026-match-in-markup-pos` (the `match` is markup TEXT), 
      `match-leave/given-arm-lambda-param-no-false-scope-error` (one-line juxtaposed arms in a lambda; the comma
      form equals the multi-line newline form, both fail as today), and
      `match-leave/top-level-raw-and-handler-arm-return-neg` (first run only: a codemod bug put a `,` inside an
      alternation head — caught by the verification; fixed; second run kept it).
- [x] impl#1 conformance after migration: 1728/1808 pass + 80 xfail (no failures).
- [x] bootstrap conformance after migration: PASS 252 (0 per-case verdict changes; the bootstrap on this base
      reads both spellings — the 33 restored PASS are expected only once s469-boot-semicolons enforces commas).

## Re-running after s469-boot-semicolons lands
`bun docs/changes/s469-impl1-arm-commas/arm-commas-codemod.ts --write conformance/cases` — idempotent (an arm
already ending in `,` is skipped); an arm ending in `;` is NOT rewritten and is listed for a human.

## Round 2 (review of 2f9176de0 — FIX)
- [x] F1/F2 root fix: `compiler/src/arm-list-split.ts` reads raw arm text with `tokenizeLogic` (the lexer's own
      regex/division decision). Used by the expression parser's arm-separator split, the emit-expr stray-`,`
      guard, and `splitMultiArmString` (literal spans skipped whole). (fa35526ae)
- [x] Corpus emit diff vs the pre-fix merge tree (c86790d6c): 0 content differences except the 171 server
      bundles that embed `_scrml_project_root` (the base was captured from a scratch copy); 0 diagnostic changes.
- [x] Tests: `compiler/tests/unit/match-arm-commas-regex-s469.test.js` (13); pack `security-failable-pack/n24.js`
      (15 shapes; on 2f9176de0 the comma / mixed spellings with a quote in the regex are FAIL; all PASS now). 471.
- [x] F3 reproduces at `@cell = match …` (raw-arm path); filed with the repro (plus: string alternation drops
      its first alternate in both spellings). Not fixed (S435).
- [x] Gaps filed (760899451): F3, nested raw-arm value match, engine template target (repro owed by reviewer),
      arm after `else` in expression position, E-PARSE-ARM vs E-PARSE-001, regex after a binary operator lexed as
      division (`"x" + /a,b/` → `/ a , b /`, silent, any position).
- [x] Merged origin/land/s469-batch-5 (c86790d6c) then origin/main after #1501 landed (6c6ac6165).
- [x] impl#1 conformance after the merge: 1728 + 80 xfail.
