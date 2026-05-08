# primary.map.md
# project: scrmlTS
# updated: 2026-05-08T00:00:00Z  commit: f59bbcc

## Project Fingerprint
Language:   JavaScript / TypeScript (mixed `.js` + `.ts`; Bun runtime).
Framework:  Custom compiler — scrml language compiler.
Runtime:    Bun >= 1.3.13 (no Node.js dependency for compiler core; `node --check` used only as a syntax linter for emitted output).
Type:       Compiler + CLI tool + LSP server + 17-module stdlib.
Size:       ~24,739 LOC compiler / ~14,135 LOC codegen across 39 modules.
            SPEC.md 24,382+ lines (A5-1 amendments LANDED S68); PIPELINE.md 2,380 lines (v0.7.0).
            Tests: 469 files, S69 close 9,626 pass / 60 skip / 1 todo / 0 fail (~8,870 pre-commit subset).

## Map Index
| Map                      | Status  | Contents                                                                                                             |
|--------------------------|---------|----------------------------------------------------------------------------------------------------------------------|
| structure.map.md         | present | directory layout, 6 entry points, 5 new S68-S69 source files noted (89 lines)                                       |
| dependencies.map.md      | present | 2 runtime + 3 dev packages, full internal pipeline graph (59 lines)                                                 |
| schema.map.md            | present | ~80+ AST node kinds; SYM types B1-B22; all new S68-S69 types: synth surface, EngineStateChildEntry, SemicolonHit (178 lines) |
| config.map.md            | present | 11 SCRML_*/PORT env vars; bunfig.toml; package.json; .gitignore (69 lines)                                          |
| build.map.md             | present | 8 npm scripts, 7 CLI subcommands, docs/build.ts (82 lines)                                                         |
| error.map.md             | present | ~240+ E-codes + ~42 W-codes; S68-S69 B11-B22 codes enumerated; A5-1 SPEC codes noted (147 lines)                   |
| test.map.md              | present | bun test, 469 files, 9,626 pass; S68-S69 12 new unit test files enumerated (99 lines)                              |
| domain.map.md            | present | full pipeline + 22 locks + A1b COMPLETE status + S68-S69 B11-B22 changes + A5-1 + A7/A8 pending (168 lines)       |
| events.map.md            | present | `<channel>` (§38) + SSE (§37); no compiler-internal EventEmitter (38 lines)                                        |
| non-compliance.report.md | present | S69 refresh: B11-B22 dispatch dirs added to completed batch; B11-B17 audits re-assessed as historical (169 lines)  |
| api.map.md               | absent  | not applicable (compiler, not web API)                                                                               |
| state.map.md             | absent  | not applicable (compiler, not frontend app)                                                                          |
| auth.map.md              | absent  | not applicable (compiler tool; auth lives in stdlib/auth + user programs)                                            |
| style.map.md             | absent  | not detected                                                                                                         |
| i18n.map.md              | absent  | not detected                                                                                                         |
| infra.map.md             | absent  | no Dockerfile, no .github/workflows, no Terraform, no docker-compose                                                |
| migrations.map.md        | absent  | per-file `<schema>` blocks (§39) + `scrml migrate` CLI; no global migrations dir                                    |
| jobs.map.md              | absent  | stdlib/cron exists but project itself does not run jobs                                                              |

## File Routing
types / interfaces / AST node kinds        -> schema.map.md
environment variables / config keys        -> config.map.md
test patterns / fixtures / runner          -> test.map.md
build commands / CLI subcommands           -> build.map.md
directory layout / entry points            -> structure.map.md
external packages / internal pipeline      -> dependencies.map.md
business rules / pipeline / spec sections  -> domain.map.md
error codes / warning codes / diagnostics  -> error.map.md
`<channel>` / SSE / runtime event wiring   -> events.map.md
docs hygiene / superseded artefacts        -> non-compliance.report.md

## Key Facts

- **Entry points:** Installed CLI is `compiler/bin/scrml.js` (`bin: scrml`); programmatic API is `compiler/src/api.js` running the canonical pipeline `BS → TAB → MOD → CE → VP-1/W-1 → NR/SYM → PA → RI → TS → META → DG → BP → CG`. LSP entry is `lsp/server.js --stdio`. Docs site builder is `docs/build.ts` (Bun, uses `marked`).

- **A1b FUNCTIONALLY COMPLETE (S69):** All 22 steps B1-B22 SHIPPED across S63-S69. 9 commits in S69 (B18+B19+B20+B21+B22 = Wave 5 small-bundle + Wave 5 closer). Net +201 tests, 0 regressions. A1c (codegen+runtime, 24 steps C0-C23 in 6 waves) is the next phase.

- **S69 wrap (commit f59bbcc):** B22 — E-RESET-INVALID-TARGET (reset(@cell) target-shape multi-level compound-nav, PASS 14). B19 — E-CHANNEL-INSIDE-PROGRAM + E-CHANNEL-SHARED-MODIFIER (PASS 15, `module-resolver.js` updated). B18 — E-MULTI-STATEMENT-HANDLER via new `multi-statement-scan.ts` (two fire-sites: markup attr + engine :-shorthand). B20 — E-VARIANT-AMBIGUOUS + E-TYPE-063 (bare-variant inference §14.10, typer scope-bind, match-arm-block payload-binding Form 1b, PA debug recovery). B21 — refinement-type three-zone §53 (boundary-zone + trusted-zone extension).

- **S68 key changes:** B11 synth-cell registry PASS 8 (§6.11 compound validity surface). B13 E-DERIVED-WITH-VALIDATORS PASS 9 + Level-1 inline-override extraction (`ValidatorEntry.inlineOverride`). B12 per-field synth + ScopeKind `"field"`. B14 engine binding + MOD engine-aware exportRegistry PASS 10. B15 state-child exhaustiveness + rule= typer via new `engine-statechild-parser.ts` PASS 11. B16 E-DERIVED-ENGINE-* PASS 12. B17 E-COMPONENT-ENGINE-SCOPE PASS 13. A5-1 SPEC amendments LANDED `1de05ef` (§51.0.K/M/N/O/P/Q + §34 +2 codes E-HISTORY-NO-INNER-ENGINE + E-INTERNAL-RULE-NOT-COMPOSITE; compiler implementation pending A7).

- **AST contract:** `compiler/src/types/ast.ts` (~1,722 LOC) is the canonical AST. ~80 `kind` discriminators + B9 `RelationalPredicateNode` (sibling of ExprNode, not in ExprNode union). `ValidatorArg = ExprNode | RelationalPredicateNode`. B22 adds `ResetExpr` production path (was already in AST; B22 adds target-shape validation at SYM). SYM stage annotates AST with `_scope`, `_record`, `_resolvedStateCell`, `_cellKind`, `_isBindable` (non-enumerable). Phase A1a Step 3 (S59) renamed `kind: "reactive-decl"` → `kind: "state-decl"`.

- **New source modules (S68-S69):** `engine-statechild-parser.ts` (B15), `multi-statement-scan.ts` (B18), `derived-mutation-ops.ts` (B8/S67), `validator-catalog.ts` (B10/S67), `validator-arg-parser.ts` (B9/S67). All in `compiler/src/`.

- **Database:** Bun.SQL only. Schemas declared per-file via `<schema>` (§39); reconciliation by `compiler/src/schema-differ.js`; multi-DB adaptation via `?{}` (§44); URI classification by `codegen/db-driver.ts`.

- **Test runner:** Bun test, root `compiler/tests/`, timeout 10s. 7 categories (unit 329, integration 31, conformance 81, browser 11, lsp 10, self-host 4, commands 3). 469 total files. Two persistent self-host smoke failures historically deferred per user.

## Tags
#scrmlTS #map #primary #compiler #s68 #s69 #s69-refresh #a1b-complete #v0next #L22 #piecemeal-migration #b11 #b12 #b13 #b14 #b15 #b16 #b17 #b18 #b19 #b20 #b21 #b22 #engine-statechild #synth-surface #bare-variant #refinement-three-zone #reset-target #multi-statement #channel-placement #a7-ratified #a8-ratified #a5-1-landed

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
- [SPEC.md](../../compiler/SPEC.md)
- [PIPELINE.md](../../compiler/PIPELINE.md)
