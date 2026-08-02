# primary.map.md
# project: scrml
# updated: 2026-08-02T18:40:00Z  commit: e80b692e
# NOTE (S313 pass): INCREMENTAL over `fe14c9b2` -> `e80b692e` — **67 commits, five sessions**
# (S307·bryan, S309-cont, S310·peter, S310·bryan, S311·peter, S311-cont, S312·peter, S313·bryan).
# Re-walked: primary, structure, domain, dependencies, error, test, build, config, infra,
# non-compliance. NOT re-walked: schema, migrations, auth (no `types/ast.ts`, DB or auth surface in
# this window touched them; each keeps its own honest stamp in the Map Index).
#
# Per-window landing narratives stay DELETED (S302 ruling — S299 measured this set at 0/4
# load-bearing with ~40% duplicating `docs/changelog.md`). **History lives in `docs/changelog.md` +
# `handOffs/delta-log.md`.** What earns space here is rules a grep cannot find.

## Project Fingerprint
Language:   TypeScript / JavaScript (mixed) + scrml itself (self-hosting stdlib + self-host compiler experiments)
Framework:  Custom compiler pipeline (no web framework) — Bun-native
Runtime:    Bun >=1.3.13 (no Node support; Bun-specific APIs throughout — `Bun.serve`, `bun:sqlite`, `Bun.$`, `Bun.SQL`, `Bun.hash`)
Type:       CLI compiler + language toolchain (single-file full-stack web-language compiler, with LSP + editor-tooling + MCP surfaces)
Size:       **7377** git-tracked files. `compiler/src/` **189** (144 .ts + 43 .js + 2 other) — unchanged in COUNT; this window grew by editing. `compiler/tests/` **1304** `*.test.js`.
Version:    v0.7.1 (root package.json — the SOLE manifest; not a workspace monorepo, `files`-allowlisted, publishable)
CI:         GitHub Actions — three workflows on `main`, **all three changed this window**: `ci.yml` (`gate` now **12 steps**, +the browser failure-NAME-SET gate and the SPEC §34.0 row-provenance gate; `fetch-depth: 0`), `advisory-review.yml` (**DISABLED — manual fire only**), `cloud-maps.yml` (**Stage 2, the map-regeneration agent, DELETED**). Both AI legs were killed as a **cost decision**, not a broken secret.

## ⚠️ MAP CURRENCY IS NOW MANUAL — READ THIS BEFORE TRUSTING A STAMP
`cloud-maps` **no longer refreshes `.claude/maps/` on any schedule.** Map regeneration reverted to the
PA at wrap. A stamp is exactly as old as the last wrap and **nothing will move it for you.** The two
preceding windows drifted 27 then 67 commits behind before a manual pass caught them. Treat any map
line as a *verify-against-source hypothesis* if `git log --oneline <stamp>..HEAD` is non-trivial.

## Derived-figure authority
`docs/FACTS.md` is GENERATED (`bun scripts/facts.ts --write`) and CI-gated (`--check` in `gate`). It
is the authority for published counts (compiler LOC, test files, SPEC lines, conformance cases,
stdlib modules, CLI verbs, LSP capabilities, gated snippets). **Do not hardcode any of those figures
in a doc — cite FACTS.md.** At this HEAD: `live compiler source` **236,082** lines / 187 files;
`test files` **1,304**; `specification lines` **37,026**; `conformance cases` **850**. stdlib modules
(21), CLI verbs (11), LSP capabilities (7) unchanged.

Second generated authority: `compiler/SPEC-INDEX.md`'s totals block (`scripts/regen-spec-index.ts`),
gated by `--check` in CI `gate` AND the local pre-push hook; its line count deliberately matches
`scripts/facts.ts`'s `specLines()` exactly. **Only the totals are gated — the AUTHORED half of that
file is ungated and has rotted** (non-compliance.report.md C5).

**FACTS.md deliberately does NOT publish a §34 diagnostic-code total** ("load-bearing but not
reliably extractable… a wrong number is worse than an absent one"). error.map.md carries the
reconciled count — **804 at this HEAD** (+3) — and, NEW this window, there is a machine oracle:
**`bun scripts/s34-census.ts`**, in-repo, no baked line numbers, and wired into `gate` as the
diff-scoped SPEC §34.0 row-provenance check.

---

## INVARIANTS AND PROHIBITIONS — the rows grep cannot find

> This is the section that earns the map set. Everything here is a rule about what you must NOT do,
> or a property that must keep holding — none of it is discoverable by grepping for a symbol, and
> several were violated once already and cost a measured regression. Ordinary "where does X live"
> rows lose to grep in a 236k-line tree with rigorous naming; these do not. The long form of each
> lives in the map named in the right column.

| # | Invariant / prohibition | Long form |
|---|---|---|
| 1 | **The module-init / rehydrator boundary is EMISSION ORDER, not a structure.** `emit-event-wiring.ts` pushes `(function(){` + `function _scrml_boot(){` at `:715-716` and closes at `:2186-2193`. Everything `emit-client.ts` emitted BEFORE its `emitEventWiring(...)` call (`:2475`) runs at script-eval; everything that call returns runs inside `_scrml_boot`. **Nothing marks the seam.** | structure.map.md · dependencies.map.md |
| 2 | **`_scrml_nav_rewire` is non-delegable handlers + reactive display binding ONLY.** `<timer>`, `<poll>`, `<request>`, `on mount`, cell inits and engine substrate are NOT in it — they are module-init. A route chunk's timer therefore **starts exactly once, ever**, and an "active-region flag around the rehydrator loop" captures nothing. | domain.map.md · dependencies.map.md |
| 3 | **The emit-time region↔resource association EXISTS and is LEXICAL — `_outletResident`** (`emit-reactive-wiring.ts:1105`/`:1114`). It never fires for route content, because route content lives in a DIFFERENT FILE from the shell that owns the `<outlet>`. The machinery is right; the granularity is wrong. `fileHasOutlet` (`:1042`) is likewise insufficient for the single-file `<page>` form. | structure.map.md · domain.map.md |
| 4 | **A soft navigation SHALL NOT mount or destroy any SCOPE (§6.7.2).** The `<outlet>` region is a **route region** keyed on `(route, params)` — a THIRD lifecycle owner (§6.7.2.1), not a scope. Edges come from exactly three events; an aborted/superseded nav emits **none**. | domain.map.md |
| 5 | **`<machine>` does not compile.** `E-DEPRECATED-001`, Error, from `ast-builder.js:16839`. It still PARSES so the report is ONE diagnostic, not a cascade. **A blind keyword swap is a silent semantics change** — `<engine derived=>` drops a projection body — so `scrml migrate`'s Migration 2a rewrites the body into §51.0.J `derived=match` and **fails CLOSED on any unparseable line**. Both fronted subsystems (§51.11 audit, §51.13 property tests) were PORTED, not retired. | domain.map.md · structure.map.md |
| 6 | **A NEW or TOUCHED §34 row SHALL state where it fires, or declare itself spec-ahead (§34.0).** DIFF-SCOPED by construction; **never retrofit it over the legacy corpus** — an instantly-red gate is bypassed then deleted. Corollary: a code may be normatively NAMED with **no §34 row at all** (`E-ERROR-011`, `W-ROUTE-REQUEST-DUPLICATES-SERVER-LOAD`). | error.map.md |
| 7 | **A failable function's error type SHALL be an ENUM (§19.4.4.1)** — only a variant carries `renders`, and without it the function sits silently outside the `<errorBoundary>` guarantee `E-ERROR-005` enforces. **The corpus migrated FIRST (6 sites) so the rejection lands inert** — per §62.2 the corpus IS the contract, so the migration, not the SPEC sentence, is what moved it. | domain.map.md |
| 8 | **Gate on the failure NAME SET, not the count and not the exit code.** A tier that always exits 1 is information-free in both directions AND halts every step behind it (verified: `Within-node parser-parity + canary` reported `skipped` and had never run). `browser-baseline.ts --check` is bidirectional — a name LEAVING means the baseline is stale, prune it in the fixing commit. **Never `--write` to turn a red check green.** | build.map.md · test.map.md |
| 9 | **`if=` is fenced at exactly THREE structural elements — `<engine>`, `<match>`, `<each>` — and SHALL NOT be generalized to the registry (§17.1.2).** `<auth>` is deliberately NOT on the reject list (a `kind:"markup"` node that gates correctly). | domain.map.md §17.1.2 |
| 10 | **`if=` gates RENDER, never LIFECYCLE (§17.1.2.1).** A gated `<engine>`'s variable stays declared; `rule=`, `effect=`, `<onTransition>`/`<onTimeout>`/`<onIdle>` stay LIVE; the boot-only opener `effect=` is NOT re-fired on false→true. The alternative makes `if=` state-destroying and breaks the §51.0.A singleton invariant. | domain.map.md §17.1.2 |
| 11 | **A structural `if=` INSIDE an `<each>` row template is NOT honored and fails OPEN (§17.1.2.3).** Markup fails CLOSED in the same position — the two are inconsistent in the DANGEROUS direction, which is why it is carved out explicitly. | domain.map.md §17.1.2 |
| 12 | **`E-IF-IN-DISPATCHED-ARM` guards ARM BODIES and must be reverted as a UNIT.** `refuseConditionalInDispatchedArm` (`emit-html.ts:780`), **THREE** call sites (`:1508` / `:1737` / `:2727`). **The revert SHA `2fbe6520` in hand-off.md is NOT in this repo's history** — revert by symbol. | domain.map.md · error.map.md |
| 13 | **ONE `if=` lowering, no second one.** `emitIfMountGate` (`emit-html.ts:1421`) is the sole lowering; all four hosts call it. #289 deleted the display-toggle lowering a purity test used to select. | domain.map.md §17.1.2 |
| 14 | **`route-inference.ts`'s `inverseCallerMap` (:4466) must stay BYTE-IDENTICAL** — it also drives `E-ROUTE-001` and the D4 `W-DEAD-FUNCTION` gate. Indirect edges go through the SEPARATE `indirectInverseCallerMap` (:4707). | dependencies.map.md |
| 15 | **The shared call-graph walk must NOT be widened** without re-deriving the S299 measurement: widening it escalated **72 corpus sites** that are correct client code today. | dependencies.map.md |
| 16 | **An INDIRECT callee edge is ESCALATION-ONLY (FIX A, :4758).** A CLIENT indirect caller is IGNORED — counting it DEMOTES a directly-server-called helper and the server caller then references an undefined symbol → 500. **FIX B (:4766): a MARKUP-referenced helper is excluded entirely** — relocating it turns a synchronous render into a blanking async fetch. | dependencies.map.md |
| 17 | **`route-inference.ts` holds TWO server-only stdlib module sets and they must not be merged.** `SERVER_ONLY_SCRML_MODULES` (:579) feeds ASYNC classification (over-inclusion free). `ESCALATION_SERVER_ONLY_MODULES` (:656) feeds PLACEMENT (under-include = client leak; over-include = wrong relocation). | dependencies.map.md |
| 18 | **`node.id` is a codegen contract.** Emitted `<each>` fence comments, `_scrml_each_renderers` keys and chunk-namespace tokens are DERIVED from it; a duplicate id is a green compile with wrong rendered output and zero diagnostics. **Reproduce with TWO instantiations in ONE file.** | domain.map.md |
| 19 | **The dist tree is NOT a mirror of the source tree (§47.9.5).** Pick ONE coordinate space and stay in it; reversal needs a FORWARD INDEX because the inverse is ambiguous. **A path oracle written in the implementation's own coordinate space proves nothing.** | domain.map.md |
| 20 | **A protected DB column can never reach the client bundle (E-CG-001, §14.8.9), fail-closed and acorn-exact.** The client `export const` emitter admits only an AST-PRECISE `IdentExpr` reference set with two PRUNED subtrees — never a text match. | dependencies.map.md |
| 21 | **`null` and `undefined` do not exist in scrml source in ANY position (§42)** — `not` is the sole absence value. `""`/`0`/`false`/`[]`/`{}` are DEFINED values, not absence. | domain.map.md |
| 22 | **A superuser/table-owner BYPASSES Postgres `FORCE ROW LEVEL SECURITY`** — the bounded `NOLOGIN NOBYPASSRLS` role is MANDATORY, not a hardening nicety. Without it the RLS policy is a silent no-op that LOOKS enforced. | domain.map.md · migrations.map.md |
| 23 | **A diagnostic code can carry two unrelated meanings from two files.** Ruled twice (`E-IMPORT-007` S297, `W-AUTH-001` S299). Standing ruling: **allocate fresh, never renumber.** | error.map.md |
| 24 | **A §34 row is not evidence of a fire site — and now neither is an emitter string.** `E-CHANNEL-INSIDE-PAGE` was cataloged and never wired; `E-MW-006` has a `code:` push the guarded shape cannot reach (**middleware is dropped silently**). Execute, or trace the caller. | error.map.md |
| 25 | **Emitted ≠ runs. FOUR recorded occurrences now** (S265 theme-switch, S268 component-root, GH #234, **S307 engine audit** — where the registration emitted and the log stayed empty because the raw cell name resolved in the wrong chunk key space). **Execute the bundle.** | test.map.md |
| 26 | **An auto-GENERATED test artifact must SKIP, never PASS, on an empty run.** §51.13 emitted `expect(true).toBe(true)` into an ADOPTER's suite as a green tick, and fired precisely for the canonical modern `<engine>` form. | test.map.md |
| 27 | **A silent-drop guard must itself be testable.** `scripts/state.ts`'s `@gap` parser now THROWS on an unparsed marker AND on an unknown status; `parseGapMarkers` is exported and the CLI is `import.meta.main`-gated **specifically so the guard can be exercised** — a gate that cannot be tested is indistinguishable from one that cannot fail. It has since fired correctly on its own author. | build.map.md |

---

## Map Index

| Map | Stamp | Contents |
|---|---|---|
| **primary.map.md** | **`e80b692e`** | this file — fingerprint, 27 INVARIANTS, routing, key facts |
| **structure.map.md** | **`e80b692e`** | **NEW: "THE EMITTED-BUNDLE EXECUTION BOUNDARY"** (module-init vs rehydrator, with file:line). `<machine>` removal in ast-builder; the `scheduling.ts` CORRECTION (six helpers deleted); the two new scripts; counts re-derived |
| **domain.map.md** | **`e80b692e`** | **FOUR new sections:** the route region as a third lifecycle owner (§6.7.2.1/§20.8.8, Pole C) incl. what the impl actually does today; `<machine>` REMOVED (§63.7); §19.4.4.1 enum-only; §6.7.1a bare-expression. Six new Business Invariants |
| **error.map.md** | **`e80b692e`** | **804** §34 codes (+3); **NEW §34.0 rule + the `s34-census.ts` oracle and its buckets**; 18→34 tombstones; 103→5 `:line` citations; `E-LIFECYCLE-001/002/004` now FIRE; W-LINT correction (nine→eight); the NAMED-but-uncatalogued pair |
| **test.map.md** | **`e80b692e`** | 1304 recounted; **the browser tier is now BLOCKING via its failure NAME SET**; the skipped-step-behind-a-red-step finding; 850 conformance; four new coverage-shape rules |
| **dependencies.map.md** | **`e80b692e`** | **NEW: the module-init vs rehydrator PRODUCER TABLE**; the `scheduling.ts` acorn rewrite; the audit-registry and §51.13 projection edges; `dispatchCalledTargets`; the AI-action correction |
| **build.map.md** | **`e80b692e`** | `gate` 8→12 steps; both AI legs killed; **`cloud-maps` no longer refreshes maps**; `browser-baseline.ts` + `s34-census.ts`; the second `@gap` silent-drop guard |
| **config.map.md** | **`e80b692e`** | env surface UNCHANGED across five sessions; the `ANTHROPIC_API_KEY` row inverted |
| **infra.map.md** | **`e80b692e`** | all three workflows changed; the old cloud-maps credential diagnosis retired as MOOT |
| **non-compliance.report.md** | **`e80b692e`** | every carried finding re-executed at this HEAD |
| schema.map.md | `fe14c9b2` | **deliberately older.** `compiler/src/types/` has ZERO diff this window — no new FileAST node kind, no changed AST shape. The one new shape (`IndirectResolution.dispatchCalledTargets`) is codegen-internal and is mapped in dependencies.map.md |
| migrations.map.md | `115e8b1b` | **deliberately older.** No DB/migration surface touched in three windows |
| auth.map.md | `df2ac831` | **deliberately older.** Correct at its stamp for JWT/OAuth/protect-floor/CSRF/§20.5 session. Auth-ADJACENT facts from later windows are mapped elsewhere on purpose |
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
| **"where is per-chunk MODULE-INIT emitted, and what owns the boundary with the soft-nav rehydrator?"** | **`codegen/emit-client.ts` (assembly) + `codegen/emit-reactive-wiring.ts` (the lifecycle bodies) + `codegen/emit-event-wiring.ts` (the boundary).** **NOT `codegen/index.ts`** — its `wrapChunkBodyInIife` (:699) wraps the WHOLE body including `_scrml_boot`, so it is lexical isolation, not the boundary. **There is no chunk/route splitter** — a chunk is one `.scrml` file's `.client.js`. Full producer table in dependencies.map.md ("Module-init vs the soft-nav rehydrator"); file:line walkthrough in structure.map.md ("THE EMITTED-BUNDLE EXECUTION BOUNDARY"). |
| **a route's `<timer>`/`<poll>` that keeps firing after a soft nav · route content that does not re-run on re-entry · `cleanup()` that never fires on a route change** | **domain.map.md "The route region is a THIRD lifecycle owner"** — read the "WHAT THE IMPLEMENTATION ACTUALLY DOES TODAY" block before scoping. The emit-time association exists (`_outletResident`) and is LEXICAL; a runtime-only fix is impossible (`_scrml_timer_start` takes no element, `<timer>` emits no DOM node). `g-route-timer-poll-not-stopped-on-soft-nav` (HIGH, open) + `docs/changes/route-region-teardown/`. |
| **a `<machine>` that used to compile · `scrml migrate` output · a projection engine that lost its rules** | **domain.map.md "The `<machine>` keyword is REMOVED"** → `ast-builder.js:16835-16845` (E-DEPRECATED-001) + `commands/migrate.js` Migrations 2a/2/2b. **A blind keyword swap silently drops a projection body** — that is what 2a exists to prevent, and it fails CLOSED. |
| **an attribute you wrote on `<engine>` / `<match>` / `<each>` that has NO effect and NO diagnostic** | **`compiler/src/ast-builder.js` — the OPENER RECONSTRUCTION, not codegen.** Those three kinds carry **no `attrs` array**; `buildBlock` rebuilds each opener by regexing NAMED attributes. An attribute nobody regexes for is discarded at PARSE time and every downstream stage is innocent. Template: `captureStructuralIfAttr` (:2705) + `structuralHeaderAnchor` (:2797), plus a field on the node AND a mirror in `native-parser/{collect-hoisted,parse-file}.js`. |
| **a diagnostic code — ANY code, any prefix** | **error.map.md**, starting at "HOW TO LOOK UP A DIAGNOSTIC CODE". Honest order: (0) **`bun scripts/s34-census.ts --full`** — in-repo, current, and it answers "does this have an emitter at all / is it pinned?"; (0b) `error.generated.md` if it is an `E-` code (**E-ONLY, stamped 2026-06-25, ~144 commits stale, and its generator is out-of-repo and now un-scheduled**); (1) error.map.md's family table if your prefix is one of the ~70 it names (of 187); (2) `grep -rn "<CODE>" compiler/src/` — the only complete method; (3) grep SPEC.md for the normative meaning. **A code may be NAMED normatively with no §34 row at all (§34.0 outcome 2).** |
| **a `W-*` or `I-*` code specifically** | **error.map.md only** — `error.generated.md` contains ZERO `W-`/`I-` entries by construction, so it will look like the code does not exist. Then grep. |
| **whether a §34 code is real, pinned, dead or spec-ahead** | **`bun scripts/s34-census.ts --full`.** Its NEGATIVE is reliable (zero emitter mentions ⇒ cannot fire); a FALSE-CLAIM verdict is a HYPOTHESIS owing an execution check. Only `expect.codes` counts as a pin — not `notCodes`, not rationale prose. |
| **a `cleanup()` diagnostic** | `type-system.ts` :18834 / :18843 / :18853. **`E-LIFECYCLE-001/002/004` FIRE as of S310** — any doc calling them catalogued-but-unwired is stale. |
| **a failable server fn that parsed with an EMPTY body / SQL that leaked to the client** | `ast-builder.js` `consumeErrorTypeAnnotation` (parseLogicBody, ~:3675). Pre-#333/#338 a generic / paren / union / array error type left its tail unconsumed, the `{` body check failed, route-inference never saw the `?{}`, and E-CG-006 fired. **Bounded to ONE type expression on purpose** — a failable fn may be body-less. |
| **an `on mount` body whose statements vanish, or whose server call is not awaited** | `ast-builder.js` `mountBodyExprNode` (:355) for the DROPPED-statement half; `codegen/scheduling.ts` `injectServerCallAwaitsViaAst` (:510) for the await half — **acorn-modelled scopes, and it returns the body UNCHANGED on a parse failure**; `emit-client.ts:2907+` for the `_scrml_reactive_set(cell, stub())` DIRECT-value lift, which the AST pass deliberately skips and which is therefore unguarded elsewhere. |
| **`if=<#r>.data is some` / any `<#…>` request-ref predicate** | **`expression-parser.ts` `scanLhsLeft` (:1181) + `matchInputStateSigilLeft` (:1052) — a PARSE-layer fact, not a routing one.** `rewriteIsPredicates` runs before `<#id>` normalization, so the sigil's `>` read as a chain terminator. Emit-side re-parse in `emit-event-wiring.ts` (:474+, :566+), scoped to `<#`-bearing exprs so every other escape-hatch condition is byte-identical. |
| **`if=` on a structural element · a gated `<engine>` losing state · an `<each>` gate leaving rows behind** | **domain.map.md "§17.1.2"** → `emit-html.ts` `emitGatedStructural` (:1498) / `emitIfMountGate` (:1421); `runtime-template.js` `_scrml_mount_template` (:1429) / `_scrml_unmount_scope` (:1468) / `_scrml_mount_wire` (:1599) / `_scrml_remount_each_fence` (:1639). |
| **"why did my function move to the server / vanish from the client bundle, with no error?"** | **A PLACEMENT question, not a diagnostic one — §12 emits no code for it.** domain.map.md "§12.2 Trigger 3" + `route-inference.ts` `ESCALATION_SERVER_ONLY_MODULES` (:656) / `collectServerOnlyBindingModules` (:3397). Also check the INDIRECT path: `indirect-callee-resolver.ts` + `indirectInverseCallerMap` (:4707). |
| **a helper reached through an alias or a dispatch table (`const p = fn; p(x)`, `t[k]()`)** | `compiler/src/indirect-callee-resolver.ts` — `aliasNamesResolvingTo` for the ALIAS shape; `dispatchTableNamesWithPeers` / `dispatchTablePeerMembers` / **`dispatchCalledTargets` (NEW)** for the DISPATCH-TABLE shape (a member callee never appears in `calledNames`). **NEW: a raw-text scan catches a dispatch call inside a template literal or `?{}` body**, which the AST walk cannot see. **Invariants 14-17 apply — read them before widening anything.** |
| **a `ReferenceError: _scrml_* is not defined` in a shipped bundle · runtime-chunk tree-shake gates** | `codegen/emit-client.ts` — `detectRuntimeChunks` (:273, PRE-EMIT) + `POST_EMIT_HELPER_CHUNK_GATES` (:2167, POST-EMIT) — AND `codegen/runtime-chunks.ts` `CHUNK_DEPENDENCIES`. **NOT `codegen/index.ts`.** Post-emit entries match as SUBSTRINGS and the scan runs BEFORE `cell-accessor-rename.ts`'s `_scrml_cs_` rename. |
| **an engine `audit` clause that records nothing** | `codegen/emit-engine.ts:2054` + `runtime-template.js:4914+`. **A REGISTRY, not a parameter**, and it registers a CLOSURE, not a cell NAME — a raw name resolves in the wrong chunk key space, the registration emits, and the log stays empty. **Only executing a transition catches it.** |
| **an auto-generated `<engine>` property test that asserts nothing** | `codegen/emit-machine-property-tests.ts` `projectStateChildRules` (:487) + `codegen/index.ts:2354-2375`. The projection is substituted ONLY where `machine.rules` is empty. |
| **build commands / CI stages / a gate decision** | build.map.md. **`gate` is 12 steps and includes the browser NAME-SET check and the §34.0 provenance check; `cloud-maps` no longer regenerates these maps.** |
| **an error type on a failable fn** | domain.map.md "§19.4.4.1" — **SHALL be an enum**, `E-ERROR-011` reserved. `examples/29-engine-vs-flags.scrml` is the worked teaching example (migrated this window). |
| **a `status=` value in `docs/known-gaps.md` / the §0 gap-counts rollup** | build.map.md "Gap-status vocabulary". `scripts/state.ts` THROWS on an unknown status AND on an unparsed marker; `@gap` markers now carry `locus=` and `prov=`. Adding a new status word breaks CI Stage 1 **by design**. |
| **the DB-authoritative security tier — RLS/roles/SECDEF/db-migrate/grants** | domain.map.md (concept + threat model) + migrations.map.md (apply model) + schema.map.md + error.map.md + build.map.md. **Untouched for three windows.** |
| a mechanical symbol / import-edge / E-code index | `.claude/maps/{structure,dependencies,error,test}.generated.md` — `@generated` by `flogence/scripts/mapgen.ts`, **NOT by this repo's CI, stamped 2026-06-25 (~144 commits stale), and the only CI leg that ever refreshed maps was deleted this window.** File attribution reliable; line numbers a starting point. |
| types / interfaces / AST node shapes | schema.map.md (stamp `fe14c9b2` — `compiler/src/types/` has zero diff since) |
| environment variables / config keys / CI secrets | config.map.md |
| test patterns / fixtures / which tier a test runs in / which gate runs it | test.map.md |
| directory layout / entry points / where a file lives | structure.map.md |
| external packages / module graph / producer→consumer chains | dependencies.map.md |
| language primitives / SPEC navigation / business invariants | domain.map.md |
| auth flows / JWT / OAuth / protect-floor / session builtin | auth.map.md (stamp `df2ac831` — honest, unchanged surface) |
| **per-session history: what landed when, and why** | **`docs/changelog.md` + `handOffs/delta-log.md` + `hand-off.md`. NOT these maps.** |
| non-compliant / stale docs | non-compliance.report.md |

## Key Facts

- Entry point: `compiler/bin/scrml.js` -> `compiler/src/cli.js` dispatches to `commands/*.js` (11 subcommands); the pipeline is `compileScrml()` in `compiler/src/api.js` (block-split -> AST-build -> type-check -> codegen).
- **The emitted client bundle has exactly one execution seam and it is invisible in the output.** `emit-client.ts` builds a flat `lines[]`; `emit-event-wiring.ts` happens to push a function wrapper into the middle of it. Everything before is module-init, everything inside is boot. **This is the fact the prior map generation was missing, and it is why the route-region arc's first design was wrong.**
- **The three scrml structural elements are parsed by NAMED REGEX, not by generic attribute parsing.** `engine-decl` / `match-block` / `each-block` carry no `attrs` array. *An attribute that vanishes with no diagnostic is a PARSE-stage fact, and nothing in codegen will show it to you.*
- **§34 now has a normative well-formedness rule (§34.0) AND a machine oracle (`scripts/s34-census.ts`).** The rule is diff-scoped on purpose; the oracle derives §34's range from the headings every run because **a baked line number in a maintained artifact rots silently and nothing fails** — the same reason `docs/FACTS.md` exists.
- **SPEC.md is the sole normative source.** PIPELINE.md documents stage internals. Any doc contradicting SPEC.md is non-compliant per pa.md Rule 4. Two amendments this window state their own **implementation status** rather than asserting a SHALL the impl does not keep (§6.7.1a's sugar-equivalence; §20.8.8's Nominal banner) — that is the compliant shape.
- **SPEC now carries a `provenance:` field (pa-base v2.10 Rule 4b), first instance at §19.4.4.1** — and its first use SUPERSEDED a PA-authored rule that had no design provenance and sanctioned the form the recorded reasoning condemns. *A parser defect is not a language-design reason.*
- The compiler ships TWO parsers: the live pipeline and `compiler/native-parser/` (`--parser=scrml-native`). **This window incurred NO parity obligation** — every landing is emit-time, runtime, diagnostic-message or CLI. The rule: a landing that adds an AST FIELD to a structural node owes a native mirror; nothing else does.
- **`.claude/` is gitignored; `.claude/maps/` and `.claude/agents/project-mapper.md` are FORCE-tracked.** Staging a map refresh requires `git add -f`. Because the maps publish with the public repo, a map generation must not reintroduce third-party adopter identity (scrubbed at `89db7981`).
- **These maps have no CI gate of their own, and as of this window no scheduled refresh either.** Any generation that asserts completeness ("every family", "all loci", "fully routed") is a hypothesis until re-derived — S297 closed a gap with a coverage claim that measured 67/185 true.

## Tags
#scrml #map #primary #index #compiler #bun #invariants #prohibitions #module-init #rehydrator-boundary #scrml-nav-rewire #scrml-boot #emission-order-seam #no-route-splitter #outlet-resident #region-cleanups #route-region #§6.7.2.1 #§20.8.8 #pole-c #route-leave #route-enter #machine-retired #e-deprecated-001 #§63.7 #projection-codemod #fail-closed-codemod #engine-audit #§51.11 #§51.13 #property-tests #vacuous-test-skip #§34.0 #row-provenance #s34-census #census-buckets #named-codes-land-with-impl #e-error-011 #w-route-request-duplicates-server-load #enum-only #§19.4.4.1 #renders-clause #corpus-first-migration #provenance-field #§6.7.1a #bare-expression-category #browser-baseline #failure-name-set #bidirectional-baseline #skipped-step-behind-red-step #gate-topology #ai-legs-killed #cost-decision #no-scheduled-map-refresh #cloud-maps-stage2-deleted #advisory-review-disabled #e-lifecycle-001 #e-lifecycle-002 #e-lifecycle-004 #cleanup-diagnostics #consume-error-type-annotation #mount-body-expr-node #inject-server-call-awaits-via-ast #acorn-scope-model #request-ref-sigil #scan-lhs-left #dispatch-called-targets #template-dispatch-scan #structural-if #§17.1.2 #render-not-lifecycle #each-row-template-fails-open #e-if-in-dispatched-arm #one-if-lowering #ast-builder-named-regex #no-attrs-array #inverse-caller-map-byte-identical #escalation-only #two-set-distinction #node-identity #coordinate-space #runtime-chunks #export-const-client-gate #execute-dont-grep #gap-attribute-bag #proven-gate #facts-md-authority #changelog-dereferenced

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
