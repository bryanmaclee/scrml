# config.map.md
# project: scrml
# updated: 2026-07-28T17:18:00Z  commit: 115e8b1b

No `.env.example` or `.env.template` in the repo. No `.env*` files were read (per config-map policy, `.env*` files other than `.env.example`/`.env.template` are never read by this mapper).

**Re-verified at `115e8b1b` (S297)** by re-enumerating every `process.env.*` / `Bun.env.*` reference across `compiler/src`, `lsp`, `scripts` and `e2e`. The compiler-side set is UNCHANGED this window. Two additions below are the CI-secret names and a compile-time settings knob family that is NOT an env var.

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
`[test]` section: test root = `compiler/tests/`, timeout = 10000ms.

### compiler/src/unit-cc-exemption-list.json
List of unit-test files exempted from code-coverage enforcement (currently empty array).

### compiler/tests/parser-conformance-within-node-allowlist.json
Per-file allowlist of native-parser-vs-live-pipeline within-node divergence counts (COUNT-LENGTH / EXTRA-FIELD / FIELD-SHAPE buckets), maintained per GITI-024 shape-change tracking.

## CI Secrets (GitHub Actions repo secrets, NOT env vars in source — names only)
| Secret | Consumed by | Status |
|---|---|---|
| `ANTHROPIC_API_KEY` | `advisory-review.yml` (`ai-review`) + `cloud-maps.yml` Stage 2 | **IS set.** Prior map generations said "unset today" — that is STALE; the cloud-maps run log shows it passed as `***`. It is nonetheless the most probable locus of the cloud-maps failure (a 1-turn, ~0.6s, $0, `is_error:true` result is an API-level rejection of the first request). See build.map.md. |
| `MAPS_PAT` | `cloud-maps.yml` checkout token + `GH_TOKEN` for the PR/auto-merge step | Set. A fine-grained PAT (Contents R/W + Pull-requests R/W). Required INSTEAD of `GITHUB_TOKEN` because a `GITHUB_TOKEN`-opened PR does not cascade events and `gate` would never fire. **Expires (≤1 yr) — renew or the bot goes dark.** |

No secret VALUE appears anywhere in this map set.

## Tags
#scrml #map #config #environment #env-vars #bunfig #allowlist #ci-secrets #compiler-settings #lint-knobs #maps-pat #anthropic-api-key #nav-chunk-timeout

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [build.map.md](./build.map.md)
