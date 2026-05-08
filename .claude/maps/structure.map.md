# structure.map.md
# project: scrmlTS
# updated: 2026-05-08T00:00:00Z  commit: f59bbcc

## Entry Points
compiler/bin/scrml.js                — installed CLI entry (`bin: scrml`); thin shim to `compiler/src/cli.js`.
compiler/src/cli.js                  — argv parser; dispatches to `compiler/src/commands/{compile,build,dev,serve,init,migrate,promote}.js`.
compiler/src/api.js                  — programmatic API; runs the full BS→TAB→MOD→CE→VP-1/W-1→PA→RI→TS→META→DG→BP→CG pipeline (see PIPELINE.md).
compiler/src/index.js                — barrel re-exports; wraps `api.js`.
lsp/server.js                        — LSP entry (`bun lsp` script); split L1+L2+L3+L4 across `handlers.js`, `workspace.js`, `l4.js`.
compiler/scripts/build-self-host.js  — compiles `compiler/self-host/*.scrml` into `compiler/self-host/dist/`.

## Directory Ownership
benchmarks/                       — performance benchmarks (browser, fullstack, sql-batching, todomvc + framework comparison dirs).
benchmarks/fullstack-react/       — react comparison harness; not built into compiler; see benchmarks/RESULTS.md.
benchmarks/todomvc-{react,svelte,vue}/ — framework comparison dirs (out-of-scope for mapping).
compiler/                         — root of compiler package + spec; vendored `node_modules/`.
compiler/bin/                     — installed CLI shim (`scrml.js`).
compiler/runtime/stdlib/          — hand-written ES module shims (`auth.js`, `crypto.js`, `store.js`) copied verbatim into `dist/_scrml/` at compile time.
compiler/scripts/                 — `build-self-host.js` only.
compiler/self-host/               — scrml-source mirrors of compiler passes (`bs.scrml`, `tab.scrml`, `pa.scrml`, `ri.scrml`, `ts.scrml`, `dg.scrml`, `cg.scrml`, `bpp.scrml`, `ast.scrml`, `meta-checker.scrml`, `module-resolver.scrml`, plus `cg-parts/` + `dist/`); used by self-host conformance tests. NOT updated S66-S69 (post-v1.0.0 deferral).
compiler/src/                     — primary compiler source; ~85 top-level files (mixed `.js` + `.ts`).
compiler/src/codegen/              — code generation pass; 39 modules totalling ~14,135 LOC.
compiler/src/codegen/compat/      — parser-workaround shims (`parser-workarounds.js`).
compiler/src/commands/             — CLI subcommand handlers: `build.js`, `compile.js`, `dev.js`, `init.js`, `migrate.js`, `promote.js` (S65 `--match` LIVE, Tier C `--engine` deferred), `serve.js`.
compiler/src/types/                — TypeScript AST type definitions (`ast.ts` — ~1,722 LOC, ~80+ node kinds).
compiler/src/validators/           — VP-1 / W-1 validator passes: `ast-walk.ts`, `attribute-allowlist.ts`, `attribute-interpolation.ts`, `post-ce-invariant.ts`.
compiler/tests/                   — Bun test suite (469 test files, S69 baseline 9,626 pass / 60 skip / 1 todo / 0 fail).
compiler/tests/browser/           — happy-dom + puppeteer browser tests (11 files).
compiler/tests/commands/          — CLI subcommand tests (3 files).
compiler/tests/conformance/       — block-grammar, s32-fn-state-machine, tab conformance (81 files).
compiler/tests/helpers/           — shared test helpers (`expr.ts`, `extract-user-fns.js`).
compiler/tests/integration/       — cross-module integration (31 files; per-test scratch dirs `_tmp_*`).
compiler/tests/lsp/               — LSP feature tests (10 files; L1+L2+L3+L4).
compiler/tests/self-host/         — self-host smoke + per-pass `.test.js` files (4 files).
compiler/tests/unit/              — per-module unit tests (329 files); largest test bucket.
compiler/PIPELINE.md              — authoritative stage contracts (v0.7.0, 2,380 lines).
compiler/SPEC.md                  — language spec (24,382+ lines; A5-1 amendments LANDED S68).
compiler/SPEC-INDEX.md            — spec section index (last updated S58; S68 A5-1 amendments not yet regenerated into index).
docs/                             — current docs root: tutorial.md, lin.md, external-js.md, PA-SCRML-PRIMER.md (updated S68), changelog.md.
docs/articles/                    — published dev.to articles + drafts.
docs/audits/                      — current audits: Rule-4 pre-dispatch audits B7-B22 + a1c-roadmap + item-c-temporal-engine; scope-c trackers.
docs/changes/                     — per-change scratch dirs (active dispatches; SHIPPED B1-B22 dirs queued for archive; active: phase-a1b-resolve-type, phase-a1c-codegen, promotion-ergonomics Tier C, v0next-inventory, v0next-spec-impact, predicate-gaps-deep-dive-prep, reactive-derived-decl-divergence).
docs/curation/                    — disposition reports for the docs tree.
docs/deep-dives/                  — deep-dive research artefacts (3 files; flagged: belongs in scrml-support per global rules).
docs/experiments/                 — clueless-agent runs + kickstarter validation experiments.
docs/pinned-discussions/          — single pinned discussion (`w-program-001-warning-scope.md`).
docs/recon/                       — per-task recon notes (8 files, dated 2026-04-29).
docs/website/                     — website-bound announce notes.
docs/tutorial-snippets/           — code snippets used by tutorial.md.
editors/                          — VSCode + Neovim editor plugins; vendored `node_modules` under editors/vscode.
examples/                         — small `.scrml` examples (22-multifile, 23-trucking-dispatch).
handOffs/                         — historical hand-off-1.md … hand-off-69.md plus `incoming/` (out-of-scope per Phase 0 ignore rules).
lsp/                              — LSP server (`server.js` 235 + `handlers.js` 2,113 + `workspace.js` 440 + `l4.js` ~600).
samples/                          — `.scrml` examples + gauntlet sample dirs (gauntlet-r11 … gauntlet-r19, gauntlet-s19-phase4); `samples/compilation-tests/` is enumerated only by count.
scripts/                          — repo scripts: `assemble-spec.sh`, `bundle-size-benchmark.js`, `compile-test-samples.sh`, `gauntlet-s19-verify.mjs`, `generate-api-reference.js`, `migrate-closers.js`, `pull-worktree.sh`, `rebuild-bs-dist.ts`, `update-spec-index.sh`, `verify-js.js`, `git-hooks/`.
stdlib/                           — `.scrml` stdlib sources, 17 modules: auth, compiler, cron, crypto, data, format, fs, http, oauth, path, process, redis, regex, router, store, test, time.

## Key New Source Files (S68-S69)
compiler/src/engine-statechild-parser.ts — B15 state-child structural parser; `parseEngineStateChildren`, `isLegacyArrowRulesBody`.
compiler/src/multi-statement-scan.ts     — B18 top-level semicolon scanner; `scanForTopLevelSemicolon`, `isEventHandlerAttrName`.
compiler/src/derived-mutation-ops.ts     — B8 mutation operator catalog; `ARRAY_MUTATING_METHODS`, `COMPOUND_ASSIGNMENT_OPS`.
compiler/src/validator-catalog.ts        — B10 predicate signature catalog; `UNIVERSAL_CORE_PREDICATES` (14 entries).
compiler/src/validator-arg-parser.ts     — B9 validator-arg parser; `parseValidatorArg`, `decorateValidatorsWithExprNodes`.

## Top-Level Files
DESIGN.md             — design notes (current).
README.md             — project README (current).
LICENSE               — MIT.
master-list.md        — live inventory + v0.2.0 migration dashboard (current; S69 close — A1b COMPLETE).
pa.md                 — primary agent contract (current; S69-era).
scrmlFormula.md       — formula notes (current).
package.json          — workspace root; `workspaces: ["compiler"]`; bun >=1.3.13; bin: scrml.
bunfig.toml           — bun test config (`root = "compiler/tests/"`, `timeout = 10000`).
bun.lock              — lockfile.
.gitignore            — excludes node_modules/, dist/, .claude/, *.log, .env*, editors/vscode/out/, docs/SEO-LAUNCH.md, .tmp/.

## Ignored / Generated Paths
node_modules/, dist/, build/, target/, .git/, .jj/, .claude/, vendor/, __pycache__/, .tmp/, archive/, handOffs/ (history), samples/compilation-tests/* (counted only), benchmarks/todomvc-{react,svelte,vue}/, benchmarks/fullstack-react/.

## Tags
#scrmlTS #map #structure #compiler #lsp #stdlib #self-host #s68 #s69 #a1b-complete

## Links
- [primary.map.md](./primary.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [build.map.md](./build.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
