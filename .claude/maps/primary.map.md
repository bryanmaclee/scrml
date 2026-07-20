# primary.map.md
# project: scrml
# updated: 2026-07-19T21:52:34-06:00  commit: df2ac831
# For per-session history, see docs/changelog.md (NOT this file — maps are current-truth navigation, not an archive).

## Project Fingerprint
Language:   TypeScript / JavaScript (mixed) + scrml itself (self-hosting stdlib + self-host compiler experiments)
Framework:  Custom compiler pipeline (no web framework) — Bun-native
Runtime:    Bun >=1.3.13 (no Node support; Bun-specific APIs used throughout)
Type:       CLI compiler + language toolchain (single-file full-stack web-language compiler, with LSP + editor-tooling + MCP surfaces)
Size:       6910 git-tracked files total (up from 6854 at the 99ae45ca/S265-wrap watermark; +56, 0 deletions, across the S266-S271 window — 1 new compiler/src file [codegen/async-combinators.ts], 13 new compiler/tests files, 41 new docs/changes/ dispatch-archive files across 8 new dispatch dirs, 1 new handOffs/ file, 1 stray root `progress.md` — see non-compliance.report.md); compiler/src/ 175 files (133 .ts + 40 .js + 2 other; +1 = codegen/async-combinators.ts), compiler/src/codegen/ 77 files (73 .ts + 3 .js + 1 .md), compiler/native-parser/ 79 files (37 paired .js/.scrml + 5 planning docs, UNCHANGED this window — flagged as a parity-check item, see below), compiler/tests/ 1221 *.test.js (directly counted, no undercount this pass — see test.map.md).
Version:    v0.7.1 (root package.json; compiler/package.json reads 0.2.0 — subpackage drift, longstanding, ignore). No manifest change this window.
Monorepo:   yes — `workspaces: ["compiler"]`; compiler/ is the sole npm workspace member; stdlib/, editors/, lsp/ are NOT npm workspaces but are integral first-party surfaces of the same repo.
CI:         GitHub Actions — `.github/workflows/ci.yml` (gate/tracking/windows) + `advisory-review.yml` (advisory AI /code-review). Unchanged this window.

## Watermark note

This pass advances the map watermark from 99ae45ca (the S265-wrap commit; the S266 map-refresh
commit `19f41a3d` had bumped the STAMP to 99ae45ca but only for the §65/§25 CSS surface) to the
current HEAD `df2ac831`, closing the ENTIRE unmapped S266-S271 gap in one pass — six landed
commits' worth of feature surface that had never been reflected in the map set:

1. **§20.5 session-establishment, both landings** (`1e63bbb1` base primitive + `510cef8d` pass-2
   hardening) — the `session.set`/`.destroy` write half of the session model, `__Host-` cookie
   naming, `session-secure=` opt-out, the reserved-key CSRF-token guard. **auth.map.md rewritten**
   (was stamped f079d0a9/S264, two full watermarks stale, predated this feature entirely).
2. **#81 writer-ownership Axiom ①** (`8931fd59`) — `E-ATTR-WRITER-CONFLICT`, the exclusive
   wholesale-DOM-surface-owner rule.
3. **#87 nested server-call auto-await** (`d8c814d5`) — i87 §13.2 position-invariant auto-await.
4. **Colorless-async Seam-A Phase-1 + Phase-2** (`1c577da5` GITI-037 fix + `9c950dfe` combinator
   transform) — NEW `codegen/async-combinators.ts`.
5. **GITI-038** (`72ba19d6`) — a returned named-function-expression async closure now TRANSFORMS
   correctly; required a round-2 AST-completeness fix across ~10 analysis passes
   (`ReturnStmtNode.fnExprNode` — see schema.map.md) after the S239 gate caught the round-1 gap as
   a LIVE server/client-split regression a green suite had shipped.
6. **GITI-039** (`df2ac831`) — literal markup text inside `${…}`-interpolated markup was
   expression-lexed (silent corruption / false E-CODEGEN-INVALID-LOGIC); fixed at the
   `joinWithNewlines` span-adjacency rejoin.

Two commits in the window (`8fdab116`, `204b1897`) are recovery/dogfood wraps with **no
compiler-source change** per hand-off.md — correctly excluded from the maps.

Maps re-verified against source this pass (not just narrative-carried): schema.map.md,
dependencies.map.md, domain.map.md, error.map.md, auth.map.md, structure.map.md, test.map.md,
primary.map.md, non-compliance.report.md. **config.map.md / build.map.md / infra.map.md are
intentionally LEFT at their prior stamps (99ae45ca / f079d0a9)** — none of this window's changed
files touch CLI flags, env vars, config-file shapes, or CI/infra; an honest older stamp is
preferable to a false "verified at df2ac831". Re-verify those three at the next full pass.

Diagnostic catalog: 776 -> 780 (+4: `E-ATTR-WRITER-CONFLICT`, `E-SCOPE-012` reserved->LIVE [not
a new row], `E-SESSION-CONTEXT`, `E-SESSION-VALUE`, `E-SESSION-RESERVED-KEY`). Test count: 1200
(mapped, was already a known undercount vs 1208 actual) -> 1221 actual, +13 net-new files this
window, directly `git ls-files`-counted this pass (no undercount carried forward).

Flagged for follow-up (see non-compliance.report.md): a stray root-level `progress.md` (WIP
scratch notes for the ALREADY-LANDED `510cef8d` session pass-2 work, sitting outside
docs/changes/ or scratch/); `compiler/native-parser/`'s GITI-038/039 parity is UNCONFIRMED (zero
diff in the window — either genuinely unaffected or silently behind the live pipeline, not
independently determined this pass).

## Map Index

| Map                  | Status  | Contents                                                      |
|----------------------|---------|-------------------------------------------------------------------|
| structure.map.md     | present | directory layout (top 4 levels), 5 entry points, 10 subcommands; codegen/ 77 files (incl. NEW async-combinators.ts); test counts directly re-counted |
| dependencies.map.md  | present | 6 runtime + 6 dev deps (unchanged), compiler pipeline module graph incl. the colorless-async classification stage + session-establishment stage + writer-ownership analyzer, 21 stdlib module pairing |
| schema.map.md        | present | ~114 AST types/interfaces in types/ast.ts (+1 field: `ReturnStmtNode.fnExprNode`, GITI-038); 3 separate non-unified `AuthConfig`-shape interfaces documented; §65 CSS-native model + §20.8 outlet sections carried |
| config.map.md        | present | 6 env vars, 3 config files (NOT re-verified this pass — stamped f079d0a9/S264, no in-scope change) |
| build.map.md         | present | 13 npm scripts, 10 CLI subcommands + flags, 2 CI workflows + git-hooks (NOT re-verified this pass — stamped 99ae45ca, no in-scope change) |
| error.map.md         | present | 780 diagnostic codes (+4 this window — E-ATTR-WRITER-CONFLICT, E-SESSION-CONTEXT/-VALUE/-RESERVED-KEY, E-SCOPE-012 reserved->LIVE; see caveat on baseline-count methodology) |
| test.map.md          | present | bun:test, 9 categories, 1221 files directly counted (+13 this window, no undercount) |
| domain.map.md        | present | scrml language primitives (§1-§65+ SPEC navigation); colorless-async LANDED, writer-ownership Axiom ① LANDED, §20.5 session-establishment LANDED (all this window) |
| auth.map.md          | present | scrml:auth/scrml:oauth stdlib + §14.8.9 protect-floor + CSRF + §64.9 headless carve-out + **§20.5 session server builtin (REWRITTEN this window — was 2 watermarks stale)** |
| infra.map.md         | present | GitHub Actions CI, no Docker/cloud resources (NOT re-verified this pass — stamped f079d0a9/S264, no in-scope change) |
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
colorless-async classification (Q1/Q2)      -> dependencies.map.md (mechanism) + domain.map.md (status/rules)
returned-fn-expr AST completeness (GITI-038) -> schema.map.md (ReturnStmtNode.fnExprNode) + dependencies.map.md (per-pass detail)
writer-ownership Axiom ① (#81)              -> domain.map.md (rule) + error.map.md (E-ATTR-WRITER-CONFLICT) + dependencies.map.md (analyzeWriterConflict)
§20.5 session establishment (session.*)     -> auth.map.md (full mechanism) + error.map.md (E-SCOPE-012/E-SESSION-*) + schema.map.md (config-shape note)
CSS §65 Wave-1 emission / theme tokens      -> domain.map.md (status) + schema.map.md (registry/types) + error.map.md (E-THEME-TOKEN-UNKNOWN) + dependencies.map.md (emit-theme-reset.ts)
§25 reactive-CSS-var bridge (#{prop:@cell}) -> dependencies.map.md (collect.ts + emit-reactive-wiring.ts) + schema.map.md (CSSVariableBridge)
Client Router / outlet / link-boost         -> domain.map.md
auth flows / JWT / OAuth / protect-floor    -> auth.map.md
non-compliant / stale docs                  -> non-compliance.report.md

## Key Facts
- Entry point: `compiler/bin/scrml.js` -> `compiler/src/cli.js` dispatches to `commands/*.js` (10 subcommands); the actual pipeline is `compileScrml()` in `compiler/src/api.js` (block-split -> AST-build -> type-check -> codegen, ~35 imported pipeline-stage modules).
- **Colorless async is LANDED for the classifier-unification + combinator-transform + returned-closure cases (S267/S269/S271, GITI-037/GITI-038).** A plain function calling a Promise-returning host primitive — directly, transitively, or as a returned closure — is compiler-inferred `async` and auto-awaited; scrml source has no `async`/`await` keyword. `ReturnStmtNode.fnExprNode` (types/ast.ts) is the new AST shape a returned function expression carries, and EVERY AST-walking pass must descend into it (see schema.map.md) — this is the single most load-bearing fact for anyone touching `return-stmt` handling anywhere in the pipeline.
- **Each physical DOM surface has at most one wholesale reactive writer (Axiom ①, §5.5.3/§5.5.4, #81, S268).** A second wholesale writer on the same surface (`class=(expr)` + `class:name=`, `style=(expr)` + `if=`, `value=(expr)` + `bind:value`) is now a compile error (`E-ATTR-WRITER-CONFLICT`), not a silent clobber; a SOLE wholesale writer outside `<each>` now correctly emits (was silently dropped pre-#81).
- **The `session` server builtin (§20.5) is now LIVE, not reserved.** `session.userId`/`.isAuth`/`.role`/`.get`/`.set`/`.destroy` inside a server-escalated function body write/read a compiler-managed `__Host-scrml_sid` (default) or plain `scrml_sid` (opt-out `session-secure="false"`) cookie + durable session store. `session` used outside a server-escalated body is `E-SCOPE-012`; misuse WITHIN a server body (wrong context / bare value / reserved-key write) is `E-SESSION-CONTEXT`/`E-SESSION-VALUE`/`E-SESSION-RESERVED-KEY`. See auth.map.md.
- The compiler ships TWO parsers side by side: the live pipeline (block-splitter.js + ast-builder.js) and a from-scratch native parser (compiler/native-parser/, activated via `--parser=scrml-native`) that also feeds `lsp/handlers.js`'s semantic-tokens provider directly. **This window's GITI-038/GITI-039 fixes landed ONLY in the live pipeline** — native-parser/ had zero diff in the window; parity is unconfirmed, not confirmed-drifted (see non-compliance.report.md).
- SPEC.md (~35k lines, §1-§65+) is the sole normative source; PIPELINE.md documents the stage-by-stage internals. Any doc contradicting SPEC.md is non-compliant per pa.md Rule 4.
- Server/client execution boundary is fully INFERRED from usage (no author annotation; a `session` reference is now also a server-escalation trigger); a fail-closed acorn-exact scan (E-CG-001, codegen/egress-field-scan.ts) backstops the §14.8.9 protect-floor against protected-column leaks to the client bundle.
- 21 stdlib modules ship as scrml:* imports, each with BOTH a canonical `.scrml` source (stdlib/<mod>/) and a JS host shim (compiler/runtime/stdlib/<mod>.js). Two self-host efforts run in parallel: compiler/self-host/ (Road-A, 17 files) and compiler/self-host-v2/ (Road-B, in progress).
- `null` and `undefined` do not exist in scrml source in ANY position (§42) — `not` is the sole absence value; this is a hard compiler rule (E-SYNTAX-042 + W-ABSENCE-IN-SCRML-SOURCE), not a style guideline.
- CI is a 3-job gate-layering model (`gate` blocking = unit+conformance+gauntlet; `tracking` + `windows` non-blocking) plus an advisory-only AI `/code-review` workflow; unchanged this window.

## Tags
#scrml #map #primary #index #compiler #bun #css65 #native-parser #self-host #stdlib #auth #baas #outlet #server-shape #semdiff #ci #infra #content-hash #link-boost #css-wave1 #theme-token #css-var-bridge #colorless-async #giti-037 #giti-038 #giti-039 #writer-ownership #session-establishment #position-invariant-await

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
