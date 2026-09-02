# config.map.md
# project: scrml
# updated: 2026-09-02T06:00:07-06:00  commit: ad7b65dc
# generated-at: ad7b65dc — **THE SAME SHA AS LINE 3, BY CONSTRUCTION, AND THAT IS THE POINT.** At this
# watermark `merge-base HEAD origin/main` == `origin/main` == `HEAD` == `ad7b65dc`, so there is no
# second SHA to record and none is invented. MAP-STAMP RULE run at WRITE time, all three commands:
# `BASE=$(git merge-base HEAD origin/main)` -> `ad7b65dc`; `git diff --name-only BASE..HEAD --
# compiler/ scripts/ conformance/ stdlib/ lsp/ .github/ package.json` -> **EMPTY**;
# `git merge-base --is-ancestor ad7b65dc origin/main` -> **exit 0**. Inbound check (invariant 48)
# also run: `git merge-base --is-ancestor 2ec2ce3a ad7b65dc` -> exit 0.
#
# ━━━━━━━ ⛑ S395 wrap-6c — STAMP ADVANCED `2ec2ce3a` -> `ad7b65dc` (25 commits) ━━━━━━━
#
# **STAMP-ADVANCED ON RE-MEASURED ZERO-DIFF.** `git diff --name-only 2ec2ce3a..ad7b65dc -- '.env*'
# 'bunfig.toml' 'package.json' 'tsconfig.json'` is **EMPTY** across 25 commits. No environment key,
# feature flag, runtime config or manifest field was added, removed or renamed. `package.json`
# remains the SOLE manifest at v0.7.1.
#
# ⚠ **ONE THING DID CHANGE IN THIS FILE'S NEIGHBOURHOOD AND IT IS *NOT* CONFIG: `scripts/` gained
# `worktree-sweep.ts`.** It reads no environment variable and no config file — it is a pure git-query
# tool — so it correctly produces no row here. Named only so the next pass does not re-discover it as
# an unexplained `scripts/` delta.#
# ⚠ **A ZERO-DIFF SURFACE IS NOT A CORRECT MAP — IT IS ONLY AN UNCHANGED ONE.** The S391 pass
# advanced `auth.map.md` on a measured zero and still found a §20.5 SPEC anchor that had been WRONG
# FROM BIRTH (invariants 77/78). **Nothing in this file was re-walked this pass.** Treat every
# `file:line` here as a verify-against-source hypothesis, not as re-verified currency.
#
# ━━━ HISTORICAL (S391 pass; line 3 has since advanced to `ad7b65dc`) ━━━ generated-at: 2ec2ce3a — **THE SAME SHA AS LINE 3, BY CONSTRUCTION.** ⛑ **S391 — STAMP-ADVANCED ON MEASURED ZERO-DIFF (`fc6df72e..2ec2ce3a`), NOT RE-WALKED:** `git diff --name-only fc6df72e..2ec2ce3a -- '.env*' bunfig.toml package.json` is **EMPTY**; no env key, feature flag or config file moved in the window. MAP-STAMP RULE run at WRITE time (`BASE` = HEAD = `origin/main` = `2ec2ce3a`; outbound `--is-ancestor` exit 0).
# `60803548` on branch `wrap/s376`; `git diff --name-only fc6df72e..60803548` returns FOUR DOCS FILES
# (`docs/changelog.md`, `hand-off.md`, `handOffs/delta-log.md`, `master-list.md`) and ZERO source, so
# the source state actually read IS `fc6df72e`, which is `merge-base HEAD origin/main` and IS `origin/main`.
# **Line 3 and line 4 carry one SHA on purpose** — at S372 a refresh bumped line 3 while line 4 still
# named an older `generated-at:`, a self-contradicting watermark the PA correctly refused to ship.
# ⚑ **S376-bryan: STAMP-ADVANCED ON MEASURED ZERO-DIFF (`8b2e4053` -> `fc6df72e`), NOT RE-WALKED.**
# Re-measured at THIS watermark: `grep -cE '^[+-].*(process\.env|Bun\.env)'` over the WHOLE
# window's `compiler/ scripts/ .github/ package.json` diff returns **0**, and `.env*` /
# `bunfig.toml` / `tsconfig*` / `package.json` / `bun.lock` are all `--name-only` **EMPTY**.
# No env var, no feature flag, no config key moved. The window's one NEW module
# (`compiler/src/lint-e-state-block-statement-form.js`) reads no environment and takes no flag —
# its only configuration surface is the `DIAGNOSTIC_CODE` / `STATE_BLOCK_NAMES` constants, which
# are source, not config.
#
# content generated-at: `728bdc92` (the S368 pass — CARRIED. The line-3 stamp advanced
# `728bdc92` -> `b9e97f1b` (S371) -> `8b2e4053` (S372) -> `fc6df72e` (S376) on the MEASURED
# ZERO-DIFF recorded in the ⚑ note above, not on a re-walk.)
# **CURRENCY RE-VERIFIED AT `728bdc92`, NOT RE-WALKED — and verified by DIFFING, not by assuming.**
# Ancestry CHECKED (invariant 48); outbound MAP-STAMP check run (primary.map.md) at WRITE time: the
# source diff `merge-base..HEAD` is EMPTY and `728bdc92` is an ancestor of `origin/main` (it IS `origin/main`).
#
# **ZERO ENV-SURFACE DIFF ACROSS THE `c96e7012` -> `728bdc92` WINDOW (21 commits, PRs #657-#676).**
# The evidence, re-run at this HEAD over a 2,328-line source diff:
# `git diff c96e7012..728bdc92 -- compiler/src/ scripts/ lsp/ | grep -cE '^[+-].*(process\.env|Bun\.env)'`
# returns **0** — no added AND no removed env-var line anywhere in the window diff. `.env*`,
# `bunfig.toml` and `tsconfig*` are `--name-only` EMPTY. **Every key table below carries.**
#
# ⚑ **ONE CARRIED CLAIM IS NOW FALSE: `package.json` is NOT zero-diff.** The eleven-window streak
# ended at #665 — `typescript@^5.9.2` (dev) plus `types` / `types:check` / a `"//types"` comment-key
# in `scripts`. **It introduces NO environment variable and NO configuration key**, so nothing in
# this map's tables moves; it is recorded here only so a reader who diffs `package.json` does not
# conclude the config surface changed. build.map.md · dependencies.map.md.
#
# ⚠ **STILL NO `tsconfig.json` IN THE REPO, even after `typescript` became a dependency.**
# `scripts/types-gate.ts` supplies its compiler options programmatically. **Do not add one casually**
# — it would change what `tsc` sees and therefore what the `TYPES-BASELINE.json` name-set means.

No `.env.example` or `.env.template` in the repo. No `.env*` files were read (per config-map policy, `.env*` files other than `.env.example`/`.env.template` are never read by this mapper).

**Re-verified at `e80b692e` (S313)** by re-enumerating every `process.env.*` / `Bun.env.*` reference across `compiler/src`, `lsp`, `scripts` and `e2e`. **The compiler-side set is UNCHANGED across five sessions** — every landing in this window was compiler source, spec, CI or docs; none introduced or removed a configuration key. The CI-secret table at the bottom is the only part of this map that moved.

## Environment Variables (referenced directly in compiler/src / lsp / scripts / e2e source)

| Key | Where used | Notes |
|-----|-----------|-------|
| NODE_ENV | compiler/src/ | runtime environment detection |
| PORT | compiler/src/ | HTTP server port (generated-app server + `scrml serve`) |
| SCRML_PORT | compiler/src/ | scrml dev-server port override |
| SCRML_MCP_WATCH | compiler/src/ | enables MCP file-watch mode |
| CI | e2e/playwright.config.ts, e2e/playwright.docs.config.ts | gates retries/workers/reporter/reuseExistingServer for CI vs local runs |
| REDIS_TEST_URL | compiler/tests/unit/stdlib-redis.test.js | optional — enables the live-integration redis test tier (skipped by default / in CI) |

**Correction vs. the prior watermark:** `JWT_SECRET` was previously listed as a compiler-read env var; verified this pass that it is NOT read via `process.env` anywhere in compiler/src or compiler/runtime — it appears only in a JSDoc `@example` comment in `stdlib/auth/jwt.scrml` illustrating how a CONSUMER app might supply its own secret. `signJwt`/`verifyJwt` take `secret` as a caller-supplied function argument; this compiler repo has no env-var-based JWT secret of its own.

Generated (emitted) apps additionally read author-declared env vars via `<db src=env(...)>` / `scrml:host` — those are per-app, not part of this compiler repo's own config surface, and are not enumerated here.

## Feature Flags
No runtime feature-flag system. The native-parser is activated at CLI level via `--parser=scrml-native` (canary mode, not an env var). `--emit-block-analysis`, `--emit-engine-graph`, `--emit-token-set` are compile-time diagnostic-emission CLI flags (see build.map.md).

## `compilerSettings` — the SPEC §28 `lint.*` suppression knobs (an API option, NOT env vars)
`compileScrml({ compilerSettings: { … } })` accepts a small, closed set of lint-suppression keys.
They mirror the spec-only `lint.*` config family at SPEC §28; **unknown keys are silently ignored**,
and there is no config FILE loader in this repo — an adopter's own project loader passes the object.

| Key | Values | Default | Suppresses |
|---|---|---|---|
| `lintTailwindUnrecognizedClass` | `"warn"` / `"off"` | `"warn"` | `W-TAILWIND-UNRECOGNIZED-CLASS` — for codebases relying on custom CSS class names, where the lint produces acknowledged false positives (SPEC §26.5 / §34) |
| `lintForeignUndeclaredCapability` | fires / `"off"` | fires | `W-FOREIGN-UNDECLARED-CAPABILITY` — the §23.5.5 presence-nudge, for an author who genuinely wants an undeclared foreign scope |

Declared at `compiler/src/api.js` (~:751-766); read at ~:1039. See error.map.md for both codes.

## Runtime constants in the emitted client (compile-time literals, NOT config)
`_SCRML_NAV_CHUNK_TIMEOUT_MS` — the cross-chunk soft-nav script-load budget before falling back to a
hard navigation (`W-NAV-CHUNK-LOAD-FAILED`, §20.8.2/§20.8.7). Baked into `runtime-template.js`; not
author-settable and not an env var. Likewise the DB-authoritative GUC names (`scrml.tenant`,
`scrml.principal.caps`) and role/policy names (`scrml_app`, `scrml_tenant_iso`) are exported string
CONSTANTS in `schema-differ.js`, not configuration.

## Config Files

### bunfig.toml  [repo root]
`[test]` section: test root = `compiler/tests/` — **and deliberately NO `timeout` key (#537, S346).**
The file carried `timeout = 10000` from the initial split until S346 and **bun does not read
`[test].timeout`** — the effective per-test budget was always bun's default **5000 ms**. ⚠ The prior
generation of this map printed `timeout = 10000ms` as if it were live configuration; **that claim was
wrong at every stamp that carried it**, not merely stale. The standing rule (stated in the file
itself): a test/hook that legitimately runs multi-second declares its own budget at the site
(`test(name, fn, { timeout })` / `beforeAll(fn, { timeout })`) with a comment saying why; the only
per-run knob is the CLI flag `bun test --timeout <ms>`. **Do NOT re-add a key to widen the default
silently** — `scripts/browser-baseline.ts` gates on the browser tier's failure NAME SET, and a
timed-out test produces the same `(fail) <name>` marker as a failed assertion.

### compiler/src/unit-cc-exemption-list.json
List of unit-test files exempted from code-coverage enforcement (currently empty array).

### compiler/tests/parser-conformance-within-node-allowlist.json
Per-file allowlist of native-parser-vs-live-pipeline within-node divergence counts (COUNT-LENGTH / EXTRA-FIELD / FIELD-SHAPE buckets), maintained per GITI-024 shape-change tracking.

## CI Secrets (GitHub Actions repo secrets, NOT env vars in source — names only)
| Secret | Consumed by | Status |
|---|---|---|
| `ANTHROPIC_API_KEY` | **`advisory-review.yml` ONLY, and that workflow is `workflow_dispatch`-only as of #351. `cloud-maps.yml` no longer references it at all — Stage 2 was DELETED.** | **CHANGED — treat as UNSET / not-required.** bryan ruled the cloud AI spend OFF; **the absence is a COST decision, not a broken secret**, and both consuming legs were removed rather than left permanently red (the `pa-base` §8 cry-wolf shape). **Every prior map generation's "IS set — the daily cloud-maps run passes it" note is RETIRED**, as is the credential/entitlement diagnosis of the old cloud-maps red. To reinstate either leg: set the secret AND restore the trigger/step. See build.map.md. |
| `MAPS_PAT` | `cloud-maps.yml` checkout token + `GH_TOKEN` for the PR/auto-merge step | Set. A fine-grained PAT (Contents R/W + Pull-requests R/W). Required INSTEAD of `GITHUB_TOKEN` because a `GITHUB_TOKEN`-opened PR does not cascade events and `gate` would never fire. **Expires (≤1 yr) — renew or the bot goes dark.** |

`cloud-maps.yml` also DROPPED its `id-token: write` permission — it existed solely for the removed
claude-code-action's OIDC.

**Operational consequence that belongs in a config map, not just a build map: nothing on a schedule
consumes an AI credential in this repo any more, and nothing on a schedule refreshes `.claude/maps/`.
A map stamp is now exactly as old as the last PA wrap.**

No secret VALUE appears anywhere in this map set.

## Tags
#scrml #map #config #environment #env-vars #bunfig #allowlist #ci-secrets #compiler-settings #lint-knobs #maps-pat #anthropic-api-key #nav-chunk-timeout #ai-legs-killed #cost-decision #cloud-maps-stage2-deleted #advisory-review-disabled #no-scheduled-map-refresh #env-surface-unchanged #zero-env-diff #new-files-checked-individually #no-env-in-new-modules #bunfig-timeout-never-in-force #invariant-56 #zero-env-diff

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
