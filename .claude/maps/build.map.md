# build.map.md
# project: scrml
# updated: 2026-07-18T08:36:53-06:00  commit: 99ae45ca

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
compile, dev, build, serve, migrate, promote, generate, init, introspect, semdiff. No subcommand added/removed this window (S265) — `build`/`dev` gained internal cache/content-hash behavior (see below), not new flags.

### `scrml compile` flags
--parser (live|scrml-native), --mode, --output/--output-dir, --watch, --embed-runtime, --self-host, --convert-legacy-css, --prod/--production (§20.6.5 log() strip), --validate-emit/--no-validate-emit, --no-gather, --debug-perf, --verbose, --chunk-size-budget, --emit-batch-plan, --emit-block-analysis, --emit-engine-graph, --emit-reachability, --emit-token-set, --emit-per-route, --emit-machine-tests, --help.
`compileScrml()` (compiler/src/api.js) gained an internal `contentHashAssets` option (default `false`) — NOT a CLI flag; `scrml compile`'s output stays byte-identical (un-hashed `.client.js`/`.css` names) so the dev/inspection path and every disk-reading test are unaffected. See "Content-addressed build assets" below.

### `scrml dev` flags
--port, --idle-timeout <n> (configurable Bun.serve idleTimeout, default 120s), --embed-runtime, --convert-legacy-css, --validate-emit/--no-validate-emit, --no-gather, --verbose, --help.
`scrml dev` now attaches cache headers to every static response (see below) — no new flag gates this; it is always on.

### `scrml build` flags
--target, --minify, --output, --idle-timeout, --embed-runtime, --copy-config, --validate-emit/--no-validate-emit, --verbose, --help.
`scrml build` now calls `compileScrml({ ..., contentHashAssets: true })` unconditionally (no opt-out flag) and threads the returned `hashedAssets` set into the generated `_server.js` (see below).

### `scrml semdiff <base> <head>` flags (the #6b P0 semantic-diff primitive, landed S264)
Classify a change between two .scrml versions by AXIS + soundness TIER — never a boolean "safe".
--emit-classification  Emit the per-matched-entity classification (default).
--json                 Structured JSON output (the consumer review-row / merge input).
--help, -h.
Both versions are compiled in-process (full pipeline, write:false); the synthesized top-level `verdict` field is the single value a consumer keys on. Exit codes: **0** = cosmetic (no-op on every modeled axis) · **1** = behavioral (a change on some axis; gate/review stays consumer-side) · **2** = a version failed to compile (fail-closed — the compiler is the first reviewer). Consumers: giti MERGE, flogence REVIEW. Classifier math lives in `compiler/src/semdiff.ts` (pure, unit-tested); the command is the I/O shell.

## Content-addressed build assets + cache headers (NEW S265, adopter #82, PR #96)

Resolves a stale-bundle-after-deploy report: the shared runtime was already content-hashed
(`scrml-runtime.<hash>.js`, §47.1.3 FNV-1a), but per-page client bundles (`<base>.client.js`)
and per-page CSS (`<base>.css`) were emitted un-hashed, and NEITHER `scrml dev` NOR the generated
production server sent any cache headers — a redeploy could leave a browser silently serving a
cached stale bundle against a new server. SPEC §47.9.8 (compiler/SPEC.md) is now normative for
this contract.

**Naming (build path only).** `scrml build` → `compileScrml({ contentHashAssets: true })` in
`compiler/src/api.js`. The FNV-1a 32-bit hash (8-char base36) of each artifact's FINAL on-disk
bytes (post `scrml:`-specifier rewrite for client bundles) is spliced in before the extension:
`<base>.client.js` → `<base>.client.<hash>.js`, `<base>.css` → `<base>.<hash>.css`, and the
`.map` sibling / embedded `sourceMappingURL` tracks the same hash. Emitted `<script src>` /
`<link href>` refs in the HTML are rewritten to the hashed names (relative-path aware, so nesting
resolves correctly); a bundle shared across multiple page HTMLs resolves to the SAME hashed name
in every referrer. The `_scrml_modules` cross-file registry key (§21.3) is UNCHANGED — only the
`<script src>` URL carries the hash. `scrml compile` / `scrml dev` keep un-hashed names (flag
defaults `false`), so dev output and disk-reading tests are byte-identical to before.

**Cache-header contract (both serve paths).**
- Content-addressed asset → `Cache-Control: public, max-age=31536000, immutable`.
  - Production `_server.js` (`generateServerEntry` in `compiler/src/commands/build.js`) decides
    by EXACT SET MEMBERSHIP, never a filename-shape guess: `compileScrml()` returns
    `hashedAssets` (dist-relative POSIX paths of runtime + per-route chunks + page bundles + CSS
    on the build path); `generateServerEntry` bakes it into `_SCRML_IMMUTABLE` (a `Set`), and a
    candidate is immutable iff its dist-relative path is a member. (A dotted-but-unhashed asset
    like `app.settings.js` is therefore correctly revalidated, not frozen.)
  - `scrml dev` (`devCacheHeaders` in `compiler/src/commands/dev.js`) content-hashes ONLY the
    shared runtime and, opt-in, per-route chunks — never page bundles/CSS — so it matches by
    EXACT REGEX against those two known forms: `scrml-runtime.[0-9a-z]{8}.js` and
    `\.(initial|tier1|tier2|tierN\d+)\.[0-9a-z]{8}\.js$`.
- HTML entry document → `Cache-Control: no-cache` (always revalidate; every `scrml dev` HTML
  response now also carries this, fixing a prior no-header gap).
- Every other static asset → `Cache-Control: no-cache` + a WEAK validator (`ETag: W/"<size-hex>-<mtime-hex>"`, `Last-Modified`). A conditional request 304s when it validates.
  `If-None-Match`, when present, is authoritative (RFC 7232 §6) — a mismatch means CHANGED, so
  `If-Modified-Since` is NOT consulted in that case; IMS is evaluated only when INM is absent.
  Both serve paths (`build.js`'s `_server.js` generator and `dev.js`'s `buildServeConfig`)
  implement this identically.

Implementation: `compiler/src/api.js` (`compileScrml`'s `contentHashAssets` option + the
pre-pass hash/rewrite + the returned `hashedAssets` array), `compiler/src/commands/build.js`
(`generateServerEntry(serverModules, mcpOpts, idleTimeout, hashedAssets)` — signature GAINED a
4th param this window — emits `_SCRML_IMMUTABLE` + `_scrml_cache_headers`/`_scrml_etag` into the
generated `_server.js`), `compiler/src/commands/dev.js` (`devCacheHeaders`, exported). New
integration test: `compiler/tests/integration/i82-content-hash-cache-headers.test.js`.

## CI/CD Pipeline  [.github/workflows/ci.yml]
Three jobs, "gate-layering" model (types → pre-commit fast subset → CI-here → PA judgment):

**gate** — BLOCKING (the merge-gate). checkout → setup-bun → `bun install --frozen-lockfile` → `bun run pretest` → `bun test compiler/tests/unit compiler/tests/conformance` (reproducibly-green-from-source core) → gauntlet quick check (compile benchmarks/todomvc/app.scrml, `node --check` the emitted client.js).
Triggers: push (paths-ignore: **.md, handOffs/**, docs/**) and pull_request. `concurrency: group ci-${{ref}}, cancel-in-progress: true`.

**tracking** — NON-BLOCKING (`continue-on-error: true`). integration + lsp + commands tests, browser tests (known real fails tracked, not gated), and the parser-conformance-within-node.test.js M6.x native-parser-migration backlog. Same checkout/install/pretest steps as gate.

**windows** — NON-BLOCKING (`continue-on-error: true`), `runs-on: windows-latest`. Runs unit + conformance only (the dist-independent core) to surface OS-path-separator regressions (`\` vs `/`, the issue #25/#26 class) invisible on the Linux gate. Candidate for promotion into `gate` (as a matrix leg) once confirmed green.

Rationale banner in the workflow (S253): the prior single-job CI ran the FULL suite and went red on known self-host/within-node backlog (self-host tests need a locally-built, non-reproducible-from-source dist) — untrustworthy as a merge gate. `gate` is now the guaranteed-green-from-source core only.

No workflow file changed this window (S265) — the #82/#29-D/#27/CSS-Wave-1 PRs are source+test only.

## CI/CD Pipeline  [.github/workflows/advisory-review.yml]
**ai-review** job — non-blocking second-opinion AI `/code-review` on every code PR (deliberately NOT in branch-protection required checks; comments only, never fails the PR).
Triggers: `pull_request` (opened/synchronize/ready_for_review/reopened), paths-filtered to `compiler/**`, `stdlib/**`, `lsp/**` (skips docs-only PRs to save tokens). `concurrency: group ai-review-${{pr#}}, cancel-in-progress: true`.
Runs `anthropics/claude-code-action@v1` with the packaged `/code-review` skill against the PR diff (`claude-sonnet-4-6`, max 15 turns). Needs the `ANTHROPIC_API_KEY` repo secret — unset today, so a run currently errors at the auth step (harmless; not a required check). Public-repo caveat: fork PRs from external contributors get no secrets, so this only runs on same-repo branches (bryan + Peter).

## Pending / not-yet-merged CI (informational — NOT current truth at HEAD)
`.github/workflows/cloud-maps.yml` exists on branch `feat/cloud-maps-beachhead` but is NOT merged into `main` as of this HEAD (99ae45ca) — a scheduled + dispatch nav-map regen workflow (mints a scrml-maps-bot App token, runs `bun scripts/state.ts --write` + this project-mapper agent, opens an auto-merge `maps/regen-*` PR). Needs the `scrml-maps-bot` GitHub App + `MAPS_APP_ID`/`MAPS_APP_PRIVATE_KEY` secrets before it can go green. Not reflected in the CI section above because it is not part of the checked-out tree. (Status re-verify on a full refresh — this note is carried from the S255 watermark.)

## Git Hooks (source-controlled, `.git/hooks/pre-commit` + `pre-push`; install via `scripts/git-hooks/install.sh`)
pre-commit — runs `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail` (~2min, excludes browser/e2e/self-host); warns (non-blocking) on direct commits to `main`.
pre-push — full test suite (`bun test compiler/tests/`) + gauntlet quick check (TodoMVC compile + emitted-JS parse check); refreshes samples/compilation-tests/ fixtures first (stale fixtures previously faked ~9 browser-suite failures, S250); README-vs-source extraction gate (`scripts/extract-readme-scrml.js`) ONLY on a `refs/tags/v*` release-tag push.

## Docker
None. No Dockerfile / docker-compose in this repo — see infra.map.md.

## Tags
#scrml #map #build #cli-flags #semdiff #ci #ci-gate-layering #pre-commit #pre-push #bun-test #advisory-review #windows-ci #content-hash #cache-headers #adopter-82

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [test.map.md](./test.map.md)
- [config.map.md](./config.map.md)
- [infra.map.md](./infra.map.md)
