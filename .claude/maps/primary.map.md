# primary.map.md
# project: scrmlts
# updated: 2026-05-23T00:00:00Z  commit: 73dd816c

## Project Fingerprint

Language:   JavaScript + TypeScript (mixed; .js + .ts source, no tsc build step)
Framework:  none — bespoke compiler; deps acorn + astring
Runtime:    Bun >=1.3.13 (also the test runner, bundler, package manager)
Type:       compiler / language toolchain (monorepo: Bun workspace `["compiler"]`)
Size:       ~3200 git-tracked files
Watermark:  HEAD 73dd816c (2026-05-23) — package.json v0.6.0 — S124 wrap (M6.6.b.2+b.3 + M6.5.b.0 + M6.7 STOP + MCP V0 SCOPING)

## Map Index

| Map | Status | Contents |
|---|---|---|
| structure.map.md | present | directory layout, entry points, native-parser, stdlib, codegen/SYM/native-walker module detail |
| dependencies.map.md | present | 2 root + 2 compiler runtime deps, internal module graph, stdlib shim layout |
| schema.map.md | present | FileAST / ASTNode / EngineStateChildEntry / native catalogs / SYM types / runtime-chunks |
| config.map.md | present | 2 env vars, compiler option flags |
| build.map.md | present | bun scripts, CLI subcommands, git hooks |
| error.map.md | present | 11 stage classes, §34.1 81-code catalog, W-STDLIB-*, I-FN-PROMOTABLE, E-STATE-UNDECLARED, E-WRITE-NOT-IN-LOGIC-CONTEXT |
| test.map.md | present | bun test, 759 test files, M6.5.b.0 + M6.6.b.2 + V-kill + Unit CC + R4 regression gates |
| domain.map.md | present | 25-stage pipeline, M5 swap seam, M6 Wave 1+M6.6.b.2+M6.7-STOP, native-walker pattern, MCP V0 |
| api.map.md | absent | no HTTP API surface (compiler, not a server) |
| state.map.md | absent | no app state store (compiler) |
| events.map.md | absent | no event bus |
| auth.map.md | absent | auth is a scrml LANGUAGE feature, not app infra |
| migrations.map.md | absent | no DB migration tooling (test *.db throwaway) |
| jobs.map.md | absent | no job/queue scheduler |
| infra.map.md | absent | no Docker / CI / IaC |
| style.map.md | absent | no design-token system |
| i18n.map.md | absent | no i18n |

## File Routing

| Task | Map |
|---|---|
| types / AST shapes / native catalogs / EngineStateChildEntry | schema.map.md |
| pipeline stages / native parser / M5/M6 / native-walker pattern | domain.map.md |
| native-parser layout / assembler / stdlib shim layout / CE/SYM/native-walker module detail | structure.map.md |
| compiler option flags / env vars | config.map.md |
| build commands / CLI / git hooks | build.map.md |
| test layout / parser-conformance / canary / within-node parity | test.map.md |
| external packages / module graph / shim catalog | dependencies.map.md |
| diagnostic classes / error codes / W-STDLIB-* / I-FN-PROMOTABLE / E-STATE-UNDECLARED | error.map.md |

## Task-Shape Routing (agents — read this section first)

**Native-parser bug fix** (gap-ledger residual, dual-pipeline canary, within-node parity, FileAST synthesis, R4-continuation):
1. `structure.map.md` (Native-Parser Layout section)
2. `schema.map.md` — FileAST contract + native catalogs + bridge layer
3. `domain.map.md` (M5 swap section + M6 Wave 1 progression)
4. `test.map.md` — parser-conformance + dual-pipeline-canary + within-node canary harness

**M6 consumer migration** (legacy `splitBlocks`/`buildAST`/`parseEngineStateChildren` call-sites → native):
1. `domain.map.md` (M6 Wave 1 status + Aggregates table + native-walker pattern)
2. `structure.map.md` (Native-Parser Layout — BRIDGE + Key New Module — M6.6.b.2)
3. `schema.map.md` — FileAST + EngineStateChildEntry the consumer touches
4. `test.map.md` — m66-b2 test + parser-conformance gates

**symbol-table.ts change** (SYM PASS modifications, scope-chain, new pass):
1. `domain.map.md` (Stage 3.06 [SYM] entry + Aggregates)
2. `structure.map.md` (Key Symbol Table Modules section)
3. `schema.map.md` (EngineStateChildEntry + SYMInput/SYMResult types)
4. `test.map.md` — symbol-table.test.js integration gate

**V-kill / Unit CC change** (E-STATE-UNDECLARED / E-WRITE-NOT-IN-LOGIC-CONTEXT, exemption list, ReactiveAssignNode):
1. `error.map.md` — V-kill + Unit CC codes section
2. `domain.map.md` (Stage 3.06 [SYM] + Stage 3 [TAB] + Business Invariants)
3. `schema.map.md` (ReactiveAssignNode + LogicStatement union)
4. `test.map.md` — S123 unit test files

**Codegen change** (Stage 8 [CG], emit-* modules, rewrite.ts, runtime-chunks.ts):
1. `structure.map.md` (Key Codegen Modules section)
2. `schema.map.md` (RewriteContext, RuntimeChunkName, CHUNK_DEPENDENCIES)
3. `domain.map.md` (Stage 8 [CG] entry)

**Stdlib-shim authoring** (new scrml:NAME bundling, W-STDLIB-* surface):
1. `dependencies.map.md` (Stdlib runtime shim layout)
2. `structure.map.md` (compiler/runtime/)
3. `error.map.md` — W-STDLIB-SHIM-MISSING + W-STDLIB-COMPILER-DEFERRED

**Spec amendment** (SPEC.md §X.Y, §34 catalog row):
1. `domain.map.md` (Core Concepts + Business Invariants)
2. `error.map.md` — if the amendment touches a code family
3. `schema.map.md` — if the amendment touches a node shape

**Don't know which** (open-ended task brief):
1. Read `primary.map.md` (this file) in full
2. Self-classify via Task-Shape Routing above
3. If genuinely unclear, surface to PA before consuming further context

## Use Feedback Loop

When this map's content was load-bearing for a dispatch outcome, the agent's final report should note **"map content consulted: [list of map files]; load-bearing finding: [one sentence]"**. When not useful, report **"maps consulted but not load-bearing"** so PA can diagnose wrong-map or wrong-granularity issues. 3–5 consecutive "not load-bearing" reports on the same task shape trigger a map-design review.

## Key Facts

- `compileScrml(options)` in `compiler/src/api.js` is the pipeline orchestrator — a 25-stage chain BS→TAB→PRECG→GCP1/3→MOD→NR→SYM→CE→VP→PA→RI→MC→TS→META→DG→BP→AG→RS→CG.
- M5-swap C2 IS LANDED (S119): `--parser=scrml-native` routes the per-file TAB stage through `nativeParseFile` (`compiler/native-parser/parse-file.js`). Strictly opt-in; `parser` defaults to `null`.
- **M6.6.b.2 LANDED (S124)**: `compiler/src/native-walker/engine-statechild-walker.ts` replaces `parseEngineStateChildren` text-rescanner in SYM PASS 11. Parity verified by `compiler/tests/unit/m66-b2-engine-statechild-walker.test.js`. Legacy `engine-statechild-parser.ts` survives as fallback for synthetic ASTs.
- **M6.6.b.3 LANDED (S124)**: `isLegacyArrowRulesBody` + `scanForOnIdleEntries` migrated to native walker path.
- **M6.5.b.0 LANDED (S124)**: within-node parity classifier extended (Wave 2 unblocked); `parser-conformance-within-node.test.js` + allowlist added.
- **M6.7 STOP (S124)**: full-corpus flag flip attempted and reverted. Corpus migrations + canary close landed. Within-node divergences (`parser-conformance-within-node.test.js`) block the flip. Next: M6.6.b.4..b.6 (continued native-walker migrations), then M6.7 re-attempt.
- **MCP V0 SCOPING (S124)**: 11-tool surface + 5-sub-unit decomposition scoped in `docs/changes/mcp-v0-devtools-scoping/SCOPING.md`. Not yet implemented.
- **R4 translateExpr wiring COMPLETE (S123)**: all 6 sites in `translate-stmt.js` wired — U1..U6.b.
- **V-kill (S123)**: E-STATE-UNDECLARED fires in SYM PASS 3; `ReactiveAssignNode` (kind:"reactive-assign") in `types/ast.ts:764`.
- **Unit CC (S123)**: E-WRITE-NOT-IN-LOGIC-CONTEXT fires for bare `@x = expr` at `<program>`/`<page>`/`<channel>` body-top; per-file exemption via `compiler/src/unit-cc-exemption-list.json`.
- **6nz Bug P (S123)**: `scope` runtime chunk unconditionally pulls `timers` + `animation` via `CHUNK_DEPENDENCIES` + `applyChunkDependencies` in `codegen/runtime-chunks.ts`.
- The central data structure is `FileAST` (`compiler/src/types/ast.ts:1487`). Native catalogs (Stmt[], Expr, Block[]) are PascalCase ESTree-shaped; live FileAST uses lowercase scrml kinds — the bridge translates.
- scrml SOURCE has no exceptions, no `null`/`undefined`, and no async/await (standing rules). §34.1 catalogs 81 native-parser diagnostics (stable through S124). §34 grew S123: +E-STATE-UNDECLARED + E-WRITE-NOT-IN-LOGIC-CONTEXT.
- `symbol-table.ts` is 9730+ LOC (21 PASSes). PASS 11 now uses `engine-statechild-walker.ts` (M6.6.b.2) with legacy text-rescanner as fallback. M6.6.b.4..b.6 = deletion-only follow-ons.
- No hosted CI, no Docker — quality gates are local git hooks; pre-commit runs unit+integration+conformance, never bypass `--no-verify` without authorization.
- SPEC.md is normative per pa.md Rule 4 (58 sections).

## Tags
#scrmlts #map #primary #compiler #native-parser #m5-swap #m6-wave1 #pipeline #s124 #v-kill #unit-cc #r4-continuation #giti-017 #6nz-bug-p #m6-2b #m6-6-b2 #m6-5-b0 #native-walker #m6-7-stop #mcp-v0 #stdlib-shims

## Links
- [structure.map.md](./structure.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [schema.map.md](./schema.map.md)
- [config.map.md](./config.map.md)
- [build.map.md](./build.map.md)
- [error.map.md](./error.map.md)
- [test.map.md](./test.map.md)
- [domain.map.md](./domain.map.md)
- [non-compliance.report.md](./non-compliance.report.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
