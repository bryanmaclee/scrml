# build.map.md
# project: scrmlts
# updated: 2026-06-07T19:30:00Z  commit: e05dbb17

## Development Commands (package.json scripts)

| Command | What it does |
|---------|-------------|
| bun run compile | Run `scrml compile` on current directory via compiler/src/cli.js |
| bun test | Run all 852 compiler tests under compiler/tests/ |
| bun run test:coverage | Run all tests with coverage report |
| bun run watch | Watch-mode compile via cli.js |
| bun run bench | Compile samples/compilation-tests/ with --timing flag |
| bun run security | Compile test samples + node --check all emitted client JS |
| bun run lsp | Start LSP server in --stdio mode |
| bun run docs:build | Build documentation site via docs/build.ts |
| bun run e2e | Run Playwright end-to-end tests |
| bun run e2e:ui | Run Playwright tests with UI mode |
| bun run e2e:docs | Run Playwright docs tests |
| bun run e2e:install | Install Playwright browser binaries (chromium, firefox, webkit) |

## Build & Release

| Script | What it does |
|--------|-------------|
| scripts/compile-test-samples.sh | Pretest hook: compiles all samples/compilation-tests/ before test run |
| scripts/regen-spec-index.ts | Regenerates SPEC-INDEX.md section table from SPEC.md headings |
| scripts/update-spec-index.sh | Print-only helper listing current SPEC.md heading line numbers |
| scripts/rebuild-bs-dist.ts | Rebuilds block-splitter dist artifact |
| scripts/rebuild-tab-dist.ts | Rebuilds TAB (tokenizer+ast-builder) dist artifact |
| scripts/rebuild-self-host-dist.ts | Rebuilds self-host compiler dist |
| scripts/bundle-size-benchmark.js | Measures emitted bundle sizes |
| scripts/perf-regression-check.ts | Runs timing regression check against perf baseline |
| scripts/state.ts | **DD3 project-state tool (S172, NEW +329).** `bun scripts/state.ts` prints state-at-HEAD: gap counts by severity (from `docs/known-gaps.md` `@gap` tokens), bun-test subset pass/skip/fail, version, inventory, last-N `wrap(s…)` anchors, maps-staleness. `--write` regenerates in-repo `@generated:*` sections (today: known-gaps §0 `\| Severity \| Open \|` table). `--check` is the currency gate — exit 1 on stale `@generated`; maps-staleness is WARN-only. This is the wrap step 6d generator. |

## CI/CD Pipeline
No .github/workflows/ directory detected — no automated CI/CD configured.
Pre-commit hook: scripts/git-hooks/ — runs `bun test` before every commit (--no-verify is prohibited).

## Pre-commit Hook
Location: scripts/git-hooks/ (installed via git hooks config)
Behavior: runs the full test suite; blocks commits on failures.

## Tags
#scrmlts #map #build #bun #scripts #precommit

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [test.map.md](./test.map.md)
