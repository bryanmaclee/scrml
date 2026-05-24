# structure.map.md
# project: scrmlts
# updated: 2026-05-23T00:00:00Z  commit: 73dd816c

## Entry Points

`compiler/bin/scrml.js` — CLI executable shim; re-exports src/cli.js.
`compiler/src/cli.js` — subcommand router; dispatches compile/dev/build/migrate/promote/generate/init/serve; falls through to compile when arg 0 is a .scrml file or directory.
`compiler/src/api.js` — programmatic compiler API; `compileScrml(options)` runs the full BS→TAB→PRECG→GCP1/3→MOD→NR→SYM→CE→VP→PA→RI→MC→TS→META→DG→BP→AG→RS→CG pipeline; the M5 native-parser swap seam (`--parser=scrml-native` routes per-file TAB through `nativeParseFile`).
`compiler/native-parser/parse-file.js` — `nativeParseFile(filePath, source)` — the C1 FileAST assembler; 1037 LOC; 12 per-BlockKind synth* builders; imported by meta-eval.ts, codegen/emit-match.ts, component-expander.ts.
`lsp/server.js` — Language Server Protocol entry.
`docs/build.ts` — docs-site builder.

## Directory Ownership

`compiler/src/` — JS+TS compiler pipeline stages (BS, TAB, CE, PA, RI, MC, TS, META, DG, BP, AG, RS, CG) plus lints and validators.
`compiler/src/codegen/` — Stage 8 code generation; ~55 emit-* modules + index.ts (runCG), route-splitter, IR, source-map, runtime-chunks, rewrite.
`compiler/src/codegen/compat/` — parser-workaround shims (BPP-override compatibility layer).
`compiler/src/commands/` — CLI subcommand implementations (compile, dev, build, migrate, promote, generate, init, serve).
`compiler/src/types/` — TypeScript type declarations: `ast.ts` (all AST node shapes), `auth-graph.ts`, `reachability.ts`.
`compiler/src/reachability/` — Reachability Solver sub-components (component-1..5, entry-points, gate-classifier, outer-fixpoint).
`compiler/src/native-parser-canary/` — M6.5 within-node divergence classifier (`within-node-classifier.ts`); 7-class taxonomy for parity testing.
`compiler/src/native-walker/` — Native-pipeline AST walkers; `engine-statechild-walker.ts` (M6.6.b.2) — walks native engine block child stream → live `EngineStateChildEntry[]`, replacing legacy `parseEngineStateChildren` text-rescanner in SYM PASS 11.
`compiler/src/validators/` — Post-CE validators: attribute-allowlist, attribute-interpolation, post-ce-invariant, lint-try-catch, lint-async-user-source, ast-walk.
`compiler/native-parser/` — Self-hosted scrml native parser (`.scrml` sources + compiled `.js` outputs); M5 SWAP target; M6 Wave 1 consumer migrations active.
`compiler/runtime/` — Hand-written ES-module runtime shims; copied into emitted output as `_scrml/*.js`.
`compiler/runtime/stdlib/` — Per-module runtime shims: 18 top-level + oauth/ providers + compiler/ 13-shim family.
`compiler/self-host/` — From-scratch scrml self-host compiler prototype (`.scrml` sources); separate post-v1.0 effort.
`compiler/self-host/cg-parts/` — CG sub-unit scrml sources.
`compiler/tests/unit/` — Unit tests (535 files at HEAD); `bun:test` framework.
`compiler/tests/integration/` — Integration tests (77 files).
`compiler/tests/conformance/` — Conformance tests (105 files): block-grammar suite + S32 fn-state-machine suite + tab.
`compiler/tests/browser/` — Browser runtime tests (12 files); happy-dom sandbox.
`compiler/tests/commands/` — CLI command tests (6 files).
`compiler/tests/lsp/` — LSP integration tests (10 files).
`compiler/tests/parser-conformance/` — Parser conformance canary tests (24 files in dir); plus top-level `parser-conformance-*.test.js` files including the new `parser-conformance-within-node.test.js` (M6.5.b.0).
`compiler/tests/self-host/` — Self-host compiler smoke tests (4 files).
`compiler/tests/helpers/` — Test helper utilities: `expr.ts`, `extract-user-fns.js`.
`compiler/tests/fixtures/` — Test fixtures: promote-match-canonical, promote-multi-file-app.
`samples/compilation-tests/` — ~318 compilation test sample directories (counted only, not enumerated). Two new samples at HEAD: `gauntlet-r10-zig-buildconfig.scrml`, `tailwind-prose-coverage.scrml`.
`samples/gauntlet-r*/` — Gauntlet round samples (r11, r13–r15, r18–r19); regression anchors.
`stdlib/` — 18 stdlib modules (auth, compiler, cron, crypto, data, format, fs, host, http, oauth, path, process, redis, regex, router, store, test, time).
`examples/` — 23 canonical scrml example apps (01-hello through 23-trucking-dispatch).
`benchmarks/` — Performance benchmarks: browser, fullstack-react, fullstack-scrml, llm-efficiency, per-route-roles, sql-batching, todomvc variants.
`lsp/` — Language server (vscode-languageserver); entry at `lsp/server.js`.
`editors/neovim/` — Neovim editor plugin.
`e2e/` — Playwright end-to-end test suite.
`scripts/` — Utility scripts + git-hooks (pre-commit runs unit+integration+conformance; pre-push runs full suite).
`docs/` — PA-SCRML-PRIMER, tutorial, known-gaps, lin, changelog, changes/, audits/, articles/, website/.
`docs/changes/` — Per-change SCOPING, BRIEF, and progress tracking documents (100+ subdirs).

## Native-Parser Layout

Front-end flow: lex → parse-stmt/parse-expr → parse-markup → bridge layer → nativeParseFile → live FileAST.

| Sub-system | Files |
|---|---|
| Lexing | lex.js + lex-mode.js + 7 lex-in-* dispatchers; token.js, token-cursor.js, cursor.js |
| Statements | parse-stmt.js (3335L), ast-stmt.js (20 StmtKind variants), parse-ctx.js, parse-mode.js, parse-seam.js, block-context.js, body-mode.js |
| Expressions | parse-expr.js, ast-expr.js (40 ExprKind variants) |
| Markup | parse-markup.js, tag-frame.js (M6.6.b.1.5: attr tokenizer extensions), display-text-literal.js, parse-css-body.js, parse-sql-body.js, parse-state-body.js, parse-error-body.js, delegation-frame.js |
| Bridge | translate-stmt.js (R4 COMPLETE — all 6 translateExpr sites wired); translate-expr.js (A2 complete S118); collect-hoisted.js (A3; M6.6.b.1.5 updates) |
| Assembler | parse-file.js — `nativeParseFile` (1037L); 12 per-BlockKind synth* builders |
| Support | span.js, bracket-stack.js, error-recovery.js, char-classify.js |
| Docs | README.md, M5-ast-bridge-scoping.md, M5-divergence-ledger.md, M5-SWAP-residual-decomposition.md, M6.6-CONTRACT-DERIVATION.md (540L cookbook — updated M6.6.b.1.5) |

## Key New Module — M6.6.b.2 Native Walker

`compiler/src/native-walker/engine-statechild-walker.ts` — Replaces `parseEngineStateChildren` text-rescanner in SYM PASS 11. Walks native `<engine for=...>` Markup block's child stream → live `EngineStateChildEntry[]`. Imports `parseRuleAttrValue` from the legacy `engine-statechild-parser.ts` (still the canonical rule= parser). The legacy `engine-statechild-parser.ts` survives as fallback for synthetic ASTs (test harnesses). M6.6.b.3 retired `isLegacyArrowRulesBody` + `scanForOnIdleEntries` from the legacy path.

## Key Canary Module — M6.5.b.0

`compiler/src/native-parser-canary/within-node-classifier.ts` — Extended M6.5.b.0 (Wave 2 unblocked). 7-class divergence taxonomy: KIND-NAME, FIELD-SHAPE, MISSING-FIELD, EXTRA-FIELD, COUNT-LENGTH, SPAN-COORD, NESTED-SHAPE plus PARSE-FAILURE pseudo-class. Consumes same corpus enumerator as dual-pipeline-canary. Allowlist: `compiler/tests/parser-conformance-within-node-allowlist.json`.

## Key Codegen Modules (Stage 8)

`codegen/rewrite.ts` — string-rewrite helpers; GITI-017: `rewriteNotKeyword` regex-literal + comment aware; `REGEX_PERMISSIVE_KEYWORDS` + `regexAllowedAfter`.
`codegen/runtime-chunks.ts` — runtime chunk detection; 6nz Bug P: `CHUNK_DEPENDENCIES = { scope: ['timers','animation'] }` + `applyChunkDependencies`.
`codegen/emit-client.ts` — wires `applyChunkDependencies` call (emit-client.ts:864).

## Key Symbol Table Modules (Stage 3.06)

`compiler/src/symbol-table.ts` — 9730+ LOC; Stage 3.06 SYM orchestrator; 21 PASSes.
- PASS 11 (`validateEngineStateChildrenAndRules`) — **M6.6.b.2 LANDED**: now calls `walkEngineStateChildren` from `compiler/src/native-walker/engine-statechild-walker.ts` when native block stream is available; legacy `parseEngineStateChildren` call retained as fallback for synthetic ASTs.
- M6.6.b.3 LANDED: `isLegacyArrowRulesBody` + `scanForOnIdleEntries` migrated to native walker.
- V-kill: PASS 3 fires E-STATE-UNDECLARED + E-WRITE-NOT-IN-LOGIC-CONTEXT.
- Per-file exemption: `compiler/src/unit-cc-exemption-list.json`.

## M6 Status at HEAD (73dd816c — S124 wrap)

| Milestone | Status |
|---|---|
| M6.1 meta-eval | LANDED |
| M6.2a markup-value bridge | LANDED |
| M6.2b component-expander | LANDED (S123) |
| M6.3 emit-match | LANDED |
| M6.4a P2-Form1 | LANDED |
| M6.5 no-op proof | PROVEN |
| M6.5.b.0 within-node canary | LANDED (Wave 2 unblocked, S124) |
| M6.6.b.1 attr tokenizer | LANDED |
| M6.6.b.1.5 attr tokenizer ext | LANDED (S124) |
| M6.6.b.2 engine-statechild-walker | LANDED (S124) |
| M6.6.b.3 legacy helper migration | LANDED (S124) |
| M6.7 flag flip | STOP — flag flip REVERTED; corpus migrations landed; canary closed |
| M6.6.b.4..b.6, M6.8 | PENDING |

## Compiler Spec / Pipeline References

`compiler/SPEC.md` — normative scrml language spec (58 sections; §34 catalog growing).
`compiler/SPEC-INDEX.md` — navigation map into SPEC.md.
`compiler/PIPELINE.md` — pipeline-stage reference.
`docs/PA-SCRML-PRIMER.md` — adopter-side primer.

## Ignored / Generated Paths

`node_modules/`, `compiler/node_modules/`, `compiler/dist/`, `compiler/native-parser/dist/`,
`compiler/self-host/dist/`, `stdlib/*/dist/`, `samples/dist/`, `benchmarks/*/dist/`,
`.git/`, `.claude/`, `archive/`, `handOffs/`

## Monorepo Note

`package.json` declares a Bun workspace `["compiler"]`. `compiler/package.json` is the sub-package manifest (acorn + astring). Single map set covers the whole repo.

## Tags
#scrmlts #map #structure #compiler #native-parser #pipeline #m5-swap #m6-wave1 #m6-6-b2 #m6-5-b0 #stdlib-shims #native-walker #s124

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [domain.map.md](./domain.map.md)
