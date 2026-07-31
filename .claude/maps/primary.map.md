# primary.map.md
# project: scrml
# updated: 2026-07-31T03:18:23Z  commit: fe14c9b2
# NOTE (S302 pass): INCREMENTAL over `d0763cff` -> `fe14c9b2` — **27 commits, four sessions**
# (S300·Peter, S301·bryan, S302·bryan, S303·Peter). Re-walked: primary, domain, error, structure,
# test, dependencies, build, schema, non-compliance. NOT re-walked: config, infra, migrations, auth
# (no surface in this window touched them; each keeps its own honest stamp in the Map Index).
#
# **STRUCTURAL CHANGE THIS PASS — the per-window landing narratives are DELETED.** S299 measured
# this map set at 0/4 load-bearing on that session's loci, with ~40% of content duplicating
# `docs/changelog.md`, which is better at it. Two sections (~154 of 352 lines, 44%) that recounted
# "what landed in window N" are gone from this file, and the equivalents are gone from error.map.md
# and test.map.md. **For per-session history read `docs/changelog.md` and `handOffs/delta-log.md`.**
# What replaces them is the section below: rules a grep cannot find.

## Project Fingerprint
Language:   TypeScript / JavaScript (mixed) + scrml itself (self-hosting stdlib + self-host compiler experiments)
Framework:  Custom compiler pipeline (no web framework) — Bun-native
Runtime:    Bun >=1.3.13 (no Node support; Bun-specific APIs throughout — `Bun.serve`, `bun:sqlite`, `Bun.$`, `Bun.SQL`, `Bun.hash`)
Type:       CLI compiler + language toolchain (single-file full-stack web-language compiler, with LSP + editor-tooling + MCP surfaces)
Size:       **7192** git-tracked files. `compiler/src/` **189** (144 .ts + 43 .js + 2 other) — **+1** (`indirect-callee-resolver.ts`). `compiler/tests/` **1294** `*.test.js` — **+13**. `compiler/SPEC.md` **36,767** lines. Conformance **769** cases — **+13**.
Version:    v0.7.1 (root package.json — the SOLE manifest; not a workspace monorepo, `files`-allowlisted, publishable)
CI:         GitHub Actions — three workflows on `main`: `ci.yml` (gate/tracking/windows), `advisory-review.yml`, `cloud-maps.yml` (**scheduled daily, STILL FAILING**; `.github/` otherwise untouched for three windows). **`gate` gained a step this window** — `bun test compiler/tests/*.test.js` (14 root-level files that were outside EVERY blocking gate). See build.map.md.

## Derived-figure authority
`docs/FACTS.md` is GENERATED (`bun scripts/facts.ts --write`) and CI-gated (`--check` in `gate`). It
is the authority for published counts (compiler LOC, test files, SPEC lines, conformance cases,
stdlib modules, CLI verbs, LSP capabilities, gated snippets). **Do not hardcode any of those figures
in a doc — cite FACTS.md.** At this HEAD: `live compiler source` **235,334** lines / 187 files;
`test files` **1,294**; `specification lines` **36,767**; `conformance cases` **769**. stdlib modules
(21), CLI verbs (11), LSP capabilities (7) unchanged.

Second generated authority: `compiler/SPEC-INDEX.md`'s totals block (`scripts/regen-spec-index.ts`),
gated by `--check` in CI `gate` AND the local pre-push hook; its line count deliberately matches
`scripts/facts.ts`'s `specLines()` exactly.

**FACTS.md deliberately does NOT publish a §34 diagnostic-code total** ("load-bearing but not
reliably extractable… a wrong number is worse than an absent one"). error.map.md carries the
reconciled count — **801 at this HEAD** (+1: `E-IF-IN-DISPATCHED-ARM`) — with its own re-derivable
`comm`-set-diff methodology.

---

## INVARIANTS AND PROHIBITIONS — the rows grep cannot find

> This is the section that earns the map set. Everything here is a rule about what you must NOT do,
> or a property that must keep holding — none of it is discoverable by grepping for a symbol, and
> several of these were violated once already and cost a measured regression. Ordinary "where does X
> live" rows lose to grep in a 235k-line single-language tree with rigorous naming; these do not.
> The long form of each lives in the map named in the right column.

| # | Invariant / prohibition | Long form |
|---|---|---|
| 1 | **`if=` is fenced at exactly THREE structural elements — `<engine>`, `<match>`, `<each>` — and SHALL NOT be generalized to the registry (§17.1.2).** Every other scrml-defined structural element (`<onTransition>`/`<onTimeout>`/`<onIdle>`/`<errors>`/`<channel>`/`<page>`) SHALL REJECT it. `<auth>` is deliberately NOT on the reject list (it is a `kind:"markup"` node and gates correctly). | domain.map.md §17.1.2 |
| 2 | **`if=` gates RENDER, never LIFECYCLE (§17.1.2.1).** A gated `<engine>`'s auto-declared variable stays declared and readable; `rule=`, `effect=`, `<onTransition>`, `<onTimeout>`, `<onIdle>` stay LIVE; transitions keep occurring; the boot-only opener `effect=` is NOT re-fired on false→true. Tying lifecycle to the predicate makes `if=` a state-destroying operator and breaks the §51.0.A singleton invariant. | domain.map.md §17.1.2 |
| 3 | **A structural `if=` INSIDE an `<each>` row template is NOT honored and fails OPEN (§17.1.2.3).** Markup and structural fail in OPPOSITE directions there — markup-non-root fails CLOSED (loud), structural fails OPEN (silently ships content a predicate was written to withhold). Carved out explicitly *because* the failure is silent and dangerous. | domain.map.md §17.1.2 |
| 4 | **`E-IF-IN-DISPATCHED-ARM` still guards ARM BODIES and must be reverted as a UNIT, not eroded.** Omitting it on the new structural path was a measured regression (a `<each … if=>` in a `<match>` arm: 2 rows → 0 after one arm round-trip, no diagnostic). Refusing DROPS the element rather than emitting it ungated. `refuseConditionalInDispatchedArm`, `emit-html.ts:780`, **THREE** call sites (`:1508` structural, `:1737` chain, `:2727` markup). **The revert SHA `2fbe6520` named in hand-off.md is NOT in this repo's history** — `git revert 2fbe6520` fails; revert by symbol. | domain.map.md §17.1.2 · error.map.md |
| 5 | **ONE `if=` lowering, no second one.** #289 deleted the display-toggle lowering a purity test used to select; a single `${…}` flipped the attribute between *removes* and *hides*. `emitIfMountGate` (`emit-html.ts:1421`) is the sole lowering; all four hosts call it. Hand-rolling the `<template>`+marker wrap at a new host is how the divergence grows back. | domain.map.md §17.1.2 |
| 6 | **`route-inference.ts`'s `inverseCallerMap` (:4466) must stay BYTE-IDENTICAL** — it also drives `E-ROUTE-001` and the D4 `W-DEAD-FUNCTION` gate. Indirect (alias / dispatch-table) edges go through the SEPARATE `indirectInverseCallerMap` (:4707), consulted ONLY by the Step 5c caller-context fixed point. | dependencies.map.md |
| 7 | **The shared call-graph walk (`exprNodeCollectCallees` / `forEachCallInExprNode`) must NOT be widened** without re-deriving the S299 measurement: widening it escalated **72 corpus sites** that are correct client code today. Both S299's Trigger-3 walk and S303's indirect resolver were built as SEPARATE local walks for exactly this reason. | dependencies.map.md |
| 8 | **An INDIRECT callee edge is ESCALATION-ONLY (FIX A, `route-inference.ts:4758`).** A SERVER indirect caller adds promotion pressure; a CLIENT indirect caller is IGNORED. Counting client indirect callers DEMOTES a directly-server-called helper to client → the server caller references an undefined symbol → 500. | dependencies.map.md |
| 9 | **A MARKUP-referenced helper is EXCLUDED from indirect escalation (FIX B, `:4766`)** — relocating it turns a synchronous render into a blanking async fetch. | dependencies.map.md |
| 10 | **`route-inference.ts` holds TWO server-only stdlib module sets and they must not be merged.** `SERVER_ONLY_SCRML_MODULES` (:579) feeds ASYNC classification (over-inclusion free). `ESCALATION_SERVER_ONLY_MODULES` (:656) feeds PLACEMENT (under-include = client leak; over-include = wrong relocation). | dependencies.map.md |
| 11 | **`node.id` is a codegen contract.** Emitted `<each>` fence comments, `_scrml_each_renderers` keys and chunk-namespace tokens are DERIVED from it; a duplicate id is a green compile with wrong rendered output and zero diagnostics. Component expansion clones per instantiation; `chunk-namespace.ts` covers the cross-file half; **neither saves you from the other's failure.** | domain.map.md |
| 12 | **The dist tree is NOT a mirror of the source tree (§47.9.5).** Any code relating two files must pick ONE coordinate space and stay in it; reversal from dist back to source needs a FORWARD INDEX because the inverse is ambiguous. A path oracle written in the implementation's own coordinate space proves nothing. | domain.map.md |
| 13 | **A protected DB column can never reach the client bundle (E-CG-001, §14.8.9), fail-closed and acorn-exact.** The new client-side `export const` emitter (`emitReferencedModuleExportConstLines`, `emit-client.ts`) is admitted only through an AST-PRECISE reference set built from `IdentExpr` nodes with two PRUNED subtrees — never a text/regex match, so a name in a fetch stub, a string literal or a comment can never widen it. | dependencies.map.md |
| 14 | **pre-push MUST NOT point at the whole of `compiler/tests/`.** browser/lsp/self-host/commands carry a DOCUMENTED FAILURE BASELINE (~42 at 2026-07-30) assessed by comparing failure-NAME SETS, not counts; an exit-code gate cannot express that, so the whole-tree scope made the hook structurally unpassable — the cry-wolf shape that gets a gate bypassed and then deleted. | build.map.md |
| 15 | **A gate that is correctly non-blocking and habitually red is where a real regression hides.** The 14 root-level `compiler/tests/*.test.js` were outside every blocking check; a 38-failure native-parity regression passed pre-commit AND the required `gate`, surfacing only as a red `tracking` (`continue-on-error: true`). Now wired into both. | build.map.md · test.map.md |
| 16 | **`null` and `undefined` do not exist in scrml source in ANY position (§42)** — `not` is the sole absence value. | domain.map.md |
| 17 | **A superuser/table-owner BYPASSES Postgres `FORCE ROW LEVEL SECURITY`** — the bounded `NOLOGIN NOBYPASSRLS` role is MANDATORY, not a hardening nicety. Without it the RLS policy is a silent no-op that LOOKS enforced. | domain.map.md · migrations.map.md |
| 18 | **A diagnostic code can carry two unrelated meanings from two files.** Ruled twice (`E-IMPORT-007` S297, `W-AUTH-001` S299) and both times the second meaning was undocumented. Standing ruling: **allocate fresh, never renumber.** | error.map.md |

---

## Map Index

| Map | Stamp | Contents |
|---|---|---|
| **primary.map.md** | **`fe14c9b2`** | this file — fingerprint, INVARIANTS, routing, key facts |
| **domain.map.md** | **`fe14c9b2`** | NEW section: **§17.1.2 `if=` on the three structural elements** (four prohibitions + the runtime mount contract). Business Invariants extended |
| **error.map.md** | **`fe14c9b2`** | **801** §34 codes (+1 `E-IF-IN-DISPATCHED-ARM`); new `E-IF-*` family row; `E-CHANNEL-INSIDE-PAGE` fire site now LIVE; the §34 row's own "two call sites" is stale (three). Per-window changelog sections DELETED |
| **structure.map.md** | **`fe14c9b2`** | new file `indirect-callee-resolver.ts`; the `ast-builder.js` named-regex opener reconstruction row (the window's highest-value locus); counts re-derived; window narratives stripped |
| **test.map.md** | **`fe14c9b2`** | 1294 recounted; the root-level-gate hole; the 13 new files + 13 new conformance cases; the `-rt` runtime-case convention and why an `if=true` case is deliberately DOM-indistinguishable |
| **dependencies.map.md** | **`fe14c9b2`** | the `ifRaw`/`ifCond` FIVE-consumer pipeline (+ mirrors); `indirect-callee-resolver.ts` graph edges; `serverFnPeerAliasNames` threading; the client `export const` gate |
| **build.map.md** | **`fe14c9b2`** | the new `gate` root-level test step; pre-commit + pre-push scope changes and the `set -e` trap |
| **schema.map.md** | **`fe14c9b2`** | `ifRaw`/`ifCond` node fields on `engine-decl`/`match-block`/`each-block` + the ABSENT-not-null parity-canary convention |
| **non-compliance.report.md** | **`fe14c9b2`** | re-verified at this HEAD |
| migrations.map.md | `115e8b1b` | **deliberately older.** No DB/migration surface touched in two windows |
| config.map.md | `115e8b1b` | **deliberately older.** No env var, `compilerSettings` knob or CI secret changed |
| infra.map.md | `115e8b1b` | **deliberately older.** `.github/workflows/` gained ONE step (mapped in build.map.md); cloud-maps status unchanged (still red) |
| auth.map.md | `df2ac831` | **deliberately older.** Correct at its stamp for JWT/OAuth/protect-floor/CSRF/§20.5 session. Auth-ADJACENT facts from later windows are mapped elsewhere on purpose (`W-AUTH-*` split → error.map.md; `scrml:auth`/`scrml:oauth` escalation membership → dependencies.map.md) |
| api.map.md | absent | no REST/GraphQL/gRPC surface owned by this repo — the compiler EMITS API routes for generated apps (§60/§61, domain.map.md) |
| state.map.md | absent | no redux/zustand/jotai — not a frontend app |
| events.map.md | absent | no EventEmitter/pubsub in the compiler's own src — §38 channel semantics are a language feature |
| style.map.md | absent | Tailwind + §65 CSS-native are compiler FEATURES (domain.map.md + error.map.md) |
| i18n.map.md | absent | no locales/i18n dirs |
| jobs.map.md | absent | `scrml:cron` is a stdlib module FOR GENERATED APPS, not a job system this repo runs |

An honest older stamp beats a false "verified at HEAD".

## Task-Shape Routing

| If your task is about… | Read |
|---|---|
| **an attribute you wrote on `<engine>` / `<match>` / `<each>` that has NO effect and NO diagnostic** | **`compiler/src/ast-builder.js` — the OPENER RECONSTRUCTION, not codegen.** Those three kinds are not `kind:"markup"`: the block splitter raw-captures them and `buildBlock` rebuilds each opener by regexing NAMED attributes (`for=`, `initial=`, `on=`, `in=`, `of=`, `key=`, `as`, …). **The node has no `attrs` array at all** — an attribute nobody regexes for is discarded at PARSE time and every downstream stage is innocent. Adding one needs: a named capture (`captureStructuralIfAttr` :2705 + `structuralHeaderAnchor` :2797 are the §17.1.2 template), a field on the node, AND a mirror in `native-parser/{collect-hoisted,parse-file}.js`. dependencies.map.md carries the full five-consumer chain. |
| **`if=` on a structural element · a gated `<engine>` losing state · an `<each>` gate that leaves rows behind · a gate inside an arm or a row template** | **domain.map.md "§17.1.2"** (all four prohibitions + the LIVE-SPAN unmount contract) → `emit-html.ts` `emitGatedStructural` (:1498) / `emitIfMountGate` (:1421) / `isGateableIfValue` (:1472); `runtime-template.js` `_scrml_mount_template` (:1429) / `_scrml_unmount_scope` (:1468) / `_scrml_mount_wire` (:1599) / `_scrml_remount_each_fence` (:1639). |
| **a `W-`/`E-DG-002` on a cell that IS read — but only by a structural `if=`** | `dependency-graph.ts` `creditFromAttrValue` (:2559), called for `ifCond` at :2930. **`ifRaw` is deliberately NOT in the raw-scan lists** — a private `/@ident/` scan over-credits (reads inside string literals) and under-credits (misses an `if=fn()` call-ref's `fnTransitiveReads`). |
| **a structural `if=` predicate resolving against the wrong scope (`if=item.ok` on an `<each>`)** | `type-system.ts` `visitStructuralIfAttr` (:12688) → `visitAttr`. **Called BEFORE `scopeChain.push("each:…")` deliberately** — the opener predicate is evaluated OUTSIDE the per-item scope. |
| **"why did my function move to the server / vanish from the client bundle, with no error?"** | **A PLACEMENT question, not a diagnostic one — §12 emits no code for it.** domain.map.md "§12.2 Trigger 3" + `route-inference.ts` `ESCALATION_SERVER_ONLY_MODULES` (:656) / `collectServerOnlyBindingModules` (:3397). Since S303 also check the INDIRECT path: `indirect-callee-resolver.ts` + `indirectInverseCallerMap` (:4707). |
| **a helper reached through an alias or a dispatch table (`const p = fn; p(x)`) that is not awaited / not server-placed** | `compiler/src/indirect-callee-resolver.ts` — `resolveIndirectCallees` / `indirectResolvedCallees` / `aliasNamesResolvingTo` / `fnParamNameSet` for the ALIAS shape, and `dispatchTableNamesWithPeers` / `dispatchTablePeerMembers` for the OBJECT-LITERAL DISPATCH-TABLE shape (`t[k](...)` has a member callee, so it never appears in `calledNames`) — plus `route-inference.ts:4692-4729` and `emit-server.ts:3043`. For the await-lowering half: `serverFnPeerAliasNames` threaded into `EmitExprContext` (`emit-expr.ts:473`, consumed :1488 / :3013). **Invariants 6-9 above apply — read them before widening anything.** |
| **adding / changing a server-only stdlib module classification** | `route-inference.ts` — **and get the SET right** (invariant 10). dependencies.map.md carries the 21-module classification table. |
| **adding an `EscalationReason` kind / touching `escalationReasons`** | dependencies.map.md's `escalationReasons` table. **Check `codegen/emit-server.ts:727` (`isBodyOnlyEscalation`) FIRST** — it gates on EVERY reason being `server-only-resource`, so a new kind fails that `.every()` and silently re-attaches an HTTP wrapper §12.6 says to drop. |
| **a `ReferenceError: _scrml_* is not defined` in a shipped bundle · runtime-chunk tree-shake gates** | `codegen/emit-client.ts` — `detectRuntimeChunks` (:273, PRE-EMIT AST walk) + `POST_EMIT_HELPER_CHUNK_GATES` (POST-EMIT reference scan) — AND `codegen/runtime-chunks.ts` `CHUNK_DEPENDENCIES` / `applyChunkDependencies`. **NOT `codegen/index.ts`.** Post-emit entries match as SUBSTRINGS and the scan runs BEFORE `cell-accessor-rename.ts`'s `_scrml_cs_` rename. |
| **a module-level `const` that is undefined at runtime in one bundle but not the other** | Two SEPARATE emitters, same class, opposite bundles: `emit-server.ts` `emitReferencedModuleConstLines` (D-5, S293) and `emit-client.ts` `emitReferencedModuleExportConstLines` (#263, S301). The client one is §14.8-gated — see invariant 13. |
| **an emitted path that resolves at one nesting depth and not another · `Cannot find module` from a `.server.js`** | **domain.map.md "Coordinate space: SOURCE vs DIST"** + `emit-server.ts` `distRelativeServerSpecifier` + `api.js` `serverImportTargetSource` / `distServerKeyToSource`. SPEC §47.9.5. |
| **a diagnostic code — ANY code, any prefix** | **error.map.md** — start at its "HOW TO LOOK UP A DIAGNOSTIC CODE" preamble. Honest order: (0) `.claude/maps/error.generated.md` if it is an `E-` code (353 entries, **E-ONLY**, stamped 2026-06-25 — trust the FILE, re-grep the LINE); (1) error.map.md's family table IF your prefix is one of the **68** it names (of **186** in §34); (2) `grep -rn "<CODE>" compiler/src/` — the only complete method; (3) grep SPEC.md for the normative meaning. **Do NOT infer a fire site from an adjacent family** — families are feature-scoped, not name-scoped. |
| **a `W-*` or `I-*` code specifically** | **error.map.md only** — `error.generated.md` contains ZERO `W-`/`I-` entries by construction, so it will look like the code does not exist. Then `grep`. |
| **a `W-`-looking string you grepped out of `compiler/src/codegen/`** | error.map.md's "NOT diagnostics" note. `W-LIFT-TIER0-*` / `W-EACH-PERITEM-*` are `//` COMMENTS pushed into the emitted JS. No §34 row, no stream, not assertable except as text. |
| **two components rendering each other's data · an `<each>` fence resolving to the wrong list · anything keyed on `node.id`** | **domain.map.md "Node identity is a CODEGEN CONTRACT"** + `component-expander.ts` `expandComponentNode` / `_deepCloneAst`. **Reproduce with TWO instantiations in ONE file** — every single-component test is green on this bug. |
| **a `<channel>` that compiles clean but delivers nothing / is wired at the wrong scope** | `symbol-table.ts` — `E-CHANNEL-INSIDE-PAGE`'s fire site was MISSING until S301 (#286): the code was cataloged, the check was never wired, and a `<channel>` in a `<page>` compiled clean and wired program-scoped. Sibling: the LISTEN channel-name quoting fix (#281) — a camelCase `<channel watches=>` delivered zero rows silently. error.map.md. |
| **a per-item `if=` that hides instead of unmounting · a row that stops updating after a toggle** | `codegen/emit-each.ts` (Tier-1, `isSoleItemRoot`) OR `codegen/emit-lift.js` (Tier-0) → the shared `runtime-template.js` `_scrml_ifrow_apply`. **Fix one tier and the other stays broken** — separate emit paths, one runtime helper; the conformance corpus mirrors the families for exactly that reason. |
| **`on mount` / a server call that returns a pending Promise / §13.2 auto-await placement** | `codegen/scheduling.ts` (`emittedCodeCallsServerFn`, `liftEmittedStatementAwaits`, `scanEmittedCode`) + `codegen/emit-reactive-wiring.ts` — dependencies.map.md. §13.2's obligation has THREE destinations (function body, reactive-cell initializer, desugared `on mount`); missing one is fail-OPEN. |
| **cross-chunk soft navigation / a soft-nav that renders correct-but-inert markup** | domain.map.md "Cross-chunk soft navigation" + `runtime-template.js` (the `_scrml_chunk_loading` DEPTH COUNTER) + `codegen/emit-event-wiring.ts` |
| **a form control whose `value=` won't clear / caret jumps while typing** | `codegen/emit-bindings.ts` (file scope, i174) OR `emit-html.ts` → `binding-registry.ts` `directiveIsFormValue` → `emit-variant-guard.ts` (inside a `<match>`/`<engine>` arm, i225) |
| **the DB-authoritative security tier — RLS/roles/SECDEF/db-migrate/grants** | domain.map.md (concept + threat model) + migrations.map.md (apply model, queried-table grants, constraint drift) + schema.map.md + error.map.md + build.map.md |
| which tables a `?{}` touches / a `permission denied` at request time | `compiler/src/sql-table-refs.js` + migrations.map.md. **Never read an empty `tables` as "touches nothing"** — check `undetermined`. |
| a `status=` value in `docs/known-gaps.md` / the §0 gap-counts rollup | build.map.md "Gap-status vocabulary". `scripts/state.ts` THROWS on an unknown status — adding a new status word breaks CI Stage 1 by design. |
| a mechanical symbol / import-edge / E-code index (faster than prose for a pure lookup) | `.claude/maps/{structure,dependencies,error,test}.generated.md` — `@generated` by `flogence/scripts/mapgen.ts`, **NOT by this repo's CI, and stamped 2026-06-25** (~5 weeks / ~77 commits stale at this HEAD). File attribution reliable; line numbers a starting point. |
| types / interfaces / AST node shapes | schema.map.md |
| environment variables / config keys / lint suppression knobs | config.map.md |
| test patterns / fixtures / which tier a test runs in / which gate runs it | test.map.md |
| build commands / CI stages / CLI flags / packaging + publish surface / git hooks | build.map.md |
| directory layout / entry points / where a file lives | structure.map.md |
| external packages / module graph / producer→consumer chains | dependencies.map.md |
| language primitives / SPEC navigation / business invariants | domain.map.md |
| auth flows / JWT / OAuth / protect-floor / session builtin | auth.map.md (stamp `df2ac831` — honest, unchanged surface) |
| **per-session history: what landed when, and why** | **`docs/changelog.md` + `handOffs/delta-log.md` + `hand-off.md`. NOT these maps** — that content was deleted from them this pass on purpose. |
| non-compliant / stale docs | non-compliance.report.md |

## Key Facts

- Entry point: `compiler/bin/scrml.js` -> `compiler/src/cli.js` dispatches to `commands/*.js` (11 subcommands); the pipeline is `compileScrml()` in `compiler/src/api.js` (block-split -> AST-build -> type-check -> codegen).
- **The three scrml structural elements are parsed by NAMED REGEX, not by generic attribute parsing.** `engine-decl` / `match-block` / `each-block` carry no `attrs` array; their openers are reconstructed field by field in `ast-builder.js`. This is the single highest-value symptom→locus fact from this window: *an attribute that vanishes with no diagnostic is a PARSE-stage fact, and nothing in codegen will show it to you.*
- **A structural `if=` has FIVE consumers plus two native-parser mirrors** (capture → exprNode walker → scope check → DG reader credit → emit), and the reason each is routed through the SAME function the markup path uses is to make a structural predicate and a markup predicate structurally incapable of diverging. A private re-implementation at any one of them is the defect this arc removed.
- **`ifRaw`/`ifCond` are ABSENT, not null, when there is no `if=`.** The within-node parser-parity canary compares FIELD SETS; null-stamping every engine/match/each in the corpus grows the divergence allowlist. Precedent on the same node family: `engine-decl.bodyChildren`.
- The compiler ships TWO parsers: the live pipeline and `compiler/native-parser/` (`--parser=scrml-native`). **This window DID incur a parity obligation and it was paid** — `collect-hoisted.js` `readStructuralIfAttr` + `parse-file.js` (three sites). A landing that adds an AST field to a structural node owes a native mirror; an emit-time / runtime / CLI / message-only landing does not.
- **SPEC.md is the sole normative source.** PIPELINE.md documents stage internals. Any doc contradicting SPEC.md is non-compliant per pa.md Rule 4. §17.1.2 is unusual and worth reading directly: it states its own ENFORCEMENT STATUS ("`<channel>`/`<errors>` emit only `W-ATTR-001`… `<onTimeout>`/`<onIdle>` ignore it with zero diagnostics") rather than asserting a SHALL the impl does not yet keep.
- **`.claude/` is gitignored; `.claude/maps/` and `.claude/agents/project-mapper.md` are FORCE-tracked.** Staging a map refresh requires `git add -f`. Because the maps publish with the public repo, a map generation must not reintroduce third-party adopter identity (scrubbed at `89db7981`).
- **The automated map refresh is STILL DOWN.** `cloud-maps` has failed every scheduled run; since 2026-07-17 the agent errors on turn 1 in ~0.6s at $0 cost — an API-level rejection of the first request, not a mapper fault. It is off the required-checks list, so it blocks no merge; its only cost is silent map staleness, which is exactly how this watermark stranded 27 commits across four sessions.
- **These maps have no CI gate of their own.** Any generation that asserts completeness ("every family", "all loci", "fully routed") should be treated as a hypothesis until re-derived — S297 closed a gap with a coverage claim that measured 67/185 true.

## Tags
#scrml #map #primary #index #compiler #bun #invariants #prohibitions #if-structural #structural-if #§17.1.2 #render-not-lifecycle #each-row-template-fails-open #e-if-in-dispatched-arm #one-if-lowering #emit-if-mount-gate #ast-builder-named-regex #no-attrs-array #if-cond #if-raw #absent-not-null #parity-canary #native-parser-mirror #live-span-unmount #scrml-if-range #remount-each-fence #indirect-callee-resolver #indirect-inverse-caller-map #inverse-caller-map-byte-identical #escalation-only #fix-a #fix-b #markup-referenced-exclusion #server-fn-peer-alias-names #72-site-over-escalation #trigger-3 #two-set-distinction #escalation-reasons #node-identity #coordinate-space #dist-space #source-space #runtime-chunks #export-const-client-gate #§14.8 #protect-floor #root-level-test-gate #gate-hole #pre-push-scope #documented-failure-baseline #cry-wolf #e-channel-inside-page #listen-quoting #dbauth #rls #secdef #cloud-maps #ci-red #changelog-dereferenced

## Links
- [domain.map.md](./domain.map.md)
- [structure.map.md](./structure.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [schema.map.md](./schema.map.md)
- [config.map.md](./config.map.md)
- [build.map.md](./build.map.md)
- [error.map.md](./error.map.md)
- [test.map.md](./test.map.md)
- [auth.map.md](./auth.map.md)
- [infra.map.md](./infra.map.md)
- [migrations.map.md](./migrations.map.md)
- [non-compliance.report.md](./non-compliance.report.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
