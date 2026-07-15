# primary.map.md
# project: scrml
# updated: 2026-07-14T18:58:34-06:00  commit: f079d0a9
# For per-session history, see docs/changelog.md (NOT this file — maps are current-truth navigation, not an archive).

## Project Fingerprint
Language:   TypeScript / JavaScript (mixed) + scrml itself (self-hosting stdlib + self-host compiler experiments)
Framework:  Custom compiler pipeline (no web framework) — Bun-native
Runtime:    Bun >=1.3.13 (no Node support; Bun-specific APIs used throughout)
Type:       CLI compiler + language toolchain (single-file full-stack web-language compiler, with LSP + editor-tooling + MCP surfaces)
Size:       6119 git-tracked files total; 3389 .ts/.js/.scrml source files (excluding node_modules/dist/.git/.jj/.claude); compiler/src/ 170 files (130 .ts + 38 .js + 2 other), compiler/native-parser/ 79 files (37 paired .js/.scrml + 5 planning docs), compiler/tests/ 1194 *.test.js
Version:    v0.7.1 (root package.json; compiler/package.json reads 0.2.0 — subpackage drift, longstanding, ignore)
Monorepo:   yes — `workspaces: ["compiler"]`; compiler/ is the sole npm workspace member; stdlib/, editors/, lsp/ are NOT npm workspaces but are integral first-party surfaces of the same repo.
CI:         GitHub Actions — `.github/workflows/ci.yml` (gate/tracking/windows) + `advisory-review.yml` (advisory AI /code-review). NEW this window (was a single `full-suite` job at the fbb4d9fd watermark).

## Map Index

| Map                  | Status  | Contents                                                      |
|----------------------|---------|-----------------------------------------------------------------|
| structure.map.md     | present | directory layout (top 4 levels), 5 entry points |
| dependencies.map.md  | present | 6 runtime + 6 dev deps, compiler pipeline module graph, 21 stdlib module pairing |
| schema.map.md        | present | ~114 AST types/interfaces in types/ast.ts, grouped by concern (unchanged this window) |
| config.map.md        | present | 6 env vars, 3 config files (no .env.example in repo) |
| build.map.md         | present | 13 npm scripts, 9 CLI subcommands + flags, 2 CI workflows (3+1 jobs) + git-hooks |
| error.map.md         | present | 766 diagnostic codes (636 Error / 124 Warning / 6 Info), +13 new this window |
| test.map.md          | present | bun:test, 1194 test files across 9 categories |
| domain.map.md        | present | scrml language primitives (§1-§65+ SPEC navigation), business invariants |
| auth.map.md          | present | scrml:auth/scrml:oauth stdlib + §14.8.9 protect-floor + CSRF + §64.9 headless carve-out |
| infra.map.md         | present | NEW this window — GitHub Actions CI, no Docker/cloud resources |
| api.map.md           | absent (no REST/GraphQL/gRPC surface owned by this repo itself — the compiler EMITS API routes for generated apps, tracked in domain.map.md §60/§61, not this repo's own API) |
| state.map.md         | absent (no redux/zustand/jotai — not a frontend app) |
| events.map.md        | absent (no EventEmitter/pubsub in compiler's own src — §38 channel semantics are a language feature, tracked in domain.map.md) |
| style.map.md         | absent (no tailwind.config/theme.ts in this repo — Tailwind + §65 CSS-native are compiler FEATURES, tracked in domain.map.md + error.map.md) |
| i18n.map.md          | absent (no locales/i18n dirs) |
| migrations.map.md    | absent (`scrml migrate` is a scrml-SOURCE syntax migrator, not a DB schema-migration tool; no migrations/ dir) |
| jobs.map.md          | absent (scrml:cron is a stdlib module FOR GENERATED APPS, not a job system this repo runs itself) |

## File Routing
types / interfaces / AST node shapes        -> schema.map.md
diagnostic codes / error classes            -> error.map.md
environment variables / config keys         -> config.map.md
test patterns / fixtures                    -> test.map.md
build commands / CI stages / CLI flags      -> build.map.md
CI provider / deploy / docker / cloud       -> infra.map.md
directory layout / entry points             -> structure.map.md
external packages / module graph            -> dependencies.map.md
language primitives / SPEC navigation       -> domain.map.md
auth flows / JWT / OAuth / protect-floor    -> auth.map.md
non-compliant / stale docs                  -> non-compliance.report.md

## Key Facts
- Entry point: `compiler/bin/scrml.js` -> `compiler/src/cli.js` dispatches to `commands/*.js`; the actual pipeline is `compileScrml()` in `compiler/src/api.js` (block-split -> AST-build -> type-check -> codegen, ~35 imported pipeline-stage modules).
- The compiler ships TWO parsers side by side: the live pipeline (block-splitter.js + ast-builder.js) and a from-scratch native parser (compiler/native-parser/, 37 paired .js/.scrml files, activated via `--parser=scrml-native`) that also feeds `lsp/handlers.js`'s semantic-tokens provider directly.
- SPEC.md (~35k lines, §1-§65+) is the sole normative source; PIPELINE.md documents the stage-by-stage internals. Any doc contradicting SPEC.md is non-compliant per pa.md Rule 4.
- Two flagship surfaces landed THIS window (137 commits since fbb4d9fd): (1) §20.8 the Client Router / soft navigation — `<outlet>` persistent-shell region + `<a>` link-boost soft-nav (E-OUTLET-*/W-OUTLET-* firing, browser-tested); `<page keep-alive>` cache invalidation (§20.8.4) remains genuinely spec-ahead (no fire site yet). (2) §64.9 `<program kind="tool" serve=PORT>` — a listener-owning headless serve-harness for standalone tools (5 new E-TOOL-SERVE-*/E-TOOL-ROUTE-NEEDS-SERVE codes, all firing).
- A HIGH-severity jwt-auth-bypass regression (2 parser bugs: block-splitter.js comment-scan leak + tokenizer.ts regex-vs-divide misclassification) was found and fixed 2026-07-11; the standing defense-in-depth is api.js's STDLIB-EXPORT-SEED, which now fails CLOSED (defaults async) on any unresolvable server-only `scrml:*` re-export.
- CI was reworked this window from a single `full-suite` job into a 3-job gate-layering model (`gate` blocking = unit+conformance+gauntlet; `tracking` and `windows` non-blocking) plus a new advisory-only AI `/code-review` workflow. A THIRD workflow (`cloud-maps.yml`, scheduled nav-map regen) exists on an unmerged branch (`feat/cloud-maps-beachhead`) — NOT part of this HEAD, see infra.map.md.
- Server/client execution boundary is fully INFERRED from usage (no author annotation); a fail-closed acorn-exact scan (E-CG-001, codegen/egress-field-scan.ts) backstops the §14.8.9 protect-floor against protected-column leaks to the client bundle.
- 21 stdlib modules ship as scrml:* imports, each with BOTH a canonical `.scrml` source (stdlib/<mod>/) and a JS host shim (compiler/runtime/stdlib/<mod>.js).
- Two self-host efforts exist in parallel: compiler/self-host/ (Road-A, hand-authored scrml compiler impl #1, 17 files) and compiler/self-host-v2/ (Road-B, pure-functional lexer rewrite, in progress, 2 files).
- `null` and `undefined` do not exist in scrml source in ANY position (§42) — `not` is the sole absence value; this is a hard compiler rule (E-SYNTAX-042 + W-ABSENCE-IN-SCRML-SOURCE), not a style guideline.
- Pre-commit hook runs the unit+integration+conformance subset (~2min); the FULL suite runs in CI's `tracking`/`windows` jobs and on release-tag pre-push. The CI `gate` job (unit+conformance+gauntlet only) is the actual merge-blocker, deliberately narrower than the full local suite (self-host tests need a locally-built dist that can't be reproduced on a clean CI checkout).

## Tags
#scrml #map #primary #index #compiler #bun #css65 #native-parser #self-host #stdlib #auth #baas #outlet #server-shape #ci #infra

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
- [infra.map.md](./infra.map.md)
- [non-compliance.report.md](./non-compliance.report.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
