# primary.map.md
# project: scrml
# updated: 2026-07-18T08:36:53-06:00  commit: 99ae45ca
# For per-session history, see docs/changelog.md (NOT this file — maps are current-truth navigation, not an archive).

## Project Fingerprint
Language:   TypeScript / JavaScript (mixed) + scrml itself (self-hosting stdlib + self-host compiler experiments)
Framework:  Custom compiler pipeline (no web framework) — Bun-native
Runtime:    Bun >=1.3.13 (no Node support; Bun-specific APIs used throughout)
Type:       CLI compiler + language toolchain (single-file full-stack web-language compiler, with LSP + editor-tooling + MCP surfaces)
Size:       6854 git-tracked files total (up from 6791 at the 0a79d838/S264 watermark; +63 across the whole S265 window — 1 new compiler/src file, 6 new test files, 8 new conformance/style/ cases, 2 new docs/changes/ dispatch dirs, 2 new handOffs continuity docs from the S265 wraps, plus spa-lists bookkeeping); compiler/src/ 174 files (132 .ts + 40 .js + 2 other; +1 = codegen/emit-theme-reset.ts), compiler/src/codegen/ 76 files (72 .ts + 2 .js + 2 other), compiler/native-parser/ 79 files (37 paired .js/.scrml + 5 planning docs, unchanged), compiler/tests/ ~1200 *.test.js (map's per-category tallies undercount HEAD by ~8 — see non-compliance.report.md).
Version:    v0.7.1 (root package.json; compiler/package.json reads 0.2.0 — subpackage drift, longstanding, ignore)
Monorepo:   yes — `workspaces: ["compiler"]`; compiler/ is the sole npm workspace member; stdlib/, editors/, lsp/ are NOT npm workspaces but are integral first-party surfaces of the same repo.
CI:         GitHub Actions — `.github/workflows/ci.yml` (gate/tracking/windows) + `advisory-review.yml` (advisory AI /code-review). Unchanged this window.

## Watermark note
This refresh advances the map watermark from c779e606 (the S265 mid-window map base — Peter's #101
routing-level pass) to the S265 wrap HEAD 99ae45ca, and DEEP-VERIFIES the two S265 bryan-lane CSS
landings against source (Peter's pass mapped them at routing level only; this pass code-verified
them). Between c779e606 and 99ae45ca ONLY docs changed (changelog, known-gaps, hand-off, delta-log,
master-list, 2 new handOffs continuity docs) — no compiler/src, compiler/tests, or conformance/
change — so every source-derived map claim carried from c779e606 is structurally current at HEAD.

Code-verified this pass, at HEAD 99ae45ca:
- **#95 CSS Wave-1 emission §65 (`3b62839a`)** — NEW `compiler/src/codegen/emit-theme-reset.ts`
  (9 exports: `collectThemeContext`, `emitThemeCss`, `emitResetLayer`, `wrapSelectorWhere`,
  `lowerCssValueRefs`, `collectThemeTokenNames`, `themeVariantAttr` + `RESET_LAYER_CSS` const +
  the `ThemeContext` interface). Delegated from `generateCss` (emit-css.ts:382 → codegen/index.ts:1146)
  and re-run on the flat-inline `#{}`→`style=""` path in emit-html.ts. Verified behaviour: `<theme>`
  base tokens → `:root { --name: value }`; the `@`-sigil use-site model (`@name` → `var(--name)` if a
  theme token / `var(--scrml-name)` if a declared cell / else `E-THEME-TOKEN-UNKNOWN`; a BARE
  identifier is always literal CSS, never lowered — no keyword shadowing); the built-in `@layer reset`
  (opt-out `<program reset="none">`, attribute-registry.js:189); `:where()`-flat wrapping of
  UNCONDITIONAL arms only (conditional pseudo/attr arms stay unwrapped as deterministic layers);
  `.Variant` → `:root[data-scrml-theme-<cell>="Variant"]` + `@media` → `@media (…){ :root {…} }`;
  and the §65.6 runtime theme-switch reflection (`emitThemeSwitchReflection`, emit-client.ts:1337,
  wired at :1994 — reflects `@cell`'s active variant tag onto `<html data-scrml-theme-<cell>>` at
  mount + every change via `_scrml_effect`). `E-THEME-TOKEN-UNKNOWN` is the ONE new §34 catalog row
  (775→776), fired by `lowerCssValueRefs`/`emitThemeCss`; SPEC §34 row LANDED (compiler/SPEC.md:18148).
- **#98 §25 CSS-var bridge fix (`bf316828`)** — reactive component CSS (`#{prop:@cell}`) now targets
  `document.documentElement` (:root) at emit-reactive-wiring.ts:882, NOT the undefined `_scrml_el`
  stub that ReferenceError'd at bundle load. `collectCssVariableBridges` dropped its `isScoped` param,
  `CSSVariableBridge` dropped its `scoped` field, and the `_constructorScoped` node flag was removed
  (collect.ts). This is what un-broke §65.6: the theme-switch was silently DOA on main (a theme token
  wrongly §25-bridged → `_scrml_el`), was caught in the S265 S239 review, and fixed + re-verified BY
  EXECUTING the bundle (hand-off.md). Current truth = the theme-switch WORKS; maps carry current
  state, not the DOA history.

Observed source-comment drift (a note for the fix agent, not a map defect): emit-theme-reset.ts
lines 189-197 still call the runtime theme-switch reflection "a DEFERRED follow-on" — stale, written
before the round-4 reflection landed in emit-client.ts; SPEC §34/§65 and hand-off.md both mark it
LANDED. Not mapped as deferred; flagged in non-compliance.report.md.

Still unmapped (deferred to a FULL or NON_COMPLIANCE_ONLY pass): the latent S256-S263 delta noted at
the S264 watermark, and a test-count reconciliation (this map set's test totals undercount HEAD —
unit 807 mapped vs 813 tracked, total 1200 vs 1208; tree unchanged, so pre-existing methodology
drift). See non-compliance.report.md.

## Map Index

| Map                  | Status  | Contents                                                      |
|----------------------|---------|-------------------------------------------------------------------|
| structure.map.md     | present | directory layout (top 4 levels), 5 entry points, 10 subcommands; codegen/ 76 files (incl. emit-theme-reset.ts) |
| dependencies.map.md  | present | 6 runtime + 6 dev deps (unchanged), compiler pipeline module graph (emit-theme-reset.ts + §25-bridge-fix detail), 21 stdlib module pairing |
| schema.map.md        | present | ~114 AST types/interfaces in types/ast.ts; codegen-internal ThemeContext + CSSVariableBridge (scoped field dropped, #98); attribute-registry.js line refs re-verified (reset attrSpec :189, theme :503, defaults :516) |
| config.map.md        | present | 6 env vars, 3 config files (NOT re-verified this pass — stamped f079d0a9/S264) |
| build.map.md         | present | 13 npm scripts, 10 CLI subcommands + flags, 2 CI workflows + git-hooks; content-hash asset naming + cache-header contract (adopter #82) |
| error.map.md         | present | 776 diagnostic codes (+1 this window, E-THEME-TOKEN-UNKNOWN — see caveat in the map re: baseline-count methodology) |
| test.map.md          | present | bun:test, 9 categories (per-category counts undercount HEAD by ~8 — see non-compliance.report.md) |
| domain.map.md        | present | scrml language primitives (§1-§65+ SPEC navigation); §65 CSS Wave-1 emission LANDED + §20.8.3 link-boost LANDED this window |
| auth.map.md          | present | scrml:auth/scrml:oauth stdlib + §14.8.9 protect-floor + CSRF + §64.9 headless carve-out (NOT re-verified this pass — stamped f079d0a9/S264) |
| infra.map.md         | present | GitHub Actions CI, no Docker/cloud resources (NOT re-verified this pass — stamped f079d0a9/S264) |
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
CSS §65 Wave-1 emission / theme tokens      -> domain.map.md (status) + schema.map.md (registry/types) + error.map.md (E-THEME-TOKEN-UNKNOWN) + dependencies.map.md (emit-theme-reset.ts)
§25 reactive-CSS-var bridge (#{prop:@cell}) -> dependencies.map.md (collect.ts + emit-reactive-wiring.ts) + schema.map.md (CSSVariableBridge)
CSS pipeline stage (generateCss)            -> dependencies.map.md (module graph)
Client Router / outlet / link-boost         -> domain.map.md
auth flows / JWT / OAuth / protect-floor    -> auth.map.md
non-compliant / stale docs                  -> non-compliance.report.md

## Key Facts
- Entry point: `compiler/bin/scrml.js` -> `compiler/src/cli.js` dispatches to `commands/*.js` (10 subcommands); the actual pipeline is `compileScrml()` in `compiler/src/api.js` (block-split -> AST-build -> type-check -> codegen, ~35 imported pipeline-stage modules).
- **§65 CSS Wave-1 emission is LANDED (S265, #95).** CSS is emitted by `generateCss` (codegen/emit-css.ts:382, called from codegen/index.ts:1146), which delegates `<theme>` token lowering + the built-in `@layer reset` + `:where()`-flat wrapping to the NEW `compiler/src/codegen/emit-theme-reset.ts`; the §65.6 runtime theme-switch reflection is emitted in emit-client.ts. A theme-token USE-SITE reference requires the `@` sigil (`color: @brand` → `color: var(--brand)`); an unresolvable `@`-reference (or a variant re-bind of a token absent from the global base set) fires the NEW `E-THEME-TOKEN-UNKNOWN` (§34 count 775→776).
- **Reactive CSS custom properties always target `document.documentElement` (:root), never a per-instance element (#98, S265).** Components are compile-time INLINED, so a `#{prop:@cell}` cell is global; the :root custom property inherits into the component's inline `var(--scrml-name)` (§65.3.1/§25.5). The prior per-instance `_scrml_el` target was an undefined stub — the fix (emit-reactive-wiring.ts:882 + collect.ts dead-code removal) un-broke the DOA §65.6 theme-switch.
- **`<a href>` internal links soft-navigate by default** (§20.8.3 link-boost, S265, #100): a delegated document-level click listener in `compiler/src/runtime-template.js`, boot-wired only on a `<program>` shell with an `<outlet>` (`fileHasOutlet` in emit-reactive-wiring.ts, now exported). `<a href hard>` opts a link out; every non-plain-internal-link case falls through to native navigation.
- **`scrml build` content-addresses page bundles/CSS + sends precise cache headers on both serve paths** (S265, #82). `compileScrml()` gained a `contentHashAssets` option (off by default; `scrml build` turns it on); `generateServerEntry()`'s signature gained a 4th `hashedAssets` param. Immutable-by-exact-set-membership for hashed assets, `no-cache` for HTML, weak-ETag-revalidation for the rest. See build.map.md.
- The compiler ships TWO parsers side by side: the live pipeline (block-splitter.js + ast-builder.js) and a from-scratch native parser (compiler/native-parser/, activated via `--parser=scrml-native`) that also feeds `lsp/handlers.js`'s semantic-tokens provider directly.
- SPEC.md (~35k lines, §1-§65+) is the sole normative source; PIPELINE.md documents the stage-by-stage internals. Any doc contradicting SPEC.md is non-compliant per pa.md Rule 4.
- Server/client execution boundary is fully INFERRED from usage (no author annotation); a fail-closed acorn-exact scan (E-CG-001, codegen/egress-field-scan.ts) backstops the §14.8.9 protect-floor against protected-column leaks to the client bundle.
- 21 stdlib modules ship as scrml:* imports, each with BOTH a canonical `.scrml` source (stdlib/<mod>/) and a JS host shim (compiler/runtime/stdlib/<mod>.js). Two self-host efforts run in parallel: compiler/self-host/ (Road-A, 17 files) and compiler/self-host-v2/ (Road-B, in progress).
- `null` and `undefined` do not exist in scrml source in ANY position (§42) — `not` is the sole absence value; this is a hard compiler rule (E-SYNTAX-042 + W-ABSENCE-IN-SCRML-SOURCE), not a style guideline.
- CI is a 3-job gate-layering model (`gate` blocking = unit+conformance+gauntlet; `tracking` + `windows` non-blocking) plus an advisory-only AI `/code-review` workflow; unchanged this window. A THIRD workflow (`cloud-maps.yml`) exists on an unmerged branch — NOT part of this HEAD.

## Tags
#scrml #map #primary #index #compiler #bun #css65 #native-parser #self-host #stdlib #auth #baas #outlet #server-shape #semdiff #ci #infra #content-hash #link-boost #css-wave1 #theme-token #css-var-bridge

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
