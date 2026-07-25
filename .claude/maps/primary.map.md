# primary.map.md
# project: scrml
# updated: 2026-07-25T16:00:00Z  commit: 1c5c2aee
# NOTE (S287): INCREMENTAL refresh, codegen-surface-scoped. This window (`e8fdd44c` -> `1c5c2aee`)
# folds in the chunk-namespacing BUG-6 accessor-rename landing (#180, closes #27) plus Peter's #171-#175
# adopter/codegen fixes. Only the maps that carry codegen/emit MECHANISM were regenerated — primary,
# structure, dependencies (all -> 1c5c2aee). The catalog/config/schema/domain/auth/build/test/infra
# maps were NOT touched: this window added ZERO §34 catalog codes, zero AST node types, zero env vars,
# zero external deps, and no CLI flag. Their older stamps are honest — see the Map Index notes.
# For per-session history, see docs/changelog.md (NOT this file — maps are current-truth navigation, not an archive).

## Project Fingerprint
Language:   TypeScript / JavaScript (mixed) + scrml itself (self-hosting stdlib + self-host compiler experiments)
Framework:  Custom compiler pipeline (no web framework) — Bun-native
Runtime:    Bun >=1.3.13 (no Node support; Bun-specific APIs used throughout)
Type:       CLI compiler + language toolchain (single-file full-stack web-language compiler, with LSP + editor-tooling + MCP surfaces)
Size:       **7053** git-tracked files. `compiler/src/` **184** (141 .ts + 41 .js + 2 other[README.md + unit-cc-exemption-list.json]); `compiler/src/codegen/` **83** (79 .ts + 3 .js + 1 .md); `compiler/native-parser/` 79 (**still ZERO diff — now since `df2ac831`, re-verified at THIS HEAD `1c5c2aee`**); `compiler/tests/` **1246** `*.test.js` (recursive `git ls-files` count). All counts `git ls-files`-derived this pass; cross-check `docs/FACTS.md` (generated, `--check`-gated in CI) for the published figures.
Version:    v0.7.1 (root package.json; compiler/package.json reads 0.2.0 — subpackage drift, longstanding, ignore). No manifest change this window.
Monorepo:   yes — `workspaces: ["compiler"]`; compiler/ is the sole npm workspace member; stdlib/, editors/, lsp/ are NOT npm workspaces but are integral first-party surfaces of the same repo.
CI:         GitHub Actions — `.github/workflows/ci.yml` (gate/tracking/windows) + `advisory-review.yml`. No CI-stage change this window.

## Derived-figure authority
`docs/FACTS.md` is GENERATED (`bun scripts/facts.ts --write`) and CI-gated (`--check` in `gate`).
It is the authority for published counts (compiler LOC, test files, SPEC lines, conformance cases,
stdlib modules, CLI verbs, LSP capabilities, gated snippets). **Do not hardcode any of those figures
in a doc — cite FACTS.md.** Where this map states a count it agrees with FACTS.md at this commit.

## Landings folded in THIS window (`e8fdd44c` -> `1c5c2aee`)

1. **chunk-namespacing BUG-6 accessor-rename (`1c5c2aee`, #180, closes #27) — the flagship.**
   Two route chunks that coexist in one live document no longer clobber each other's runtime-global
   token space (numeric node ids N1, reactive cell-store keys N2, top-level type names N3, engine
   names N4). The arc lands as a per-compilation-unit NAMESPACE keyed on a `fnv1aHash` of the
   PROJECT-ROOT-relative source path (RULED S280/S282), plus a chunk-local cell scope. **Two NEW
   codegen modules:**
   - `codegen/chunk-namespace.ts` (406 L) — owns the token machinery and the module-level namespace
     state: `resolveProjectRoot` (walks up for `scrml.toml` / `.git`; falls back to the FILESYSTEM
     ROOT — a flagged deviation from the S282 hard-error ruling, more-injective not less),
     `chunkNamespaceToken`, `nsId` (`24` -> `"0a1b2c3d_24"`), `nsName`, `nsCellKey` (`"rows"` ->
     `"0a1b2c3d$rows"`), `stripNsName`, `buildCellOwnerMap` (cross-file imported cells key under the
     EXPORTER's token, §51.0), and `assertChunkTokensDistinct` (D2 — a token collision is a HARD
     error, NOT the `E-CG-010` catalog code and NOT a silent miscompile).
   - `codegen/cell-accessor-rename.ts` (200 L) — `renameCellAccessors`, an Acorn-parse + range-SPLICE
     bundle-assembly pass that rewrites every cell-accessor CALL in the assembled chunk BODY from the
     bare runtime name to its chunk-local `_scrml_cs_` wrapper (`_scrml_reactive_get("rows")` ->
     `_scrml_cs_reactive_get("rows")`). The `"rows"` argument stays byte-identical — only the callee
     identifier moves — so the ~1200 tests that pin the bare store key still pass.
   **Wiring is a POST-HOC bundle-assembly pass, not per-emitter edits — NO emitter emits `_scrml_cs_`
   directly** (see Key Facts). `fnv1a-hash.ts` gained a third documented call-site class (the
   chunk-NAMESPACE site, the only one that enforces distinctness). `semdiff.ts` gained
   `canonicalizeChunkNamespaceToken` so two byte-identical programs at different paths do not read
   false-behavioral in the emit-identity compare. Runtime side (`runtime-template.js`) learned to
   accept an ALREADY-namespaced varKey and split the `<token>$` prefix back for slot addressing.
2. **Peter's adopter/codegen fixes #171-#175.** #171 (`deb3722c`) completed the #165 batch-hoist
   fence (full control-transfer set + filler-distance). #172 (`477b0b5d`) — a client side-effect
   between two server calls is a batch boundary (§19.9.9.2). #173 (`b274ed2b`) — no dead client
   destructure for static-component imports (`g-static-component-import-dead-destructure`,
   `component-expander.ts`). #174 (`2d192b6f`) — a reactive `value=` on a form control writes the
   `.value` PROPERTY (`emit-bindings.ts`). #175 (`c8dbd048`) — `bind:value` value-side wiring for
   OUTER/shared reactive cells inside `<each>` (i175, `emit-each.ts`).
3. **Stage 3.055 Tag-Canonicalizer (`aa86fa92`, #155).** NEW top-level `compiler/src/tag-canonicalizer.ts`
   — a capitalized tag (`<Button>`) EMITS what the §15.X registry resolved it to (§4.2/§4.3 casing-
   irrelevant resolution). Imported by `landmark-tag.ts` + `api.js` (Stage 3.055 TC). Not codegen/emit
   internals — noted here only for the file count.

## Landings folded in the PRIOR window (`9481bc69` -> `a0344d75`) — still current surface

1. **ESM-chunks arc U1-U3 — a second client module format.** NEW `codegen/runtime-esm.ts` +
   `codegen/emit-client-esm.ts` + `commands/module-format-notice.js`; CLI flag
   `--module-format=classic|esm` on `compile`/`dev`/`build`. `classic` is the DEFAULT and the only
   conformance-tested path; classic bytes are unchanged by the whole arc. See dependencies.map.md.
2. **#131 each-mount FENCE model** — the `<each>` mount is a `<!--scrml-each:N-->…<!--/scrml-each:N-->`
   comment fence, not an element. Rows are siblings between the anchors (foster-safe). Runtime got a
   range-aware `_scrml_reconcile_list`. The interim `W-EACH-TABLE-FOSTER` lint + module were DELETED.
   NOTE: this window namespaced the fence id via `nsId` — `<!--scrml-each:0a1b2c3d_N-->`.
3. **S280 claim-gate** — `scripts/snippet-gate.js` (CI-required), `scripts/facts.ts` + `docs/FACTS.md`,
   `scripts/claim-gate.js` (MEASURE-mode). See build.map.md.

## Map Index

| Map                  | Stamp | Contents                                                      |
|----------------------|-------|-----------------------------------------------------------------|
| structure.map.md     | **`1c5c2aee`** | directory layout (top 4 levels), 5 entry points, 10 subcommands; recounted 184/83/1246 + the 2 new chunk-ns codegen modules + tag-canonicalizer.ts |
| dependencies.map.md  | **`1c5c2aee`** | 6 runtime + 6 dev deps (**unchanged — chunk-namespacing is first-party, reuses acorn; ZERO new external dep**), compiler pipeline module graph incl. the NEW chunk-namespace stage (rename pass + IIFE hoist + token derivation) |
| build.map.md         | `a0344d75` | 13 npm scripts, 10 CLI subcommands + flags incl. `--module-format`, 2 CI workflows, git hooks, the 3 claim-gate scripts — NOT re-verified; chunk-ns added no CLI flag / npm script / CI stage |
| test.map.md          | `a0344d75` | bun:test, 9 categories — **stated count 1234 is now 1246** (chunk-ns + Peter's fixes added test files); the CATEGORIES/framework are unchanged, so the map body stays valid — NOT regenerated |
| error.map.md         | `a0344d75` | 787 §34 codes — **unchanged: chunk-ns added ZERO catalog codes.** The token-collision guard (`assertChunkTokensDistinct`) is a HARD error but explicitly NOT `E-CG-010` and NOT a §34 code; the nine uncatalogued W-LINT codes still open — NOT re-verified |
| schema.map.md        | `df2ac831` | ~114 AST types/interfaces in types/ast.ts — NOT re-verified; this window added NO AST node type (the namespace is a codegen-time token; `ChunkNamespaceState` is a codegen-internal interface, not an AST shape) |
| config.map.md        | `f079d0a9` | 6 env vars, 3 config files — NOT re-verified; no env-var or config-file shape change this window |
| domain.map.md        | `9481bc69` | scrml language primitives (§1-§65+ SPEC navigation), tenant floor, SSR auto-make-safe, one-landmark + shell composition — NOT re-verified; chunk-namespacing is a codegen MECHANISM (multi-chunk isolation), not a new language primitive |
| auth.map.md          | `df2ac831` | scrml:auth/scrml:oauth stdlib + §14.8.9 protect-floor + CSRF + §64.9 headless carve-out + §20.5 session builtin — NOT re-verified; no auth surface change |
| infra.map.md         | `f079d0a9` | GitHub Actions CI, no Docker/cloud resources — NOT re-verified; no infra change |
| api.map.md           | absent (no REST/GraphQL/gRPC surface owned by this repo itself — the compiler EMITS API routes for generated apps, tracked in domain.map.md §60/§61) |
| state.map.md         | absent (no redux/zustand/jotai — not a frontend app) |
| events.map.md        | absent (no EventEmitter/pubsub in compiler's own src — §38 channel semantics are a language feature) |
| style.map.md         | absent (Tailwind + §65 CSS-native are compiler FEATURES, tracked in domain.map.md + error.map.md) |
| i18n.map.md          | absent (no locales/i18n dirs) |
| migrations.map.md    | absent (`scrml migrate` is a scrml-SOURCE syntax migrator, not a DB schema-migration tool) |
| jobs.map.md          | absent (scrml:cron is a stdlib module FOR GENERATED APPS, not a job system this repo runs) |

An honest older stamp beats a false "verified at HEAD" — every `NOT re-verified` row above is a
decision, made because no file changed this window touches that map's subject.

## Task-Shape Routing

| If your task is about… | Read |
|---|---|
| **chunk namespacing / multi-chunk token isolation (ACTIVE SURFACE, #180)** | `codegen/chunk-namespace.ts` (`nsId` :242, `nsName` :259, `nsCellKey` :383, `chunkNamespaceToken` :162, `resolveProjectRoot` :108, `buildCellOwnerMap` :292, `assertChunkTokensDistinct` :182, `stripNsName` :402) + `codegen/cell-accessor-rename.ts` (`renameCellAccessors` :78, `CS_PREFIX` :48) + `codegen/index.ts` (`CELL_SCOPE_ACCESSORS` :474, `buildCellScopePrologue` :598, `addCellScopePrologue` :638 which calls `renameCellAccessors` :667, `wrapChunkBodyInIife` :683, and the per-file wiring :1243 root-resolve / :1252 distinct-assert / :1290+:1573 state-install / :1969 owner-map / :1973 prologue / :2019 IIFE-wrap) + `semdiff.ts` `canonicalizeChunkNamespaceToken` :686 + `fnv1a-hash.ts` (the shared hash) + `runtime-template.js` (namespaced-key split) — mapped in dependencies.map.md ("chunk-namespace" stage row) + structure.map.md |
| **`<each>` codegen + the runtime list reconciler (ACTIVE SURFACE)** | `codegen/emit-each.ts` (`emitEachMountHtml` :385 = the `<!--scrml-each:${nsId(N)}-->` fence — NOTE the id is now NAMESPACED; `emitEachReconcileLines`; the i175 per-item `bind:*` value-side wiring :1539/:1997; the nested-each runtime `<div>` at :1095) + `runtime-template.js` (`_scrml_reconcile_list` :1652 range-aware, `_scrml_find_each_anchor` :1989, `_scrml_each_end` :1963, `_scrml_each_clear` :2006, `_scrml_each_append` :2019, `_scrml_remount_each` :2131) + `codegen/emit-ssr-render.ts` (fence fill) — mapped in dependencies.map.md ("each mount fence" row) + structure.map.md |
| **chunk / module-format emit (ACTIVE SURFACE)** | `codegen/runtime-esm.ts` (`toEsmRuntime` :304) + `codegen/emit-client-esm.ts` (`toEsmClientChunk` :270) + `codegen/index.ts` (:852 `type="module"`, :2019 the classic-only IIFE hoist, the esm-vs-classic tag split, the per-route chunk transform) + `codegen/runtime-chunks.ts` / `route-splitter.ts` + `api.js` `rewriteChunkImportRefs` + `commands/module-format-notice.js` — mapped in dependencies.map.md ("ESM chunks" row) + build.map.md (`--module-format` flag) |
| cross-file `<script src>` depth / dist-relative refs | `codegen/index.ts` `computeDependencyClientScripts` (both sides via `toDistRel()`) + `codegen/utils.ts` `stripPagesPrefix` — 3 OPEN gaps on this surface, see non-compliance.report.md |
| batch-hoist / server-call fencing (§19.9.9.2) | `codegen/emit-server.ts` + `codegen/scheduling.ts` (Peter #171/#172 — control-transfer set + filler-distance + client-side-effect boundary) |
| types / interfaces / AST node shapes | schema.map.md |
| diagnostic codes / error classes | error.map.md |
| environment variables / config keys | config.map.md |
| test patterns / fixtures | test.map.md |
| build commands / CI stages / CLI flags | build.map.md |
| public-claim gates (snippets, derived figures) | build.map.md (the three scripts + CI wiring); `docs/FACTS.md` is the figure authority |
| CI provider / deploy / docker / cloud | infra.map.md |
| directory layout / entry points | structure.map.md |
| external packages / module graph | dependencies.map.md |
| language primitives / SPEC navigation | domain.map.md |
| outlet / `<main>` landmark / MPA shell composition | domain.map.md (four-case table) + error.map.md (E-OUTLET-AND-MAIN) + dependencies.map.md |
| tenant-row isolation floor (§14.8.10) | domain.map.md + error.map.md (E-TENANT-*/I-TENANT-*) + dependencies.map.md (tenant-egress.ts) |
| SSR auto-make-safe (§52.15.5) / sql-lex | domain.map.md + error.map.md + dependencies.map.md |
| colorless-async classification (Q1/Q2) | dependencies.map.md (mechanism) + error.map.md (E-ASYNC-STDLIB-IN-SYNC-CALLBACK + the discard-HOF narrowing) |
| content-hash / cache-header build contract | build.map.md (mechanism) + domain.map.md (§47.9.8 concept) |
| auth flows / JWT / OAuth / protect-floor | auth.map.md |
| non-compliant / stale docs | non-compliance.report.md |

## Key Facts
- Entry point: `compiler/bin/scrml.js` -> `compiler/src/cli.js` dispatches to `commands/*.js` (10 subcommands); the pipeline is `compileScrml()` in `compiler/src/api.js` (block-split -> AST-build -> type-check -> codegen).
- **Chunk namespacing is a POST-HOC bundle-assembly pass — NO emitter emits `_scrml_cs_` or a namespaced token directly.** `renameCellAccessors` (`cell-accessor-rename.ts`) PARSES the assembled chunk body with Acorn and range-SPLICES every cell-accessor CALL to its chunk-local `_scrml_cs_` wrapper; a prologue built by `buildCellScopePrologue` (`codegen/index.ts:598`) then DEFINES those wrappers, each delegating to the real runtime accessor via an inlined `_scrml_cs_key`. This runs on the BODY before the prologue is prepended (ordering is load-bearing — else the prologue's own real-accessor refs would be renamed). The distinct callee name means no shadow, no TDZ. If you add an emitter that mints a cell-accessor call, it is covered BY CONSTRUCTION; if you pass an accessor as a VALUE (not a callee), `valueReferences` catches it. The `nsId`/`nsName`/`nsCellKey` helpers namespace ids/DOM markers/store keys and RETURN THE BARE VALUE when no namespace is installed, so synthetic unit tests see today's output.
- The namespace token is `fnv1aHash(project-root-relative source path)` — 8-char lowercase base36, **always starting with `0`** (32-bit u32 never fills the 8th base36 digit). Shape-match tokens with `0[0-9a-z]{7}`, never `[0-9a-z]{8}`. A token COLLISION is a hard compile error (`assertChunkTokensDistinct`), explicitly NOT the `E-CG-010` catalog code.
- The classic client chunk body is wrapped in an IIFE (`wrapChunkBodyInIife`, `codegen/index.ts:683`, NEW #180) so its top-level `const`/`function` are chunk-local; `import`/`export` + `_scrml_modules[...]=` registrations are hoisted OUTSIDE the wrap. Gated on `moduleFormat !== "esm"` (esm already has module scope) and skipped under `--embed-runtime`.
- **The `<each>` mount is a COMMENT FENCE with a NAMESPACED id.** `<!--scrml-each:0a1b2c3d_N-->…<!--/scrml-each:0a1b2c3d_N-->`, rows as siblings. `querySelector` cannot see it — every locator is a SHOW_COMMENT TreeWalker (`_scrml_find_each_anchor`). Any code/test/doc expecting `[data-scrml-each-mount]` for a TOP-LEVEL each is describing the retired model; the attribute survives only on the NESTED-each runtime `<div>` mount.
- **`<outlet>` is NOT a dedicated AST node.** It is an ordinary `kind: "markup"` node with `tag: "outlet"` — and so is `<main>`. Every consumer matches structurally; a pass expecting a typed node silently finds nothing.
- **The one-landmark invariant (§20.8.1.1) is enforced across THREE files** communicating only through the emitted `data-scrml-outlet` marker: `codegen/emit-html.ts`, `codegen/index.ts` (§40.8.2 composition slot), `symbol-table.ts` PASS 15.5 (`E-OUTLET-AND-MAIN`). The MARKER, never the tag, identifies the slot.
- **Confidentiality is four orthogonal axes (§52.15.4)** — route-admission ⟂ tenant-scope (§14.8.10) ⟂ per-user row-selection (§52.15.3) ⟂ column-redaction (§14.8.9). Two compiler-enforced FLOORS: the column floor (E-CG-001, acorn-exact) and the tenant-row floor (`codegen/tenant-egress.ts`).
- **`codegen/sql-lex.ts` is the single source of truth for LIVE-vs-INERT `${}` inside `?{}` SQL**, imported by exactly two modules (`collect.ts`, `rewrite.ts`). Do not add a second interpolation scanner.
- **`fnv1a-hash.ts` now has THREE call-site classes** (§47.1.3 per-binding type-encoding, §47.5 per-chunk content-address, and the chunk-NAMESPACE token) — the shape is normative; do not modify without a SPEC amendment.
- SPEC.md (36,114 lines, §1-§65+) is the sole normative source; PIPELINE.md documents stage internals. Any doc contradicting SPEC.md is non-compliant per pa.md Rule 4.
- Server/client execution boundary is fully INFERRED from usage (no author annotation; a `session` reference is a server-escalation trigger); a fail-closed acorn-exact scan (E-CG-001) backstops the §14.8.9 protect-floor.
- 21 stdlib modules ship as `scrml:*` imports, each with BOTH a canonical `.scrml` source (stdlib/) and a JS host shim (compiler/runtime/stdlib/). Two self-host efforts run in parallel (compiler/self-host/, compiler/self-host-v2/).
- `null` and `undefined` do not exist in scrml source in ANY position (§42) — `not` is the sole absence value (E-SYNTAX-042 + W-ABSENCE-IN-SCRML-SOURCE).
- The compiler ships TWO parsers: the live pipeline (block-splitter.js + ast-builder.js) and `compiler/native-parser/` (`--parser=scrml-native`, also feeding the LSP semantic-tokens provider). **native-parser/ has had ZERO diff since `df2ac831`, re-verified at `1c5c2aee`** — the chunk-namespace machinery is emit-layer only and carries no native-parser parity obligation.

## Tags
#scrml #map #primary #index #compiler #bun #chunk-namespace #cell-accessor-rename #cs-prefix #ns-token #fnv1a #iife-hoist #esm-chunks #module-format #each-fence #foster-safe #batch-hoist #bind-value #claim-gate #facts-gate #css65 #native-parser #self-host #stdlib #auth #outlet #one-landmark #shell-composition #server-shape #semdiff #ci #infra #content-hash #colorless-async #tenant-floor #ssr-auto-make-safe #sql-lex #confidentiality-axes

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
