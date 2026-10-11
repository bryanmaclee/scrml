# progress — s462-given-body-text-as-code

- [x] startup: merged origin/main (up to date @ 37e50e881), bun install, pretest
- [x] reproduce — CONFIRMED, happy-dom AND Chromium (scratch probes, before = 37e50e881):
  - `${ given @u :> { <p>${@u.name} - ${@n}</p> } }` → `-;` in client.js, E-CODEGEN-INVALID-LOGIC.
  - `${ given @u :> { <p>${@u.name} track(@n) ${@n}</p> } }` → compiles; `track(@n)` RUNS on load
    (`#hits` 0 → 1 in both engines) and the `<p>` renders nothing.
  - the canonical `${ if (@u is given) { <p>…</p> } }` has the identical defect (same parser path).
  - other text: E-SCOPE-001 / E-STMT-RETURN-OUTSIDE-FUNCTION on words of the display text.
- [x] root cause: ast-builder.js. A statement-leading markup element in a logic body is not parsed
  as an element; the default statement path collects it up to the first BLOCK_REF (`${…}`) as an
  html-fragment, the BLOCK_REF becomes a logic node, and the text after it is parsed as the next
  STATEMENT. The §17.6.10 implied-lift desugar then declines the arm (a bare-expr piece is not an
  arm piece), so the element is dropped and the text statements are emitted.
- [x] fix: scanMarkupElementEnd + armMarkupTextRuns + collectMarkupTextRun (both statement loops);
  collectExpr newline boundary at a later-line markup element. Unit + browser tests.
- [x] siblings: lift, <match> arm, engine state-child, <each>, component, plain markup were already
  text; pinned in the browser test.
- [ ] corpus measure + emit differential
- [ ] gates

## Notes
- The bail at commit 1: conformance lifecycle/effect-nested-pos xfail signature shrank (the
  markup on the line after `beacon(@n)` is no longer read into it as code: E-MU-001,
  E-SCOPE-001×2, E-STMT-MISSING-SEMICOLON gone). Signature updated.
