# primary.map.md
# project: scrml
# updated: 2026-07-18T03:27:22-06:00  commit: c779e606
# For per-session history, see docs/changelog.md (NOT this file — maps are current-truth navigation, not an archive).

## Project Fingerprint
Language:   TypeScript / JavaScript (mixed) + scrml itself (self-hosting stdlib + self-host compiler experiments)
Framework:  Custom compiler pipeline (no web framework) — Bun-native
Runtime:    Bun >=1.3.13 (no Node support; Bun-specific APIs used throughout)
Type:       CLI compiler + language toolchain (single-file full-stack web-language compiler, with LSP + editor-tooling + MCP surfaces)
Size:       6852 git-tracked files total (up from 6791 at the 0a79d838/S264 watermark; +61 this window — 1 new compiler/src file, 6 new test files, 8 new conformance/style/ cases, 2 new docs/changes/ dispatch dirs, handOffs/spa-lists bookkeeping); compiler/src/ 174 files (132 .ts + 40 .js + 2 other; +1 = codegen/emit-theme-reset.ts), compiler/native-parser/ 79 files (37 paired .js/.scrml + 5 planning docs, unchanged), compiler/tests/ 1200+ *.test.js (+6 this window)
Version:    v0.7.1 (root package.json; compiler/package.json reads 0.2.0 — subpackage drift, longstanding, ignore)
Monorepo:   yes — `workspaces: ["compiler"]`; compiler/ is the sole npm workspace member; stdlib/, editors/, lsp/ are NOT npm workspaces but are integral first-party surfaces of the same repo.
CI:         GitHub Actions — `.github/workflows/ci.yml` (gate/tracking/windows) + `advisory-review.yml` (advisory AI /code-review). Unchanged this window.

## Watermark note
This is an INCREMENTAL_UPDATE stamped to the S265 HEAD (c779e606). The PRIOR watermark was 0a79d838
(S264). This pass mapped the FIVE S265 source-PRs on the changed-surface list: #96 (adopter #82 —
content-hash page bundles/CSS + precise cache headers on both serve paths), #97 (adopter #29-D —
bare `disabled=@var` now routes into the reactive bool-attr binding instead of emitting a static
attribute), #100 (adopter #27 — §20.8.3 link-boost: delegated `<a href>` soft-nav click
interception, the piece that makes "internal links soft-navigate by default" actually true), plus
two files from bryan's concurrent CSS work that this pass's routing touched directly: #95 (CSS
Wave-1 EMISSION — the SPEC §65 status banner flipped from "Nominal/spec-ahead except the
conflict-checker" to "Wave-1 emission LANDED"; NEW file `codegen/emit-theme-reset.ts`; NEW
diagnostic `E-THEME-TOKEN-UNKNOWN`; a NEW `@`-sigil use-site syntax for theme-token/reactive-cell
CSS references) and #98 (a CSS-var-bridge bugfix — `document.documentElement`, not an unbuilt
`_scrml_el`). The other CSS Wave-1 internals (emit-css.ts's `:where()`-flat / `@layer` emission
details, component-expander.ts's `#{}` masking) were NOT independently deep-dived this pass beyond
what the touched-map routing required — treat as covered-by-reference via domain.map.md's status
banner, not exhaustively re-derived. The latent S256-S263 delta noted at the S264 watermark remains
unmapped; a full or NON_COMPLIANCE_ONLY refresh is still advisable at the next wrap.

## Map Index

| Map                  | Status  | Contents                                                      |
|----------------------|---------|-------------------------------------------------------------------|
| structure.map.md     | present | directory layout (top 4 levels), 5 entry points, 10 subcommands; codegen/ 76 files (+1, emit-theme-reset.ts) |
| dependencies.map.md  | present | 6 runtime + 6 dev deps (unchanged), compiler pipeline module graph (+ emit-theme-reset.ts row), 21 stdlib module pairing |
| schema.map.md        | present | ~114 AST types/interfaces in types/ast.ts; attribute-registry.js line refs re-verified (+11 shift from the new `reset` attr) |
| config.map.md        | present | 6 env vars, 3 config files (unchanged this window) |
| build.map.md         | present | 13 npm scripts, 10 CLI subcommands + flags, 2 CI workflows + git-hooks; NEW S265: content-hash asset naming + cache-header contract (adopter #82) |
| error.map.md         | present | 776 diagnostic codes (+1 this window, E-THEME-TOKEN-UNKNOWN — see caveat in the map re: baseline-count methodology) |
| test.map.md          | present | bun:test, 1200 test files across 9 categories (+6 this window) |
| domain.map.md        | present | scrml language primitives (§1-§65+ SPEC navigation); §65 CSS Wave-1 emission LANDED + §20.8.3 link-boost LANDED this window |
| auth.map.md          | present | scrml:auth/scrml:oauth stdlib + §14.8.9 protect-floor + CSRF + §64.9 headless carve-out (unchanged this window) |
| infra.map.md         | present | GitHub Actions CI, no Docker/cloud resources (unchanged this window) |
| api.map.md           | absent (no REST/GraphQL/gRPC surface owned by this repo itself — the compiler EMITS API routes for generated apps, tracked in domain.map.md §60/§61, not this repo's own API) |
| state.map.md         | absent (no redux/zustand/jotai — not a frontend app) |
| events.map.md        | absent (no EventEmitter/pubsub in compiler's own src — §38 channel semantics are a language feature, tracked in domain.map.md) |
| style.map.md         | absent (no tailwind.config/theme.ts in THIS repo — Tailwind + §65 CSS-native are compiler FEATURES, tracked in domain.map.md + error.map.md; §65 emission landing this window does not change this — scrml itself still ships no theme.ts) |
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
content-hash / cache-header build contract  -> build.map.md (mechanism) + domain.map.md (§47.9.8 concept)
CI provider / deploy / docker / cloud       -> infra.map.md
directory layout / entry points             -> structure.map.md
external packages / module graph            -> dependencies.map.md
language primitives / SPEC navigation       -> domain.map.md
CSS §65 Wave-1 emission / theme tokens      -> domain.map.md (status) + schema.map.md (registry) + error.map.md (E-THEME-TOKEN-UNKNOWN)
Client Router / outlet / link-boost         -> domain.map.md
auth flows / JWT / OAuth / protect-floor    -> auth.map.md
non-compliant / stale docs                  -> non-compliance.report.md

## Key Facts
- Entry point: `compiler/bin/scrml.js` -> `compiler/src/cli.js` dispatches to `commands/*.js` (10 subcommands); the actual pipeline is `compileScrml()` in `compiler/src/api.js` (block-split -> AST-build -> type-check -> codegen, ~35 imported pipeline-stage modules).
- **NEW S265 — `scrml build` content-addresses page bundles/CSS and both `scrml build`'s generated `_server.js` AND `scrml dev` now send precise cache headers** (immutable-by-exact-set-membership for hashed assets, `no-cache` for HTML, weak-ETag-revalidation for everything else). `compileScrml()` gained a `contentHashAssets` option (off by default; `scrml build` turns it on); `generateServerEntry()`'s signature gained a 4th `hashedAssets` param. See build.map.md.
- **NEW S265 — `<a href>` internal links now actually soft-navigate by default** (§20.8.3 link-boost): a delegated document-level click listener in `compiler/src/runtime-template.js`, boot-wired only on a `<program>` shell with an `<outlet>` (`fileHasOutlet` in emit-reactive-wiring.ts, now exported). `<a href hard>` opts a specific link out. Progressive-enhancement guards mean every non-plain-internal-link case (modified click, `target≠_self`, `download`, `rel=external`, non-http(s), cross-origin, hash-only, same-location) still falls through to native navigation.
- **NEW S265 — the §65 CSS-native model's SPEC status banner flipped** from "Nominal (spec-ahead), except the conflict-checker" to "Wave-1 emission LANDED, Waves 2-3 Nominal". A NEW file `compiler/src/codegen/emit-theme-reset.ts` owns `<theme>` token → `:root` custom-property lowering, the built-in `reset` `@layer` (opt-out `<program reset="none">`), and the runtime theme-switch reflection. A theme-token USE-SITE reference now requires the `@` sigil (`color: @brand`), disambiguating it from the pre-existing §25 reactive-CSS-var cell bridge and from a literal CSS keyword; unresolvable references fire the NEW `E-THEME-TOKEN-UNKNOWN`.
- The compiler ships TWO parsers side by side: the live pipeline (block-splitter.js + ast-builder.js) and a from-scratch native parser (compiler/native-parser/, activated via `--parser=scrml-native`) that also feeds `lsp/handlers.js`'s semantic-tokens provider directly.
- SPEC.md (~35k lines, §1-§65+) is the sole normative source; PIPELINE.md documents the stage-by-stage internals. Any doc contradicting SPEC.md is non-compliant per pa.md Rule 4.
- Server/client execution boundary is fully INFERRED from usage (no author annotation); a fail-closed acorn-exact scan (E-CG-001, codegen/egress-field-scan.ts) backstops the §14.8.9 protect-floor against protected-column leaks to the client bundle.
- 21 stdlib modules ship as scrml:* imports, each with BOTH a canonical `.scrml` source (stdlib/<mod>/) and a JS host shim (compiler/runtime/stdlib/<mod>.js). Two self-host efforts run in parallel: compiler/self-host/ (Road-A, 17 files) and compiler/self-host-v2/ (Road-B, in progress).
- `null` and `undefined` do not exist in scrml source in ANY position (§42) — `not` is the sole absence value; this is a hard compiler rule (E-SYNTAX-042 + W-ABSENCE-IN-SCRML-SOURCE), not a style guideline.
- CI is a 3-job gate-layering model (`gate` blocking = unit+conformance+gauntlet; `tracking` + `windows` non-blocking) plus an advisory-only AI `/code-review` workflow; unchanged this window (S265 was source+test only, no workflow file touched). A THIRD workflow (`cloud-maps.yml`) exists on an unmerged branch — NOT part of this HEAD.

## Tags
#scrml #map #primary #index #compiler #bun #css65 #native-parser #self-host #stdlib #auth #baas #outlet #server-shape #semdiff #ci #infra #content-hash #link-boost #css-wave1 #theme-token

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
