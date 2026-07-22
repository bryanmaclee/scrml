# build.map.md
# project: scrml
# updated: 2026-07-22T17:10:00Z  commit: a0344d75

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
compile, dev, build, serve, migrate, promote, generate, init, introspect, semdiff (10 verbs — the figure `docs/FACTS.md` derives from `compiler/src/commands/`). No subcommand added or removed. **`compile`, `dev` and `build` each gained `--module-format=<classic|esm>` this window** (see below).

### `scrml compile` flags
--parser (live|scrml-native), --mode, --output/--output-dir, --watch, --embed-runtime, --self-host, --convert-legacy-css, --prod/--production (§20.6.5 log() strip), --validate-emit/--no-validate-emit, --no-gather, --debug-perf, --verbose, --chunk-size-budget, --emit-batch-plan, --emit-block-analysis, --emit-engine-graph, --emit-reachability, --emit-token-set, --emit-per-route, --emit-machine-tests, **--module-format=<classic|esm>**, --help.
`compileScrml()` (compiler/src/api.js) gained an internal `contentHashAssets` option (default `false`) — NOT a CLI flag; `scrml compile`'s output stays byte-identical (un-hashed `.client.js`/`.css` names) so the dev/inspection path and every disk-reading test are unaffected. See "Content-addressed build assets" below.

### `scrml dev` flags
--port, --idle-timeout <n> (configurable Bun.serve idleTimeout, default 120s), --embed-runtime, --convert-legacy-css, --validate-emit/--no-validate-emit, --no-gather, --verbose, **--module-format=<classic|esm>**, --help.
`scrml dev` now attaches cache headers to every static response (see below) — no new flag gates this; it is always on.

### `scrml build` flags
--target, --minify, --output, --idle-timeout, --embed-runtime, --copy-config, --validate-emit/--no-validate-emit, --verbose, **--module-format=<classic|esm>**, --help.
`scrml build` now calls `compileScrml({ ..., contentHashAssets: true })` unconditionally (no opt-out flag) and threads the returned `hashedAssets` set into the generated `_server.js` (see below).

### `scrml semdiff <base> <head>` flags (the #6b P0 semantic-diff primitive, landed S264)
Classify a change between two .scrml versions by AXIS + soundness TIER — never a boolean "safe".
--emit-classification  Emit the per-matched-entity classification (default).
--json                 Structured JSON output (the consumer review-row / merge input).
--help, -h.
Both versions are compiled in-process (full pipeline, write:false); the synthesized top-level `verdict` field is the single value a consumer keys on. Exit codes: **0** = cosmetic (no-op on every modeled axis) · **1** = behavioral (a change on some axis; gate/review stays consumer-side) · **2** = a version failed to compile (fail-closed — the compiler is the first reviewer). Consumers: giti MERGE, flogence REVIEW. Classifier math lives in `compiler/src/semdiff.ts` (pure, unit-tested); the command is the I/O shell.

## `--module-format=classic|esm` (NEW — ESM-chunks arc U1-U3)

Selects the CLIENT module format. Accepted on `compile`, `dev` and `build`, in both the
`--module-format=esm` and `--module-format esm` shapes; any other value is a hard exit with
`Unknown --module-format value: "<x>". Valid values: classic, esm`. Parsed in each command's arg
loop (compile.js:273, dev.js:92, build.js:91) and threaded to `compileScrml({ moduleFormat })`
(api.js:822) -> `runCG` (codegen/index.ts:156/:837).

- **`classic` is the DEFAULT and the only conformance-tested path.** The client runtime is a
  non-module `<script src>` sharing one global scope with every page chunk; cross-file linkage goes
  through the global `_scrml_modules` registry. Every esm transform is gated, so classic output is
  byte-identical to pre-arc output.
- **`esm`** emits the runtime as an ES module with a derived `export {…}` surface, each client chunk
  as an ES module that namespace-imports its deps and the runtime subset it uses, `type="module"` on
  the emitted `<script>` tags, and (on the build path) content-hashed in-chunk import URLs. A full
  esm app RUNS in a browser. Still EXPERIMENTAL: the module-capable browser-test harness and the
  default-flip are not built.
- **`esm` + `--embed-runtime` = no effect** — the embedded runtime stays a classic script.
- Selecting esm prints an operational stderr notice keyed **`W-MODULE-FORMAT-ESM-INCOMPLETE`**
  (`compiler/src/commands/module-format-notice.js`). It is deliberately NOT a §34 catalog code and
  never enters the diagnostic stream or the compile result; classic prints nothing.

## Public-claim gates (NEW — S280)

Three scripts, two of them CI-required. They exist because a public claim that was true when
written rots silently.

- **`scripts/snippet-gate.js`** — GATE. Discovers every `.scrml` under a declared corpus
  (`SNIPPET_CORPUS = ["docs/tutorial-snippets", "docs/readme-snippets"]`; 12 files today) and
  compiles each through `compiler/bin/scrml.js compile` into a temp dir; exit 1 on any failure.
  Modes: default gate, `--list` (print the corpus, compile nothing), explicit paths (override the
  corpus). Real files, not fenced blocks, and no opt-out marker — an opt-out gate under fragment
  pressure degrades to zero coverage. **Wired into CI `gate` and the release-tag `pre-push` hook.**
- **`scripts/facts.ts`** — generator + checker for `docs/FACTS.md`. `bun scripts/facts.ts` prints,
  `--write` regenerates the `@generated:*` anchored sections in place (idempotent), `--check`
  regenerates in memory and exits 1 on any stale section. **`--check` is wired into CI `gate`.**
  Derives: compiler version, live compiler LOC + file count (`compiler/src`), test files
  (`compiler/tests/**.test.js`), SPEC lines, conformance cases (`expected.json` under
  `conformance/cases`), stdlib modules, CLI verbs, LSP capabilities, editor integrations, deploy
  targets, gated snippets. Deliberately EXCLUDES anything that changes without a commit (GitHub
  stars, issue counts, test PASS counts) and the §34 diagnostic total (not reliably extractable).
  **A public doc SHALL cite FACTS.md rather than hardcode any of these figures.**
- **`scripts/claim-gate.js`** — the fenced-block (C1) half: extracts ```scrml fences from a declared
  PUBLIC_SURFACE, compiles + ghost-pattern-lints each, `// gate: skip` opt-OUT. Modes: default gate,
  `--report` (MEASURE a surface without failing). **Not wired into CI** — the measured fence
  approach scored 92/149 failures dominated by narrative-fragment artifacts, which is why
  snippet-gate (real files) is the CI-required gate. Deliberately does NOT gate
  `handOffs/incoming/**` (bug reproducers), `compiler/SPEC.md` (error demos), or `docs/changes/**`.
- `scripts/extract-readme-scrml.js` (the S101 README gate) is **DELETED** — superseded by the above.

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

**gate** — BLOCKING (the merge-gate). checkout → setup-bun → `bun install --frozen-lockfile` → `bun run pretest` → `bun test compiler/tests/unit compiler/tests/conformance` (reproducibly-green-from-source core) → gauntlet quick check (compile benchmarks/todomvc/app.scrml, `node --check` the emitted client.js) → **`bun scripts/snippet-gate.js`** (every public-cited `.scrml` still compiles) → **`bun scripts/facts.ts --check`** (published figures still match the repo). The last two steps are NEW this window.
Triggers: push (paths-ignore: **.md, handOffs/**, docs/**) and pull_request. `concurrency: group ci-${{ref}}, cancel-in-progress: true`.

**tracking** — NON-BLOCKING (`continue-on-error: true`). integration + lsp + commands tests, browser tests (known real fails tracked, not gated), and the parser-conformance-within-node.test.js M6.x native-parser-migration backlog. Same checkout/install/pretest steps as gate.

**windows** — NON-BLOCKING (`continue-on-error: true`), `runs-on: windows-latest`. Runs unit + conformance only (the dist-independent core) to surface OS-path-separator regressions (`\` vs `/`, the issue #25/#26 class) invisible on the Linux gate. Candidate for promotion into `gate` (as a matrix leg) once confirmed green.

Rationale banner in the workflow (S253): the prior single-job CI ran the FULL suite and went red on known self-host/within-node backlog (self-host tests need a locally-built, non-reproducible-from-source dist) — untrustworthy as a merge gate. `gate` is now the guaranteed-green-from-source core only.

`.github/workflows/ci.yml` CHANGED this window: the two claim-gate steps above were appended to `gate`. No other workflow change.

## CI/CD Pipeline  [.github/workflows/advisory-review.yml]
**ai-review** job — non-blocking second-opinion AI `/code-review` on every code PR (deliberately NOT in branch-protection required checks; comments only, never fails the PR).
Triggers: `pull_request` (opened/synchronize/ready_for_review/reopened), paths-filtered to `compiler/**`, `stdlib/**`, `lsp/**` (skips docs-only PRs to save tokens). `concurrency: group ai-review-${{pr#}}, cancel-in-progress: true`.
Runs `anthropics/claude-code-action@v1` with the packaged `/code-review` skill against the PR diff (`claude-sonnet-4-6`, max 15 turns). Needs the `ANTHROPIC_API_KEY` repo secret — unset today, so a run currently errors at the auth step (harmless; not a required check). Public-repo caveat: fork PRs from external contributors get no secrets, so this only runs on same-repo branches (bryan + Peter).

## Pending / not-yet-merged CI (informational — NOT current truth at HEAD)
`.github/workflows/cloud-maps.yml` exists on branch `feat/cloud-maps-beachhead` but is NOT merged into `main` as of this HEAD (99ae45ca) — a scheduled + dispatch nav-map regen workflow (mints a scrml-maps-bot App token, runs `bun scripts/state.ts --write` + this project-mapper agent, opens an auto-merge `maps/regen-*` PR). Needs the `scrml-maps-bot` GitHub App + `MAPS_APP_ID`/`MAPS_APP_PRIVATE_KEY` secrets before it can go green. Not reflected in the CI section above because it is not part of the checked-out tree. (Status re-verify on a full refresh — this note is carried from the S255 watermark.)

## Git Hooks (source-controlled, `.git/hooks/pre-commit` + `pre-push`; install via `scripts/git-hooks/install.sh`)
pre-commit — runs `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail` (~2min, excludes browser/e2e/self-host); warns (non-blocking) on direct commits to `main`.
pre-push — full test suite (`bun test compiler/tests/`) + gauntlet quick check (TodoMVC compile + emitted-JS parse check); refreshes samples/compilation-tests/ fixtures first (stale fixtures previously faked ~9 browser-suite failures, S250); and the **public snippet gate (`scripts/snippet-gate.js`)** ONLY on a `refs/tags/v*` release-tag push (re-pointed from the deleted `scripts/extract-readme-scrml.js`; snippet-gate also runs in CI `gate` on every push, so the hook is the release-tag second net).

## Docker
None. No Dockerfile / docker-compose in this repo — see infra.map.md.

## Tags
#scrml #map #build #cli-flags #semdiff #ci #ci-gate-layering #pre-commit #pre-push #bun-test #advisory-review #windows-ci #content-hash #cache-headers #adopter-82 #module-format #esm-chunks #snippet-gate #facts-gate #claim-gate #public-claims

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [test.map.md](./test.map.md)
- [config.map.md](./config.map.md)
- [infra.map.md](./infra.map.md)
