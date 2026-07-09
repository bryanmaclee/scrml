# structure.map.md
# project: scrml
# updated: 2026-07-09  commit: fbb4d9fd

## Entry Points
compiler/bin/scrml.js — CLI shim; resolves to compiler/src/cli.js.
compiler/src/cli.js — dispatches `scrml compile|dev|build|serve|migrate|promote|generate|init|introspect` to compiler/src/commands/*.js.
compiler/src/api.js — `compileScrml()`, the single-file pipeline entrypoint (block-split -> AST-build -> type-check -> codegen); everything else calls into this.
lsp/server.js — LSP server entry (`bun run lsp` / `--stdio`); registers handlers.js + workspace.js.
docs/build.ts — static-site generator for the docs website (`bun run docs:build`).

## Directory Ownership

compiler/src/  — the compiler core: block-splitter, tokenizer, ast-builder, type-system, symbol-table, route-inference, and ~20 top-level analysis modules (64 files at this level; see dependencies.map.md for the module graph).
compiler/src/codegen/  — code emission: one emit-*.ts per output concern (html, css, client, server, each, match, engine, ssr, channel, worker...) plus shared collect/rewrite/reactive-deps/errors infra (75 files).
compiler/src/commands/  — the 9 CLI subcommands (build, compile, dev, generate, init, introspect, migrate, promote, serve).
compiler/src/types/  — shared TS type declarations: ast.ts (the FileAST/ASTNode catalog), auth-graph.ts, reachability.ts.
compiler/src/validators/  — standalone AST-walk validators (attribute allowlist/interpolation, async-user-source lint, try-catch lint, post-CE invariant checks).
compiler/src/native-parser-canary/  — the within-node-classifier that diffs native-parser output against the live pipeline for parity tracking.
compiler/src/native-walker/  — 3 walkers (attrvalue-exprnode, engine-statechild, exprtext-backfill) used by the native-parser canary.
compiler/src/reachability/  — the reachability-solver's component/gate-classifier/fixpoint machinery (8 files).
compiler/native-parser/  — the from-scratch native lexer/parser (Road-B rewrite): each stage ships as a paired `.js` (compiled/live) + `.scrml` (canonical source) file — lex, parse-expr, parse-stmt, parse-markup, parse-file, translate-expr/stmt, error-recovery, etc. (79 files). Feeds lsp/handlers.js semantic tokens.
compiler/self-host/  — Road-A self-host compiler implementation #1, hand-authored in scrml (ast/bs/bpp/cg/dg/meta-checker/module-resolver/pa.scrml + cg-parts/).
compiler/self-host-v2/  — Road-B self-host compiler implementation #2 (pure-functional lexer rewrite, lex.scrml; in progress per progress.md).
compiler/runtime/stdlib/  — the JS host-shim side of each of the 21 stdlib modules (auth, compiler, cron, crypto, data, format, fs, host, http, math, mcp, oauth/, path, process, random, redis, regex, router, store, test, time) — the runtime half of the scrml:* import namespace.
compiler/runtime/idempotency.js — idempotency-key store used by generated server code.
compiler/tests/  — 1167 `*.test.js` files: unit/ (803), integration/ (165), conformance/ (113), browser/ (63, happy-dom), commands/ (8), lsp/ (11), self-host/ (4), e2e-render-map/ (2), plus parser-conformance*.test.js at the top level (native-parser vs live-pipeline parity) and fixtures/ + helpers/.
compiler/scripts/  — build-self-host.js (rebuilds self-host dist) + css-conflict-dryrun.ts (the §65.11 corpus dry-run analyzer for the E-STYLE-CONFLICT checker).
compiler/SPEC.md  — the 35,338-line normative language specification (§1-§65+); authoritative per pa.md Rule 4.
compiler/SPEC-INDEX.md — section-number lookup index into SPEC.md.
compiler/PIPELINE.md — the compiler pipeline stage-by-stage reference (2913 lines).
stdlib/  — the canonical `.scrml` SOURCE of the 21 stdlib modules (auth/, cron/, crypto/, data/, format/, fs/, host/, http/, math/, mcp/, oauth/, path/, process/, random/, redis/, regex/, router/, store/, test/, time/, compiler/) — compiler/runtime/stdlib/*.js is generated/mirrored from these.
lsp/  — LSP server: server.js (capability registration), handlers.js (hover/diagnostics/semantic-tokens provider — hybrid block-splitter + native lex()), workspace.js, l4.js.
editors/vscode/  — VS Code extension: syntaxes/scrml.tmLanguage.json (TextMate grammar) + package.json + test/ (tokenize.js + regression-scan.js harness).
editors/neovim/  — syntax/scrml.vim (region-aware Vim syntax) + README.
conformance/  — the top-level D3 conformance corpus (adapters/, cases/, driver.ts, conformance-corpus.test.js) — a SEPARATE surface from compiler/tests/conformance/, bridged onto the pre-commit gate via corpus-bridge.test.js.
samples/  — hand-authored dogfood .scrml apps (admin-panel, blog-cms, contact-directory, etc.) + samples/compilation-tests/ (13 fixture dirs compiled pre-test by scripts/compile-test-samples.sh; count only, not individually mapped per scope rules) + checked-in .db files.
examples/  — 32 numbered example .scrml files (01-hello.scrml .. 32-external-api.scrml) plus 2 multi-file example dirs (22-multifile/, 23-trucking-dispatch/).
benchmarks/  — perf/LLM-efficiency benchmark harnesses (bench-scrml.js, browser/, fullstack-react/ vs fullstack-scrml/ comparison, per-route-roles/, perf-baseline.json).
docs/  — website + articles + docs/changes/ (per-dispatch BRIEF.md archive, one dir per change-id) + docs/audits/ (point-in-time audit reports) + docs/changelog.md (the full session-history log — the pointer target for anything this map set omits) + docs/known-gaps.md + PA-SCRML-PRIMER.md.
e2e/  — Playwright end-to-end tests (fixtures/, tests/, 2 playwright configs).
dashboard/  — a single scrml dogfood app (app.scrml).
handOffs/  — cross-session/cross-agent hand-off bookkeeping (queues, rosters, delta-log, digest) — historical, excluded from content-mapping per scope rules.
scratch/  — ad hoc one-off investigation scripts (.mjs), not part of the shipped surface.
scripts/  — repo-level maintenance scripts (assemble-spec.sh, benchmark tooling, dock health checks, flograph fixtures).
spa-lists/  — sub-PA task-list tracking docs (ssN-*.md + progress files) — PA bookkeeping, not compiler content.
.pa-base/  — the scrml PA boot manifest/profile.

## Ignored / Generated Paths
node_modules, dist, build, target, .git, .jj, .claude, vendor, __pycache__ — plus samples/compilation-tests/*/dist (gitignored, populated by `bun run pretest`).

## Tags
#scrml #map #structure #entry-points #directory-layout #native-parser #self-host #stdlib #lsp #css-native #css65

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [dependencies.map.md](./dependencies.map.md)
- [domain.map.md](./domain.map.md)
