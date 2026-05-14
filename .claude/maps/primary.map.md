# primary.map.md
# project: scrmlts
# updated: 2026-05-13T23:00:00Z  commit: 71305fe

## Project Fingerprint
Language:   JavaScript / TypeScript (mixed .js + .ts); Bun runtime
Framework:  Custom compiler — scrml language compiler + LSP server
Runtime:    Bun >= 1.3.13
Type:       Compiler + CLI tool + LSP server + 21-module stdlib
Size:       ~1,781 source files (excluding node_modules/dist/.git); compiler/src ~104 .ts/.js files;
            SPEC.md 27,037 lines; SPEC-INDEX.md 313 lines; PIPELINE.md v0.7.1 (2,758 lines);
            samples/compilation-tests: ~289 .scrml fixtures;
            Tests: 604 files — **12,065 pass / 117 skip / 1 todo / 0 FAIL** (S89 close)

## Key Facts (S89 CLOSE — 2026-05-13)

**Current shipped version: v0.2.6 (`efbd1e8`)**
HEAD `71305fe` is NOT tagged — v0.3.0 cut path active; Wave 4 adopter content CLOSED.

**§36 input devices chain CLOSED S89 (Phases 1-4 end-to-end):**
- Parser/typer support for `<keyboard>`, `<mouse>`, `<gamepad>` input-state elements
- conf-INPUT-001..005 conformance suite + input-canvas-integration + input-frame-accurate tests
- E-INPUT-005 (duplicate input-state id in scope) emitted at emit-html.ts:260
- W-INPUT-001 warning + input-canvas-demo.scrml sample
- emit-variant-guard.ts factored helper for engine-related codegen (variant-source-agnostic)

**§13.2 auto-await chain CLOSED S89 (Sub-A + Sub-B + Sub-E):**
- SPEC §13.2.1/§13.2.2 stdlib Promise<T> normative sections added
- Stage 3.105 STDLIB-EXPORT-SEED TAB-only pass in api.js seeds 37 stdlib function signatures for auto-await classifier
- verifyPassword + verifyJwt migrated to one-line auto-await
- E-PROG-004 demoted Error → Info

**Approach A wave A-1 CLOSED S89 (A-1.1..A-1.8 complete):**
- A-1.6 consumer audit: 523 markup-read nodes vs 256 ceiling = 2.04x
- A-1.7 ceiling re-measurement via scripts/measure-markup-read-edges.ts
- A-1.8 docs; A-5.5 closed ahead of schedule

**Approach A-2 Reachability Solver advanced (A-2.1 scaffold + A-2.2 Component 1):**
- A-2.1: types/reachability.ts (RSInput/RSOutput/ChunkPlan, 247 LOC) + reachability-solver.ts (152 LOC) + --emit-reachability CLI flag
- A-2.2: entry-point detection + constant-folder primitive + gate-classifier + worst-case-union; +82 tests

**A-3 §40 auth-graph SCOPED:** docs/changes/a3-auth-graph-scoping/SCOPING.md

**Null + undefined ABSOLUTE eradication (S89):**
- SPEC §42 sharpened; NEW §42.1.1 "Defined Values vs. Absence — `""` is NOT Absence" normative subsection
- W-NULL-IN-SCRML-SOURCE → W-ABSENCE-IN-SCRML-SOURCE catalog rename (covers both tokens)
- Corpus + primer + kickstarter + samples + examples swept
- Stdlib Phase 1.5 sweep: 21 files / 124 sites null→not/is-some/is-not (commit 8c608a7)
- TS audit docs: docs/audits/null-audit-compiler-src-2026-05-13.md + undefined-audit-compiler-src-2026-05-13.md
- mutability-contracts article migrated `(null → T)` → `(not → T)` lifecycle

**M-7C-D-12 runtime sentinel SCOPING complete:** Option ε ratified (SPEC §42.5 + §42.8 + §12.5.1 + §42.1 S89 exclusions). 5 tracks / 33-45h aggregate. Pending 3-OQ disposition. docs/changes/m-7c-d-12-runtime-sentinel-scoping/SCOPING.md

**W-TRY-CATCH-IN-SCRML-SOURCE lint added (S89):**
- Stage 3.007 lint walker (validators/lint-try-catch.ts) in api.js
- New §34 warning row; fires on stdlib/http lines 65/264 (tracked as migration backlog)

**Wave 4 adopter content CLOSED S89:**
- Tutorial 11/11 PASS (13 edits across 4 sub-tasks)
- 17 D-track articles classified

**TodoMVC edit-mode markup landed** post-LIFT-5 (markup fixture + anchor test: todomvc-fixture-edit-mode.test.js).

## Map Index

| Map                      | Status  | Contents                                                                  |
|--------------------------|---------|---------------------------------------------------------------------------|
| structure.map.md         | present | directory layout, entry points, S89 new/modified files (109 lines)        |
| dependencies.map.md      | present | 5 root+compiler runtime + 5 dev packages; pipeline graph with A-2.1 reachability wiring (118 lines) |
| schema.map.md            | present | ~80+ AST node kinds; reachability types [S89 A-2.1]; MarkupReadDGNode [S88 A-1.2]; HostError/safeCall; IR; CompileContext (233 lines) |
| config.map.md            | present | 2 env vars (SCRML_PORT, PORT); bunfig.toml; CLI flags incl. --emit-reachability [S89] (54 lines) |
| build.map.md             | present | 11 npm scripts + e2e scripts; pre-commit hook; CLI subcommands; measure-markup-read-edges [S89] (95 lines) |
| error.map.md             | present | CGError + 9 runtime error classes; E-INPUT-005 [S89]; W-ABSENCE [S89 renamed]; W-TRY-CATCH [S89]; all E-/W- families (147 lines) |
| test.map.md              | present | bun:test, 604 files, 12,065 pass; S89 new test files; §36/§13.2/A-2 tests enumerated (138 lines) |
| domain.map.md            | present | 40+ domain concepts; S89: A-1 closed, A-2 in progress, §36 closed, §13.2 closed, null-eradication, Wave 4 closed; Task-Shape Routing section (128 lines) |
| events.map.md            | present | no compiler EventEmitter; §36 input device model [S89]; channel placement rules; WebSocket pub/sub in compiled output (57 lines) |
| api.map.md               | absent  | not applicable — compiler tool, not web API                               |
| state.map.md             | absent  | not applicable — compiler, not a frontend app                             |
| auth.map.md              | absent  | not applicable — auth lives in stdlib/auth and user .scrml programs       |
| style.map.md             | absent  | not detected                                                              |
| i18n.map.md              | absent  | not detected                                                              |
| infra.map.md             | absent  | no Dockerfile, no .github/workflows, no Terraform, no docker-compose      |
| migrations.map.md        | absent  | per-file `<schema>` blocks (§39) + `scrml migrate` CLI; no migrations dir |
| jobs.map.md              | absent  | stdlib/cron exists but compiler itself does not run jobs                  |
| non-compliance.report.md | present | 4 non-compliant; 10 uncertain; 104 compliant (110 lines)                  |

## File Routing

types / interfaces / AST node kinds           → schema.map.md
reachability types (RSInput/RSOutput/ChunkPlan) → schema.map.md
environment variables / config keys           → config.map.md
CLI flags                                     → config.map.md + build.map.md
test patterns / fixtures / runner             → test.map.md
build commands / CLI subcommands / hooks      → build.map.md
directory layout / entry points               → structure.map.md
external packages / internal pipeline graph   → dependencies.map.md
business rules / pipeline stages / spec       → domain.map.md
error codes / warning families / handlers     → error.map.md
event bus / channel placement / input devices → events.map.md
null/absence migration tasks                  → domain.map.md (Task-Shape Routing section)
Approach A continuation (A-2.3+)              → domain.map.md (Task-Shape Routing section)

## Key Facts
- Entry point is `compiler/src/cli.js` → `compiler/src/api.js` which orchestrates 12+ pipeline stages (BS→TAB→NR→MOD→CE→UVB→PA→RI→TS→META→DG→CG plus Stage 3.007 LINT-TRY-CATCH [S89] + Stage 3.105 STDLIB-EXPORT-SEED [S89] + Stage 7.6 reachability scaffold [S89])
- SPEC.md (27,037 lines) is normative; SPEC-INDEX.md (313 lines) is the navigation index; PIPELINE.md (v0.7.1, 2,758 lines) is the implementation contract
- Test suite: 604 files, 12,065 pass / 117 skip / 1 todo / 0 fail at S89 close (71305fe); pre-commit hook gates on unit+integration+conformance subsets
- `null` and `undefined` do NOT exist in scrml at any level — SPEC §42 + §42.1.1 normative; `""` / `0` / `false` are DEFINED values; canonical absence is `not`; E-SYNTAX-042 (hard error) + W-ABSENCE-IN-SCRML-SOURCE (info lint)
- Approach A-1 fully closed (S89); A-2 in progress (scaffold + Component 1 done, A-2.3+ pending); A-3 scoped (pending implementation)
- §36 input devices and §13.2 auto-await chains both CLOSED end-to-end at S89; Wave 4 adopter content CLOSED; M-7C-D-12 sentinel SCOPED (pending 3-OQ disposition)
- stdlib/http has 4 remaining try-catch sites tracked by W-TRY-CATCH-IN-SCRML-SOURCE lint (lines 65/264) — migration backlog, not blockers

## Tags
#scrmlts #map #primary #s89 #v0.3 #approach-a #approach-a2 #null-eradication #input-devices #auto-await #wave4-closed #reachability

## Links
- [structure.map.md](./structure.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [schema.map.md](./schema.map.md)
- [config.map.md](./config.map.md)
- [build.map.md](./build.map.md)
- [error.map.md](./error.map.md)
- [test.map.md](./test.map.md)
- [domain.map.md](./domain.map.md)
- [events.map.md](./events.map.md)
- [non-compliance.report.md](./non-compliance.report.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
