# build.map.md
# project: scrmlts
# updated: 2026-06-26  commit: 6988c426

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

## `scrml compile` Flags (compiler/src/commands/compile.js)

| Flag | What it does |
|------|-------------|
| --emit-engine-graph | Writes `<base>.engine-graph.json` sidecar per engine (S149) |
| --parser=scrml-native | Opt-in native parser (default `null` = legacy BS+Acorn); STRICTLY OPT-IN — see structure.map.md "Native-Parser File Table" |
| **--production / --prod** | **(S174 NEW — §20.6.5 F4=A)** Production build flag. Strips ALL `log()` builtin calls to 0 bytes (`(void 0)` no-op lowering — the emitted bundle carries NO `_scrml_log` reference and no argument-eval residue; mirrors the test-bind 0-byte clean-strip §19.12.7). Sets `production:true` [compile.js:170/172], threaded into the compile opts [compile.js:279/409/431] and on to `compileScrml(... { production })` [api.js:586/1931]. Default false (non-production builds emit the location-transparent `log()` runtime). |

## `scrml build` / `scrml dev` Flags (compiler/src/commands/build.js + dev.js)

| Flag | What it does |
|------|-------------|
| **--idle-timeout \<n\>** | **(S223 ss33 NEW — `commands/build.js` + `commands/dev.js`)** Configurable `Bun.serve` `idleTimeout` in seconds baked into the emitted production server (default 120). Previously the 120 s value was hard-coded. `scrml build --idle-timeout 300` emits `idleTimeout: 300` in the server entry. `scrml dev --idle-timeout 300` raises the dev-server timeout (useful for long-running MCP or SSE sessions under slow test runners that would otherwise be truncated by Bun's default). Parsed at `commands/build.js:105` → `generateServerEntry(..., idleTimeout)` → emitted at `lines.push(\`  idleTimeout: ${idleTimeout},\`)` [:365]. Parsed analogously in `dev.js`. ZERO compile-time diagnostics. |

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
| scripts/state.ts | **DD3 project-state tool (S172, NEW +329).** `bun scripts/state.ts` prints state-at-HEAD: gap counts by severity (from `docs/known-gaps.md` `@gap` tokens), bun-test subset pass/skip/fail, version, inventory, last-N `wrap(s…)` anchors, maps-staleness. `--write` regenerates in-repo `@generated:*` sections; `--check` is the currency gate — exit 1 on stale `@generated`; maps-staleness is WARN-only. This is the wrap step 6d generator. **GEN_SECTIONS** (2 entries S173): (1) `gap-counts` → known-gaps §0 `\| Severity \| Open \|` data rows from `@gap` tokens; (2) **`recent-sessions` (NEW S173, DD3 Fork 1)** → master-list §0.6 generated index (last-8 `wrap(s…)` anchors + push-state + tag-cut) via `recentSessions(8)` [scripts/state.ts:272]. Per-session narrative SoT is `docs/changelog.md`; §0.6 is the startup-load-bearing forensic index only. |

## CI/CD Pipeline
No .github/workflows/ directory detected — no automated CI/CD configured.
Pre-commit hook: scripts/git-hooks/ — runs `bun test` before every commit (--no-verify is prohibited).

## Pre-commit Hook
Location: scripts/git-hooks/ (installed via git hooks config)
Behavior: runs the full test suite; blocks commits on failures.

## Tags
#scrmlts #map #build #bun #scripts #precommit #s223 #s174 #production-flag #log-strip #compile-flags #idle-timeout #bun-serve-idle-timeout #ss33 #runtime-minimality #scrml-build-flag #scrml-dev-flag

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [test.map.md](./test.map.md)
