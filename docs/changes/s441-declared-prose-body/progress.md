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
