# build.map.md
# project: scrml
# updated: 2026-07-17T14:48:56-06:00  commit: 0a79d838

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
compile, dev, build, serve, migrate, promote, generate, init, introspect, **semdiff** (NEW S264). cli.js changed this window only to wire the `semdiff` subcommand (import `runSemdiff` from `commands/semdiff.js` + fall-through guard).

### `scrml compile` flags
--parser (live|scrml-native), --mode, --output/--output-dir, --watch, --embed-runtime, --self-host, --convert-legacy-css, --prod/--production (§20.6.5 log() strip), --validate-emit/--no-validate-emit, --no-gather, --debug-perf, --verbose, --chunk-size-budget, --emit-batch-plan, --emit-block-analysis, --emit-engine-graph, --emit-reachability, --emit-token-set, --emit-per-route, --emit-machine-tests, --help.

### `scrml dev` flags
--port, --idle-timeout <n> (configurable Bun.serve idleTimeout, default 120s), --embed-runtime, --convert-legacy-css, --validate-emit/--no-validate-emit, --no-gather, --verbose, --help.

### `scrml build` flags
--target, --minify, --output, --idle-timeout, --embed-runtime, --copy-config, --validate-emit/--no-validate-emit, --verbose, --help.

### `scrml semdiff <base> <head>` flags (NEW S264 — the #6b P0 semantic-diff primitive)
Classify a change between two .scrml versions by AXIS + soundness TIER — never a boolean "safe".
--emit-classification  Emit the per-matched-entity classification (default).
--json                 Structured JSON output (the consumer review-row / merge input).
--help, -h.
Both versions are compiled in-process (full pipeline, write:false); the synthesized top-level `verdict` field is the single value a consumer keys on. Exit codes: **0** = cosmetic (no-op on every modeled axis) · **1** = behavioral (a change on some axis; gate/review stays consumer-side) · **2** = a version failed to compile (fail-closed — the compiler is the first reviewer). Consumers: giti MERGE, flogence REVIEW. Classifier math lives in `compiler/src/semdiff.ts` (pure, unit-tested); the command is the I/O shell.

## CI/CD Pipeline  [.github/workflows/ci.yml]
Three jobs, "gate-layering" model (types → pre-commit fast subset → CI-here → PA judgment):

**gate** — BLOCKING (the merge-gate). checkout → setup-bun → `bun install --frozen-lockfile` → `bun run pretest` → `bun test compiler/tests/unit compiler/tests/conformance` (reproducibly-green-from-source core) → gauntlet quick check (compile benchmarks/todomvc/app.scrml, `node --check` the emitted client.js).
Triggers: push (paths-ignore: **.md, handOffs/**, docs/**) and pull_request. `concurrency: group ci-${{ref}}, cancel-in-progress: true`.

**tracking** — NON-BLOCKING (`continue-on-error: true`). integration + lsp + commands tests, browser tests (known real fails tracked, not gated), and the parser-conformance-within-node.test.js M6.x native-parser-migration backlog. Same checkout/install/pretest steps as gate.

**windows** — NON-BLOCKING (`continue-on-error: true`), `runs-on: windows-latest`. Runs unit + conformance only (the dist-independent core) to surface OS-path-separator regressions (`\` vs `/`, the issue #25/#26 class) invisible on the Linux gate. Candidate for promotion into `gate` (as a matrix leg) once confirmed green.

Rationale banner in the workflow (S253): the prior single-job CI ran the FULL suite and went red on known self-host/within-node backlog (self-host tests need a locally-built, non-reproducible-from-source dist) — untrustworthy as a merge gate. `gate` is now the guaranteed-green-from-source core only.

## CI/CD Pipeline  [.github/workflows/advisory-review.yml]
**ai-review** job — non-blocking second-opinion AI `/code-review` on every code PR (deliberately NOT in branch-protection required checks; comments only, never fails the PR).
Triggers: `pull_request` (opened/synchronize/ready_for_review/reopened), paths-filtered to `compiler/**`, `stdlib/**`, `lsp/**` (skips docs-only PRs to save tokens). `concurrency: group ai-review-${{pr#}}, cancel-in-progress: true`.
Runs `anthropics/claude-code-action@v1` with the packaged `/code-review` skill against the PR diff (`claude-sonnet-4-6`, max 15 turns). Needs the `ANTHROPIC_API_KEY` repo secret — unset today, so a run currently errors at the auth step (harmless; not a required check). Public-repo caveat: fork PRs from external contributors get no secrets, so this only runs on same-repo branches (bryan + Peter).

## Pending / not-yet-merged CI (informational — NOT current truth at HEAD)
`.github/workflows/cloud-maps.yml` exists on branch `feat/cloud-maps-beachhead` but is NOT merged into `main` as of this HEAD (0a79d838) — a scheduled + dispatch nav-map regen workflow (mints a scrml-maps-bot App token, runs `bun scripts/state.ts --write` + this project-mapper agent, opens an auto-merge `maps/regen-*` PR). Needs the `scrml-maps-bot` GitHub App + `MAPS_APP_ID`/`MAPS_APP_PRIVATE_KEY` secrets before it can go green. Not reflected in the CI section above because it is not part of the checked-out tree. (Status re-verify on a full refresh — this note is carried from the S255 watermark.)

## Git Hooks (source-controlled, `.git/hooks/pre-commit` + `pre-push`; install via `scripts/git-hooks/install.sh`)
pre-commit — runs `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail` (~2min, excludes browser/e2e/self-host); warns (non-blocking) on direct commits to `main`.
pre-push — full test suite (`bun test compiler/tests/`) + gauntlet quick check (TodoMVC compile + emitted-JS parse check); refreshes samples/compilation-tests/ fixtures first (stale fixtures previously faked ~9 browser-suite failures, S250); README-vs-source extraction gate (`scripts/extract-readme-scrml.js`) ONLY on a `refs/tags/v*` release-tag push.

## Docker
None. No Dockerfile / docker-compose in this repo — see infra.map.md.

## Tags
#scrml #map #build #cli-flags #semdiff #ci #ci-gate-layering #pre-commit #pre-push #bun-test #advisory-review #windows-ci

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [test.map.md](./test.map.md)
- [config.map.md](./config.map.md)
- [infra.map.md](./infra.map.md)
