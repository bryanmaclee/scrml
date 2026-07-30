# build.map.md
# project: scrml
# updated: 2026-07-30T07:41:02Z  commit: d0763cff
# NOTE (S299): TARGETED — `scripts/state.ts`'s gap-status contract (a NEW hard-fail surface in
# cloud-maps Stage 1). No package.json script, CLI flag, workflow or Dockerfile changed this window;
# those sections carry their `115e8b1b` walk.

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

## Packaging — scrml is PUBLISHABLE as of this window (`171f5f23`)

`"private": true` removed · `"workspaces": ["compiler"]` removed · **`compiler/package.json`
DELETED** (acorn + astring hoisted into the root `dependencies`) · a `files` ALLOWLIST added. There
is now exactly ONE manifest. Published surface: `compiler/bin/`, `compiler/src/`,
`compiler/native-parser/`, `compiler/runtime/`, `stdlib/`, `README.md`, `LICENSE` — an allowlist, so
**anything new is excluded by default**. `stdlib/` is REQUIRED at runtime
(`module-resolver.js`'s `STDLIB_ROOT` resolves `../../stdlib`), not documentation. Deliberately
excluded: `compiler/tests` (20M), `self-host*`, `samples/`, `examples/` (12M),
`SPEC.md`/`PIPELINE.md` (docs live on scrml.dev) — widening a published surface is easy, narrowing
it is not. `bin: { scrml: "compiler/bin/scrml.js" }` is unchanged. Any doc or brief describing a
`compiler/` workspace at v0.2.0 is stale.

## scrml CLI subcommands (compiler/src/cli.js -> commands/*.js)
compile, dev, build, serve, migrate, **db-migrate (NEW S287)**, promote, generate, init, introspect, semdiff — **11 verbs** (was 10; `db-migrate` is the only addition this window). `migrate` and `db-migrate` are DELIBERATELY DISTINCT commands, not a rename: `migrate` is the pre-existing scrml-SOURCE syntax codemod tool; `db-migrate` (below) applies a project's `<schema>` to a REAL database. `compile`, `dev` and `build` carry `--module-format=<classic|esm>` (prior window, unchanged).

### `scrml compile` flags
--parser (live|scrml-native), --mode, --output/--output-dir, --watch, --embed-runtime, --self-host, --convert-legacy-css, --prod/--production (§20.6.5 log() strip), --validate-emit/--no-validate-emit, --no-gather, --debug-perf, --verbose, --chunk-size-budget, --emit-batch-plan, --emit-block-analysis, --emit-engine-graph, --emit-reachability, --emit-token-set, --emit-per-route, --emit-machine-tests, --module-format=<classic|esm>, --help.
`compileScrml()` (compiler/src/api.js) carries an internal `contentHashAssets` option (default `false`) — NOT a CLI flag; `scrml compile`'s output stays byte-identical (un-hashed `.client.js`/`.css` names). See "Content-addressed build assets" below.

### `scrml dev` flags
--port, --idle-timeout <n> (configurable Bun.serve idleTimeout, default 120s), --embed-runtime, --convert-legacy-css, --validate-emit/--no-validate-emit, --no-gather, --verbose, --module-format=<classic|esm>, --help.
`scrml dev` attaches cache headers to every static response (see below) — always on, no flag gates it. **Does NOT auto-apply DB-authoritative security DDL** (see `scrml db-migrate` below — auto-apply-on-boot is deliberately eliminated for Postgres).

### `scrml build` flags
--target, --minify, --output, --idle-timeout, --embed-runtime, --copy-config, --validate-emit/--no-validate-emit, --verbose, --module-format=<classic|esm>, --help.
`scrml build` calls `compileScrml({ ..., contentHashAssets: true })` unconditionally and threads the returned `hashedAssets` set into the generated `_server.js`.

### `scrml db-migrate <project-dir|entry.scrml> --db <url> [options]` flags (NEW S287, §14.8.11.1 — the migration-apply seam)

Applies a project's `<schema>` (including the §14.8.11/.2 DB-authoritative RLS/role/SECDEF DDL) to a
REAL database — the APPLY inverse of `scrml introspect`'s EMIT (introspect: live DB -> `<schema>`
source; db-migrate: desired `<schema>` -> reconciling DDL on the live DB).

--db <url>            REQUIRED. The MIGRATOR/owner connection string (`postgres://…` or a SQLite
                       path/`sqlite:` URL) — a DIFFERENT, MORE-PRIVILEGED principal than the app
                       runtime's own `db=` (a DDL-capable role: `CREATE ROLE`, `ALTER TABLE … FORCE
                       ROW LEVEL SECURITY`, `CREATE POLICY`, `GRANT`). This separation IS the
                       security property — the compiler will not make the app process able to apply
                       or alter its own security DDL.
--dry-run              Print the reconcile plan; apply NOTHING (no lock, no ledger write, no txn).
--allow-destructive    Permit a bare `DROP TABLE` for a table present in the DB but absent from
                       `<schema>` (default: refused — see `W-SCHEMA-DESTRUCTIVE-DROP`, error.map.md).
--help, -h

**Postgres apply flow** (the acceptance-gated, db-authoritative-capable path), all inside ONE
transaction under the migrator connection: `pg_advisory_xact_lock(<fixed key>)` (serializes
concurrent migrators; auto-releases at commit/rollback — a dead migrator process leaks no lock) ->
ensure the thin `_scrml_migrations` ledger (`id`, `applied_at`, `object_kind`, `object_name`,
`ddl_hash` — apply-atomicity + object-authorship, NOT a versioned migration-file history) -> read
actual state (`readActualSchemaPg` + a narrow `pg_policies`/`pg_roles` scrml-managed-object presence
read) -> `diffSchema(desired, actual, {driver:"postgres", allowDestructive})` (appends the idempotent
DB-authoritative DDL for each `db-authoritative` table + any SECDEF `fn`) -> apply each statement,
recording `{object_kind, object_name, ddl_hash}` per statement -> commit. A statement failure rolls
the WHOLE run back.

**SQLite apply flow** (Fork 5 — general, no privilege model): read actual via `readActualSchema`,
diff, apply the whole plan in one `BEGIN`/`COMMIT` transaction. Makes a plain `<schema>` finally
do-something-at-deploy for every adopter, not only db-authoritative ones.

**Pre-flights (fail closed BEFORE touching the DB):** `E-DBAUTH-SQLITE` (a db-authoritative table or
SECDEF `fn` against a non-Postgres `--db`), `E-DBAUTH-NO-TENANT-COLUMN` (a db-authoritative table
with no `tenant_id` column — the M1 policy is keyed on it). Echoes the recognized db-authoritative
table set and surfaces `W-DBAUTH-MARKER-NEARMISS` for a mistyped marker (silent-downgrade guard).
See error.map.md for all four codes, domain.map.md for the tier's concept, migrations.map.md for the
full apply model.

### `scrml semdiff <base> <head>` flags (the #6b P0 semantic-diff primitive, landed S264)
Classify a change between two .scrml versions by AXIS + soundness TIER — never a boolean "safe".
--emit-classification  Emit the per-matched-entity classification (default).
--json                 Structured JSON output (the consumer review-row / merge input).
--help, -h.
Both versions are compiled in-process (full pipeline, write:false); the synthesized top-level `verdict` field is the single value a consumer keys on. Exit codes: **0** = cosmetic (no-op on every modeled axis) · **1** = behavioral (a change on some axis; gate/review stays consumer-side) · **2** = a version failed to compile (fail-closed — the compiler is the first reviewer). Consumers: giti MERGE, flogence REVIEW. Classifier math lives in `compiler/src/semdiff.ts` (pure, unit-tested); the command is the I/O shell.

## `--module-format=classic|esm` (ESM-chunks arc U1-U3)

Selects the CLIENT module format. Accepted on `compile`, `dev` and `build`, in both the
`--module-format=esm` and `--module-format esm` shapes; any other value is a hard exit with
`Unknown --module-format value: "<x>". Valid values: classic, esm`. Parsed in each command's arg
loop (compile.js, dev.js, build.js) and threaded to `compileScrml({ moduleFormat })` -> `runCG`
(codegen/index.ts).

- **`classic` is the DEFAULT and the only conformance-tested path.** The client runtime is a
  non-module `<script src>` sharing one global scope with every page chunk; cross-file linkage goes
  through the global `_scrml_modules` registry. Every esm transform is gated, so classic output is
  byte-identical to pre-arc output.
- **`esm`** emits the runtime as an ES module with a derived `export {…}` surface, each client chunk
  as an ES module that namespace-imports its deps and the runtime subset it uses, `type="module"` on
  the emitted `<script>` tags, and (on the build path) content-hashed in-chunk import URLs. Still
  EXPERIMENTAL: the module-capable browser-test harness and the default-flip are not built.
- **`esm` + `--embed-runtime` = no effect** — the embedded runtime stays a classic script.
- Selecting esm prints an operational stderr notice keyed **`W-MODULE-FORMAT-ESM-INCOMPLETE`**
  (`compiler/src/commands/module-format-notice.js`). Deliberately NOT a §34 catalog code and never
  enters the diagnostic stream or the compile result; classic prints nothing.

## Public-claim gates (S280)

Three scripts, two of them CI-required. They exist because a public claim that was true when
written rots silently.

- **`scripts/snippet-gate.js`** — GATE. Discovers every `.scrml` under a declared corpus and
  compiles each through `compiler/bin/scrml.js compile` into a temp dir; exit 1 on any failure.
  **Wired into CI `gate` and the release-tag `pre-push` hook.** **CORPUS WIDENED S292:**
  `SNIPPET_CORPUS = ["docs/tutorial-snippets", "docs/readme-snippets", "docs/website"]`. The
  scrml.dev pages are the most-read public surface shipped and sat OUTSIDE the gate until now — the
  same hollow-gate shape the gate was built to close at S280, one directory over. The ROOT is
  declared (98 files at time of addition) rather than individual pages, so a NEW page is gated by
  EXISTING rather than by someone remembering to list it. A declared-but-absent row is tolerated.
  **Known limit, stated in the source:** this gates that a page COMPILES; it cannot gate whether the
  page's PROSE is true — the seven false claims corrected at S292 were all prose on a page that
  compiled fine. Prose currency needs an empirical re-verify, not this gate. `docs/FACTS.md`'s
  "public code samples under the compile gate" figure (12) counts the tutorial/readme snippet
  corpus, not the widened `docs/website` root.
- **`scripts/facts.ts`** — generator + checker for `docs/FACTS.md`. `bun scripts/facts.ts` prints,
  `--write` regenerates the `@generated:*` anchored sections in place (idempotent), `--check`
  regenerates in memory and exits 1 on any stale section. **`--check` is wired into CI `gate`.**
  Derives: compiler version, live compiler LOC + file count, test files, SPEC lines, conformance
  cases, stdlib modules, **CLI verbs (now 11, `db-migrate` included)**, LSP capabilities, editor
  integrations, deploy targets, gated snippets. **A public doc SHALL cite FACTS.md rather than
  hardcode any of these figures.**
- **`scripts/regen-spec-index.ts`** — generator + **NEW `--check`er (S290)** for
  `compiler/SPEC-INDEX.md`. Regenerates the Sections-table line ranges/sizes AND the
  `@generated:spec-index-totals` block in place from SPEC.md headings, preserving hand-written
  summaries. **`--check` is wired into CI `gate` (a 6th step) and the local pre-push currency gate.**
  Only the TOTALS are gated — the per-section line ranges drift by design between amendments, and a
  gate that cries wolf gets bypassed then deleted. The totals line (`Total lines: N | Total
  sections: M + appendices`) was hand-maintained while the script regenerated the rows around it, so
  it had rotted to `33,436 lines / 61 sections` against a 36,575-line, §65-deep SPEC. The line count
  drops a trailing empty split element so it matches BOTH `wc -l` and `scripts/facts.ts`'s
  `specLines()` — two generated figures for one quantity disagreeing by one makes a reader distrust
  both.
- **`scripts/claim-gate.js`** — the fenced-block (C1) half: extracts ```scrml fences from a declared
  PUBLIC_SURFACE, compiles + ghost-pattern-lints each, `// gate: skip` opt-OUT. **Not wired into CI**
  (measure-mode only).

## Content-addressed build assets + cache headers (S265, adopter #82, PR #96)

**Naming (build path only).** `scrml build` → `compileScrml({ contentHashAssets: true })`. The
FNV-1a 32-bit hash (8-char base36) of each artifact's FINAL on-disk bytes is spliced in before the
extension: `<base>.client.js` → `<base>.client.<hash>.js`, `<base>.css` → `<base>.<hash>.css`.
`scrml compile` / `scrml dev` keep un-hashed names.

**Cache-header contract (both serve paths).**
- Content-addressed asset → `Cache-Control: public, max-age=31536000, immutable` (decided by EXACT
  SET MEMBERSHIP against `compileScrml()`'s returned `hashedAssets`, never a filename-shape guess).
- HTML entry document → `Cache-Control: no-cache` (always revalidate).
- Every other static asset → `Cache-Control: no-cache` + a WEAK validator (ETag/Last-Modified).

Implementation: `compiler/src/api.js` (`contentHashAssets` option), `compiler/src/commands/build.js`
(`generateServerEntry`), `compiler/src/commands/dev.js` (`devCacheHeaders`).

## CI/CD Pipeline  [.github/workflows/ci.yml]
Three jobs, "gate-layering" model (types → pre-commit fast subset → CI-here → PA judgment):

**gate** — BLOCKING (the merge-gate), **7 steps** (was 6; the SPEC-INDEX totals check is NEW this window). checkout → setup-bun → `bun install --frozen-lockfile` → `bun run pretest` → `bun test compiler/tests/unit compiler/tests/conformance` (reproducibly-green-from-source core) → gauntlet quick check (compile benchmarks/todomvc/app.scrml, `node --check` the emitted client.js) → `bun scripts/snippet-gate.js` → `bun scripts/facts.ts --check` → **`bun run scripts/regen-spec-index.ts --check`**.
Triggers: push (paths-ignore: **.md, handOffs/**, docs/**) and pull_request. `concurrency: group ci-${{ref}}, cancel-in-progress: true`.

**tracking** — NON-BLOCKING (`continue-on-error: true`). integration + lsp + commands tests (**incl. `commands/db-migrate.test.js`, S287**), browser tests, and the parser-conformance-within-node.test.js M6.x native-parser-migration backlog. Same checkout/install/pretest steps as gate.

**windows** — NON-BLOCKING (`continue-on-error: true`), `runs-on: windows-latest`. Runs unit + conformance only.

Rationale banner in the workflow (S253): `gate` is the guaranteed-green-from-source core only — no self-host/within-node backlog noise.

**`.github/workflows/ci.yml` DID change this window** — `gate` gained the SPEC-INDEX totals step (`0d95c364`). Everything else is unchanged: the window's new tests run within the existing unit/integration/conformance/browser tiers, gated the same way as everything else. The live-PG DB-authoritative integration tests remain `tracking`-tier and skip-graceful when Postgres is unreachable.

## CI/CD Pipeline  [.github/workflows/advisory-review.yml]
**ai-review** job — non-blocking second-opinion AI `/code-review` on every code PR (deliberately NOT in branch-protection required checks; comments only, never fails the PR).
Triggers: `pull_request` (opened/synchronize/ready_for_review/reopened), paths-filtered to `compiler/**`, `stdlib/**`, `lsp/**`. `concurrency: group ai-review-${{pr#}}, cancel-in-progress: true`.
Runs `anthropics/claude-code-action@v1` with the packaged `/code-review` skill against the PR diff. Needs the `ANTHROPIC_API_KEY` repo secret. **CORRECTION vs. prior map generations: that secret IS set** — the daily `cloud-maps` run passes it (`anthropic_api_key: ***` in the run log). Any "unset today, so a run errors at the auth step" note is stale.

## CI/CD Pipeline  [.github/workflows/cloud-maps.yml] — MERGED, SCHEDULED, and FAILING

**CORRECTION vs. prior map generations.** This workflow is NOT on an unmerged branch and does NOT
need a `scrml-maps-bot` GitHub App. It landed on `main` at `1971a87d` (2026-07-14), was retooled to a
fine-grained PAT at `b5ec120b`, and last changed at `752574d9` (2026-07-16). It is live.

**name:** `cloud-maps` · **job:** `regen` · **triggers:** `workflow_dispatch` + `schedule` cron
`17 9 * * *` (daily ~09:17 UTC) · **concurrency:** group `cloud-maps`, `cancel-in-progress: false` ·
**permissions:** `contents: write`, `pull-requests: write`, `id-token: write` (claude-code-action
needs OIDC even with an API key).

**Steps.** checkout (token `secrets.MAPS_PAT`, `fetch-depth: 0`) → setup-bun → `bun install
--frozen-lockfile` → **Stage 1** `bun scripts/state.ts --write` (deterministic @generated rollup,
zero AI cost — **and, as of S299, a HARD-FAIL surface: see "Gap-status vocabulary" below**) →
**Stage 1b** `bun scripts/threads.ts --check && bun scripts/threads.ts`
(`continue-on-error: true`) → **Stage 2** `anthropics/claude-code-action@v1` running the
`project-mapper` subagent in FULL_COLD_START mode (`--permission-mode acceptEdits --max-turns 40`)
→ **Stage 3** if `git status --porcelain -- .claude/maps master-list.md` is non-empty: branch
`maps/regen-<run_id>`, `git add -f .claude/maps master-list.md` (the `-f` is load-bearing — `.claude/`
is gitignored and the maps are force-tracked), commit, push, `gh pr create --base main`,
`gh pr merge --squash --auto --delete-branch`.

**Design constraints worth not re-litigating:** it NEVER pushes to protected `main` — it opens a PR
and enables auto-merge, so `ci.yml`'s `gate` runs on it (that workflow's `pull_request:` trigger has
no path filter, so it fires on docs-only PRs) and auto-merge stamps it on green. The PAT (not
`GITHUB_TOKEN`) is required because a PR opened by `GITHUB_TOKEN` does not cascade events, so `gate`
would never fire and auto-merge would wait forever. Fine-grained PATs expire (≤1 yr) — `MAPS_PAT`
must be renewed or the bot goes dark.

### STATUS AT THIS HEAD: **FAILING — every scheduled run, ~14 days running.**

Verified via `gh run list --workflow=cloud-maps.yml`: **17 of 17 recorded runs failed** — 3 `workflow_dispatch`
and 14 scheduled — from 2026-07-15 through the 2026-07-28 09:09 UTC schedule.

**The signature changed on 2026-07-17, and the change is the diagnosis.** The 2026-07-16 run lasted
**12m31s** — the agent genuinely ran and the job failed downstream. Every run from 2026-07-17 onward
lasts **35-60s wall**, of which the agent accounts for **~0.55-0.60s**:

```
"type": "result", "subtype": "success", "is_error": true,
"duration_ms": 594, "num_turns": 1, "total_cost_usd": 0, "permission_denials_count": 0
##[error] Claude result reported subtype success with is_error:true
##[error] Action failed with error: Claude execution failed: result is_error:true
```

**Read that shape literally: one turn, ~0.6 seconds, ZERO cost, zero permission denials.** The
session initializes fine (`"model": "claude-opus-5[1m]"`) and then errors before consuming a single
billable token. That is an **API-level rejection of the very first request** — a credential /
entitlement / quota condition on `ANTHROPIC_API_KEY`, not a mapper-agent fault, not a repo-content
fault, and not `--max-turns 40` exhaustion (that would burn minutes and dollars, as the 07-16 run
did). Stages 1 and 1b pass; Stage 3 never runs.

**Corroborating negatives:** `cloud-maps.yml` has not changed since 2026-07-16 12:31, which is AFTER
the last long-running run — so the workflow file is not the regression. The only repo-side change
between the 07-16 and 07-17 runs is `752574d9`, whose Stage 1b is `continue-on-error: true` and
therefore cannot fail the job.

**The one-line diagnostic that would confirm it:** the action is configured `show_full_output:
false`, so the agent's actual error TEXT is suppressed ("full output hidden for security"). Setting
`show_full_output: true` (or adding `--debug` to `claude_args`) on one `workflow_dispatch` run would
print the rejection verbatim. **Not done here — this refresh's write-footprint excludes `.github/`.**

**Consequence for map currency:** the maps have had NO automated refresh since 2026-07-16, which is
why the watermark sat at `c700c435` while three sessions of landings accumulated. Until `cloud-maps`
is green, every map refresh is a manual PA action.

## Gap-status vocabulary — `scripts/state.ts` now THROWS on an unknown status (CHANGED S299)

`scripts/state.ts` parses `<!-- @gap id=… sev=… status=… -->` markers out of `docs/known-gaps.md`
to generate the §0 counts rollup. It runs in `cloud-maps` **Stage 1** and via `bun scripts/state.ts
--write` locally.

**What changed and why it matters to anyone editing `known-gaps.md`.** The status was previously a
CLOSED alternation *inside the regex* (`status=(open|resolved|deferred|nominal|non-gap|forensic)`).
A marker carrying any other status therefore **did not match the regex at all — not miscounted,
INVISIBLE.** Fourteen such markers had accumulated across six unrecognised statuses, **two of them
open HIGHs**, so the published headline under-reported and nothing anywhere went red. It surfaced by
ARITHMETIC: a landing resolved two HIGH entries and the count moved 12 -> 11.

**The fix is deliberately not "widen the alternation".** The regex now matches ANY
`status=([a-z-]+)` and classification happens in three named sets:

| Set | Members | Counts as |
|---|---|---|
| `GAP_STATUS_OPEN` | `open`, `in-progress`, `narrowed`, `ruling-gated` | OPEN |
| `GAP_STATUS_CLOSED` | `resolved`, `fixed`, `deferred`, `non-gap`, `forensic`, `root-caused-elsewhere` | CLOSED |
| `GAP_STATUS_NOMINAL` | `nominal` | NOMINAL |

**A status in none of the three THROWS.** That is the gate: the ledger cannot grow a seventh
vocabulary word without someone deciding how it counts. **Practical consequence — introducing a new
`status=` string in `docs/known-gaps.md` will break CI Stage 1 by design.** Add it to the right set
in `scripts/state.ts` in the same commit.

Author intent is preserved rather than normalized — `ruling-gated` is not rewritten to `open`,
because the distinction is real to a human reading the entry. Only the COUNTING semantics are
decided in the script. (Design rationale: a closed list that silently drops what it does not
recognise fails the `pa-base` §8 gate test — a gate whose blind spot is invisible is not a gate.)

## Git Hooks (source-controlled, `.git/hooks/pre-commit` + `pre-push`; install via `scripts/git-hooks/install.sh`)
pre-commit — runs `bun test compiler/tests/unit compiler/tests/integration compiler/tests/conformance --bail` (~2min, excludes browser/e2e/self-host); warns (non-blocking) on direct commits to `main`.
pre-push — full test suite (`bun test compiler/tests/`) + gauntlet quick check; refreshes samples/compilation-tests/ fixtures first; the public snippet gate ONLY on a `refs/tags/v*` release-tag push; and **NEW S292, step 2.5 — a GENERATED-DOC CURRENCY gate** that mirrors the cloud gate's CHEAP checks so a stale generated artifact is caught locally instead of ~3 minutes later in CI. Runs `bun scripts/facts.ts --check` (~200ms) + `bun run scripts/regen-spec-index.ts --check` (~61ms) on EVERY non-deletion push, including the feature-branch pushes the S254 relaxation exempts from the full suite (exactly the ones that were failing). **`bun scripts/snippet-gate.js` is deliberately NOT in this hook — it costs ~48s**, and a hook that expensive gets bypassed, and a bypassed gate gets deleted. 261ms does not get bypassed. Skipped entirely when the push payload is deletions only. Failure message names the fix (`bun scripts/facts.ts --write && bun run scripts/regen-spec-index.ts`) and warns to regenerate AFTER the last content commit, not before — regenerating early and then editing `compiler/src` again is the exact loop this gate exists to catch (three rejected pushes in one S292 session).

## Docker
None. No Dockerfile / docker-compose in this repo — see infra.map.md.

## Tags
#scrml #map #build #gap-status-parser #state-ts #fail-loudly #known-gaps #cloud-maps-stage1 #cli-flags #semdiff #ci #ci-gate-layering #pre-commit #pre-push #bun-test #advisory-review #windows-ci #content-hash #cache-headers #adopter-82 #module-format #esm-chunks #snippet-gate #facts-gate #claim-gate #public-claims #dbauth #db-migrate #privilege-separation #migration-apply-seam #cloud-maps #maps-pat #spec-index-gate #generated-doc-currency #pre-push-currency #snippet-corpus-widened #npm-publishable #files-allowlist

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [test.map.md](./test.map.md)
- [config.map.md](./config.map.md)
- [infra.map.md](./infra.map.md)
- [migrations.map.md](./migrations.map.md)
- [domain.map.md](./domain.map.md)
