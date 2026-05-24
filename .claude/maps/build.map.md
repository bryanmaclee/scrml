# build.map.md
# project: scrmlts
# updated: 2026-05-23T00:00:00Z  commit: 73dd816c

## Development Commands (root package.json scripts)

| Command | What it does |
|---|---|
| `compile` | `bun run compiler/src/cli.js compile` — compile scrml source |
| `watch` | `bun --watch compiler/src/cli.js compile` — recompile on change |
| `test` | `bun test compiler/tests/` (pretest compiles samples first) |
| `pretest` | `bash scripts/compile-test-samples.sh` — runs automatically before `test` |
| `test:coverage` | `bun test compiler/tests/ --coverage` |
| `bench` | compile samples/compilation-tests/ with --timing |
| `security` | compile compilation-tests + `node --check` every emitted client JS |
| `lsp` | `bun run lsp/server.js --stdio` — start Language Server |
| `docs:build` | `bun run docs/build.ts` — build docs site |
| `e2e` | `playwright test --config=e2e/playwright.config.ts` |
| `e2e:ui` | Playwright UI mode |
| `e2e:docs` | `playwright test --config=e2e/playwright.docs.config.ts` |
| `e2e:install` | `playwright install chromium firefox webkit` |

## CLI Subcommands (compiler/src/cli.js)

| Subcommand | What it does |
|---|---|
| `scrml compile <file\|dir>` | compile scrml source |
| `scrml dev <file\|dir>` | dev server with watch |
| `scrml build <dir>` | production build |
| `scrml migrate <file\|dir>` | source migration tooling |
| `scrml promote` | if-chain → match / fn → engine promotion |
| `scrml generate / init / serve` | scaffolding + static serving |

Flags: `--no-gather`, `--test`, `--emit-per-route`, `--chunk-size-budget=<bytes>`, `--debug-perf`, `--timing`, `--parser=scrml-native` (C2 routing — opt-in native parser).

## Build & Release

No bundler step — scrml runs directly under Bun. Generated dist artifacts: `compiler/dist/`, `compiler/native-parser/dist/`, `compiler/self-host/dist/`, `stdlib/*/dist/`, `samples/dist/`. Native-parser dist rebuilt via `scripts/rebuild-bs-dist.ts` / `rebuild-tab-dist.ts` / `rebuild-self-host-dist.ts`. SPEC-INDEX regenerated via `scripts/regen-spec-index.ts`.

## CI/CD Pipeline

No hosted CI (`.github/workflows`, GitLab, Jenkins all absent). Quality gates are local git hooks; install via `bash scripts/git-hooks/install.sh`.

### Pre-commit hook  [scripts/git-hooks/pre-commit]
Warns on direct commits to `main`. Runs `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail` (browser tests excluded). Non-zero test exit blocks the commit. Never bypass with `--no-verify` without explicit user authorization (pa.md Rule 0).

### Pre-push hook  [scripts/git-hooks/pre-push]
Runs the full test suite + gauntlet quick check. README gate (extract-readme-scrml.js) runs only when push payload contains a release-tag ref (`refs/tags/v*`).

## Test Runner Config

`bunfig.toml`: `[test] root="compiler/tests/", timeout=10000`.

## Docker

No Dockerfile / docker-compose. Not containerized.

## Tags
#scrmlts #map #build #bun #git-hooks #cli

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [test.map.md](./test.map.md)
