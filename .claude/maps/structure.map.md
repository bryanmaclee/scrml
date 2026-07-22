# structure.map.md
# project: scrml
# updated: 2026-07-22T17:10:00Z  commit: a0344d75

## Entry Points
compiler/bin/scrml.js — CLI shim; resolves to compiler/src/cli.js.
compiler/src/cli.js — dispatches `scrml compile|dev|build|serve|migrate|promote|generate|init|introspect|semdiff` to compiler/src/commands/*.js.
compiler/src/api.js — `compileScrml()`, the single-file pipeline entrypoint (block-split -> AST-build -> type-check -> codegen); everything else calls into this. Carries the `moduleFormat` option (default `"classic"`, api.js:822) and the esm-gated build-path import-URL hasher (`rewriteChunkImportRefs`, ~:2947-3010).
lsp/server.js — LSP server entry (`bun run lsp` / `--stdio`); registers handlers.js + workspace.js.
docs/build.ts — static-site generator for the docs website (`bun run docs:build`).

## Directory Ownership

compiler/src/  — the compiler core: block-splitter, tokenizer, ast-builder, type-system, symbol-table, route-inference, name-resolver, html-elements, compute-program-config, landmark-tag, and ~20 top-level analysis modules. **181 tracked files (138 .ts + 41 .js + 1 .md + 1 .json)**, `git ls-files`-counted this pass. Net **+2** across this window: **+3 NEW** (`codegen/runtime-esm.ts`, `codegen/emit-client-esm.ts`, `commands/module-format-notice.js`) and **−1 DELETED** (`lint-w-each-table-foster.js` — the S272 interim table-foster lint, retired because the #131 fence model makes its warned condition impossible).
compiler/src/codegen/  — code emission: one emit-*.ts per output concern plus shared collect/rewrite/reactive-deps/errors infra. **81 files (77 .ts + 3 .js + 1 .md)**, +2 this window (`runtime-esm.ts`, `emit-client-esm.ts`).
compiler/src/codegen/runtime-esm.ts  — **NEW (ESM-chunks U1).** Transforms the assembled, POST-SLICE classic runtime string into a valid ES module for `--module-format=esm`. Exports `toEsmRuntime` (:304), `deriveTopLevelExportNames` (:256, Acorn-derived — the export surface is mechanical, never a curated list, so a future runtime symbol exports automatically and a tree-shaken-out symbol is never exported), `LIFT_TARGET_GLOBAL` (:71), `REACTIVE_GET_OVERRIDE_SLOT`. Three transforms, ALL esm-gated: `^{}` meta-block dep-tracking interception routed through `globalThis.__scrml_reactive_get_override` (module bindings and global properties diverge under ESM, so the classic global-swap trick cannot work); redeclare-guard simplification; the trailing `export { … }` block.
compiler/src/codegen/emit-client-esm.ts  — **NEW (ESM-chunks U2).** Transforms a per-file classic client chunk body (post runtime-slice-strip, PRE the cross-file IIFE wrap) into an ES module. Export `toEsmClientChunk` (:270). Three transforms: the `_scrml_modules["<key>"] = {…}` registration footer -> `export { emitted as public, … }`; the `const {a,b} = _scrml_modules["<key>"]` header -> a **NAMESPACE** import (`import * as __scrml_dep_0 from "<rel-url>"` + destructure) — the namespace form is load-bearing, because an importer may name a cross-file COMPONENT or type-only binding the dependency never registers, and a NAMED import of a non-exported binding is a hard module link error; and a runtime import of `(runtime-slice exports ∩ chunk idents) − chunk-own decls`. `SHARED_MUTABLE_RUNTIME_GLOBALS` (:73, currently just `_scrml_lift_target`) are routed through `globalThis.<name>` instead of being imported, because an imported ESM binding is read-only.
compiler/src/commands/module-format-notice.js  — **NEW.** `moduleFormatNotices(moduleFormat, embedRuntime)` — the stderr operational notice for `--module-format=esm`, keyed `W-MODULE-FORMAT-ESM-INCOMPLETE`. Deliberately NOT a §34 catalog code and never in the diagnostic stream; returns `[]` for classic so the default path prints nothing. Imported by commands/{compile,dev,build}.js.
compiler/src/codegen/emit-each.ts  — `<each>` emission. `emitEachMountHtml` (:371) emits the **parse-safe comment FENCE** `<!--scrml-each:N--><!--/scrml-each:N-->` (a comment is inserted normally in EVERY HTML insertion mode, so it is never foster-parented out of a `<table>` nor dropped by the "in select" mode; the two-comment form bounds the keyed-reconcile range against static siblings). The reconcile emit calls the polymorphic runtime ops `_scrml_each_clear` / `_scrml_each_append` and locates the mount via `_scrml_find_each_anchor(document, N)` — never `querySelector`. A NESTED each still builds its mount with `createElement` + `setAttribute("data-scrml-each-mount", …)` (:1041) — that path is immune to parse-time foster-parenting but is a separate open gap in restricted parents.
compiler/src/runtime-template.js  — the client runtime shipped into generated apps: soft-nav engine, link-boost delegated click listener, the `[data-scrml-outlet]` swap target (`querySelector` at ~:2238/:2436), and the **range-aware list reconciler**: `_scrml_reconcile_list` (:1652) branches on `container.nodeType === 8` (comment anchor -> operate over the fence sibling range via `_scrml_each_end`) versus an element container (`replaceChildren`/`appendChild`); `_scrml_each_end` (:1963, memoized on the start anchor), `_scrml_find_each_anchor` (:1989, memoized SHOW_COMMENT TreeWalker mirroring `_scrml_find_if_marker` :1381), `_scrml_each_clear` (:2006), `_scrml_each_append` (:2019), `_scrml_remount_each` (:2131, walks comments to re-invoke registered renderers after an arm swap).
compiler/src/landmark-tag.ts  — a single-export module: `isAuthorMainTag(node)`, the ONE `<main>` landmark predicate, imported by BOTH `symbol-table.ts`'s `collectOutlets` (SYM PASS 15.5, fires the diagnostic) and `codegen/emit-html.ts`'s `treeHasAuthorMain` (picks the emitted slot tag). Case-INSENSITIVE but guarded by NAME RESOLUTION (`isUserComponentMarkup`), because ast-builder classifies component-vs-element by capitalization alone. Touch landmark logic HERE, not in either walker.
compiler/src/symbol-table.ts  — the SYM pass battery. PASS 15.5 `collectOutlets` walks TOTALLY (every object-valued property, `span` excluded, WeakSet-guarded), mirroring its emit twin `treeHasAuthorMain`, and resets `inRouteScope` at a nested `<program>` boundary (§4.12.1). PASS 5a `walkNonBindableMarkupDecls` (:2892, wired :12425) owns the DECL-scoped `E-CELL-RENDER-SPEC-NOT-BINDABLE`.
compiler/src/commands/  — the 10 CLI subcommands (build, compile, dev, generate, init, introspect, migrate, promote, semdiff, serve) + module-format-notice.js. No new subcommand; `compile`/`dev`/`build` each gained the `--module-format` flag parser (both `=value` and space-separated forms; unknown value = hard exit).
compiler/src/types/  — shared TS type declarations: ast.ts (the FileAST/ASTNode catalog, carries `ReturnStmtNode.fnExprNode`), auth-graph.ts, reachability.ts. **No `<outlet>` node type and no each-mount node type exist here** — `<outlet>` is a plain `kind: "markup"` node, and the each mount is an emitted string, not an AST shape. `moduleFormat` is a codegen INPUT option (`codegen/index.ts:156`), not an AST type.
compiler/src/validators/  — standalone AST-walk validators (attribute allowlist/interpolation, async-user-source lint, try-catch lint, post-CE invariant checks) — 6 files.
compiler/src/native-parser-canary/  — the within-node-classifier that diffs native-parser output against the live pipeline for parity tracking.
compiler/src/native-walker/  — 3 walkers (attrvalue-exprnode, engine-statechild, exprtext-backfill) used by the native-parser canary.
compiler/src/reachability/  — the reachability-solver's component/gate-classifier/fixpoint machinery (8 files).
compiler/native-parser/  — the from-scratch native lexer/parser (Road-B, Charter B): each stage ships as a paired `.js` (compiled/live) + `.scrml` (canonical source) — lex, parse-expr, parse-stmt, parse-markup, parse-file, translate-expr/stmt, error-recovery (79 files total). Feeds lsp/handlers.js semantic tokens. **ZERO diff since `df2ac831`, re-verified at this HEAD** (`git diff --name-only df2ac831..HEAD -- compiler/native-parser/` returns 0 files). It is a lexer/parser/AST layer only — outlet/landmark rules and the each MOUNT SHAPE are out of its layer and carry no parity obligation (the fence is an emit-time string; the native parser produces no HTML). `E-SCRIPT-001` IS in its layer and IS a confirmed gap (`parse-markup.js:983-995` carries the `<style>`/E-STYLE-001 mirror with no `<script>` counterpart). See non-compliance.report.md.
compiler/self-host/  — Road-A self-host compiler implementation #1, hand-authored in scrml (17 files).
compiler/self-host-v2/  — Road-B self-host compiler implementation #2 (pure-functional lexer rewrite; in progress).
compiler/runtime/stdlib/  — the JS host-shim side of each of the 21 stdlib modules (auth, compiler, cron, crypto, data, format, fs, host, http, math, mcp, oauth/ [5 provider files], path, process, random, redis, regex, router, store, test, time).
compiler/runtime/idempotency.js — idempotency-key store used by generated server code.
compiler/tests/  — **1234 `*.test.js` files** (recursive `git ls-files` count this pass): unit/ **828**, integration/ **176**, conformance/ **122**, browser/ **69**, commands/ 8, lsp/ 11, self-host/ 4, e2e-render-map/ 2, plus **14** top-level `parser-conformance*.test.js` (native-parser vs live-pipeline parity) and fixtures/ + helpers/. This window: **+5** (`unit/esm-runtime-module-format`, `unit/esm-client-chunk-format`, `unit/esm-script-tag-module-format`, `unit/each-mount-fence-foster-safe`, `unit/colorless-async-discard-hof`, `browser/esm-chunk-module-linkage`) and **−1** (`unit/each-table-foster-warn-s272`, deleted with its lint). See test.map.md.
compiler/scripts/  — build-self-host.js + css-conflict-dryrun.ts (the §65.11 corpus dry-run analyzer).
compiler/SPEC.md  — the normative language specification, **36,114 lines** (§1-§65+). This window: §5 gained the **five-door markup-value partition** (component / bindable cell / derived cell / enum `renders` / iteration) with a plain writable Shape-1 markup cell explicitly rejected (`E-CELL-RENDER-SPEC-NOT-BINDABLE`, S279 ruling), and the §34 **`E-STYLE-001` row was CORRECTED** to describe the `<style>` ELEMENT rejection (it previously read "CSS: syntax error in `#{}` style block", a stale trigger the compiler never had). Authoritative per pa.md Rule 4.
compiler/SPEC-INDEX.md — section-number lookup index into SPEC.md.
compiler/PIPELINE.md — the compiler pipeline stage-by-stage reference.
stdlib/  — the canonical `.scrml` SOURCE of the 21 stdlib modules; compiler/runtime/stdlib/*.js is generated/mirrored from these.
lsp/  — LSP server: server.js (capability registration — 7 providers), handlers.js (hover/diagnostics/semantic-tokens, hybrid block-splitter + native lex()), workspace.js, l4.js.
editors/vscode/  — VS Code extension: TextMate grammar + package.json + src/extension.ts + tokenize/regression-scan harness (7 files).
editors/neovim/  — syntax/scrml.vim + scrml.lua + queries/ + README (5 files).
conformance/  — the top-level D3 conformance corpus (adapters/, cases/ [51 case dirs, **745 `expected.json` assertions**], driver.ts, conformance-corpus.test.js) — a SEPARATE surface from compiler/tests/conformance/, bridged onto the pre-commit gate via corpus-bridge.test.js. This window: 8 `cases/each/*/expected.json` files updated to the fence-shaped output.
samples/  — hand-authored dogfood .scrml apps + samples/compilation-tests/ (fixture dirs compiled pre-test; count only, not individually mapped).
examples/  — 34 numbered example .scrml files plus 2 multi-file example dirs (22-multifile/, 23-trucking-dispatch/). `examples/23-trucking-dispatch` + `docs/website` are the two MPA corpora used as regression anchors for slot/landmark and cross-file `<script src>` changes.
benchmarks/  — perf/LLM-efficiency benchmark harnesses (todomvc/ is the CI gauntlet-check target) + framework-comparison dirs (out of scope per scope rules).
docs/  — website + articles + **docs/FACTS.md (GENERATED — `bun scripts/facts.ts --write`, CI `--check`-gated; the authority for every published derived figure)** + docs/tutorial-snippets/ (11 `.scrml`) + **docs/readme-snippets/ (NEW — `tasks-app.scrml`, the README flagship example as a real compiled file)** + docs/changes/ (per-dispatch BRIEF/SCOPING/progress archive, 612 dirs, historical, excluded from content-mapping) + docs/audits/ + docs/heads-up/ + docs/changelog.md + docs/known-gaps.md + docs/cross-os-invariants.md + PA-SCRML-PRIMER.md.
e2e/  — Playwright end-to-end tests (fixtures/, tests/, 2 configs).
dashboard/  — a single scrml dogfood app (app.scrml).
handOffs/  — cross-session/cross-agent hand-off bookkeeping — historical, excluded from content-mapping.
scratch/  — ad hoc one-off investigation scripts, not part of the shipped surface.
scripts/  — repo-level maintenance + gate scripts: **snippet-gate.js (NEW — compiles every `.scrml` in the declared public corpus; CI-required)**, **facts.ts (NEW — generates/checks docs/FACTS.md)**, **claim-gate.js (NEW — fenced-block compile gate over a declared public surface; MEASURE-capable, not yet CI-wired)**, assemble-spec.sh, compile-test-samples.sh, git-hooks/, state.ts, threads.ts, benchmark + dock tooling. `extract-readme-scrml.js` was DELETED this window (superseded by snippet-gate.js).
spa-lists/  — sub-PA task-list tracking docs — PA bookkeeping, excluded from content-mapping.
.github/workflows/  — CI: ci.yml (gate/tracking/windows; `gate` gained a snippet-gate step and a facts `--check` step this window), advisory-review.yml.
.pa-base/  — the scrml PA boot manifest/profile.

## Ignored / Generated Paths
node_modules, dist, build, target, .git, .jj, .claude, vendor, __pycache__ — plus samples/compilation-tests/*/dist (gitignored, populated by `bun run pretest`). `docs/FACTS.md` is tracked but GENERATED — edit `scripts/facts.ts`, never the file.

## Monorepo Note
`workspaces: ["compiler"]` (root package.json) — compiler/ is the sole npm workspace member (own package.json, v0.2.0, acorn+astring deps). stdlib/, editors/, lsp/ are NOT npm workspaces but are integral first-party surfaces of the same repo.

## Tags
#scrml #map #structure #entry-points #directory-layout #esm-chunks #module-format #runtime-esm #emit-client-esm #each-fence #foster-safe #snippet-gate #facts-gate #native-parser #self-host #stdlib #lsp #outlet #one-landmark #shell-composition #landmark-tag

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [dependencies.map.md](./dependencies.map.md)
- [domain.map.md](./domain.map.md)
- [test.map.md](./test.map.md)
- [error.map.md](./error.map.md)
- [build.map.md](./build.map.md)
