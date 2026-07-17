# primary.map.md
# project: scrml
# updated: 2026-07-17T14:48:56-06:00  commit: 0a79d838
# For per-session history, see docs/changelog.md (NOT this file — maps are current-truth navigation, not an archive).

## Project Fingerprint
Language:   TypeScript / JavaScript (mixed) + scrml itself (self-hosting stdlib + self-host compiler experiments)
Framework:  Custom compiler pipeline (no web framework) — Bun-native
Runtime:    Bun >=1.3.13 (no Node support; Bun-specific APIs used throughout)
Type:       CLI compiler + language toolchain (single-file full-stack web-language compiler, with LSP + editor-tooling + MCP surfaces)
Size:       6791 git-tracked files total; compiler/src/ 173 files (131 .ts + 40 .js + 2 other), compiler/native-parser/ 79 files (37 paired .js/.scrml + 5 planning docs), compiler/tests/ 1194+ *.test.js
Version:    v0.7.1 (root package.json; compiler/package.json reads 0.2.0 — subpackage drift, longstanding, ignore)
Monorepo:   yes — `workspaces: ["compiler"]`; compiler/ is the sole npm workspace member; stdlib/, editors/, lsp/ are NOT npm workspaces but are integral first-party surfaces of the same repo.
CI:         GitHub Actions — `.github/workflows/ci.yml` (gate/tracking/windows) + `advisory-review.yml` (advisory AI /code-review).

## Watermark note
This is an INCREMENTAL_UPDATE stamped to the S264 HEAD (0a79d838). The PRIOR watermark was f079d0a9
(S255) — NOT S263. This pass mapped only the four S264 compiler-source PRs (semdiff #6b, E-SQL-004,
E-SQL-003, E-MARKUP-001) + recomputed the diagnostic count and file counts to true-current. The latent
S256-S263 source delta (§12.4 E-ROUTE-002/E-ROUTE-005 in route-inference.ts, cross-OS path-canonical.js,
block-splitter/type-system churn, the §34 catalog cleanup) is reflected in the counts but was NOT
individually re-mapped — a full or NON_COMPLIANCE_ONLY refresh is advisable at the next wrap.

## Map Index

| Map                  | Status  | Contents                                                      |
|----------------------|---------|-----------------------------------------------------------------|
| structure.map.md     | present | directory layout (top 4 levels), 5 entry points, 10 subcommands |
| dependencies.map.md  | present | 6 runtime + 6 dev deps, compiler pipeline module graph, 21 stdlib module pairing |
| schema.map.md        | present | ~114 AST types/interfaces in types/ast.ts, grouped by concern |
| config.map.md        | present | 6 env vars, 3 config files (no .env.example in repo) |
| build.map.md         | present | 13 npm scripts, 10 CLI subcommands + flags (semdiff NEW S264), 2 CI workflows + git-hooks |
| error.map.md         | present | 775 diagnostic codes (641 Error / 127 Warning / 7 Info); S264 wired E-SQL-003/E-SQL-004/E-MARKUP-001 to firing |
| test.map.md          | present | bun:test, 1194+ test files across 9 categories |
| domain.map.md        | present | scrml language primitives (§1-§65+ SPEC navigation), business invariants |
| auth.map.md          | present | scrml:auth/scrml:oauth stdlib + §14.8.9 protect-floor + CSRF + §64.9 headless carve-out |
| infra.map.md         | present | GitHub Actions CI, no Docker/cloud resources |
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
semantic-diff / semdiff / #6b classifier    -> error.map.md (consuming surface) + build.map.md (CLI)
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
- Entry point: `compiler/bin/scrml.js` -> `compiler/src/cli.js` dispatches to `commands/*.js` (10 subcommands, `semdiff` added S264); the actual pipeline is `compileScrml()` in `compiler/src/api.js` (block-split -> AST-build -> type-check -> codegen, ~35 imported pipeline-stage modules).
- NEW S264 surface: `scrml semdiff <base> <head> [--json]` — the #6b P0 semantic-diff primitive. `compiler/src/semdiff.ts` (pure, unit-tested) classifies a base-vs-head change by AXIS (opaque/source/use-site/context) + soundness TIER (0 proven-cosmetic / 2 behavioral), never a boolean "safe"; opaque regions (foreign `_{}`, unresolved import, dynamic dispatch) are forced Tier-2. Exit 0=cosmetic · 1=behavioral · 2=failed-to-compile (fail-closed). Consumers: giti MERGE, flogence REVIEW. Design DD in scrml-support/docs/deep-dives/.
- S264 also moved three NAMED diagnostics to FIRING (no new catalog rows): E-MARKUP-001 (§4.1, name-resolver.ts gate + the new `isKnownElementName` HTML∪SVG∪MathML∪custom union in html-elements.js), E-SQL-003 (§8.1.1, ast-builder.js runtime-expr `?{}` body), E-SQL-004 (§44.7, emit-server.ts/emit-tool.ts `?{}`-without-`db=` fail-closed gate). ast-builder.js gained two exports — `STRUCTURAL_ELEMENT_PLACEMENT` + `RESERVED_CSS_ELEMENT_IDENTIFIERS` — that name-resolver DERIVES its `SCRML_NON_ELEMENT_TAGS` exclusion from.
- The compiler ships TWO parsers side by side: the live pipeline (block-splitter.js + ast-builder.js) and a from-scratch native parser (compiler/native-parser/, 37 paired .js/.scrml files, activated via `--parser=scrml-native`) that also feeds `lsp/handlers.js`'s semantic-tokens provider directly.
- SPEC.md (~35k lines, §1-§65+) is the sole normative source; PIPELINE.md documents the stage-by-stage internals. Any doc contradicting SPEC.md is non-compliant per pa.md Rule 4.
- Server/client execution boundary is fully INFERRED from usage (no author annotation); a fail-closed acorn-exact scan (E-CG-001, codegen/egress-field-scan.ts) backstops the §14.8.9 protect-floor against protected-column leaks to the client bundle. §12.4 E-ROUTE-002/E-ROUTE-005 (route-inference.ts, S263) close two client/server boundary soundness holes.
- 21 stdlib modules ship as scrml:* imports, each with BOTH a canonical `.scrml` source (stdlib/<mod>/) and a JS host shim (compiler/runtime/stdlib/<mod>.js). Two self-host efforts run in parallel: compiler/self-host/ (Road-A, 17 files) and compiler/self-host-v2/ (Road-B, in progress).
- `null` and `undefined` do not exist in scrml source in ANY position (§42) — `not` is the sole absence value; this is a hard compiler rule (E-SYNTAX-042 + W-ABSENCE-IN-SCRML-SOURCE), not a style guideline.
- CI is a 3-job gate-layering model (`gate` blocking = unit+conformance+gauntlet; `tracking` + `windows` non-blocking) plus an advisory-only AI `/code-review` workflow. A THIRD workflow (`cloud-maps.yml`, scheduled nav-map regen) exists on an unmerged branch — NOT part of this HEAD, see build.map.md / infra.map.md.
- Pre-commit hook runs the unit+integration+conformance subset (~2min); the FULL suite runs in CI's `tracking`/`windows` jobs and on release-tag pre-push. The CI `gate` job (unit+conformance+gauntlet only) is the actual merge-blocker, deliberately narrower than the full local suite (self-host tests need a locally-built dist that can't be reproduced on a clean CI checkout).

## Tags
#scrml #map #primary #index #compiler #bun #css65 #native-parser #self-host #stdlib #auth #baas #outlet #server-shape #semdiff #ci #infra

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
