# structure.map.md
# project: scrmlts
# updated: 2026-05-18T00:00:00-06:00  commit: dae8ff1

## Entry Points

compiler/src/cli.js            — CLI entry; routes compile/dev/build/serve/migrate/promote/init/generate subcommands
compiler/src/api.js            — programmatic API; orchestrates full BS→TAB→NR→MOD→CE→UVB→PA→RI→TS→META→DG→BP→RS→CG pipeline (includes Stage 3.007 LINT-TRY-CATCH + Stage 3.105 STDLIB-EXPORT-SEED + Stage 7.55 AuthGraph + Stage 7.6 Reachability Solver)
compiler/bin/scrml.js          — installed binary (points to cli.js via package.json `bin`)
lsp/server.js                  — Language Server Protocol server; started via `scrml lsp --stdio`
compiler/src/codegen/index.ts  — Stage 8 CG entry point; runCG() exported; emitPerRouteChunks() wired; MPA shell-composition `$&` regex-injection fix (S100 `01eeda9`)

## Directory Ownership

compiler/                      — workspace root; compiler/package.json declares acorn + astring deps
compiler/src/                  — all pipeline stage implementations: tokenizer, block-splitter, ast-builder, type-system, etc.
compiler/src/codegen/          — Stage 8 (CG) emitters; 35+ emit-*.ts files + IR, BindingRegistry, CompileContext, errors; route-splitter.ts, atom-emitter.ts, fnv1a-hash.ts
compiler/src/codegen/compat/   — integration shim: parser-workarounds.js (setBPPOverrides hook for self-hosted BPP modules)
compiler/src/commands/         — CLI subcommand implementations: compile.js, dev.js, build.js, serve.js, migrate.js, init.js, promote.js, generate.js
compiler/src/types/            — AST type definitions (ast.ts, ~1,858 LOC); reachability.ts (A-2.1); auth-graph.ts (A-3.1, ~354 LOC)
compiler/src/validators/       — UVB sub-passes: post-ce-invariant.ts, attribute-interpolation.ts, attribute-allowlist.ts, ast-walk.ts, lint-try-catch.ts, lint-async-user-source.ts
compiler/src/reachability/     — Components 1-5 + entry-points.ts + gate-classifier.ts + outer-fixpoint.ts (A-2.7)
compiler/native-parser/        — NEW S99-S103: bottom-up scrml-native JS lexer (M1.1..M1.4 complete). 17 .scrml/.js shadow pairs + README. NOT self-host; NOT Acorn port. Replaces Acorn pre-v1.0.
compiler/runtime/              — server-side runtime JS shims; copied to dist/_scrml/ at compile time
compiler/runtime/stdlib/       — hand-written ES modules for stdlib (auth.js, crypto.js, store.js, host.js)
compiler/tests/                — 658 test files (bun test, S101 pre-commit subset); organized by category
compiler/tests/unit/           — unit tests (~390 files) covering individual pipeline passes
compiler/tests/conformance/    — conformance tests (~102 files); NEW: conf-raw-content-pre-code.test.js (S101 §4.17)
compiler/tests/integration/    — integration tests (~52 files)
compiler/tests/parser-conformance/ — parser conformance infrastructure: bench corpus, parsers.js, tier-diff.js
compiler/tests/browser/        — browser-environment tests (11 files, happy-dom)
compiler/tests/lsp/            — LSP server protocol tests (10 files)
compiler/tests/self-host/      — compiler self-host tests (4 files)
compiler/tests/commands/       — CLI command tests (6 files)
compiler/tests/fixtures/       — shared test fixtures
compiler/tests/helpers/        — test utilities (expr.ts, extract-user-fns.js)
compiler/self-host/            — self-hosted compiler; dist/ artifacts gitignored (built locally)
compiler/self-host/cg-parts/   — code-generation partials for self-host compiler
lsp/                           — LSP server (hover, diagnostics, completion, workspace management)
stdlib/                        — scrml standard library source .scrml files (auth, crypto, data, format, fs, http, etc.)
stdlib/auth/templates/         — adopter-owned login template (login.scrml, emitted by `scrml generate auth`)
samples/                       — sample .scrml programs; samples/compilation-tests/ has ~311 .scrml fixtures
scripts/                       — build, test, and maintenance scripts (shell + .ts); scripts/git-hooks/ pre-commit hook
docs/                          — project documentation: articles, audits, changelog, changes dirs, curation, pinned-discussions
docs/changes/                  — active dispatch directories; 50+ entries total
docs/audits/                   — audit snapshots; articles-currency-table, wave-3-7-corpus-ouroboros, etc.
editors/                       — editor integrations (VSCode extension, neovim)
examples/                      — standalone scrml usage examples
benchmarks/                    — performance benchmarks; benchmarks/llm-efficiency/ NEW (S95+)
e2e/                           — Playwright e2e test suite (3-browser)
handOffs/                      — historical hand-offs (read-only; current hand-off at hand-off.md)

## Notable New Additions (S99-S103, since S92 baseline)

**compiler/native-parser/ — bottom-up scrml-native JS lexer (M1.1 S99, M1.2 S100, M1.3 S102, M1.4 S103):**
compiler/native-parser/span.scrml + .js        — `{start, end, line, col}` struct; pure data
compiler/native-parser/token.scrml + .js       — TokenKind nested-by-category enum + TemplateInterpStart/End (M1.2); makeToken/makeIdentOrKeyword/makeEof; JS_KEYWORDS table
compiler/native-parser/cursor.scrml + .js      — V5-strict character cursor; peek*/advance/snapshot/restore
compiler/native-parser/lex-mode.scrml + .js    — `<engine for=LexMode initial=.InCode>` — all 7 state-children + rule= contract; InTemplateBody is COMPOSITE per §51.0.Q.1 (M1.2)
compiler/native-parser/bracket-stack.scrml + .js — `<engine>` + LIVE frame stack mirror; `.OpenAt(depth, opener, span)` variant
compiler/native-parser/error-recovery.scrml + .js — `<engine for=ErrorRecovery initial=.ParsingNormally>` + 3 state-children + full rule= matrix
compiler/native-parser/lex-in-code.scrml + .js — InCode-state dispatcher; all punctuation, operators, scrml extensions, brackets; M1.2/M1.3/M1.4 delegation to sub-dispatchers
compiler/native-parser/lex-in-single-string.scrml + .js — M1.2: escape-aware single-quoted string scanner (JS spec §12.8.4)
compiler/native-parser/lex-in-double-string.scrml + .js — M1.2: mirror of single-quoted scanner
compiler/native-parser/lex-in-template.scrml + .js — M1.2: §51.0.Q.1 NESTED-ENGINE pattern; TemplateChunk + TemplateInterpStart/End; nested templates supported
compiler/native-parser/lex-in-line-comment.scrml + .js — M1.3: `//` body scanner; consumes to LineTerminator; emits no token
compiler/native-parser/lex-in-block-comment.scrml + .js — M1.3: `/* ... */` body scanner; EOF-tolerant; emits no token
compiler/native-parser/lex-in-regex.scrml + .js — M1.4: `/pattern/flags` scanner per ECMA-262 §12.8.5; char-class + escape aware; emits RegexLit token
compiler/native-parser/lex.scrml + .js         — top-level `lex(source): Token[]`; dispatches via 7 active LexMode branches; M1 LADDER COMPLETE
compiler/native-parser/README.md               — authoritative M1.x status table, file listing, anomaly log, swap-in roadmap

**Test infrastructure additions (S93-S103):**
compiler/tests/parser-conformance-lexer.test.js    — M1.1-M1.4 bench-corpus + inline micro-corpus; 97 pass / 0 fail at M1.4
compiler/tests/parser-conformance.test.js          — top-level parser conformance driver (Acorn vs native)
compiler/tests/parser-conformance/                 — bench corpus, parsers.js adapter, tier-diff.js normalizer
compiler/tests/conformance/conf-raw-content-pre-code.test.js — S101 §4.17 raw-content element conformance test

**Compiler source changes (S93-S103):**
compiler/src/block-splitter.js                 — RAW_CONTENT_ELEMENTS Set (`pre`, `code`) + raw-content branch (S101 §4.17)
compiler/src/codegen/index.ts                  — MPA shell-composition `$&` regex-injection fix (S100 `01eeda9`)
compiler/src/component-expander.ts:2169        — function-form replace conversion ($& injection fix, S101 `d77a60d`)
compiler/src/tailwind-classes.js               — +415 LOC Tailwind §26.6 typography plugin (S100 `2663870`); +`buildProseRule` + `buildProseColorRule` + `buildProseSizeRule` helpers
compiler/src/commands/generate.js:242          — function-form replace conversion ($& injection fix, S101)

## Ignored / Generated Paths
node_modules/, compiler/node_modules/, dist/, compiler/dist/self-host/, compiler/self-host/dist/,
build/, .git/, .jj/, samples/compilation-tests/dist/, handOffs/, stdlib/*/dist/

## Tags
#scrmlts #map #structure #compiler #cli #pipeline #s101 #v0.3.1 #native-parser #m1-4 #m1-ladder-complete #raw-content #typography #approach-a #route-splitter #fnv1a-hash #generate-auth

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [dependencies.map.md](./dependencies.map.md)
- [build.map.md](./build.map.md)
