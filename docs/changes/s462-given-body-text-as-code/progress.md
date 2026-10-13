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

## S465 resume (cloud, owner absent)
- 2026-10-12 00:00 reset onto wip/s464-markup-text-not-code @ a273fd596; applied salvage patch agent-ab499a58703c346b4; archived BRIEF-resume-S465.md (0f6fd8bf4); salvage committed as WIP (5585dc1f6).
- 2026-10-12 00:40 gate on salvage: 13 fail = env-only set + conformance lifecycle/effect-nested-pos (round-0 recorded signature; restored origin/main's expected.json since the collectExpr hunk is gone).
- 2026-10-12 00:50 finding 1 (drop collectExpr hunk): already dropped by the salvage; the single-element arm / sibling shapes still render text (unit + browser tests, 97 pass). Removal REOPENS `stmt⏎<el>…${}…</el>` (text after the first interpolation parsed as statements; probe compiles clean (exit 0) and emits `let k = 1 < b > b; _scrml_track_3(...)` as a load-time statement in the guard branch).
- 2026-10-12 merged origin/main 41af4153a (#1405, docs-only) as df9b63d7e; facts --write (6b6661505).
- 2026-10-12 corpus differential (corpus-emit-differential, 2809 sources, base 41af4153a vs head 6b6661505): 0 compile-outcome / 0 diagnostic-code / 0 diagnostic-text changes, 0 artifact-set delta, syntax delta 0; 165 artifact content diffs = 0 after normalising the checkout path (project-root strings only). gauntlet-r25: 4 files, identical outcome + code multiset on both sides. ../giti and ../flogence not cloned in this container — skipped.
- 2026-10-12 gates: pre-commit 32805 pass / 10 fail (env-only; tenant-floor-project-set 24/24 in isolation); tiers: top-level 2239/0, e2e-render-map 259/0, integration+lsp+commands 5621/16 (all `scrml dev`/serve env/timing files; base fails 18 in those files in isolation); browser-baseline --check PARSER DISAGREES twice (no verdict) — direct browser tier diff: head 49 fail ⊂ base 51 fail, 0 head-only; types, snippet, corpus-compile-floor, host-global-scan, facts, md-shim, bootstrap-conformance, conflict-marker, spec-index, delta-lint, s34-census --check-new, severity, state: PASS. No collectExpr change kept; the narrow fix is the Q24 refusal → filed g-statement-markup-after-statement-text-runs-s462 (HIGH).
- 2026-10-12 00:50 finding 2 (fail closed): no existing code fits (E-CG-003 compiler-defect; E-STMT-NO-EFFECT / E-LIFT-* / E-CTX-* other meanings). The salvage's E-MARKUP-STATEMENT-NOT-RENDERED is an unruled name → removed (emission, `_markupLead`, SPEC row, SPEC-INDEX regen, its tests). STOPPED + reported; revert the removal commit to restore the draft once the name is ruled.
- 2026-10-12 00:50 finding 3: deferred gaps already filed by the salvage; prov normalised to `review:s462-given-body-text-as-code`; `state.ts --write`.

## S464 finish (s464-markup-text-q24)
- 2026-10-12 code name ruled S464 "E-MARKUP-STATEMENT-NOT-RENDERED"; dee0e1d5d reverted (cba9971df); full Q24 build + the HIGH gap fix landed on top — see docs/changes/s464-q24-markup-statement-refused/progress.md.
