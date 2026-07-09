# primary.map.md
# project: scrml
# updated: 2026-07-09  commit: fbb4d9fd
# For per-session history, see docs/changelog.md (NOT this file — maps are current-truth navigation, not an archive).

## Project Fingerprint
Language:   TypeScript / JavaScript (mixed) + scrml itself (self-hosting stdlib + self-host compiler experiments)
Framework:  Custom compiler pipeline (no web framework) — Bun-native
Runtime:    Bun >=1.3.13 (no Node support; Bun-specific APIs used throughout)
Type:       CLI compiler + language toolchain (single-file full-stack web-language compiler, with LSP + editor-tooling + MCP surfaces)
Size:       ~3153 source files (.ts/.js/.scrml, excluding node_modules/dist/.git/.jj/.claude); compiler/src/ 168 files (130 .ts + 38 .js), compiler/native-parser/ 79 files, compiler/tests/ 1167 *.test.js
Version:    v0.7.1 (root package.json; compiler/package.json reads 0.2.0 — subpackage drift, longstanding, ignore)
Monorepo:   yes — `workspaces: ["compiler"]`; compiler/ is the sole npm workspace member; stdlib/, editors/, lsp/ are NOT npm workspaces but are integral first-party surfaces of the same repo.

## Map Index

| Map                  | Status  | Contents                                                      |
|----------------------|---------|-----------------------------------------------------------------|
| structure.map.md     | present | directory layout (top 4 levels), 5 entry points |
| dependencies.map.md  | present | 6 runtime + 6 dev deps, compiler pipeline module graph, 21 stdlib module pairing |
| schema.map.md        | present | ~114 AST types/interfaces in types/ast.ts, grouped by concern |
| config.map.md        | present | 5 env vars, 3 config files (no .env.example in repo) |
| build.map.md         | present | 13 npm scripts, 9 CLI subcommands + flags, CI + git-hooks |
| error.map.md         | present | 753 diagnostic codes (626 Error / 121 Warning / 6 Info), grouped by feature area |
| test.map.md          | present | bun:test, 1167 test files across 9 categories |
| domain.map.md        | present | scrml language primitives (§1-§65 SPEC navigation), business invariants |
| auth.map.md          | present | scrml:auth/scrml:oauth stdlib + §14.8.9 protect-floor + CSRF |
| api.map.md           | absent (no REST/GraphQL/gRPC surface owned by this repo itself — the compiler EMITS API routes for generated apps, tracked in domain.map.md §60/§61, not this repo's own API) |
| state.map.md         | absent (no redux/zustand/jotai — not a frontend app) |
| events.map.md        | absent (no EventEmitter/pubsub in compiler's own src — §38 channel semantics are a language feature, tracked in domain.map.md) |
| style.map.md         | absent (no tailwind.config/theme.ts in this repo — Tailwind + §65 CSS-native are compiler FEATURES, tracked in domain.map.md + error.map.md) |
| i18n.map.md          | absent (no locales/i18n dirs) |
| infra.map.md         | absent (no Dockerfile/compose/terraform/k8s; CI covered in build.map.md) |
| migrations.map.md    | absent (`scrml migrate` is a scrml-SOURCE syntax migrator, not a DB schema-migration tool; no migrations/ dir) |
| jobs.map.md          | absent (scrml:cron is a stdlib module FOR GENERATED APPS, not a job system this repo runs itself) |

## File Routing
types / interfaces / AST node shapes        -> schema.map.md
diagnostic codes / error classes            -> error.map.md
environment variables / config keys         -> config.map.md
test patterns / fixtures                    -> test.map.md
build commands / CI stages / CLI flags      -> build.map.md
directory layout / entry points             -> structure.map.md
external packages / module graph            -> dependencies.map.md
language primitives / SPEC navigation       -> domain.map.md
auth flows / JWT / OAuth / protect-floor    -> auth.map.md
non-compliant / stale docs                  -> non-compliance.report.md

## Key Facts
- Entry point: `compiler/bin/scrml.js` -> `compiler/src/cli.js` dispatches to `commands/*.js`; the actual pipeline is `compileScrml()` in `compiler/src/api.js` (block-split -> AST-build -> type-check -> codegen, ~35 imported pipeline-stage modules).
- The compiler ships TWO parsers side by side: the live pipeline (block-splitter.js + ast-builder.js) and a from-scratch native parser (compiler/native-parser/, 79 paired .js/.scrml files, activated via `--parser=scrml-native`) that also now feeds `lsp/handlers.js`'s semantic-tokens provider directly (landed this window).
- SPEC.md (35,338 lines, §1-§65) is the sole normative source; PIPELINE.md documents the stage-by-stage internals. Any doc contradicting SPEC.md is non-compliant per pa.md Rule 4.
- The §65 CSS-native model (flagship this window) deletes cascade specificity: `<theme>`/`<defaults>` are Nominal/spec-ahead structural elements, but the §65.2 `E-STYLE-CONFLICT`/`W-STYLE-CONFLICT-POSSIBLE` conflict-checker is LANDED and wired into the pipeline (codegen/css-conflict-check.ts, api.js Stage 3.4) — a V1.0 Wave-1 gate.
- Server/client execution boundary is fully INFERRED from usage (no author annotation); a fail-closed acorn-exact scan (E-CG-001, codegen/egress-field-scan.ts) backstops the §14.8.9 protect-floor against protected-column leaks to the client bundle.
- 21 stdlib modules ship as scrml:* imports, each with BOTH a canonical `.scrml` source (stdlib/<mod>/) and a JS host shim (compiler/runtime/stdlib/<mod>.js); this window added/fixed auth (magic-link/JWKS), oauth (4 providers + PKCE), redis, cron, host, math, random, mcp.
- Two self-host efforts exist in parallel: compiler/self-host/ (Road-A, hand-authored scrml compiler impl #1) and compiler/self-host-v2/ (Road-B, pure-functional lexer rewrite, in progress).
- `null` and `undefined` do not exist in scrml source in ANY position (§42) — `not` is the sole absence value; this is a hard compiler rule (E-SYNTAX-042 + W-ABSENCE-IN-SCRML-SOURCE), not a style guideline.
- Pre-commit hook runs the unit+integration+conformance subset (~2min, skipped on docs-only diffs); the FULL suite (incl. browser/lsp/commands/self-host) runs only in CI (`.github/workflows/ci.yml`) and on release-tag pre-push.

## Tags
#scrml #map #primary #index #compiler #bun #css65 #native-parser #self-host #stdlib #auth #baas

## Links
- [structure.map.md](./structure.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [schema.map.md](./schema.map.md)
- [config.map.md](./config.map.md)
- [build.map.md](./build.map.md)
- [error.map.md](./error.map.md)
- [test.map.md](./test.map.md)
- [domain.map.md](./domain.map.md)
- [auth.map.md](./auth.map.md)
- [non-compliance.report.md](./non-compliance.report.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
