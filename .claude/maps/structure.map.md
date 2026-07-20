# structure.map.md
# project: scrml
# updated: 2026-07-19T21:52:34-06:00  commit: df2ac831

## Entry Points
compiler/bin/scrml.js — CLI shim; resolves to compiler/src/cli.js.
compiler/src/cli.js — dispatches `scrml compile|dev|build|serve|migrate|promote|generate|init|introspect|semdiff` to compiler/src/commands/*.js.
compiler/src/api.js — `compileScrml()`, the single-file pipeline entrypoint (block-split -> AST-build -> type-check -> codegen); everything else calls into this. Unchanged this window.
lsp/server.js — LSP server entry (`bun run lsp` / `--stdio`); registers handlers.js + workspace.js.
docs/build.ts — static-site generator for the docs website (`bun run docs:build`).

## Directory Ownership

compiler/src/  — the compiler core: block-splitter, tokenizer, ast-builder, type-system, symbol-table, route-inference, name-resolver, html-elements, compute-program-config, and ~20 top-level analysis modules (67 files at this level; see dependencies.map.md for the module graph). 175 files total (133 .ts + 40 .js + 2 other), up from 174 at the 99ae45ca watermark — net +1 is `codegen/async-combinators.ts` (NEW, S269 colorless-async Phase-2 combinator transform). This window's fixes (GITI-038/039, i87 §13.2, §20.5 session pass-2, #81 writer-ownership) all landed as EDITS to existing files — see dependencies.map.md for the per-file detail.
compiler/src/codegen/  — code emission: one emit-*.ts per output concern (html, css, client, server, each, match, engine, ssr, channel, worker, tool...) plus shared collect/rewrite/reactive-deps/errors infra. 77 files (73 .ts + 3 .js + 1 .md), +1 this window (NEW `async-combinators.ts` — async collection-combinator classification + runtime-helper synthesis for colorless-async, see dependencies.map.md). **Count-methodology note:** the 99ae45ca-watermark map cited "76 files (72 .ts + 2 .js + 2 other)"; a fresh `git ls-files` count at THIS watermark gives 73 .ts (72+1 new) but 3 .js (not 2) and 1 "other" (`README.md`, not 2) — the .js/"other" split was already off-by-one at the prior watermark (pre-existing drift, not introduced this window; the total-77-vs-76 delta of +1 IS correctly the new file). `emit-html.ts` gained `analyzeWriterConflict` (#81); `emit-server.ts`/`emit-expr.ts` gained the §20.5 session-cookie + E-SESSION-* machinery; `emit-logic.ts`/`emit-library.ts`/`emit-library-shared.ts`/`scheduling.ts` gained the colorless-async Q1/Q2 classification + i87 nested-position auto-await.
compiler/src/commands/  — the 10 CLI subcommands (build, compile, dev, generate, init, introspect, migrate, promote, semdiff, serve). No new subcommand this window.
compiler/src/types/  — shared TS type declarations: ast.ts (the FileAST/ASTNode catalog — gained `ReturnStmtNode.fnExprNode`, GITI-038, see schema.map.md), auth-graph.ts (unchanged), reachability.ts.
compiler/src/validators/  — standalone AST-walk validators (attribute allowlist/interpolation, async-user-source lint, try-catch lint, post-CE invariant checks) — 6 files.
compiler/src/native-parser-canary/  — the within-node-classifier that diffs native-parser output against the live pipeline for parity tracking.
compiler/src/native-walker/  — 3 walkers (attrvalue-exprnode, engine-statechild, exprtext-backfill) used by the native-parser canary.
compiler/src/reachability/  — the reachability-solver's component/gate-classifier/fixpoint machinery (8 files).
compiler/native-parser/  — the from-scratch native lexer/parser (Road-B rewrite, Charter B per README.md): each stage ships as a paired `.js` (compiled/live) + `.scrml` (canonical source) file — lex, parse-expr, parse-stmt, parse-markup, parse-file, translate-expr/stmt, error-recovery, etc. (37 paired .js/.scrml files = 74, + 5 planning/contract .md docs = 79 files total, unchanged this window). Feeds lsp/handlers.js semantic tokens. **NOT re-verified for this window's GITI-038/039 parity** — a returned-function-expression / markup-text-verbatim fix in the LIVE `ast-builder.js` has no confirmed counterpart in the native parser; flagged in non-compliance.report.md as a parity-drift item to check, not confirmed drift.
compiler/self-host/  — Road-A self-host compiler implementation #1, hand-authored in scrml (ast/bs/bpp/cg/dg/meta-checker/module-resolver/pa.scrml + cg-parts/, 17 files).
compiler/self-host-v2/  — Road-B self-host compiler implementation #2 (pure-functional lexer rewrite, lex.scrml + progress.md; in progress).
compiler/runtime/stdlib/  — the JS host-shim side of each of the 21 stdlib modules (auth, compiler, cron, crypto, data, format, fs, host, http, math, mcp, oauth/ [5 provider files], path, process, random, redis, regex, router, store, test, time) — the runtime half of the scrml:* import namespace.
compiler/runtime/idempotency.js — idempotency-key store used by generated server code.
compiler/tests/  — `*.test.js` files: unit/ (821, +14 vs the last CONFIRMED-from-source count of 807 at the 99ae45ca map watermark — 8 net-new this window: `colorless-async-combinators`, `colorless-async-seam-a`, `giti-039-markup-text-verbatim`, `i87-nested-server-call-autoawait`, `session-context-gate-b2b3`, `session-establishment`, `session-secure-b4b5`, `value-attr-binding-i81`; the remaining +6 reconciles the PRE-EXISTING 807-vs-813 undercount the S265-pass non-compliance report already flagged), integration/ (173, +2: `session-establishment-roundtrip`, `session-secure-b4b5-roundtrip`), conformance/ (120, +2: `conf-ATTR-WRITER-CONFLICT`, `conf-CTRL-i87-nested-server-autoawait`), browser/ (68, +1: `browser-i81-component-root-crash`), commands/ (8), lsp/ (11), self-host/ (4), e2e-render-map/ (2), plus 14 parser-conformance*.test.js at the top level (native-parser vs live-pipeline parity) and fixtures/ (8 files) + helpers/ (3 files). See test.map.md.
compiler/scripts/  — build-self-host.js (rebuilds self-host dist) + css-conflict-dryrun.ts (the §65.11 corpus dry-run analyzer for the E-STYLE-CONFLICT checker).
compiler/SPEC.md  — the ~35k-line normative language specification (§1-§65+); §34 Error Codes gained 4 new catalog rows this window (E-ATTR-WRITER-CONFLICT, E-SESSION-CONTEXT, E-SESSION-VALUE, E-SESSION-RESERVED-KEY — see error.map.md), §20.5/§20.5.1 session-establishment is now normative + LIVE (was reserved-but-unbuilt), §5.5.3/§5.5.4 writer-ownership Axiom ① promoted out of "(Planned)". Authoritative per pa.md Rule 4.
compiler/SPEC-INDEX.md — section-number lookup index into SPEC.md.
compiler/PIPELINE.md — the compiler pipeline stage-by-stage reference.
stdlib/  — the canonical `.scrml` SOURCE of the 21 stdlib modules (auth/, cron/, crypto/, data/, format/, fs/, host/, http/, math/, mcp/, oauth/, path/, process/, random/, redis/, regex/, router/, store/, test/, time/, compiler/) — compiler/runtime/stdlib/*.js is generated/mirrored from these.
lsp/  — LSP server: server.js (capability registration), handlers.js (hover/diagnostics/semantic-tokens provider — hybrid block-splitter + native lex()), workspace.js, l4.js.
editors/vscode/  — VS Code extension: syntaxes/scrml.tmLanguage.json (TextMate grammar) + package.json + src/extension.ts + test/ (tokenize.js + regression-scan.js harness), 7 files.
editors/neovim/  — syntax/scrml.vim (region-aware Vim syntax) + scrml.lua + queries/ + README, 5 files.
conformance/  — the top-level D3 conformance corpus (adapters/ [impl1-ts.ts], cases/ [51 case dirs, unchanged this window — only 2 EXISTING case files modified: `auth/auth-async-stdlib-sync-callback-neg/{case.scrml,expected.json}`, reflecting the colorless-async classifier change], driver.ts, conformance-corpus.test.js) — a SEPARATE surface from compiler/tests/conformance/, bridged onto the pre-commit gate via corpus-bridge.test.js.
samples/  — hand-authored dogfood .scrml apps (admin-panel, blog-cms, contact-directory, gauntlet-r11/r13/r14/r15/r18/r19, etc.) + samples/compilation-tests/ (fixture dirs, compiled pre-test by scripts/compile-test-samples.sh; count only, not individually mapped per scope rules) + checked-in .db files.
examples/  — 34 numbered example .scrml files (01-hello.scrml .. 34-value-native-set.scrml) plus 2 multi-file example dirs (22-multifile/, 23-trucking-dispatch/) and checked-in .db files.
benchmarks/  — perf/LLM-efficiency benchmark harnesses (bench-scrml.js, browser/, fullstack-react/ vs fullstack-scrml/ comparison, per-route-roles/, todomvc/ + 4 framework-comparison dirs [out of scope per scope rules], perf-baseline.json).
docs/  — website + articles + docs/changes/ (per-dispatch BRIEF.md/SCOPING.md/progress.md archive dirs, one dir per change-id — historical dispatch record, excluded from content-mapping; gained 6 new dirs this window: `colorless-async-seam-a-2026-07-15/`, `giti-038-returned-closure-async/`, `giti-039-markup-text-expr-lexed/`, `i29e-session-security-fixes-2026-07-18/`, `i29e-session-pass2-b4b5-2026-07-18/`, `i81-writer-ownership/`, `i87-nested-server-call-autoawait-2026-07-18/`, `colorless-async-combinators-2026-07-19/`) + docs/audits/ (point-in-time audit reports, dated) + docs/heads-up/ (open-question resolution logs) + docs/changelog.md (the full session-history log — the pointer target for anything this map set omits) + docs/known-gaps.md + docs/cross-os-invariants.md + PA-SCRML-PRIMER.md.
e2e/  — Playwright end-to-end tests (fixtures/, tests/, 2 playwright configs).
dashboard/  — a single scrml dogfood app (app.scrml).
handOffs/  — cross-session/cross-agent hand-off bookkeeping (queues, rosters, delta-log, digest) — historical, excluded from content-mapping.
scratch/  — ad hoc one-off investigation scripts (.mjs), not part of the shipped surface.
scripts/  — repo-level maintenance scripts (assemble-spec.sh, benchmark tooling, dock health checks, flograph fixtures, state.ts, threads.ts).
spa-lists/  — sub-PA task-list tracking docs (ssN-*.md + progress files) — PA bookkeeping, not compiler content, excluded from content-mapping.
.github/workflows/  — CI: ci.yml (gate/tracking/windows jobs), advisory-review.yml (AI /code-review, advisory) — see build.map.md / infra.map.md. Unchanged this window.
.pa-base/  — the scrml PA boot manifest/profile.

## Ignored / Generated Paths
node_modules, dist, build, target, .git, .jj, .claude, vendor, __pycache__ — plus samples/compilation-tests/*/dist (gitignored, populated by `bun run pretest`).

## Monorepo Note
`workspaces: ["compiler"]` (root package.json) — compiler/ is the sole npm workspace member (own package.json, v0.2.0, acorn+astring deps). stdlib/, editors/, lsp/ are NOT npm workspaces but are integral first-party surfaces of the same repo, each versioned/tested independently of the workspace mechanism.

## Tags
#scrml #map #structure #entry-points #directory-layout #native-parser #self-host #stdlib #lsp #css65 #outlet #server-shape #semdiff #ci #content-hash #link-boost #theme-reset #giti-038 #giti-039 #colorless-async #writer-ownership #session-establishment

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [dependencies.map.md](./dependencies.map.md)
- [domain.map.md](./domain.map.md)
- [test.map.md](./test.map.md)
