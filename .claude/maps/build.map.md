# build.map.md
# project: scrmlts
# updated: 2026-05-20T13:42:44-06:00  commit: 78faa65

Build tool: Bun (no transpile step — `.ts` runs directly).
No Dockerfile, no docker-compose, no CI workflow files (.github/, .gitlab-ci, Jenkinsfile).
The only CI-equivalent automation is git hooks under scripts/git-hooks/.

## npm Scripts (package.json)
compile        — `bun run compiler/src/cli.js compile` — compile a .scrml file/dir
pretest        — `bash scripts/compile-test-samples.sh` — runs automatically before `test`
test           — `bun test compiler/tests/` — full test suite (728 files)
test:coverage  — `bun test compiler/tests/ --coverage`
watch          — `bun --watch compiler/src/cli.js compile` — recompile on change
bench          — `bun run compiler/src/cli.js compile samples/compilation-tests/ --timing`
security       — compile compilation-tests then `node --check` every emitted client.js
lsp            — `bun run lsp/server.js --stdio` — start the language server
docs:build     — `bun run docs/build.ts` — build the docs site (articles → HTML)
e2e            — `playwright test --config=e2e/playwright.config.ts`
e2e:ui         — Playwright in UI mode
e2e:docs       — `playwright test --config=e2e/playwright.docs.config.ts`
e2e:install    — `playwright install chromium firefox webkit`

## CLI Subcommands (compiler/src/cli.js — the `scrml` binary)
scrml init [dir]                         — scaffold a new scrml project
scrml compile <file|dir> [opts]          — compile scrml source
scrml dev <file|dir> [opts]              — compile + watch + serve
scrml build <dir> [opts]                 — build a production server
scrml serve [opts]                       — start a persistent compiler server
scrml generate <type> [opts]             — scaffold adopter-owned source (e.g. `generate auth`)
scrml migrate <file|dir> [opts]          — apply automated rewrites for deprecated patterns
scrml promote --match|--engine <file|dir> — tier-1→<match> / <match>→<engine> (CLI locked; rewrite impl pending)
A bare `.scrml` file or directory as the first arg falls through to `compile`.

### Compile / Dev options
--output-dir, -o <dir>   output directory (default: dist/ next to input)
--verbose, -v            per-stage timing and counts
--convert-legacy-css     convert <style> blocks to #{...}
--embed-runtime          inline the runtime instead of a separate file
--emit-batch-plan        print the Stage 7.5 BatchPlan as JSON
--emit-reachability      emit <base>.reachability.json (Stage 7.6 / SPEC §40.9)
--chunk-size-budget=N    soft size budget for W-CG-CHUNK-LARGE (default 100000)
--emit-machine-tests     emit <base>.machine.test.js per source (§51.13)
--debug-perf             sub-stage CG/RS/DG timing (PGO instrumentation)
--watch, -w              watch + recompile (compile command only)

### build / serve / migrate / promote options
build:   --output <dir>, --embed-runtime, --minify (accepted, no-op in v1)
serve:   --port <n> (default 3100 or SCRML_PORT), --verbose
migrate: --dry-run, --check (CI exit-code), --include=<glob>, --exclude=<glob>, --no-default-excludes
promote: --match, --engine, --dry-run, --check

## Build & Release
There is no release pipeline in-repo. Release cut points are git release tags
(`refs/tags/v*`); the pre-push hook runs the README accuracy gate only on tag pushes.

## CI/CD Pipeline
None. No .github/workflows, .gitlab-ci.yml, or Jenkinsfile.
Quality gating is local-only via versioned git hooks (install: `bash scripts/git-hooks/install.sh`):

git pre-commit hook  [scripts/git-hooks/pre-commit]
  - warns if committing directly to `main` (only the PA should)
  - runs `bun test compiler/tests/{unit,integration,conformance} --bail`
    (skips browser subdir for flakiness); fails the commit on any test failure
  Triggers: every commit

git pre-push hook  [scripts/git-hooks/pre-push]
  - full test suite + gauntlet quick check
  - README accuracy gate (`scripts/extract-readme-scrml.js`) — ONLY when the
    push payload contains a release-tag ref (`refs/tags/v*`)
  Triggers: every push

## Docker
None.

## Notable build scripts (scripts/)
compile-test-samples.sh  — `pretest` hook; compiles test sample sources
assemble-spec.sh / regen-spec-index.ts / update-spec-index.sh — SPEC.md + SPEC-INDEX.md maintenance
generate-api-reference.js — generates API reference from stdlib
rebuild-self-host-dist.ts / rebuild-bs-dist.ts / rebuild-tab-dist.ts — rebuild self-host `.js` dist from `.scrml`
extract-readme-scrml.js  — README scrml-snippet accuracy gate (pre-push, tag pushes)
perf-regression-check.ts / benchmark-perf-baseline.ts / bundle-size-benchmark.js — performance gates
verify-js.js — `node --check` over emitted JS

## Tags
#scrmlts #map #build #cli #bun #git-hooks

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [structure.map.md](./structure.map.md)
- [test.map.md](./test.map.md)
