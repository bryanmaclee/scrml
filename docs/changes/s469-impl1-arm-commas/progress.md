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

## Round 3 (PA: fix F3 here, S435 security limb)
- [x] `splitMultiArmString`: string / number heads read through their `| literal` chain; an alternate is never an
      arm start. Unit matrix `match-literal-alternation-s469.test.js` (48: 7 positions × 6 alternation kinds × 3
      spellings, byte-identical; bites on the pre-fix tree in the `@cell`, derived-cell, call-argument rows).
- [x] Pack n24 +27 deny-list shapes (498 total): on c4233fa33 every newline `@cell` / call-argument shape is FAIL.
- [x] Corpus emit diff c4233fa33 → fix: 171 content diffs, all `_scrml_project_root` only (base captured from a
      scratch copy; verified by normalizing that line in every pair) — no program changed.
- [x] Gap resolved; state.ts --write.
- Note: a `number` / `string` / `int`-typed cell as a match subject is E-TYPE-025 ("asIs") in the const / derived /
  markup positions (a separate typer limitation; the matrix uses `number | string`).

## Round 4 (final review of 6f35fa4bb — FIX)
- [x] F1 HIGH: `splitMultiArmString` skips a whole standalone number literal that is not an arm start (a spaced
      negative later alternate no longer becomes a head of its own); a literal right after an arm arrow is a body,
      never a head (`1 :> "one" | 2 :> "two"` stays one arm and is refused). (6e42660bf)
- [x] F2 MED: `armTokens` reads the token-joined `- >` as `:>` (length kept) — `->` comma lists split.
- [x] Tests: literal-alternation matrix + negative rows + `->` arrow + exact dispatch sequences (151); `->` comma
      list (regex file §4); seeded differential `match-arm-list-differential-s469.test.js` (200 lists × 4 spellings,
      18 fail on 6f35fa4bb); pack n24 +36 negative deny-list shapes (6 FAIL on 6f35fa4bb).
- [x] Gaps: false E-VALUE-FUNCTION-STORED on `@cell = match` (multi-scrutinee repro at head); legacy `|`-led
      literal match arms (statement form silently runs the last arm — HIGH); `->` added to the regex-lexing gap.
- [x] Merged origin/main (#1507/#1508/#1510): pack count reconciled 456 + n22 11 + n24 78 = 545; conflicted
      conformance cases took main's `;` version; the codemod re-run kept 32 files / 84 commas, flagged 0 arms
      ending in `;`.
- [x] Newline-list coverage restored, unmigrated, excluded from the bootstrap (dialect.s66):
      control-flow/ctrl-switch-forbidden-match-neg-newline-list, match-leave/dpa068-stmt-bare-return-newline-list,
      error/handler-pipeless-arms-rt-newline-list. impl#1 conformance 1731/1811 + 80 xfail.
- [x] Bootstrap conformance: PASS 217 (main) → 250 (+33). 7 UNSUPPORTED → FAIL (they now parse and fail later).
- [x] Corpus emit diff (r4 fix vs the same tree with the two pre-r4 files): 171 diffs, all `_scrml_project_root`.

## Round 5 (PA: fix g-impl1-legacy-pipe-literal-match-arms-s469 here, S435 security limb)
- [x] Refuse, not dispatch (SPEC §19.4.5: "§18.2's `match` grammar never admitted a leading `|`"): a `|`-led
      match arm is E-PARSE-001 in every position and spelling — statement parser (6b7252f89) and raw-arm lowering
      (per split arm, via arm-list-split's tokens); the raw splitter no longer reads an operator's operand as a head
      (8a161e3ac). `| _` / `| else` / `| ( … )` and `!{}` / message-arm pipes unchanged.
- [x] Tests: `match-leading-pipe-arm-s469.test.js` (67); differential generates `|`-led arms (refused everywhere);
      pack n24 +18 (563): on be0a7799d the 9 statement shapes FAIL.
- [x] Corpus emit diff (pre-r5 arm code → fix, same tree): 171 diffs, all `_scrml_project_root` — no program changed.
- [x] impl#1 conformance 1731/1811 + 80 xfail. Gap resolved; state.ts --write.

## Round 6 (final review of fc046f011 — FIX)
- [x] F1 class fix — the arm-split COVERAGE invariant (`armPiecesCover`, arm-list-split.ts): pieces + separators +
      whitespace must account for every non-whitespace character; enforced in `emitMatchExpr` (every expression
      position) and `collectMatchArms`; the `|`-start check also runs on the whole raw arm text. The instance: a
      `|`-led first arm before 2+ literal arms was sliced off (the prefix before the first arm start).
- [x] The invariant is observed in the suites: `splitMultiArmString` records every split in an opt-in audit
      (`globalThis.__scrmlArmSplitAudit`); the seeded differential and the alternation / regex / leading-pipe
      suites fail on any split that lost text in a clean compile. The differential now generates the 4-arm shape.
- [x] F2 HIGH: a bare handled-call statement-match arm body compiles like the braced form (zero-width braces);
      a value-match one refuses. Gap filed resolved: g-impl1-stmt-match-arm-bare-handled-call-dropped-s469.
- [x] Pack n24: +12 (|-led first arm before 3 literals) +8 (bare handled-call arms) = 583.
- [x] Reviewer fuzzers on head: fuzz5 seeds 51–60 + fuzz6 seeds 71–80, 150 lists each (21,000 list×position
      runs × 4 spellings): 0 PIPE-NOT-REFUSED, 0 BAD-SEQ, 0 SPLIT-BAD-SEQ, 0 DIFF-OUT, 0 SPLIT-DIFF-OUT.
- [x] Corpus emit diff (r6 vs the same tree with fc046f011's four arm files): 171 diffs, all `_scrml_project_root`.
