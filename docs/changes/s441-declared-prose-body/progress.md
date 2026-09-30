# progress — s441-declared-prose-body

- startup OK; base 5c366fe15 (== local origin/main ref; `git fetch` failed: ssh publickey denied)
- 8920d2e3e — `scripts/measure-loose-body-prose.ts` (live + native; pre-commit 32,447 tests, 0 fail)
- MEASURED at 5c366fe15, 2,230 files (examples 71, samples 877, conformance/cases 1070, readme-snippets 9,
  tutorial-snippets 15, stdlib 53, scrml-site 106, flogence 29):
  - live: <program> 1,202 bodies -> 8 runs / 7 files; <page> 158 -> 0; <channel> 48 -> 0; file-root 21 runs / 21 files
    (outside the ruling: `use …` lines, legacy `/div` closers, stray `</>`); whitespace-only nodes excluded: 8,325
  - native: <program> 15 runs / 14 files (the extra 7 = bare writes / `on mount` / `use foreign:` the live lift catches)
  - the 8 live <program> runs: 1 pure prose (ctrl-012-default-logic-prose-neg counter-gate); 7 code/markup shipped
    as text: postgres-program-driver `?{CREATE TABLE…}` (VERIFIED in emitted HTML), stdlib/http nested `*/` leak x2
    (VERIFIED: `export function multipart` in index.html), e-type-026 `match`, ctrl-012 residual + multiline, `<#tick …/>`
  - zero display-prose runs outside conformance fixtures written for this locus
- dee733bfa — SPEC DRAFT (§40.8 S441 bullet, §4.18.1 S441 amendment, §4.18.7 + §34 row, §3.4 marker; SUBSUMED markers
  on S111 third-mode note / S378 / S439 #2 / S440 #8); SPEC-INDEX + FACTS regenerated. Post-commit browser run showed
  57 fails (navigate-wave1c, Bug 60 happy-dom …) — docs-only commit, not caused here.
- ROUND 2 (bryan ruled "yes to all four"): implementation. (A WIP-patch crash anchor could not be
  committed — the hook runs the suite whenever compiler files are staged — so it was dropped.)
  Live + native: body-top display-literal split (shared segmenter native-parser/body-top-prose.js),
  catch-all lift, strict check (rejectBodyTopProse / rejectBodyTopProseNative), E-WRITE retired,
  `"…"` renders w/o quotes, interp renders, AT_IDENT ASI boundary, BS+trampoline literal protection.
  Tests: s441-declared-prose-body.test.js (38, both front ends); unit-cc test rewritten to pin the
  retirement; top-level-decls 2 tests re-pinned; S430 fp10 probe -> `_={ }=`. Conformance: 17 new
  body-top/* cases; 3 ctrl-012 + e-type-026 + write-not-in-logic-context-pos re-authored; the
  nested-path xfail re-signed (the statement DROP is fixed by the AT_IDENT ASI boundary; a notify miss
  remains — known-gaps note). Samples: postgres-program-driver (CREATE TABLE into `${}`),
  phase3-is-in-when-guard-093 (malformed `<#tick ...>` -> `<p if=...>`).
- 15b8c0026 feat — implementation + SPEC + tests + conformance + samples (pre-commit 32,404 pass / 0 fail)
- eeb5ac7c2 fix — strict check judges statement HEADS only (a `when` bodyExpr was misread); CE snippet
  reparse wrapper `<program>` -> `<div>`. Browser failure set == base worktree b2d3a3d56 (minus TodoMVC env).
- VERIFIED: measure-loose-body-prose -> 0 loose runs in <program>/<page>/<channel> bodies, both front
  ends, 0 live/native divergence at this locus; conformance 1061/1068 + 7 xfail; snippet-gate 122/122.
- Corpus differential (true base worktree vs head, 2,244 files, both front ends): live changes only in
  the re-authored conformance fixtures + stdlib/http (comment leak; sibling agent's fix) + migrated
  samples; scrml-site / flogence / examples / readme+tutorial snippets unchanged (live). Native:
  `use foreign:` bodies now lifted (native parser lacks `use foreign:` — pre-existing gap), bare writes
  and `on mount` now lifted in 4 samples (matching live).

## ROUND 3 — PA adversarial review of feaf5ed8b (DO-NOT-LAND) → fix round

Probes: scratchpad `rv-prose-out/probe/pN.txt`. Regression tests: `compiler/tests/unit/s441-review-fixes.test.js`.

DONE
- #1 HIGH (5291581bf) — `@a and⏎ @b` / `or`: `lastEndsValue` no longer counts the word infix operators.
- #2 HIGH (5291581bf) — bare `@y` / `@y.a` then `return`/`if`/`const` next line no longer swallowed
  (`collectExprAfterLead`); the first-statement form was pre-existing on main and is fixed too.
- #3/#4/#5 HIGH/MED (68faba099) — prose line swallowing the next line: line-granular rejection +
  re-parse of the tail (both front ends); one diagnostic per prose run; real line/col; no cascade.
- #6 HIGH (2b0219b96) — `Hello, world`: a comma sequence is not a scrml expression (§4.18.2) →
  E-UNQUOTED-DISPLAY-TEXT (both front ends). SPEC §40.8 S441 sub-bullet added.
- #8 MED (b7ca16e79) — body-top CODE template literal kept as one text run (block-splitter
  `bodyTopTemplateEnd`, trampoline `ctx.bodyTopTemplateEnd`, shared `scanBodyTopTemplateClose`).
  Now behaves exactly like the same template inside `${}` — incl. two PRE-EXISTING gaps there, now
  loud at compile time: `${@cell}` in a template in logic is E-CODEGEN-INVALID-LOGIC (main too);
  native rejects any `${…}` template interpolation in logic (main too).
- merge origin/main (345f55abb) — SPEC-INDEX/FACTS/allowlist conflicts regenerated; known-gaps
  auto-merged, @gap id set verified both ways (comm -23: 0/0 missing, 1371 ids); state.ts --write.
  Merge interaction: main's stdlib-source-no-logic-leak.test.js §3 instrument pinned the pre-S441
  "silent page text" shape; the checker now also reports E-PARSE-001 / E-UNQUOTED-DISPLAY-TEXT.
- #9/#10/#11 LOW (6cc98e2f3) — `"abc"⏎ .toUpperCase()`, `"a"⏎ + "b"`, `@a and⏎ "d"` stay code;
  suggested literal in the diagnostic escapes `\` and `"`.

OPEN
- #7 — HELD for a bryan ruling (PA): `do it now`, `import stuff`, `export data`, `fn heading`,
  `type here`, bare `404` compile silently; the W-BODY-TOP-NO-EFFECT idea. NOT implemented.
- #12 NIT — native/default disagree on `Warning: careful` / `Price: 5` (JS label + expression:
  default E-UNQUOTED-DISPLAY-TEXT, native E-SCOPE-001 or silent). Not fixed.
- Pre-existing native gaps surfaced (not fixed): `use foreign:`, `when … changes`, `and`/`or` across
  a newline, template `${}` interpolation — all fail inside an explicit `${}` on main too.
- g-nested-path-method-call-dropped-when-not-first-statement: drop fixed, notify miss remains (carried).

LAST COMPARISONS (re-run before landing — none were re-run after the round-3 fixes)
- Browser-suite comparison vs a true-base worktree: at eeb5ac7c2 (failure set == base b2d3a3d56 minus
  its TodoMVC env gap).
- Corpus differential (2,244 files, both front ends) + measure-loose-body-prose: at eeb5ac7c2.
- Pre-commit gate at 6cc98e2f3: 32,714 pass / 0 fail. Conformance at 6cc98e2f3: 1084/1091 + 7 xfail.

## ROUND 4 (fresh agent, salvage + finish) — BRIEF-round4.md

- 18ec64a0a — salvaged r4 WIP applied at 25b38fc8b, MINUS its emit-expr.ts client reuse of
  emitServerTemplateLit (the S437 round-5 shape reverted for silent miscompiles — known-gaps
  g-client-template-interpolation-lowering-needs-a-structural-emitter (c)). Kept the constant-folder
  fix (an interpolated template is RUNTIME, not its empty `value`): on base `<p>${ `count is ${@n}` }</p>`
  rendered EMPTY silently; now the cell form is the loud carried gap, plain interpolation renders.
  body-top/template-cell-renders pinned XFAIL on that gap; engine-statechild case 5 re-pinned.
- 0c573401e — merge origin/main (SPEC-INDEX ours+regen, FACTS theirs+regen, known-gaps count hunk).
  Merge interaction: main's new s441-async-escape F5 `on mount { const … }` at body top was judged as
  a prose head → `_onMountEffect` nodes are code by head (not judged).
- 492b7b96a — THE ROOT: the coverage invariant is a CHECK in both front ends (E-INTERNAL-BODY-TOP-DROPPED,
  fail-closed; SPEC §40.8 sub-bullet + §34 row).
  - default: parseLogicBody attributes each top-level iteration's consumed tokens to the node(s) it produced
    (`_s441Cover`); `assertBodyTopCoverage` (ast-builder.js) runs once per body-top run after
    rejectBodyTopProse + tail re-parses: covered = attributed token spans (a node whose HEAD expr lost text
    counts only if an error reports it) + comments/`;` + error-diagnostic lines.
  - native: `assertBodyTopCoverageNative` (parse-markup.js): covered = lexer tokens INSIDE a final statement
    span + comments + error lines, in the coordinates the body was parsed from (bodyText/bodyStart).
  - span fixes the check exposed (native): `server function` / `const <x>` spans start at the modifier.
  - fuzz finds fixed: default kept `careful, world` as code after a statement split (compiled clean,
    ReferenceError at boot) -> the split prefix is re-judged; native exempted a prose line when a parse
    cascade flagged a declaration on a later line -> groups are judged on their first line.
- 676c2a22d — native: a diagnostic at a run's END (`import stuff`, `fn heading`) is not an orphan prose line
  (the WIP had turned it into E-UNQUOTED quoting `` and hidden E-STMT-EXPECT-FROM).
- conformance: body-top/prose-before-code-line-rejected, body-top/prose-in-declaration-run-rejected.

MEASURED (origin/main 6dccbd6cf compiler vs this branch, 2,291 files incl. scrml-site + flogence/src copies):
- newly failing, default: 12 — all `conformance/cases/body-top/*` + ctrl-012 prose-neg (cases that pin the
  S441 rejection). native: 12 — the same set minus `line-after-declaration-rejected` (already failing on
  main native, codes changed) plus `capability/undeclared-with-foreign` (native has no `use foreign:`; main
  native shipped the line silently, now loud). examples/ samples/ readme-snippets/
  scrml-site/ flogence: 0 newly failing on either parser. No in-repo migration needed this round.
- E-INTERNAL-BODY-TOP-DROPPED fires: default 0; native 2 (flogence ports/capture-tool + route-tool, both
  already failing ~15-19 codes on native from `_={ }=` foreign-block gaps; the check fires on an
  unbalanced-recovery `}`).
- stdlib rows differ only because the branch compiler treats its own stdlib/ as stdlib (async exemption) —
  a measurement artifact, not a change.
FUZZ (scratchpad s443-prose/fuzz.mjs; independent oracle): 4 seeds x 300 bodies x 2 parsers = 2,400 compiles,
  1,109 prose lines; 0 oracle violations, 0 E-INTERNAL fires. Prose-free failures are pre-existing:
  E-SYNTAX-050 on a body-top `/* */` block comment (both parsers, main too) and native
  E-CODEGEN-INVALID-LOGIC on a template with `${}` in logic (native gap, main too).
OPEN #7 (not decided; measured): default compiles `import stuff` / `export data` / `type here` / `fn heading`
  / bare `404` silently (base too); native reports the malformed decls (E-STMT-*, E-UNQUOTED for
  `export data`) but also compiles bare `404` and `type here`. The invariant counts all of these as compiled
  statements (their tokens are consumed by a declaration / expression node) — it does not classify them.

## ROUND 5 — BRIEF-round5.md

- fd9a7589c — merge origin/main: SPEC §4.18.1 + §4.18.7 conflicts = main S442 text + S441 program/page/channel
  extension re-applied; allowlist note kept; SPEC-INDEX/FACTS regenerated; known-gaps auto-merged, @gap ids 1442 =
  union(1411 ours, 1442 theirs), 0 missing. Pre-commit 33,338 tests, 0 fail.
- ROUND 5 unit (one commit, code + tests + SPEC): the coverage invariant credits a statement only for what it
  COMPILES. Shared grammar: `compiler/native-parser/body-top-coverage.js` (declExtent / typeDeclExtent /
  typeExprExtent / liveExprIsInert / nativeExprIsInert). Default: `bodyTopAcceptance` in parseLogicBody's
  cover flush stamps `_s441Accepted` ({nothing} | {end, same-line rest, later-line rest});
  rejectBodyTopProse reports the same-line rest (E-UNQUOTED), splits + re-parses a swallowed later line,
  treats `nothing` as invalid; assertBodyTopCoverage credits only up to `end`. Native: nativeStmtCompilesNothing
  (inert ExprStmt, label on a non-loop, `type Name` bare, Import without source, FunctionDecl without a
  brace body on its line), nativeTypeAliasRest (alias trailing tokens, incl. `export type`), `;` is
  formatting, a statement holding a kind translateExpr always empties (TaggedTemplate / Render —
  `NATIVE_EXPR_KINDS_TRANSLATED_EMPTY`, translate-expr.js) is not credited, a flagged group is decided on
  its FIRST line only (later lines judged as their own groups). Both: no E-INTERNAL beside an E- error
  already in the run (the build is stopped by it).
  - A: import/export/type/function trailing tokens → E-UNQUOTED on their line; swallowed next line compiles;
    `import stuff` / `type here` / `export data` / `fn heading` / `404` / `-1` / `true` / `[1,2]` /
    `"a" + 1` / `import "./x.js"` → E-UNQUOTED (both parsers). SPEC §40.8 bullet + ruling S443 #4 sub-bullet
    (provenance quoted) + §34 E-INTERNAL row.
  - B: native `;` no longer E-INTERNAL. C: `Total: 42` / `Step1: "…"` / `Docs: https://…` → E-UNQUOTED (native).
  - D: native tagged template → E-INTERNAL-BODY-TOP-DROPPED (fail-closed); the translation gap itself is NOT
    fixed (translate-expr empties TaggedTemplate) — reported.
  - Bug found by the gate (fixed before commit): the shared bracket table was an object literal, so a
    `toString` token read Object.prototype.toString as an opener → a valid function flagged as nothing.
  - FUZZ (fuzz5.mjs = round-4 fuzz + the reviewer's shapes; 4 seeds x 300 bodies x 2 parsers = 2,400
    compiles, 961 prose lines): E-INTERNAL 0 both; oracle violations 11 per parser, all ONE class —
    a line starting with `-N` / `[N, 2]` continues the previous expression (JS no-ASI rule:
    `console.log("m")⏎-3102` emits `console.log("m") - 3102`) — compiled code, identical on both
    parsers, not a coverage drop (surfaced to PA as a design question).
  - MEASURED (corpus = examples 71, samples 877, conformance 1196, readme-snippets 9, scrml-site 106,
    flogence 31; vs the round-5 base 54f7764f6): default 0 files changed (only the 4 new body-top cases);
    native 0 newly failing — 18 flogence `kind="tool"` files already failing on native (native gap:
    `function main(a: T): R {` does not parse) change their code SET (the first native parse error is now
    reported instead of masked). No migration needed.
