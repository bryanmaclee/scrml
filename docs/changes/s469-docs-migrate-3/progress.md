# s469-docs-migrate-3 — NERDME to the ruled dialect; claim-gate in CI

Branch `s469-docs-migrate-3`, cut from origin/main 29b6320ad. Follows #1499 (migrate-2) conventions.

## Baseline (origin/main 29b6320ad)
- snippet-gate --strict: 116 passed, 0 failed, 12 spec-ahead (128). impl1 107 files; bootstrap 21 (9 pass, 12 spec-ahead).
- claim-gate --report: 60 passed, 73 skipped, 27 snippet, 24 spec-ahead, 34 failed (218). NERDME.md: 7 pass, 1 skip, 1 fail (impl1).

## Plan
- [ ] nerdme/*.scrml rewritten in the ruled dialect, bootstrap-compiled or pinned spec-ahead
- [ ] NERDME.md opts in (`<!-- dialect: ruled -->`), fences under `<!-- snippet: … -->`, prose migrated
- [ ] claim-gate wired into CI (advisory — it fails on main)
- [ ] articles table for the PA
