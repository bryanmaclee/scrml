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
