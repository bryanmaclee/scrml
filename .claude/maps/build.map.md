# build.map.md
# project: scrml
# updated: 2026-07-09  commit: fbb4d9fd

## Development Commands (root package.json scripts)
compile — `bun run compiler/src/cli.js compile`
pretest — `bash scripts/compile-test-samples.sh` (populates samples/compilation-tests/*/dist gitignored fixtures; runs before `test`)
test — `bun test compiler/tests/`
test:coverage — `bun test compiler/tests/ --coverage`
watch — `bun --watch compiler/src/cli.js compile`
bench — compiles samples/compilation-tests/ with `--timing`
security — compiles samples then `node --check`s every emitted .client.js
lsp — `bun run lsp/server.js --stdio`
docs:build — `bun run docs/build.ts`
e2e / e2e:ui / e2e:docs — Playwright suites (playwright.config.ts / playwright.docs.config.ts)
e2e:install — `playwright install chromium firefox webkit`

## scrml CLI subcommands (compiler/src/cli.js -> commands/*.js)
compile, dev, build, serve, migrate, promote, generate, init, introspect.

### `scrml compile` flags
--parser (live|scrml-native), --mode, --output/--output-dir, --watch, --embed-runtime, --self-host, --convert-legacy-css, --prod/--production (§20.6.5 log() strip), --validate-emit/--no-validate-emit, --no-gather, --debug-perf, --verbose, --chunk-size-budget, --emit-batch-plan, --emit-block-analysis, --emit-engine-graph, --emit-reachability, --emit-token-set, --emit-per-route, --emit-machine-tests, --help.

### `scrml dev` flags
--port, --idle-timeout <n> (configurable Bun.serve idleTimeout, default 120s), --embed-runtime, --convert-legacy-css, --validate-emit/--no-validate-emit, --no-gather, --verbose, --help.

### `scrml build` flags
--target, --minify, --output, --idle-timeout, --embed-runtime, --copy-config, --validate-emit/--no-validate-emit, --verbose, --help.

## CI/CD Pipeline  [.github/workflows/ci.yml]
Single job `full-suite` on ubuntu-latest: checkout -> setup-bun -> `bun install --frozen-lockfile` -> `bun run pretest` (populate browser fixtures) -> `bun test compiler/tests/` (the FULL suite, incl. browser/lsp/commands/self-host — the layer above the local pre-commit subset).
Triggers: push (paths-ignore: **.md, handOffs/**, docs/**) and pull_request. `concurrency: cancel-in-progress` per ref.

## Git Hooks (source-controlled, `.git/hooks/pre-commit` + `pre-push`; install via `scripts/git-hooks/install.sh`)
pre-commit — runs `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail` (~2min, excludes browser/e2e/self-host); skipped when the staged diff is docs-only (*.md/*.txt/handOffs/); warns (non-blocking) on direct commits to `main` and on unread `handOffs/incoming/` inbox files.
pre-push — full test suite + gauntlet quick check; additionally runs the README-vs-source extraction gate (`scripts/extract-readme-scrml.js`) ONLY when the push includes a `refs/tags/v*` release tag.

## Docker
None. No Dockerfile / docker-compose in this repo.

## Tags
#scrml #map #build #cli-flags #ci #pre-commit #pre-push #bun-test

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [test.map.md](./test.map.md)
- [config.map.md](./config.map.md)
