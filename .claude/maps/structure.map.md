# structure.map.md
# project: scrml
# updated: 2026-07-18T03:27:22-06:00  commit: c779e606

## Entry Points
compiler/bin/scrml.js — CLI shim; resolves to compiler/src/cli.js.
compiler/src/cli.js — dispatches `scrml compile|dev|build|serve|migrate|promote|generate|init|introspect|semdiff` to compiler/src/commands/*.js.
compiler/src/api.js — `compileScrml()`, the single-file pipeline entrypoint (block-split -> AST-build -> type-check -> codegen); everything else calls into this. Gained a `contentHashAssets` option this window (S265, adopter #82) — see build.map.md.
lsp/server.js — LSP server entry (`bun run lsp` / `--stdio`); registers handlers.js + workspace.js.
docs/build.ts — static-site generator for the docs website (`bun run docs:build`).

## Directory Ownership

compiler/src/  — the compiler core: block-splitter, tokenizer, ast-builder, type-system, symbol-table, route-inference, name-resolver, html-elements (the HTML/SVG element-shape registry; gained the boolean `hard` `<a>` attribute this window, §20.8.3 link-boost opt-out), and ~20 top-level analysis modules (67 files at this level; see dependencies.map.md for the module graph). 174 files total (132 .ts + 40 .js + 2 other), up from 173 at the 0a79d838 watermark — the net +1 is `codegen/emit-theme-reset.ts` (new).
compiler/src/codegen/  — code emission: one emit-*.ts per output concern (html, css, client, server, each, match, engine, ssr, channel, worker, tool...) plus shared collect/rewrite/reactive-deps/errors infra. 76 files (was 74 at the last-recorded watermark; +1 this window is the NEW `emit-theme-reset.ts` — §65 CSS Wave-1 emission: `<theme>` token → `:root` custom-property lowering, the built-in `reset` `@layer`, the runtime theme-switch attribute helper (`themeVariantAttr`), `E-THEME-TOKEN-UNKNOWN`; see domain.map.md / error.map.md). `emit-html.ts` and `emit-client.ts` both now import from it. `emit-reactive-wiring.ts` exports `fileHasOutlet` (was file-private) — consumed by `emit-client.ts` to gate the §20.8.3 link-boost boot-call + runtime chunk inclusion.
compiler/src/commands/  — the 10 CLI subcommands (build, compile, dev, generate, init, introspect, migrate, promote, semdiff, serve). `build.js` and `dev.js` both gained content-hash/cache-header logic this window (S265, adopter #82) — see build.map.md; no new subcommand.
compiler/src/types/  — shared TS type declarations: ast.ts (the FileAST/ASTNode catalog), auth-graph.ts, reachability.ts.
compiler/src/validators/  — standalone AST-walk validators (attribute allowlist/interpolation, async-user-source lint, try-catch lint, post-CE invariant checks) — 6 files.
compiler/src/native-parser-canary/  — the within-node-classifier that diffs native-parser output against the live pipeline for parity tracking.
compiler/src/native-walker/  — 3 walkers (attrvalue-exprnode, engine-statechild, exprtext-backfill) used by the native-parser canary.
compiler/src/reachability/  — the reachability-solver's component/gate-classifier/fixpoint machinery (8 files).
compiler/native-parser/  — the from-scratch native lexer/parser (Road-B rewrite, Charter B per README.md): each stage ships as a paired `.js` (compiled/live) + `.scrml` (canonical source) file — lex, parse-expr, parse-stmt, parse-markup, parse-file, translate-expr/stmt, error-recovery, etc. (37 paired .js/.scrml files = 74, + 5 planning/contract .md docs = 79 files total). Feeds lsp/handlers.js semantic tokens. In progress per README.md — M1 lexer complete, parser ships behind `--parser=scrml-native` at M5.
compiler/self-host/  — Road-A self-host compiler implementation #1, hand-authored in scrml (ast/bs/bpp/cg/dg/meta-checker/module-resolver/pa.scrml + cg-parts/, 17 files).
compiler/self-host-v2/  — Road-B self-host compiler implementation #2 (pure-functional lexer rewrite, lex.scrml + progress.md; in progress).
compiler/runtime/stdlib/  — the JS host-shim side of each of the 21 stdlib modules (auth, compiler, cron, crypto, data, format, fs, host, http, math, mcp, oauth/ [5 provider files], path, process, random, redis, regex, router, store, test, time) — the runtime half of the scrml:* import namespace.
compiler/runtime/idempotency.js — idempotency-key store used by generated server code.
compiler/tests/  — `*.test.js` files: unit/ (807, +2 this window: `css-wave1-emission.test.js`, `link-boost.test.js`), integration/ (170, +1: `i82-content-hash-cache-headers.test.js`), conformance/ (117), browser/ (67, +3: `browser-component-css-var.test.js`, `browser-link-boost.test.js`, `browser-theme-switch.test.js`), commands/ (8), lsp/ (11), self-host/ (4), e2e-render-map/ (2), plus 14 parser-conformance*.test.js at the top level (native-parser vs live-pipeline parity) and fixtures/ (8 files) + helpers/ (3 files). See test.map.md.
compiler/scripts/  — build-self-host.js (rebuilds self-host dist) + css-conflict-dryrun.ts (the §65.11 corpus dry-run analyzer for the E-STYLE-CONFLICT checker).
compiler/SPEC.md  — the ~35k-line normative language specification (§1-§65+, incl. §20.8 Client Router / soft navigation, §47.9.8 content-hash + cache-header contract (NEW S265), and §65 CSS-native model — status banner flipped this window from "Nominal, spec-ahead except conflict-checker" to "Wave-1 emission LANDED, Waves 2-3 Nominal"); authoritative per pa.md Rule 4.
compiler/SPEC-INDEX.md — section-number lookup index into SPEC.md.
compiler/PIPELINE.md — the compiler pipeline stage-by-stage reference.
stdlib/  — the canonical `.scrml` SOURCE of the 21 stdlib modules (auth/, cron/, crypto/, data/, format/, fs/, host/, http/, math/, mcp/, oauth/, path/, process/, random/, redis/, regex/, router/, store/, test/, time/, compiler/) — compiler/runtime/stdlib/*.js is generated/mirrored from these.
lsp/  — LSP server: server.js (capability registration), handlers.js (hover/diagnostics/semantic-tokens provider — hybrid block-splitter + native lex()), workspace.js, l4.js.
editors/vscode/  — VS Code extension: syntaxes/scrml.tmLanguage.json (TextMate grammar) + package.json + src/extension.ts + test/ (tokenize.js + regression-scan.js harness), 7 files.
editors/neovim/  — syntax/scrml.vim (region-aware Vim syntax) + scrml.lua + queries/ + README, 5 files.
conformance/  — the top-level D3 conformance corpus (adapters/ [impl1-ts.ts], cases/ [case dirs, incl. api/ cluster + a NEW style/ cluster this window — 8 case dirs covering descendant-combinator preservation, flat-inline token lowering, reset opt-out, theme emission/variant-rebind], driver.ts, conformance-corpus.test.js) — a SEPARATE surface from compiler/tests/conformance/, bridged onto the pre-commit gate via corpus-bridge.test.js.
samples/  — hand-authored dogfood .scrml apps (admin-panel, blog-cms, contact-directory, gauntlet-r11/r13/r14/r15/r18/r19, etc.) + samples/compilation-tests/ (fixture dirs, compiled pre-test by scripts/compile-test-samples.sh; count only, not individually mapped per scope rules) + checked-in .db files.
examples/  — 34 numbered example .scrml files (01-hello.scrml .. 34-value-native-set.scrml) plus 2 multi-file example dirs (22-multifile/, 23-trucking-dispatch/) and checked-in .db files.
benchmarks/  — perf/LLM-efficiency benchmark harnesses (bench-scrml.js, browser/, fullstack-react/ vs fullstack-scrml/ comparison, per-route-roles/, todomvc/ + 4 framework-comparison dirs [out of scope per scope rules], perf-baseline.json).
docs/  — website + articles + docs/changes/ (per-dispatch BRIEF.md/SCOPING.md archive dirs, one dir per change-id — historical dispatch record, excluded from content-mapping; gained 2 new dirs this window: `css-wave1-emission-2026-07-16/`, `component-css-var-scrml-el-fix-2026-07-17/`) + docs/audits/ (point-in-time audit reports, dated) + docs/heads-up/ (open-question resolution logs) + docs/changelog.md (the full session-history log — the pointer target for anything this map set omits) + docs/known-gaps.md + docs/cross-os-invariants.md + PA-SCRML-PRIMER.md.
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
#scrml #map #structure #entry-points #directory-layout #native-parser #self-host #stdlib #lsp #css65 #outlet #server-shape #semdiff #ci #content-hash #link-boost #theme-reset

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [dependencies.map.md](./dependencies.map.md)
- [domain.map.md](./domain.map.md)
