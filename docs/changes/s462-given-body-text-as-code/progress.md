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
- [x] fix (cc3fccccd): scanMarkupElementEnd + armMarkupTextRuns + collectMarkupTextRun (both
  statement loops); collectExpr newline boundary at a later-line markup element. Unit + browser tests.
- [x] siblings: lift, <match> arm, engine state-child, <each>, component, plain markup were already
  text; pinned in the browser test.
- [x] corpus: 3692 tracked .scrml (self-host-v2 excluded), TAB-output differential base vs head:
  7 real diffs — 6 closer fragments `< / p >` → `</p>` (content only; no emitted byte changes) and
  conformance lifecycle/effect-nested-pos (xfail signature shrank). Zero corpus sites have text
  between interpolations in statement-position markup.
- [x] emit differential (corpus-emit-differential, 2808 sources): 0 compile-outcome changes, 1
  diagnostic-code change (effect-nested-pos), 165 artifact diffs = all `_scrml_project_root` path
  only (0 after normalization), syntax delta 0. Tool verdict "INCOMPARABLE" only because the base
  side was a git-archive tree (no rev).
- [x] merged origin/main 1c1e9eee5 (#1404) as 1c12e9f8c — FACTS resolved by regen; #1404's
  given-presence tests that pinned the `-;`/E-TYPE-046 failure updated (a8 + punct now rewritten,
  executed same DOM; a6 refused by the verify; a new case keeps the compile-reason-first ordering).
- [x] gates (post-merge): see report.

## Notes
- lifecycle/effect-nested-pos xfail signature: the markup on the line after `beacon(@n)` is no
  longer read into it as code (E-MU-001, E-SCOPE-001×2, E-STMT-MISSING-SEMICOLON gone).
- Deferred (pre-existing, not text-as-code): statement-position markup outside a §17.6.10 single-
  markup arm (two elements in an arm, markup after a statement, a `for` body without `lift`, a
  logic `match` arm `{ <p>…</p> }`, a bare `${ <p>…</p> }`) renders NOTHING at exit 0. With this fix
  such shapes that ALSO hold text between interpolations move from a (wrong-reason) compile error to
  that same silent drop.
- Deferred: whitespace next to an interpolation is dropped on the lift / markup-value paths
  (`${a} text ${b}` → `atextb`), and a component body re-spaces `if (x)` → `if(x)` (§4.18.5).
- Deferred: the block splitter reads `5 < 7` in plain markup text as a tag (E-CTX-001), contrary to
  §4.18.1b exit (3).
