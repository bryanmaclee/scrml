# sPA ss72 → PA re-integration — conformance authoring: import / module resolution §21

**List:** `spa-lists/ss72-conformance-import-module-21.md`
**Branch:** `spa/ss72` · **tip:** `05e1ee1b74fb0192666d3cfd5edac3f2498bd283` (`05e1ee1b`)
**Base:** branched off `origin/main` `7d5fda26` (branch is +3 commits; additive-only, all NEW files). ⚠️ `origin/main` has since advanced +2 to `e6a6cae4` (`conformance(equality) §45` #53 + `test(ss71) match §18` #51) — **DISJOINT families** (`equality-codes/`, `match-codes/`), zero overlap with my `conformance/cases/module/`. Cherry-pick / file-delta of my 3 commits onto current `origin/main` is clean (verified: none of my 65 paths exist on `origin/main`; none of its +2 paths are under `module/`).
**Harness:** `conformance (impl#1): 459/459 → 487/487` (independently re-verified green post-commit; full pre-commit suite 20226 pass / 0 fail on each of the 3 commits)
**Status:** ✅ COMPLETE — all 14 import/module codes pinned (28 cases: reject-pos + clean-neg each). 0 parked.

## ⚠️ NEEDS A RULING (escalated — sPA did NOT decide/fix; cases are unaffected either way)

**OBS-1 — E-SCOPE-010 is spec-OVERLOADED across two distinct rules.**
- **§7.6** (`SPEC.md:5988`): "Re-declaring a name … already declared at file scope SHALL be a compile error (E-SCOPE-010: **duplicate binding in file scope**)." → the ONLY impl fire site is `gauntlet-phase1-checks.js:449`. This is what the list intended and what I pinned (`e-scope-010-filescope-duplicate-reject`, spec `§7.6`).
- **§20.4** (`SPEC.md:14435-14562`, catalog row `SPEC.md:17923` = `§20.4`): E-SCOPE-010 is ALSO documented as "developer declares a variable with a **reserved binding name** (`route`, `session`)" with worked `let route = …` / `let session = …` examples.
- **impl reality:** grep finds NO E-SCOPE-010 fire site for the reserved-name meaning — only the duplicate-binding one. So the §20.4 reserved-name E-SCOPE-010 appears **unimplemented under this code** (or enforced elsewhere/not at all).
- **PA/user to decide:** (a) split the two rules into distinct codes (spec hygiene — one code, two unrelated meanings is a catalog smell), and/or (b) wire + conformance-cover the §20.4 reserved-name path. The pinned §7.6 case stays valid under either decision. Reserved-name coverage is a **follow-up** (needs the impl gap resolved first).

**OBS-2 — `bun:` / `node:` specifier prefixes: impl fires E-IMPORT-005/E-USE-005, but SPEC §41 says they're legal.**
- **SPEC §41** (`SPEC.md:21940`): "A specifier that does not begin with `scrml:`, `vendor:`, **`bun:`, `node:`**, `./`, or `../` SHALL be a compile error (E-USE-005 for `use`, E-IMPORT-005 for `import`)." → per §21940, `bun:`/`node:` are RECOGNIZED (not an error).
- **impl reality (probed):** `import { Database } from 'bun:sqlite'` → **E-IMPORT-005 fires**; `use bun:sqlite` → **E-USE-005 fires**. `isLegalImportSpecifier` (`module-resolver.js:66`) and the `use` prefix check (`gauntlet-phase1-checks.js:263`) accept ONLY `./ ../ scrml: vendor:`. The E-IMPORT-005 catalog row (`SPEC.md:15141`) also says "must be `./`, `scrml:`, or `vendor:`" — so §21940 contradicts BOTH the impl AND its own catalog row.
- **sPA handling:** my reject cases use `foo:` (`use`) and `lodash` (`import`) — unambiguously rejected under BOTH readings, so the cases are correct regardless. **PA/user to decide:** allow `bun:`/`node:` (fix impl + catalog to match §21940) OR drop them from §21940 (amend spec to match impl+catalog). If `bun:`/`node:` become legal, add a `bun:`-clean neg then.

## Landed items — 3 additive commits, all under `conformance/cases/module/`

| commit | codes | cases |
|--------|-------|-------|
| `293f834d` | E-IMPORT-001, E-IMPORT-003, E-SCOPE-010, E-USE-001, E-USE-002, E-USE-005 | 12 |
| `5b39b492` | E-IMPORT-002, E-IMPORT-004, E-IMPORT-005, E-IMPORT-006, E-EXPORT-001 | 10 |
| `05e1ee1b` | E-EXPORT-002, E-EXPORT-003, E-IMPORT-PINNED-INVALID | 6 |

Per-code reject/clean dir map: see `spa-lists/ss72.progress.md`.

**Benign incidental co-fires (documented; NOT in any `notCodes`):** every clean-neg with no `<program>` co-emits `W-PROGRAM-001` (no-program warning) — expected, superset match ignores it. No case relies on impl-freedom message text.

**Notes on the trickier codes (all impl-verified, SPEC-aligned):**
- **E-IMPORT-002 / -004 / -006 / -PINNED-INVALID** use the `files` multi-file convention (aux `a.scrml` / `m.scrml` siblings). E-IMPORT-002 forms a real 2-file `case.scrml ↔ a.scrml` cycle. Adapter compiles the whole gathered graph at CODES level, so MOD's circular/name/existence checks fire as in production.
- **E-IMPORT-PINNED-INVALID** DOES fire in the harness — the conformance pipeline wires MOD's `exportRegistry` into SYM, so `import { present pinned }` (function) is rejected; the clean-neg pins a `const` (best-effort Option A ACCEPT per §21.8.1, since engine-form `export <engine var=…>` desugars to `export const` and is indistinguishable today).
- **E-EXPORT-002 / -003** are Form-1 `export <Component>` cases authored at file top-level (no `<program>` — the ast-builder Form-1 detector requires `parentType !== "markup"`).
- **E-EXPORT-001** reject markup uses `${@count}` (reactive ref); the bare `${count}` form co-tripped E-DG-002/E-SCOPE-001 — tightened to isolate E-EXPORT-001.

## Re-integration notes for the PA
- **Delta is purely additive** — 65 new files (28 case dirs × {case.scrml, expected.json} + 9 aux `*.scrml` fixtures + `docs/changes/conformance-components-15-16-ss68/` is NOT mine). No existing tracked file touched, no compiler change → clean file-delta / cherry-pick of the 3 commits; confirm `bun conformance/run.ts` → 487 green after. (NOTE: a fresh worktree needs `node_modules` symlinked from main — the adapter imports `compiler/src`, deps like happy-dom are gitignored.)
- **Did NOT touch `spa-lists/ss72-conformance-import-module-21.md`** (tracked + PA-owned; main checkout was mid-flight on `spa/ss68`). Please mark ss72 items 1–14 `landed-on-branch` per the SHAs above at re-integration. Progress log written to untracked `spa-lists/ss72.progress.md`.
- Base was `origin/main 7d5fda26`; `origin/main` is now `e6a6cae4` (+2, disjoint equality/match families) — file-delta still applies cleanly (all-new paths under `conformance/cases/module/`; verified no collision).

*sPA ss72 standing down. Durable output = branch `spa/ss72 @ 05e1ee1b` + this ping. The §21 module-resolution contract moves to conformance-covered.*
