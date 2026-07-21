# primary.map.md
# project: scrml
# updated: 2026-07-21T12:51:06Z  commit: c48e59a2
# For per-session history, see docs/changelog.md (NOT this file — maps are current-truth navigation, not an archive).

## Project Fingerprint
Language:   TypeScript / JavaScript (mixed) + scrml itself (self-hosting stdlib + self-host compiler experiments)
Framework:  Custom compiler pipeline (no web framework) — Bun-native
Runtime:    Bun >=1.3.13 (no Node support; Bun-specific APIs used throughout)
Type:       CLI compiler + language toolchain (single-file full-stack web-language compiler, with LSP + editor-tooling + MCP surfaces)
Size:       6944 git-tracked files total (up from 6910 at the df2ac831/S271-wrap watermark; +34, 0 deletions, across the S272-S276 window); compiler/src/ 178 files (135 .ts + 41 .js + 1 .md + 1 .json; +3 = codegen/sql-lex.ts, codegen/tenant-egress.ts, lint-w-each-table-foster.js), compiler/src/codegen/ 79 files (75 .ts + 3 .js + 1 .md; +2), compiler/native-parser/ 79 files (37 paired .js/.scrml + 5 planning docs, UNCHANGED across the entire window — flagged as a parity-check item, see below), compiler/tests/ 1227 *.test.js (directly counted, +6 this window — see test.map.md). All counts directly `git ls-files`-derived this pass.
Version:    v0.7.1 (root package.json; compiler/package.json reads 0.2.0 — subpackage drift, longstanding, ignore). No manifest change this window.
Monorepo:   yes — `workspaces: ["compiler"]`; compiler/ is the sole npm workspace member; stdlib/, editors/, lsp/ are NOT npm workspaces but are integral first-party surfaces of the same repo.
CI:         GitHub Actions — `.github/workflows/ci.yml` (gate/tracking/windows) + `advisory-review.yml` (advisory AI /code-review). Unchanged this window.

## Watermark note

This pass advances the map watermark from `df2ac831` (S271) to the current HEAD `c48e59a2` (S276),
and **completes the PARTIAL S274 map refresh** — that pass updated `error.map.md` and
`dependencies.map.md` to `58c8161d`, then stalled before reaching `domain.map.md` and before
bumping this file's stamp. Both are now done.

Landings folded in since the prior stamp:

1. **#115 each-foster lint** (S272) — `W-EACH-TABLE-FOSTER` info-lint; NEW
   `compiler/src/lint-w-each-table-foster.js`, wired at api.js Stage 6.4f.
2. **#117/#118 §14.8.10 tenant-row isolation floor** (S273) — the ROW-level twin of the §14.8.9
   column floor. NEW `codegen/tenant-egress.ts`; 5 codes (`E-TENANT-AGG`/`-WRITE`/`-RAW-EGRESS` +
   `I-TENANT-STRIP`/`-ACROSS`). **Now covered in domain.map.md** (was the S274 gap).
3. **#120 `f2332c09` SSR auth-scoped prerender leak closed** (§52.15.5) — NEW
   `codegen/sql-lex.ts` (the shared LIVE-vs-INERT `${}` SQL classifier feeding BOTH
   `collect.ts` and `rewrite.ts`); retired `W-SSR-PRERENDER-UNSCOPED`, NEW Info
   `I-SSR-AUTH-SCOPED-CLIENT-HYDRATED`. **Now covered in domain.map.md.**
4. **#121 `4fb83531` freeze-spec text reconciliation ×5** — E-ATTR-012 retired, E-ERROR-010
   catalogued, E-FN-009 Nominal-deferred, §4.4.1 native-parity claim corrected, E-MW-002/005/006
   cites re-anchored. SPEC-text only, no fire-site change.
5. **#122 `58c8161d`** — E-SQL-004 corpus sample migration.
6. **#123 `020485b2`** — S274 wrap bookkeeping (partial map refresh; no compiler-source change).
7. **#124 `c48e59a2` navigate Wave-1c PR-1** (S276, THIS session) — marker-driven MPA shell
   composition + the ONE-LANDMARK invariant. Edits to `codegen/emit-html.ts` (the `<outlet>` emit +
   `treeHasAuthorMain`), `codegen/index.ts` (composition slot detection, open-tag/attribute
   tokenizer, `findMatchingCloseIdx` depth scanner, cross-file landmark demotion + re-promotion),
   `symbol-table.ts` (`walkValidateOutlets`/`collectOutlets`, `E-OUTLET-AND-MAIN`). NEW SPEC
   §20.8.1.1 (the invariant) + NEW §40.8.2 (multi-file shell composition — previously UNSPECIFIED)
   + a §34 `E-OUTLET-AND-MAIN` row. NO new source file.

Maps re-verified against source this pass: domain.map.md (FULL rewrite — the S274 miss), error.map.md,
structure.map.md, dependencies.map.md, primary.map.md. **config.map.md / build.map.md /
infra.map.md / schema.map.md / test.map.md / auth.map.md are intentionally LEFT at their prior
stamps** — none of this window's changed files touch CLI flags, env vars, config-file shapes,
CI/infra, AST type shapes, or the auth/session surface; an honest older stamp beats a false
"verified at c48e59a2". Re-verify at the next full pass.

Diagnostic catalog: 780 -> 787 (+7 net across the window; the S276 leg is exactly +1,
`E-OUTLET-AND-MAIN`, set-diff-confirmed on `58c8161d..c48e59a2`). Test count: 1221 -> 1227.

**`W-NAV-CHUNK-LOAD-FAILED` is NOT implemented** — zero occurrences in `compiler/src/`, no §34
row. Wave-1c pieces 2+3 (cross-chunk navigation) are HELD. Any doc naming that code describes
planned work, not shipped behavior. See non-compliance.report.md.

Flagged for follow-up (see non-compliance.report.md): `compiler/native-parser/` has had ZERO diff
across the entire df2ac831 -> c48e59a2 window — its parity with the live pipeline for GITI-038/039
and now the #124 outlet/landmark surface is UNCONFIRMED, not independently determined this pass.

## Map Index

| Map                  | Status  | Contents                                                      |
|----------------------|---------|-------------------------------------------------------------------|
| structure.map.md     | present | **REFRESHED @c48e59a2** — directory layout (top 4 levels), 5 entry points, 10 subcommands; compiler/src 178 files, codegen/ 79, tests 1227 — all directly re-counted |
| dependencies.map.md  | present | **REFRESHED @c48e59a2** — 6 runtime + 6 dev deps (unchanged), compiler pipeline module graph incl. the NEW Client-Router landmark+composition stage (emit-html × index.ts), sql-lex, tenant-egress, colorless-async, 21 stdlib module pairing |
| schema.map.md        | present | ~114 AST types/interfaces in types/ast.ts (NOT re-verified this pass — stamped df2ac831; #124 added no AST type, and `<outlet>` is deliberately NOT a node type) |
| config.map.md        | present | 6 env vars, 3 config files (NOT re-verified — stamped f079d0a9/S264, no in-scope change) |
| build.map.md         | present | 13 npm scripts, 10 CLI subcommands + flags, 2 CI workflows + git-hooks (NOT re-verified — stamped 99ae45ca, no in-scope change) |
| error.map.md         | present | **REFRESHED @c48e59a2** — 787 diagnostic codes (+1 this session: E-OUTLET-AND-MAIN; outlet family 3 -> 4); W-SSR-PRERENDER-UNSCOPED retirement re-verified as complete; explicit do-not-add note for W-NAV-CHUNK-LOAD-FAILED |
| test.map.md          | present | bun:test, 9 categories (count refreshed to 1227 in structure.map.md; test.map.md itself NOT re-verified — stamped df2ac831) |
| domain.map.md        | present | **FULL REWRITE @c48e59a2 — the S274 miss, now closed.** scrml language primitives (§1-§65+ SPEC navigation) + NEW: §14.8.10 tenant floor, §52.15.5 SSR auto-make-safe, the four confidentiality axes, and a dedicated §20.8.1.1/§40.8.2 one-landmark + shell-composition section |
| auth.map.md          | present | scrml:auth/scrml:oauth stdlib + §14.8.9 protect-floor + CSRF + §64.9 headless carve-out + §20.5 session server builtin (NOT re-verified — stamped df2ac831; §14.8.10 tenant-key establishment via `session.set("tenantId",…)` is covered in domain.map.md) |
| infra.map.md         | present | GitHub Actions CI, no Docker/cloud resources (NOT re-verified — stamped f079d0a9/S264, no in-scope change) |
| api.map.md           | absent (no REST/GraphQL/gRPC surface owned by this repo itself — the compiler EMITS API routes for generated apps, tracked in domain.map.md §60/§61, not this repo's own API) |
| state.map.md         | absent (no redux/zustand/jotai — not a frontend app) |
| events.map.md        | absent (no EventEmitter/pubsub in compiler's own src — §38 channel semantics are a language feature, tracked in domain.map.md) |
| style.map.md         | absent (no tailwind.config/theme.ts in THIS repo — Tailwind + §65 CSS-native are compiler FEATURES, tracked in domain.map.md + error.map.md) |
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
**outlet / `<main>` landmark / MPA shell composition** -> domain.map.md (the four-case table + which file owns which decision) + error.map.md (E-OUTLET-AND-MAIN) + dependencies.map.md (the two-stage module graph row)
tenant-row isolation floor (§14.8.10)       -> domain.map.md (concept + invariant) + error.map.md (E-TENANT-*/I-TENANT-*) + dependencies.map.md (tenant-egress.ts)
SSR auto-make-safe (§52.15.5) / sql-lex     -> domain.map.md (concept) + error.map.md (I-SSR-AUTH-SCOPED-CLIENT-HYDRATED + sql-lex section) + dependencies.map.md (collect.ts/rewrite.ts wiring)
colorless-async classification (Q1/Q2)      -> dependencies.map.md (mechanism) + domain.map.md (status/rules)
returned-fn-expr AST completeness (GITI-038) -> schema.map.md (ReturnStmtNode.fnExprNode) + dependencies.map.md (per-pass detail)
writer-ownership Axiom ① (#81)              -> domain.map.md (rule) + error.map.md (E-ATTR-WRITER-CONFLICT) + dependencies.map.md (analyzeWriterConflict)
§20.5 session establishment (session.*)     -> auth.map.md (full mechanism) + error.map.md (E-SCOPE-012/E-SESSION-*) + schema.map.md (config-shape note)
CSS §65 Wave-1 emission / theme tokens      -> domain.map.md (status) + schema.map.md (registry/types) + error.map.md (E-THEME-TOKEN-UNKNOWN) + dependencies.map.md (emit-theme-reset.ts)
§25 reactive-CSS-var bridge (#{prop:@cell}) -> dependencies.map.md (collect.ts + emit-reactive-wiring.ts) + schema.map.md (CSSVariableBridge)
auth flows / JWT / OAuth / protect-floor    -> auth.map.md
non-compliant / stale docs                  -> non-compliance.report.md

## Key Facts
- Entry point: `compiler/bin/scrml.js` -> `compiler/src/cli.js` dispatches to `commands/*.js` (10 subcommands); the actual pipeline is `compileScrml()` in `compiler/src/api.js` (block-split -> AST-build -> type-check -> codegen, ~35 imported pipeline-stage modules).
- **`<outlet>` is NOT a dedicated AST node.** It is an ordinary `kind: "markup"` node with `tag: "outlet"` — and so is `<main>`. There is no `OutletNode` in `types/ast.ts` and no ast-builder construction case; every consumer matches structurally. Any pass written expecting a typed node will silently find nothing. This is the single most load-bearing fact for anyone touching the Client Router surface.
- **The one-landmark invariant (§20.8.1.1) is enforced across THREE files at three different stages**, communicating only through the emitted `data-scrml-outlet` marker attribute: `codegen/emit-html.ts` picks the landmark tag per file at emit time (`main` vs `div`); `codegen/index.ts` locates + re-tags the composition slot across files at composition time (§40.8.2); `symbol-table.ts` PASS 15.5 fires the `E-OUTLET-AND-MAIN` diagnostic. The MARKER, never the tag, identifies the slot — codegen and the runtime (`querySelector("[data-scrml-outlet]")`) agree on that and nothing else. See domain.map.md.
- **Confidentiality is four orthogonal axes (§52.15.4)** — route-admission (§52.15.2) ⟂ tenant-scope (§14.8.10) ⟂ per-user row-selection (§52.15.3) ⟂ column-redaction (§14.8.9). They STACK; none substitutes for another. Two compiler-enforced FLOORS (invariant only, never policy): the §14.8.9 column floor (E-CG-001, acorn-exact) and the §14.8.10 tenant-row floor (`codegen/tenant-egress.ts`). The tenant floor CONSUMES `@currentUser.tenantId` from `session` and never derives one — auto-deriving from grants is the explicitly named anti-pattern.
- **`codegen/sql-lex.ts` is the single source of truth for LIVE-vs-INERT `${}` inside `?{}` SQL.** It is imported by exactly two modules — `collect.ts` (the classifier) and `rewrite.ts` (the param emitter) — so a `${}` the classifier ignores is provably the same `${}` the emitter does not bind. Do not add a second interpolation scanner; the divergence it prevents previously emitted a `$N` param inside a SQL comment.
- **Colorless async is LANDED** for the classifier-unification + combinator-transform + returned-closure cases (S267/S269/S271, GITI-037/GITI-038). `ReturnStmtNode.fnExprNode` (types/ast.ts) is the AST shape a returned function expression carries, and EVERY AST-walking pass must descend into it (see schema.map.md).
- The compiler ships TWO parsers side by side: the live pipeline (block-splitter.js + ast-builder.js) and a from-scratch native parser (compiler/native-parser/, activated via `--parser=scrml-native`) that also feeds `lsp/handlers.js`'s semantic-tokens provider. **native-parser/ had ZERO diff across the entire df2ac831 -> c48e59a2 window** — parity for GITI-038/039 and the #124 outlet surface is unconfirmed, not confirmed-drifted.
- SPEC.md (~35k lines, §1-§65+) is the sole normative source; PIPELINE.md documents the stage-by-stage internals. Any doc contradicting SPEC.md is non-compliant per pa.md Rule 4.
- Server/client execution boundary is fully INFERRED from usage (no author annotation; a `session` reference is also a server-escalation trigger); a fail-closed acorn-exact scan (E-CG-001, codegen/egress-field-scan.ts) backstops the §14.8.9 protect-floor.
- 21 stdlib modules ship as scrml:* imports, each with BOTH a canonical `.scrml` source (stdlib/<mod>/) and a JS host shim (compiler/runtime/stdlib/<mod>.js). Two self-host efforts run in parallel: compiler/self-host/ (Road-A, 17 files) and compiler/self-host-v2/ (Road-B, in progress).
- `null` and `undefined` do not exist in scrml source in ANY position (§42) — `not` is the sole absence value; a hard compiler rule (E-SYNTAX-042 + W-ABSENCE-IN-SCRML-SOURCE), not a style guideline.
- CI is a 3-job gate-layering model (`gate` blocking = unit+conformance+gauntlet; `tracking` + `windows` non-blocking) plus an advisory-only AI `/code-review` workflow; unchanged this window.

## Tags
#scrml #map #primary #index #compiler #bun #css65 #native-parser #self-host #stdlib #auth #baas #outlet #one-landmark #shell-composition #e-outlet-and-main #server-shape #semdiff #ci #infra #content-hash #link-boost #css-wave1 #theme-token #css-var-bridge #colorless-async #giti-037 #giti-038 #giti-039 #writer-ownership #session-establishment #tenant-floor #ssr-auto-make-safe #sql-lex #confidentiality-axes

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
