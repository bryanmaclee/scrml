# Progress — bug-1 Tailwind preflight Phase 4: filter + backdrop-filter (S191)

Approach C (inline var() fallbacks). NET-NEW, all-additive — no existing filter/backdrop utilities.

## Steps
- [x] Startup verification (pwd under worktree, FF-merged main to 2a2e3238, bun install, pretest, first WIP commit)
- [x] Read deep-dive authority + maps + Phase 1-3 templates + SPEC §26.7
- [x] Confirmed NET-NEW: zero existing filter/backdrop utilities + zero deferred regression-guard asserts to invert
- [ ] FILTER_COMPOSE + BACKDROP_COMPOSE consts (+ -webkit- backdrop line)
- [ ] registerFilters() named utilities
- [ ] registerBackdrop() named utilities
- [ ] Wire register calls
- [ ] Arbitrary handlers (blur/brightness/contrast/grayscale/hue-rotate/invert/saturate/sepia/drop-shadow + backdrop-*)
- [ ] Golden-CSS + COMPOSE + arbitrary unit tests
- [ ] SPEC §26.7.3 + regen-spec-index
- [ ] Update transform-test header comment (Phase 4 now landed)
- [ ] R26 empirical verify
- [ ] Pre-DONE full test gate

## Notes
- Deep-dive shows shorthands WITHOUT inline fallbacks; BRIEF specifies Approach C with EMPTY inline fallbacks (var(--tw-blur,)). BRIEF is operative.
- backdrop has `opacity` (not in plain filter set) + NO drop-shadow. backdrop ALSO emits -webkit-backdrop-filter prefix line.
- No lint inverts needed (zero deferred blur/brightness/backdrop assertions exist; transform-test header comment is the only doc-comment touch).

## Update — implementation + tests + spec landed
- [x] FILTER_COMPOSE + BACKDROP_COMPOSE consts (+ -webkit- backdrop line) — commit 4e2d3270
- [x] registerFilters() + registerBackdrop() + wire calls — commit 4e2d3270
- [x] Arbitrary handlers (filter + backdrop-* in ARBITRARY_DECL_TRANSFORM) — commit 4e2d3270
- [x] SPEC §26.7.3 + regen-spec-index — commit cb445290
- [x] 53 unit tests (bug-1-tailwind-filter-family.test.js) + transform-test header update — commit abe0e4da
- [ ] R26 empirical verify (next)
- [ ] Pre-DONE full gate confirm

## Findings
- getTailwindCSSWithDiagnostic returns {css, diagnostic} (singular); the unrecognized-class lint comes from findUnrecognizedClasses(source). §9 test corrected to use it.
- Multi-token drop-shadow-[0_4px_3px_red] is a list -> E-TAILWIND-001 (same single-token rule as transform/gradient arbitrary; use named drop-shadow-* for multi-layer). Single-token blur-[2px] etc. compose correctly.
- NO lint inverts needed: zero pre-existing deferred blur/brightness/backdrop W-TAILWIND-UNRECOGNIZED-CLASS regression-guard assertions existed (only a doc-comment in transform-test, updated).

## DONE
- [x] R26 empirical verify — PASS (13/13 assertions); filter shorthand with blur/brightness/grayscale set, backdrop-filter (+ -webkit-) with backdrop-blur set, balanced parens/braces, no undefined/NaN, no empty filter:, client.js clean (no leak)
- [x] Pre-DONE gate: 16989 pass / 90 skip / 1 todo / 0 fail (17080 across 923 files); full pre-commit hook (incl. browser) passed on each commit
- ALL COMPOSING FAMILIES COMPLETE: ring/shadow (P1) · gradient (P2) · transform (P3) · filter/backdrop (P4)
