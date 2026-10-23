# s469-docs-migrate-3 — NERDME to the ruled dialect; claim-gate in CI

Branch `s469-docs-migrate-3`, cut from origin/main 29b6320ad. Follows #1499 (migrate-2) conventions.

## Baseline (origin/main 29b6320ad)
- snippet-gate --strict: 116 passed, 0 failed, 12 spec-ahead (128). impl1 107 files; bootstrap 21 (9 pass, 12 spec-ahead).
- claim-gate --report: 60 passed, 73 skipped, 27 snippet, 24 spec-ahead, 34 failed (218). NERDME.md: 7 pass, 1 skip, 1 fail (impl1).

## After
- snippet-gate --strict: 112 passed, 0 failed, 17 spec-ahead (129). impl1 99; bootstrap 30 (13 pass, 17 spec-ahead, 0 stale).
- claim-gate: 53 passed, 73 skipped, 36 snippet, 24 spec-ahead, 33 failed (219). NERDME.md [ruled]: 0 pass, 1 skip, 0 fail, 9 snippet.
- snippet-drift + doc-gate-bootstrap-mode unit tests: 37 pass.

## Done
- [x] nerdme/*.scrml in the ruled dialect. Compile on the bootstrap: state-and-reactivity, match-and-each,
      errors-as-states, validity. Pinned spec-ahead: match-block (new; <match> element), engine (<onTimeout>),
      refinement (no refinement types; cascade pin), type-derived, navigation.
- [x] NERDME.md opts in; every program under a `<!-- snippet: … -->` marker; impl#1 notes labelled.
- [x] claim-gate wired into CI: `tracking` job, `continue-on-error` (it fails on main). DIALECT.md table updated.

## Claim-gate failures left on main (all impl#1-mode, none in a ruled doc)
| file | fails | kind |
|---|---|---|
| docs/articles/if-you-give-a-dev-an-enum-2026-08-31.md | 17 | working draft (version table, v7 2026-08-31) |
| docs/articles/if-you-give-a-dev-an-enum-PUBLISH.md | 3 | publish-ready copy |
| docs/articles/i-am-jacks-match-2026-09-08.md | 3 | working draft (v1 2026-09-08) |
| docs/articles/i-am-jacks-match-PUBLISH.md | 3 | publish-ready copy |
| docs/articles/i-am-jacks-engine-2026-09-07.md | 1 | working draft (v6 2026-09-07) |
| docs/articles/i-am-jacks-engine-PUBLISH.md | 1 | publish-ready copy |
| docs/website/v0.2.0-announce-2026-05-05.md | 4 | dated release announcement |
| docs/website/v0.3.0-announce-2026-05-14.md | 1 | dated release announcement |

## Findings (bootstrap, not fixed here)
- No compile-time `rule=` check on a single-declaration engine (`@door = .Open` from `.Closed` compiles; checked at run time via the edges), and a variant with no state-child compiles silently.
- Refinement types fail at parse in openers / struct fields / parameters, with a cascade (refinement.scrml pin is 6 codes).
