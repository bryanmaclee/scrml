# primary.map.md
# project: scrml
# updated: 2026-07-22T22:00:00Z  commit: e8fdd44c
# NOTE (S282): content-verified current, not regenerated. The map files were refreshed inside the
# d3e961de (#141) landing, so they already reflect that codegen change; the only commits after it
# (1531b341, e8fdd44c) are test-only. ESM-arc coverage spot-checked present: runtime-esm,
# emit-client-esm, module-format, snippet-gate, facts.ts, FACTS.md. The S280 hand-off's claim that
# this map 'cannot see' those was true when written and is now stale.
# For per-session history, see docs/changelog.md (NOT this file — maps are current-truth navigation, not an archive).

## Project Fingerprint
Language:   TypeScript / JavaScript (mixed) + scrml itself (self-hosting stdlib + self-host compiler experiments)
Framework:  Custom compiler pipeline (no web framework) — Bun-native
Runtime:    Bun >=1.3.13 (no Node support; Bun-specific APIs used throughout)
Type:       CLI compiler + language toolchain (single-file full-stack web-language compiler, with LSP + editor-tooling + MCP surfaces)
Size:       **6995** git-tracked files. `compiler/src/` **181** (138 .ts + 41 .js + 2 other); `compiler/src/codegen/` **81** (77 .ts + 3 .js + 1 .md); `compiler/native-parser/` 79 (**still ZERO diff — now since `df2ac831`, re-verified at this HEAD**); `compiler/tests/` **1234** `*.test.js` (recursive count — the prior map's 1229 used a single-level glob that missed the 14 top-level `parser-conformance*.test.js`; the true figure at `9481bc69` was 1230). All counts `git ls-files`-derived this pass and cross-checked against `docs/FACTS.md` (generated, `--check`-gated in CI).
Version:    v0.7.1 (root package.json; compiler/package.json reads 0.2.0 — subpackage drift, longstanding, ignore). No manifest change this window.
Monorepo:   yes — `workspaces: ["compiler"]`; compiler/ is the sole npm workspace member; stdlib/, editors/, lsp/ are NOT npm workspaces but are integral first-party surfaces of the same repo.
CI:         GitHub Actions — `.github/workflows/ci.yml` (gate/tracking/windows) + `advisory-review.yml`. **`gate` GAINED two steps this window**: `bun scripts/snippet-gate.js` and `bun scripts/facts.ts --check`.

## Derived-figure authority
`docs/FACTS.md` is GENERATED (`bun scripts/facts.ts --write`) and CI-gated (`--check` in `gate`).
It is the authority for published counts (compiler LOC, test files, SPEC lines, conformance cases,
stdlib modules, CLI verbs, LSP capabilities, gated snippets). **Do not hardcode any of those figures
in a doc — cite FACTS.md.** Where this map states a count it agrees with FACTS.md at this commit.

## Landings folded in since the prior stamp (`9481bc69` -> `a0344d75`)

1. **ESM-chunks arc U1–U3 (`970d3e1f`, `62f2cf4f`, `5385091e`) — a second client module format.**
   NEW `compiler/src/codegen/runtime-esm.ts` (U1 — turns the assembled classic runtime string into
   an ES module: `^{}` dep-tracking routed through a `globalThis.__scrml_reactive_get_override` slot,
   redeclare-guard simplification, an Acorn-derived `export { … }` surface over the POST-SLICE
   top-level decls) and NEW `compiler/src/codegen/emit-client-esm.ts` (U2 — turns a classic client
   chunk into an ES module: the `_scrml_modules` registration footer becomes `export {…}`, the
   registry-read header becomes a NAMESPACE import `import * as __scrml_dep_0 from "./dep.client.js"`
   + destructure, plus a runtime import of `(runtime-slice exports ∩ chunk idents) − own decls`).
   NEW `compiler/src/commands/module-format-notice.js`. U3 = `type="module"` on the emitted
   `<script>` tags (`emit-html.ts:4052`, `codegen/index.ts:852`) + build-path content-hash rewriting
   of in-chunk import URLs (`api.js` `rewriteChunkImportRefs`, esm-gated).
   **NEW CLI flag `--module-format=classic|esm` on `compile`, `dev` and `build`. `classic` is the
   DEFAULT and the only conformance-tested path**; classic bytes are unchanged by the whole arc.
   Selecting esm prints an operational stderr notice keyed `W-MODULE-FORMAT-ESM-INCOMPLETE` —
   deliberately NOT a §34 catalog code and never in the diagnostic stream.
2. **#131 each-mount FENCE model (`df6d269c`) — the `<each>` mount is no longer an element.**
   `emitEachMountHtml` (`codegen/emit-each.ts:371`) now emits `<!--scrml-each:N--><!--/scrml-each:N-->`
   instead of `<div data-scrml-each-mount="each_N"></div>`. Rows are inserted as SIBLINGS between the
   anchors, so the mount survives `<table>`/`<tbody>` foster-parenting and the `<select>` "in select"
   drop. Runtime side (`compiler/src/runtime-template.js`): NEW `_scrml_find_each_anchor` (:1989,
   memoized SHOW_COMMENT walk), `_scrml_each_end` (:1963), `_scrml_each_clear` (:2006),
   `_scrml_each_append` (:2019); `_scrml_reconcile_list` (:1652) is now RANGE-AWARE
   (`container.nodeType === 8` → operate over the fence sibling range, else delegate to the element
   path). SSR fills between the fences (`emit-ssr-render.ts`). **The interim `W-EACH-TABLE-FOSTER`
   lint and its module `compiler/src/lint-w-each-table-foster.js` are DELETED**; api.js Stage 6.4f
   is retired. A NESTED each still builds a runtime `<div>` mount (`emit-each.ts:1041`) — separate
   open gap `g-nested-each-div-mount-in-restricted-parent`.
3. **S280 claim-gate (`7caf8f34`, `8ade2355`, `f681a777`, `a0344d75`).** NEW `scripts/snippet-gate.js`
   (compiles every `.scrml` in the declared public corpus — `docs/tutorial-snippets/`,
   `docs/readme-snippets/`; 12 files today), NEW `scripts/facts.ts` + generated `docs/FACTS.md`,
   NEW `scripts/claim-gate.js` (fenced-block gate over a declared public surface; MEASURE-mode by
   design, not yet in CI). `scripts/extract-readme-scrml.js` DELETED; `scripts/git-hooks/pre-push`
   re-pointed to snippet-gate.
4. **Cross-file dep-script depth fix (`38aec2a9`).** `computeDependencyClientScripts`
   (`codegen/index.ts`) now routes BOTH the dep and the entry dist path through `toDistRel()`, so the
   `pages/` strip is modelled symmetrically; every cross-file `<script src>` on a nested route was
   one `../` too deep and escaped the dist root — in CLASSIC, the default path. Three pre-existing
   HIGH/MED gaps were filed on the same surface and remain OPEN (see non-compliance.report.md).
5. **README flagship reconciliation (`2e7a32e3`)** — 7 README-vs-SPEC contradictions closed; the
   example now lives as a REAL file `docs/readme-snippets/tasks-app.scrml` under the snippet gate.
6. **E-ASYNC-STDLIB-IN-SYNC-CALLBACK over-fire narrowed (`ea4c720a`)** — a `KNOWN_DISCARD_HOF` set
   (`setTimeout`/`setInterval`/`setImmediate`/`queueMicrotask`/…) in the colorless-async backstop:
   a HOF that structurally discards its callback's return no longer fires the code.
7. **SPEC §5 five-door markup-value partition + the corrected `E-STYLE-001` §34 row (S279/S280).**

## Map Index

| Map                  | Stamp | Contents                                                      |
|----------------------|-------|-----------------------------------------------------------------|
| structure.map.md     | **`a0344d75`** | directory layout (top 4 levels), 5 entry points, 10 subcommands; recounted 181/81/1234 + the 3 new codegen/command modules + the 1 deletion |
| dependencies.map.md  | **`a0344d75`** | 6 runtime + 6 dev deps (**unchanged — the whole ESM arc is first-party, zero new external dep**), compiler pipeline module graph incl. the NEW ESM emit stage and the each-FENCE stage; the foster-lint row REMOVED |
| build.map.md         | **`a0344d75`** | 13 npm scripts, 10 CLI subcommands + flags incl. the NEW `--module-format`, 2 CI workflows (+2 new gate steps), git hooks, the 3 claim-gate scripts |
| test.map.md          | **`a0344d75`** | bun:test, 9 categories, **1234** files (recursive); +5 new / −1 deleted this window |
| error.map.md         | **`a0344d75`** | 787 §34 codes (unchanged — the ESM arc and the fence model added ZERO catalog codes); W-EACH-TABLE-FOSTER RETIRED; the E-STYLE-001 row defect RESOLVED; the nine uncatalogued W-LINT codes still open |
| schema.map.md        | `df2ac831` | ~114 AST types/interfaces in types/ast.ts — NOT re-verified; this window added no AST node type (the fence is an emit-string change; `moduleFormat` is a codegen INPUT option, `codegen/index.ts:156`) |
| config.map.md        | `f079d0a9` | 6 env vars, 3 config files — NOT re-verified; no env-var or config-file shape change this window |
| domain.map.md        | `9481bc69` | scrml language primitives (§1-§65+ SPEC navigation), tenant floor, SSR auto-make-safe, one-landmark + shell composition — NOT re-verified at HEAD; SPEC §5 gained the five-door markup-value partition, not yet folded in |
| auth.map.md          | `df2ac831` | scrml:auth/scrml:oauth stdlib + §14.8.9 protect-floor + CSRF + §64.9 headless carve-out + §20.5 session builtin — NOT re-verified; no auth surface change |
| infra.map.md         | `f079d0a9` | GitHub Actions CI, no Docker/cloud resources — NOT re-verified; see build.map.md for the two new gate steps |
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
| **`<each>` codegen + the runtime list reconciler (ACTIVE SURFACE)** | `codegen/emit-each.ts` (`emitEachMountHtml` :371 = the `<!--scrml-each:N-->` fence; `emitEachReconcileLines`; the nested-each runtime `<div>` at :1041) + `runtime-template.js` (`_scrml_reconcile_list` :1652 range-aware, `_scrml_find_each_anchor` :1989, `_scrml_each_end` :1963, `_scrml_each_clear` :2006, `_scrml_each_append` :2019, `_scrml_remount_each` :2131) + `codegen/emit-ssr-render.ts` (fence fill) — mapped in dependencies.map.md ("each mount fence" row) + structure.map.md; regression pin `compiler/tests/unit/each-mount-fence-foster-safe.test.js` |
| **chunk / module-format emit (ACTIVE SURFACE)** | `codegen/runtime-esm.ts` (`toEsmRuntime` :304, `deriveTopLevelExportNames` :256, `LIFT_TARGET_GLOBAL` :71) + `codegen/emit-client-esm.ts` (`toEsmClientChunk` :270) + `codegen/index.ts` (:852 `type="module"`, :2496 runtime transform, :2602 per-route chunk transform, :1657/:1685 the esm-vs-classic tag split) + `codegen/runtime-chunks.ts` / `route-splitter.ts` + `api.js` `rewriteChunkImportRefs` + `commands/module-format-notice.js` — mapped in dependencies.map.md ("ESM chunks" row) + build.map.md (`--module-format` flag) |
| cross-file `<script src>` depth / dist-relative refs | `codegen/index.ts` `computeDependencyClientScripts` (both sides via `toDistRel()`) + `codegen/utils.ts` `stripPagesPrefix` — 3 OPEN gaps on this surface, see non-compliance.report.md |
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
- **There are now TWO client module formats, and `classic` is the default.** `--module-format=esm` is opt-in and experimental: the emitted app runs (module runtime + module chunks + `type="module"` tags + hashed import URLs), but classic is the only conformance-tested path, and the classic byte output is unchanged by the whole arc — every esm transform is gated on `moduleFormat === "esm"`. `--module-format=esm` has NO effect with `--embed-runtime`. If you touch `codegen/index.ts` chunk emission, you are touching both formats.
- **The `<each>` mount is a COMMENT FENCE, not an element.** `<!--scrml-each:N-->…<!--/scrml-each:N-->`, with rows as siblings between the anchors. `querySelector` cannot see it — every locator is a SHOW_COMMENT TreeWalker (`_scrml_find_each_anchor`, mirroring the older `_scrml_find_if_marker`). Any code, test or doc that expects `[data-scrml-each-mount]` for a TOP-LEVEL each is describing the retired model; the attribute survives only on the NESTED-each runtime `<div>` mount.
- **`<outlet>` is NOT a dedicated AST node.** It is an ordinary `kind: "markup"` node with `tag: "outlet"` — and so is `<main>`. Every consumer matches structurally; a pass expecting a typed node silently finds nothing.
- **The one-landmark invariant (§20.8.1.1) is enforced across THREE files** communicating only through the emitted `data-scrml-outlet` marker: `codegen/emit-html.ts` (landmark tag per file), `codegen/index.ts` (composition slot across files, §40.8.2), `symbol-table.ts` PASS 15.5 (`E-OUTLET-AND-MAIN`). The MARKER, never the tag, identifies the slot.
- **Confidentiality is four orthogonal axes (§52.15.4)** — route-admission ⟂ tenant-scope (§14.8.10) ⟂ per-user row-selection (§52.15.3) ⟂ column-redaction (§14.8.9). Two compiler-enforced FLOORS: the column floor (E-CG-001, acorn-exact) and the tenant-row floor (`codegen/tenant-egress.ts`).
- **`codegen/sql-lex.ts` is the single source of truth for LIVE-vs-INERT `${}` inside `?{}` SQL**, imported by exactly two modules (`collect.ts`, `rewrite.ts`). Do not add a second interpolation scanner.
- SPEC.md (36,114 lines, §1-§65+) is the sole normative source; PIPELINE.md documents stage internals. Any doc contradicting SPEC.md is non-compliant per pa.md Rule 4.
- Server/client execution boundary is fully INFERRED from usage (no author annotation; a `session` reference is a server-escalation trigger); a fail-closed acorn-exact scan (E-CG-001) backstops the §14.8.9 protect-floor.
- 21 stdlib modules ship as `scrml:*` imports, each with BOTH a canonical `.scrml` source (stdlib/) and a JS host shim (compiler/runtime/stdlib/). Two self-host efforts run in parallel (compiler/self-host/, compiler/self-host-v2/).
- `null` and `undefined` do not exist in scrml source in ANY position (§42) — `not` is the sole absence value (E-SYNTAX-042 + W-ABSENCE-IN-SCRML-SOURCE).
- The compiler ships TWO parsers: the live pipeline (block-splitter.js + ast-builder.js) and `compiler/native-parser/` (`--parser=scrml-native`, also feeding the LSP semantic-tokens provider). **native-parser/ has had ZERO diff since `df2ac831`** — parity for E-SCRIPT-001 is a CONFIRMED gap; GITI-038/039 parity is unconfirmed.

## Tags
#scrml #map #primary #index #compiler #bun #esm-chunks #module-format #each-fence #foster-safe #claim-gate #facts-gate #snippet-gate #css65 #native-parser #self-host #stdlib #auth #outlet #one-landmark #shell-composition #server-shape #semdiff #ci #infra #content-hash #colorless-async #tenant-floor #ssr-auto-make-safe #sql-lex #confidentiality-axes

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
