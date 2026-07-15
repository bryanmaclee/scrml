# build.map.md
# project: scrml
# updated: 2026-07-14T18:58:34-06:00  commit: f079d0a9

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
compile, dev, build, serve, migrate, promote, generate, init, introspect. Unchanged this window (no diff to cli.js/commands/ since fbb4d9fd).

### `scrml compile` flags
--parser (live|scrml-native), --mode, --output/--output-dir, --watch, --embed-runtime, --self-host, --convert-legacy-css, --prod/--production (§20.6.5 log() strip), --validate-emit/--no-validate-emit, --no-gather, --debug-perf, --verbose, --chunk-size-budget, --emit-batch-plan, --emit-block-analysis, --emit-engine-graph, --emit-reachability, --emit-token-set, --emit-per-route, --emit-machine-tests, --help.

### `scrml dev` flags
--port, --idle-timeout <n> (configurable Bun.serve idleTimeout, default 120s), --embed-runtime, --convert-legacy-css, --validate-emit/--no-validate-emit, --no-gather, --verbose, --help.

### `scrml build` flags
--target, --minify, --output, --idle-timeout, --embed-runtime, --copy-config, --validate-emit/--no-validate-emit, --verbose, --help.

## CI/CD Pipeline  [.github/workflows/ci.yml] — REWORKED this window (was a single `full-suite` job at fbb4d9fd)
Three jobs, "gate-layering" model (types → pre-commit fast subset → CI-here → PA judgment):

**gate** — BLOCKING (the merge-gate). checkout → setup-bun → `bun install --frozen-lockfile` → `bun run pretest` → `bun test compiler/tests/unit compiler/tests/conformance` (reproducibly-green-from-source core) → gauntlet quick check (compile benchmarks/todomvc/app.scrml, `node --check` the emitted client.js).
Triggers: push (paths-ignore: **.md, handOffs/**, docs/**) and pull_request. `concurrency: group ci-${{ref}}, cancel-in-progress: true`.

**tracking** — NON-BLOCKING (`continue-on-error: true`). integration + lsp + commands tests, browser tests (known real fails tracked, not gated), and the parser-conformance-within-node.test.js M6.x native-parser-migration backlog. Same checkout/install/pretest steps as gate.

**windows** — NON-BLOCKING (`continue-on-error: true`), `runs-on: windows-latest`. Runs unit + conformance only (the dist-independent core) to surface OS-path-separator regressions (`\` vs `/`, the issue #25/#26 class) invisible on the Linux gate. Candidate for promotion into `gate` (as a matrix leg) once confirmed green.

Rationale banner in the workflow (S253): the prior single-job CI ran the FULL suite and went red on known self-host/within-node backlog (self-host tests need a locally-built, non-reproducible-from-source dist) — untrustworthy as a merge gate. `gate` is now the guaranteed-green-from-source core only.

## CI/CD Pipeline  [.github/workflows/advisory-review.yml] — NEW this window
**ai-review** job — non-blocking second-opinion AI `/code-review` on every code PR (deliberately NOT in branch-protection required checks; comments only, never fails the PR).
Triggers: `pull_request` (opened/synchronize/ready_for_review/reopened), paths-filtered to `compiler/**`, `stdlib/**`, `lsp/**` (skips docs-only PRs to save tokens). `concurrency: group ai-review-${{pr#}}, cancel-in-progress: true`.
Runs `anthropics/claude-code-action@v1` with the packaged `/code-review` skill against the PR diff (`claude-sonnet-4-6`, max 15 turns). Needs the `ANTHROPIC_API_KEY` repo secret — unset today, so a run currently errors at the auth step (harmless; not a required check). Public-repo caveat: fork PRs from external contributors get no secrets, so this only runs on same-repo branches (bryan + Peter).

## Pending / not-yet-merged CI (informational — NOT current truth at HEAD)
`.github/workflows/cloud-maps.yml` exists on branch `feat/cloud-maps-beachhead` (commit 4f5a6b8d) but is NOT merged into `main` as of this HEAD (f079d0a9) — a scheduled + dispatch nav-map regen workflow (mints a scrml-maps-bot App token, runs `bun scripts/state.ts --write` + this project-mapper agent, opens an auto-merge `maps/regen-*` PR). Needs the `scrml-maps-bot` GitHub App + `MAPS_APP_ID`/`MAPS_APP_PRIVATE_KEY` secrets before it can go green. Not reflected in the CI section above because it is not part of the checked-out tree.

## Git Hooks (source-controlled, `.git/hooks/pre-commit` + `pre-push`; install via `scripts/git-hooks/install.sh`)
pre-commit — runs `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail` (~2min, excludes browser/e2e/self-host); warns (non-blocking) on direct commits to `main`. Unchanged this window.
pre-push — full test suite (`bun test compiler/tests/`) + gauntlet quick check (TodoMVC compile + emitted-JS parse check); refreshes samples/compilation-tests/ fixtures first (stale fixtures previously faked ~9 browser-suite failures, S250); README-vs-source extraction gate (`scripts/extract-readme-scrml.js`) ONLY on a `refs/tags/v*` release-tag push.

## Docker
None. No Dockerfile / docker-compose in this repo — see infra.map.md.

## Tags
#scrml #map #build #cli-flags #ci #ci-gate-layering #pre-commit #pre-push #bun-test #advisory-review #windows-ci

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [test.map.md](./test.map.md)
- [config.map.md](./config.map.md)
- [infra.map.md](./infra.map.md)
