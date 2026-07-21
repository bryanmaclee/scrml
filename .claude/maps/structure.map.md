# structure.map.md
# project: scrml
# updated: 2026-07-21T12:51:06Z  commit: c48e59a2

## Entry Points
compiler/bin/scrml.js — CLI shim; resolves to compiler/src/cli.js.
compiler/src/cli.js — dispatches `scrml compile|dev|build|serve|migrate|promote|generate|init|introspect|semdiff` to compiler/src/commands/*.js.
compiler/src/api.js — `compileScrml()`, the single-file pipeline entrypoint (block-split -> AST-build -> type-check -> codegen); everything else calls into this.
lsp/server.js — LSP server entry (`bun run lsp` / `--stdio`); registers handlers.js + workspace.js.
docs/build.ts — static-site generator for the docs website (`bun run docs:build`).

## Directory Ownership

compiler/src/  — the compiler core: block-splitter, tokenizer, ast-builder, type-system, symbol-table, route-inference, name-resolver, html-elements, compute-program-config, and ~20 top-level analysis modules (68 files at this level; see dependencies.map.md for the module graph). **178 files total (135 .ts + 41 .js + 1 .md + 1 .json)**, directly `git ls-files`-counted this pass, up from 175 at the df2ac831 watermark. Net **+3**, all NEW files (zero deletions across the window): `codegen/sql-lex.ts` (#120, the shared LIVE-vs-INERT `${}` SQL classifier), `codegen/tenant-egress.ts` (#117/#118, the §14.8.10 tenant-row floor), `lint-w-each-table-foster.js` (#115, the Stage-6.4f table-foster info-lint). The S276 navigate Wave-1c PR-1 landing (#124) added NO new source file — it landed entirely as EDITS to `codegen/emit-html.ts`, `codegen/index.ts` and `symbol-table.ts`.
compiler/src/codegen/  — code emission: one emit-*.ts per output concern (html, css, client, server, each, match, engine, ssr, channel, worker, tool...) plus shared collect/rewrite/reactive-deps/errors infra. **79 files (75 .ts + 3 .js + 1 .md)**, +2 vs the df2ac831 watermark (`sql-lex.ts`, `tenant-egress.ts`). Notable per-file surface: `emit-html.ts` owns `analyzeWriterConflict` (#81) AND the §20.8.1.1 one-landmark decision (`treeHasAuthorMain` :1005, the `tag === "outlet"` emit branch ~:1650-1730 picking `main` vs `div` at :1720, #124); `codegen/index.ts` owns the §40.8.2 multi-file shell composition (marker-driven slot detection, the open-tag/attribute tokenizer, `findMatchingCloseIdx` :724 depth scanner, per-page landmark demotion :2171 + re-promotion :2196, #124); `emit-server.ts`/`emit-expr.ts` own the §20.5 session-cookie + E-SESSION-* machinery plus the §52.15.5 SSR auto-omission and the §14.8.10 tenant hard-fails; `emit-logic.ts`/`emit-library*.ts`/`scheduling.ts` own the colorless-async Q1/Q2 classification + i87 nested-position auto-await.
compiler/src/commands/  — the 10 CLI subcommands (build, compile, dev, generate, init, introspect, migrate, promote, semdiff, serve). No new subcommand.
compiler/src/types/  — shared TS type declarations: ast.ts (the FileAST/ASTNode catalog — carries `ReturnStmtNode.fnExprNode`, GITI-038, see schema.map.md), auth-graph.ts, reachability.ts. **No `<outlet>` node type exists here** — `<outlet>` is a plain `kind: "markup"` node with `tag: "outlet"`; see domain.map.md.
compiler/src/validators/  — standalone AST-walk validators (attribute allowlist/interpolation, async-user-source lint, try-catch lint, post-CE invariant checks) — 6 files.
compiler/src/native-parser-canary/  — the within-node-classifier that diffs native-parser output against the live pipeline for parity tracking.
compiler/src/native-walker/  — 3 walkers (attrvalue-exprnode, engine-statechild, exprtext-backfill) used by the native-parser canary.
compiler/src/reachability/  — the reachability-solver's component/gate-classifier/fixpoint machinery (8 files).
compiler/native-parser/  — the from-scratch native lexer/parser (Road-B rewrite, Charter B per README.md): each stage ships as a paired `.js` (compiled/live) + `.scrml` (canonical source) file — lex, parse-expr, parse-stmt, parse-markup, parse-file, translate-expr/stmt, error-recovery, etc. (37 paired .js/.scrml files = 74, + 5 planning/contract .md docs = 79 files total, **unchanged across the whole df2ac831 -> c48e59a2 window**). Feeds lsp/handlers.js semantic tokens. **NOT re-verified for GITI-038/039 or the #124 outlet/landmark parity** — flagged in non-compliance.report.md as a parity-drift item to check, not confirmed drift.
compiler/self-host/  — Road-A self-host compiler implementation #1, hand-authored in scrml (ast/bs/bpp/cg/dg/meta-checker/module-resolver/pa.scrml + cg-parts/, 17 files).
compiler/self-host-v2/  — Road-B self-host compiler implementation #2 (pure-functional lexer rewrite, lex.scrml + progress.md; in progress).
compiler/runtime/stdlib/  — the JS host-shim side of each of the 21 stdlib modules (auth, compiler, cron, crypto, data, format, fs, host, http, math, mcp, oauth/ [5 provider files], path, process, random, redis, regex, router, store, test, time) — the runtime half of the scrml:* import namespace.
compiler/runtime/idempotency.js — idempotency-key store used by generated server code.
compiler/src/runtime-template.js — the client runtime shipped into generated apps: soft-nav engine + link-boost delegated click listener + the `[data-scrml-outlet]` swap target (`querySelector("[data-scrml-outlet]")` at :2238/:2436, `closest(...)` at :3709). The runtime addresses the route slot by MARKER, never by tag — the contract codegen's §20.8.1.1 emission upholds.
compiler/tests/  — **1227 `*.test.js` files** directly counted this pass (+6 vs the 1221 at df2ac831): unit/ **823** (+2: `each-table-foster-warn-s272`, `tenant-egress`), integration/ **175** (+2: `navigate-wave1c-outlet-composition` [#124], `tenant-row-isolation`), conformance/ **122** (+2: `conf-SSR-AUTH-SCOPED`, `conf-TENANT-FLOOR`), browser/ **68** (unchanged), commands/ 8, lsp/ 11, self-host/ 4, e2e-render-map/ 2, plus **14** parser-conformance*.test.js at the top level (native-parser vs live-pipeline parity) and fixtures/ (8 files) + helpers/ (3 files). See test.map.md.
compiler/scripts/  — build-self-host.js (rebuilds self-host dist) + css-conflict-dryrun.ts (the §65.11 corpus dry-run analyzer for the E-STYLE-CONFLICT checker).
compiler/SPEC.md  — the ~35k-line normative language specification (§1-§65+). Gained across this window: §14.8.10 (tenant-row isolation floor), §52.15.5 (SSR auto-make-safe), **§20.8.1.1 (the one-landmark invariant)** and **§40.8.2 (multi-file shell composition — previously UNSPECIFIED, this section is its normative anchor)**, plus §34 catalog rows for E-TENANT-*/I-TENANT-*, I-SSR-AUTH-SCOPED-CLIENT-HYDRATED, E-ERROR-010 and E-OUTLET-AND-MAIN. Authoritative per pa.md Rule 4.
compiler/SPEC-INDEX.md — section-number lookup index into SPEC.md.
compiler/PIPELINE.md — the compiler pipeline stage-by-stage reference.
stdlib/  — the canonical `.scrml` SOURCE of the 21 stdlib modules (auth/, cron/, crypto/, data/, format/, fs/, host/, http/, math/, mcp/, oauth/, path/, process/, random/, redis/, regex/, router/, store/, test/, time/, compiler/) — compiler/runtime/stdlib/*.js is generated/mirrored from these.
lsp/  — LSP server: server.js (capability registration), handlers.js (hover/diagnostics/semantic-tokens provider — hybrid block-splitter + native lex()), workspace.js, l4.js.
editors/vscode/  — VS Code extension: syntaxes/scrml.tmLanguage.json (TextMate grammar) + package.json + src/extension.ts + test/ (tokenize.js + regression-scan.js harness), 7 files.
editors/neovim/  — syntax/scrml.vim (region-aware Vim syntax) + scrml.lua + queries/ + README, 5 files.
conformance/  — the top-level D3 conformance corpus (adapters/ [impl1-ts.ts], cases/ [case dirs], driver.ts, conformance-corpus.test.js) — a SEPARATE surface from compiler/tests/conformance/, bridged onto the pre-commit gate via corpus-bridge.test.js. The E-SQL-004 corpus migration (#122) modified existing case files here.
samples/  — hand-authored dogfood .scrml apps (admin-panel, blog-cms, contact-directory, gauntlet-r11/r13/r14/r15/r18/r19, etc.) + samples/compilation-tests/ (fixture dirs, compiled pre-test by scripts/compile-test-samples.sh; count only, not individually mapped per scope rules) + checked-in .db files.
examples/  — 34 numbered example .scrml files (01-hello.scrml .. 34-value-native-set.scrml) plus 2 multi-file example dirs (22-multifile/, 23-trucking-dispatch/) and checked-in .db files. `examples/23-trucking-dispatch` + `docs/website` are the two MPA corpora verified byte-identical to base across the #124 composition change — the regression anchors for any future slot/landmark edit.
benchmarks/  — perf/LLM-efficiency benchmark harnesses (bench-scrml.js, browser/, fullstack-react/ vs fullstack-scrml/ comparison, per-route-roles/, todomvc/ + 4 framework-comparison dirs [out of scope per scope rules], perf-baseline.json).
docs/  — website + articles + docs/changes/ (per-dispatch BRIEF.md/SCOPING.md/progress.md archive dirs, one dir per change-id — historical dispatch record, excluded from content-mapping; gained 5 new dirs across this window: `each-table-foster/`, `freeze-spec-reconcile-s274/`, `navigate-wave1c-piece1-landmark/`, `ssr-auth-scoped-prerender-leak-redo/`, `tenant-floor/`) + docs/audits/ + docs/heads-up/ + docs/changelog.md (the full session-history log — the pointer target for anything this map set omits) + docs/known-gaps.md + docs/cross-os-invariants.md + PA-SCRML-PRIMER.md.
e2e/  — Playwright end-to-end tests (fixtures/, tests/, 2 playwright configs).
dashboard/  — a single scrml dogfood app (app.scrml).
handOffs/  — cross-session/cross-agent hand-off bookkeeping (queues, rosters, delta-log, digest) — historical, excluded from content-mapping.
scratch/  — ad hoc one-off investigation scripts (.mjs), not part of the shipped surface.
scripts/  — repo-level maintenance scripts (assemble-spec.sh, benchmark tooling, dock health checks, flograph fixtures, state.ts, threads.ts).
spa-lists/  — sub-PA task-list tracking docs (ssN-*.md + progress files) — PA bookkeeping, not compiler content, excluded from content-mapping.
.github/workflows/  — CI: ci.yml (gate/tracking/windows jobs), advisory-review.yml (AI /code-review, advisory) — see build.map.md / infra.map.md. Unchanged.
.pa-base/  — the scrml PA boot manifest/profile.

## Ignored / Generated Paths
node_modules, dist, build, target, .git, .jj, .claude, vendor, __pycache__ — plus samples/compilation-tests/*/dist (gitignored, populated by `bun run pretest`).

## Monorepo Note
`workspaces: ["compiler"]` (root package.json) — compiler/ is the sole npm workspace member (own package.json, v0.2.0, acorn+astring deps). stdlib/, editors/, lsp/ are NOT npm workspaces but are integral first-party surfaces of the same repo, each versioned/tested independently of the workspace mechanism.

## Tags
#scrml #map #structure #entry-points #directory-layout #native-parser #self-host #stdlib #lsp #css65 #outlet #one-landmark #shell-composition #server-shape #semdiff #ci #content-hash #link-boost #theme-reset #giti-038 #giti-039 #colorless-async #writer-ownership #session-establishment #sql-lex #tenant-floor

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [dependencies.map.md](./dependencies.map.md)
- [domain.map.md](./domain.map.md)
- [test.map.md](./test.map.md)
- [error.map.md](./error.map.md)
