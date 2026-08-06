# primary.map.md
# project: scrml
# updated: 2026-08-06T06:17:17-06:00  commit: a3a34d80
# **SOURCE WALK IS AT `0d9d843d`; the stamp is `a3a34d80`, the true HEAD.** `a3a34d80` (the
# S322-bryan wrap continuity commit) landed WHILE this pass ran and is DOCS-ONLY — verified
# `git diff --name-only 0d9d843d..a3a34d80` = {docs/changelog.md, docs/pr-reviews.md, hand-off.md,
# handOffs/delta-log.md}, ZERO diff under compiler/ scripts/ stdlib/ package.json .github/. Every
# source claim below therefore holds at the stamp.
# NOTE (S322/S324 INCREMENTAL pass): over `15e5e070` -> `a3a34d80` — **23 commits, TWO session-windows
# across TWO CLONES** (S322-bryan on the ASUS-Vivobook + S322/S323/S324-peter on Windows). **Session
# numbers COLLIDE across clones** — `hand-off.md` disambiguates by NAME, and so does this map set. Only
# the SHA range is well-defined; every header here states it.
#
# **THE ONE ENTRY A FUTURE READER MOST NEEDS FROM THIS WINDOW: there is now exactly ONE provider
# answering "is this name async in client mode."** `codegen/async-combinators.ts` — `AsyncNameFacts` +
# `isAsyncCalleeName` + `isServerBoundaryCallee` (#442, Limb 1 / dpa-023). **Decision sites 3 -> 1.**
# See invariant 39. Do not hand-write a fourth async-name disjunct anywhere.
#
# **SECOND: any change under `compiler/src/codegen/` has a standing PRE-LAND GATE, and it is not in
# CI.** `scripts/corpus-emit-differential.ts` + `scripts/corpus-check-goggles.js` (#428). There was no
# routing row for this task shape and the absence cost a dispatch — there is one now (see Task-Shape
# Routing). Read invariant 41 before you touch it.
#
# Five landings this window: **#429** (U1, the `emitCall` client server-fn await branch — landed
# **explicitly NOT claiming its bug class**), **#442** (the async-name provider unification), **#428**
# (the wide-corpus gate), **#435** (GH #357, `session` bound in the server prologue), **#440** (the
# `emit-server` dangling-ref pair). `compiler/SPEC.md` has **ZERO diff** — every landing is emit-time
# or tooling, so no §34 row moved and no native-parser mirror is owed.
#
# Re-walked: primary, domain, dependencies, error, structure, test, **build** (was deliberately older —
# re-walked for the new gate), **auth** (was deliberately older across five windows — re-walked because
# the §20.5 session surface genuinely CHANGED), non-compliance. NOT re-walked: schema, config, infra,
# migrations (zero diff in their surfaces — each keeps its own honest stamp in the Map Index).
#
# Per-window landing narratives stay DELETED (S302 ruling). **History lives in `docs/changelog.md` +
# `handOffs/delta-log.md`.** What earns space here is rules a grep cannot find.

## Project Fingerprint
Language:   TypeScript / JavaScript (mixed) + scrml itself (self-hosting stdlib + self-host compiler experiments)
Framework:  Custom compiler pipeline (no web framework) — Bun-native
Runtime:    Bun >=1.3.13 (no Node support; Bun-specific APIs throughout — `Bun.serve`, `bun:sqlite`, `Bun.$`, `Bun.SQL`, `Bun.hash`)
Type:       CLI compiler + language toolchain (single-file full-stack web-language compiler, with LSP + editor-tooling + MCP surfaces)
Size:       `compiler/src/` **187 files / 238,198 lines** (FACTS.md, mechanically derived — grew again this window without a file-count change; +799 lines, all of it inside `compiler/src/codegen/`). `compiler/tests/` **1,323** `*.test.js` (+4). Conformance **855** cases (unchanged).
Version:    v0.7.1 (root package.json — the SOLE manifest; not a workspace monorepo, `files`-allowlisted, publishable). **Zero manifest diff this window** (`git diff 15e5e070..HEAD -- package.json` is empty).
CI:         GitHub Actions — three workflows on `main`. **ZERO CI diff this window** (`git diff 15e5e070..HEAD -- .github/` is empty); `gate` stays at **12 steps**. **NOTE: the new wide-corpus emit-differential gate (#428) is NOT in CI** — it is a by-hand pre-land gate. Prior window's carried facts: `windows` job gained one line: `PUPPETEER_SKIP_DOWNLOAD: "true"` on `bun install` (that job runs unit+conformance only, never the browser tier — the puppeteer postinstall download was pure cost and a flake source, witnessed on PR #382). `advisory-review` stays DISABLED (manual fire only); `cloud-maps` Stage 2 stays DELETED (no scheduled map refresh — see the S313 warning below, still true).

## ⚠️ MAP CURRENCY IS NOW MANUAL — READ THIS BEFORE TRUSTING A STAMP
`cloud-maps` **no longer refreshes `.claude/maps/` on any schedule.** Map regeneration reverted to the
PA at wrap. A stamp is exactly as old as the last wrap and **nothing will move it for you.** This
window's own maps sat **23 commits / two session-windows across TWO CLONES** behind before this pass
caught them — the prior window sat 19, the one before that 31. **Six consecutive passes have now
recommended a deterministic non-AI map-currency check in `cloud-maps` Stage 1; nothing has moved on it.**
NEW hazard this window: with two clones landing into the same `main` under COLLIDING session numbers,
"the last session's maps" is not a well-defined idea — **only the SHA is.** Disambiguate by clone NAME
(bryan / peter) exactly as `hand-off.md` does.
Treat any map line as a *verify-against-source hypothesis* if `git log --oneline <stamp>..HEAD` is
non-trivial.

## Derived-figure authority
`docs/FACTS.md` is GENERATED (`bun scripts/facts.ts --write`) and CI-gated (`--check` in `gate`). It
is the authority for published counts. At this HEAD: `live compiler source` **237,399** lines / 187
files; `test files` **1,319**; `specification lines` **37,066**; `conformance cases` **855**. stdlib
modules (21), CLI verbs (11), LSP capabilities (7) unchanged.

Second generated authority: `compiler/SPEC-INDEX.md`'s totals block, gated by `--check` in CI `gate`
AND the local pre-push hook. **Only the totals are gated — the AUTHORED half is ungated and has
rotted further this window** (non-compliance.report.md C5, carried, not re-derived this pass).

**FACTS.md deliberately does NOT publish a §34 diagnostic-code total.** error.map.md carries the
reconciled count — **806 at this HEAD, UNCHANGED** (`compiler/SPEC.md` has zero diff this window, so no
code was added, retired or renumbered).

**CORRECTION, re-executed this pass rather than carried forward: `bun scripts/s34-census.ts` is NOT
broken — it is broken ON WINDOWS.** For three passes this map set said "STILL BROKEN" without
qualification and sent readers to a manual fallback. **It runs on this Linux clone**, and answers in one
command what the fallback takes a page to approximate:
`806 rows (§34 19030..19907, derived) · 1876 source files · 855 conformance cases`; buckets
`STRUCK 34 · PINNED 339 · IMPL-SITES 321 · DECLARED-AHEAD 14 · RUNTIME-SURFACED 3 · FALSE-CLAIM 95`.
The defect is real but PLATFORM-SCOPED — `new URL(import.meta.url).pathname` vs `fileURLToPath`
(`scripts/s34-census.ts:49`; `scripts/facts.ts:31` gets it right one file over). **On Linux/macOS run
the oracle FIRST.** On Windows, fall to error.map.md's manual table-column methodology. The one-line
code fix is still owed. See non-compliance.report.md S320-N1.

---

## INVARIANTS AND PROHIBITIONS — the rows grep cannot find

> This is the section that earns the map set. Everything here is a rule about what you must NOT do,
> or a property that must keep holding — none of it is discoverable by grepping for a symbol. The long
> form of each lives in the map named in the right column. **Rows 1-37 carried from prior passes
> (re-verified where this window's diff touched them); rows 38-42 are NEW this pass.**

| # | Invariant / prohibition | Long form |
|---|---|---|
| 1 | **The module-init / rehydrator boundary is EMISSION ORDER, not a structure.** `emit-event-wiring.ts` pushes `(function(){` + `function _scrml_boot(){` and closes it after every module-init emission. Everything `emit-client.ts` emitted BEFORE its `emitEventWiring(...)` call runs at script-eval; everything that call returns runs inside `_scrml_boot`. **Nothing marks the seam.** | structure.map.md · dependencies.map.md |
| 2 | **`_scrml_nav_rewire` is non-delegable handlers + reactive display binding ONLY.** `<timer>`, `<poll>`, `<request>`, `on mount`, cell inits and engine substrate are NOT in it — they are module-init. A route chunk's timer therefore **starts exactly once, ever** — still true and still unbuilt this window (`g-route-timer-poll-not-stopped-on-soft-nav`, HIGH, open). | domain.map.md · dependencies.map.md |
| 3 | **The emit-time region↔resource association is `_outletResident`, and it is LEXICAL** — it never fires for route content because route content lives in a different FILE from the shell that owns the `<outlet>`. Unchanged this window. | structure.map.md · domain.map.md |
| 4 | **A soft navigation SHALL NOT mount or destroy any SCOPE (§6.7.2).** The `<outlet>` region is a route region keyed on `(route, params)` — a THIRD lifecycle owner (§6.7.2.1), not a scope. | domain.map.md |
| 5 | **`<machine>` does not compile.** `E-DEPRECATED-001`, Error, from `ast-builder.js:16839`. **This window's `#376` fixed the four docs that still taught it as a live deprecated alias** (`docs/PA-SCRML-PRIMER.md`, `compiler/PIPELINE.md`, `compiler/SPEC-INDEX.md`, `docs/external-js.md`) — the prior S313-N1 non-compliance finding is now RESOLVED, re-verified this pass. | domain.map.md · non-compliance.report.md |
| 6 | **A NEW or TOUCHED §34 row SHALL state where it fires, or declare itself spec-ahead (§34.0).** Diff-scoped; never retrofit over the legacy corpus. This window's one new row (`E-FN-EQUALS-BODY`) satisfies it with an emitter-provenance note. | error.map.md |
| 7 | **A failable function's error type SHALL be an ENUM (§19.4.4.1)** — unchanged this window. | domain.map.md |
| 8 | **Gate on the failure NAME SET, not the count and not the exit code.** Unchanged this window; `browser-baseline.ts` stays in `gate`. | build.map.md · test.map.md |
| 9 | **`if=` is fenced at exactly THREE structural elements** — unchanged. | domain.map.md §17.1.2 |
| 10 | **`if=` gates RENDER, never LIFECYCLE (§17.1.2.1)** — unchanged. | domain.map.md §17.1.2 |
| 11 | **A structural `if=` INSIDE an `<each>` row template fails OPEN (§17.1.2.3)** — unchanged. | domain.map.md §17.1.2 |
| 12 | **`E-IF-IN-DISPATCHED-ARM` guards ARM BODIES and must be reverted as a UNIT** (three call sites) — unchanged. | domain.map.md · error.map.md |
| 13 | **ONE `if=` lowering, no second one** — unchanged. | domain.map.md §17.1.2 |
| 14 | **`route-inference.ts`'s `inverseCallerMap` must stay BYTE-IDENTICAL** — unchanged; no diff to `route-inference.ts` this window. | dependencies.map.md |
| 15 | **The shared call-graph walk must NOT be widened** — unchanged. | dependencies.map.md |
| 16 | **An INDIRECT callee edge is ESCALATION-ONLY** — unchanged. | dependencies.map.md |
| 17 | **`route-inference.ts` holds TWO server-only stdlib module sets and they must not be merged** — unchanged. | dependencies.map.md |
| 18 | **`node.id` is a codegen contract** — unchanged. | domain.map.md |
| 19 | **The dist tree is NOT a mirror of the source tree (§47.9.5)** — the coordinate-space discipline WIDENED this window: `emit-server.ts`'s `distRelativeServerSpecifier` is now a thin wrapper over a generalized `distRelativeLocalSpecifier(sourceSpecifier, importerFilePath, outputBaseDir, targetExt)` (#390), so a §64 tool/library `.scrml` import re-bases to dist space the same way a server import does. **Pick ONE coordinate space and stay in it — still the rule, now enforced at one more call site.** | domain.map.md · dependencies.map.md |
| 20 | **A protected DB column can never reach the client bundle (E-CG-001, §14.8.9)** — unchanged; the SEPARATE `#263`/`#358` export-const client-gate (below) is additive, not a relaxation of this floor. | dependencies.map.md |
| 21 | **`null` and `undefined` do not exist in scrml source in ANY position (§42)** — unchanged. | domain.map.md |
| 22 | **A superuser/table-owner BYPASSES Postgres `FORCE ROW LEVEL SECURITY`** — unchanged. | domain.map.md · migrations.map.md |
| 23 | **A diagnostic code can carry two unrelated meanings from two files. Allocate fresh, never renumber.** — unchanged. | error.map.md |
| 24 | **A §34 row is not evidence of a fire site — and now neither is an emitter string.** — unchanged. | error.map.md |
| 25 | **Emitted ≠ runs.** — unchanged; still four recorded occurrences. | test.map.md |
| 26 | **An auto-GENERATED test artifact must SKIP, never PASS, on an empty run.** — unchanged. | test.map.md |
| 27 | **A silent-drop guard must itself be testable.** — unchanged. | build.map.md |
| **28** | **A `fn`/`function` body admits exactly ONE shape, `{ … }`, and the `=`-expression shorthand SHALL be rejected (§48.2, `E-FN-EQUALS-BODY`, NEW #396).** The form silently miscompiled before the reject: the `-> T`/`: T` return-type consumer swallowed a trailing `= match k {…}`/`= if …` tail, and a match's `{` was misread as the fn body brace — arm results dropped, the fn returned `undefined`, **zero diagnostics**. `rejectFnEqualsBody` (`ast-builder.js:3755`) fires at **FOUR** duplicated decl-body call sites (`:9310`/`:9592`/`:12645`/`:12946`) — sibling of `E-FN-ARROW-BODY`'s five-site topology. **A FIFTH site — the `export` re-parse (`:11625-11654`) — used to SWALLOW this exact error**; it is now the one site that explicitly surfaces `E-FN-EQUALS-BODY` from its sub-parse while suppressing every other sub-error, so an exported form gets the same diagnostic a top-level one does instead of silently re-succeeding. | domain.map.md · error.map.md |
| **29** | **`<page>` has a FIFTH per-route attribute, `keep-alive` (§4.15/§40.8/§20.8.4, ruled S314, #378) — but only its AUTHORING surface is admitted.** `E-PAGE-INVALID-ATTR`'s five-member set now includes it (`attribute-registry.js`, `ast-builder.js` `validatePageAttrs`); **there is still NO runtime cache and NO §52/§38 invalidation wiring** — a doc or map claiming `keep-alive` caches anything at runtime is describing spec-ahead surface, not shipped behavior. `W-ROUTE-REQUEST-DUPLICATES-SERVER-LOAD`'s guidance was corrected in the SAME window it was named: `(b) <page keep-alive>` is a **follow-on to (a)** reading the server-load payload, **never an alternative** — its cache is SQL-server-load-scoped (keyed by the params that reach SQL) and does NOT cover an HTTP `<request>`, so applying (b) alone leaves the duplication the warning names unresolved. | domain.map.md |
| **30** | **`<timer>` and `<poll>` diverge on their FIRST tick, and the divergence is now stated normatively (§6.7.5/§6.7.6, S314).** A `<timer>`'s first execution is one interval AFTER arming (unchanged behavior, now an explicit sentence — the silence was previously filled by a `collect.ts:205` defect that accidentally ran the body at module-init). A `<poll>` SHALL fire its first tick IMMEDIATELY on arming (a poll promises freshness; the §6.7.6 worked example would otherwise render nothing for a full interval) — gated by `running=`, and a `running` false→true RESUME does NOT re-fire the immediate tick (once per arming, not once per resume). | domain.map.md |
| **31** | **A value-form `match`-arm result re-emits from a raw EXPRESSION STRING, and the #87 statement-level await injector never reached it (`g-match-arm-server-call-no-autoawait`, #394).** `scheduling.ts`'s new `parenthesizeAwaitServerCallsInExpr` wraps the CALL node in grouping parens (`fn().ok` → `(await fn()).ok`), not a bare prefix — a bare `await fn().ok` reads `.ok` off the pending Promise first, which is wrong. Await-legality is real-parser-modelled (sync callback bodies / formal-parameter lists are illegal), mirroring `injectServerCallAwaitsViaAst`'s existing discipline. | dependencies.map.md |
| **32** | **A cross-module ASYNC import consumed inside a markup interpolation now gets awaited (`g-crossmodule-async-in-markup-position-not-awaited`, #391) — but the wrap decision is made off the injector's OWN EMITTED OUTPUT, not a re-derived predicate**, after an S239 catch surfaced a page-breaking SyntaxError from an async fn used as a bare combinator callback. | domain.map.md · dependencies.map.md |
| **33** | **A sub-parse's diagnostic span (a `<match>`-arm or `<each>` sub-parse) is now REBASED to file coordinates (`_rebaseSubparseSpans`, ast-builder.js, #389)** — before this, a diagnostic inside a sub-parsed region reported the sub-parse's OWN line/col, not the file's, and the within-node parser-parity gate was silently dead on Windows (enumerator backslash relpaths) as a downstream symptom. | error.map.md · structure.map.md |
| **34** | **`export let` / `export var` are now emitted as runtime VALUE bindings alongside `export const` (`emit-server.ts` `emitModuleValueExportLines`, #388)** — before this fix, a mutable module-level `export let` closed over by an in-process PEER CALLABLE (not a direct `<endpoint>` reference) silently fell through to nothing, producing a boot/route `ReferenceError` with no diagnostic. The companion fix in the same PR widens a `serve=` tool's dead-import scan to union a `main`/setup-only reachability root, so an import used ONLY from `main` survives tree-shaking. | dependencies.map.md |
| **35** | **The §13.2 CPS auto-await choke-point is CONSOLIDATED (PR #405, `649d6fce`, LANDED — corrects the prior pass's "HELD" status).** `injectPromiseAwait` (the old per-statement string-regex pass) is RETIRED. ONE shared AST walker now backs all three auto-await entry points (on-mount, every client fn-body statement, match-arm expressions), and — the part that actually changes program behavior — auto-await now DESCENDS into `given`/match-block/`try` bodies that were previously opaque `isControlFlowBoundary` nodes to the scheduler. Closes the `g-cps-scheduler-opaque-boundary-hides-nested-server-calls` family. | dependencies.map.md · structure.map.md |
| **36** | **A per-row `if=` on a NESTED (non-item-root) element inside `<each>` is a CREATE-TIME append gate, not reactive on a same-key reconcile — the compiler now WARNS (`W-IF-IN-EACH`, §17.1, #416, GH adopter #409) when the condition references the iteration item.** Only the row's SOLE item-root `if=` is reactively swapped today; the reactive fix for the nested case is DEFERRED and routed to bryan. | domain.map.md · error.map.md |
| **37** | **A top-level `@name = expr` REASSIGNMENT of a structurally-declared (`<name>`) cell SHALL NOT re-register the cell's reset init-thunk (§6.8, #417, HIGH) — the runtime's thunk registry is last-write-wins, so a naive re-registration inverted `reset()`.** `collectStructuralDeclNames` (reactive-deps.ts, NEW) distinguishes a genuine reassignment (skip) from an IMPLICIT `@`-declaration (keep — an SSE/channel bind must still re-establish on reset). Residual, out of scope: `g-implicit-cell-double-write-clobbers-reset-init` (MED, NEW — a double-write of an IMPLICITLY-declared cell still clobbers; needs emission-order tracking). | domain.map.md |
| **38** | **§13.2 is POSITION-INVARIANT, and as of #429 the CLIENT enforces it AT THE CALL SITE — `emitCall` gained a fourth await branch for a client->server RPC.** Awaiting at the choke point every position already flows through replaces retrofitting it per position, which is what manufactured one silent gap per position (receiver-tail `loadRows().length`, nested-argument `pick(loadRows())`). **The gate that makes it safe can only ever SUPPRESS an await, never STRAND one** — `ctx.clientAsyncBody` is threaded from the SAME `_fnIsAsync` that writes the `async` keyword, so the structural walk that sees the callee is the one that colours the host. A stranded `await` in a sync host is a WHOLE-BUNDLE SyntaxError, not a local defect; that asymmetry is the whole design. **#429 landed EXPLICITLY NOT CLAIMING ITS BUG CLASS — 142 bare client server-fn call sites remain in cleanly-compiling sources, delta 0.** | dependencies.map.md · domain.map.md |
| **39** | **THERE IS NOW EXACTLY ONE PROVIDER ANSWERING "is this name async in client mode" (#442). Decision sites 3 -> 1. Do not hand-write a fourth disjunct.** `async-combinators.ts`'s `isAsyncCalleeName(name, AsyncNameFacts)` — the rule is MODE-FREE (not-shadowed, then stdlib-Promise-export OR server-boundary-fn OR transitively-async-local-peer; **there is no fourth**), and mode selection lives in exactly one caller, `emit-expr.ts:asyncNameFactsOf`. The drain's bespoke `isAsyncName` closure is DELETED; `combinatorIsAsyncName` collapsed from four disjuncts to one delegation. **`isClientServerFnCall` shares only the provider's server-fn MEMBERSHIP component and that is deliberate** — it asks an IDENTITY question, not an asyncness one, and widening it would capture a stdlib-async callee and route it away from its own branch and its own fail-closed sink. **THE BUG IT SUBTRACTED:** `computeAsyncFnNames` uses `serverFnNames` as a seed TRIGGER (colours the CALLER, never admits the CALLEE), so a client server fn was async to the emitter and sync to the fail-closed drain **in the same compilation** — a MISSING diagnostic, not a wrong emission. Adding a consumer? Hand it `AsyncNameFacts`. | dependencies.map.md · domain.map.md |
| **40** | **A `routeMap` walk SHALL be filtered on the OWNING FILE, because `FunctionRoute` carries no `filePath` and the file lives ONLY in the map KEY (`<filePath>::<start>`).** `runRI` builds ONE routeMap across the whole resolved import graph. An unfiltered walk imported another file's server-fn names into THIS file's client emission: a purely local SYNC `save` gained a spurious `await` and a FALSE `E-ASYNC-STDLIB-IN-SYNC-CALLBACK`, with renaming the local fn as the only user workaround. **`declaredNames` cannot cover this** — a TOP-LEVEL client fn name is never in it. Applied identically in `emit-functions.ts` and `scheduling.ts`, **and the two must agree**, because U1's gate derives from the coloring the filter also feeds. Corpus incidence is zero today and that is NOT reassurance: `examples/23-trucking-dispatch` declares `getCurrentUser` 19x, `refresh` 18x, `getSessionToken` 17x across files. | dependencies.map.md |
| **41** | **`node --check` ACCEPTS a top-level stranded `await` in a bare `.js`; the compiler emits `<script src=…>` with NO `type="module"`, where the same bytes are a FATAL SyntaxError. AND bun's `vm.Script` does not reject it either.** So the emitted-artifact syntax gate is `scripts/corpus-check-goggles.js`, deliberately a separate **NODE** subprocess parsing under BOTH goggles via `vm.Script`/`vm.SourceTextModule` — **`node --check` must not be reintroduced**, and an in-process "simplification" under Bun would be a third hollow gate. Its parent `scripts/corpus-emit-differential.ts` is **the standing pre-land gate for any codegen change** (1878 sources / 7254 artifacts, NOT in CI, run by hand base-vs-head). `diff` exit **2** = NOT A VALID COMPARISON, distinct from 1 = differences found. The class it kills — a truncated enumeration reading exactly like a complete one — had shipped **three times**. | build.map.md · test.map.md · error.map.md |
| **42** | **A runtime reference SHALL NOT be emitted with its BINDING or DEFINITION gated more narrowly than the reference — the DANGLING-REFERENCE class (#357/#435/#440).** Compiles clean, zero diagnostics, `ReferenceError` -> HTTP 500 at request time. Four instances closed this window (`session` in a `?{}` interpolation · `@currentUser` direct read in a plain handler · the same in an SSE `function*` · `<channel auth=>`-only `_scrml_auth_check`). **Every detector in this family is PERMISSIVE BY DESIGN: a false POSITIVE only emits unused session infra; a false NEGATIVE re-opens a 500.** And **the `session` prologue bind SHALL be the `_scrml_session_bind` Proxy, never a raw `const session = _scrml_req._scrml_sess`** — the raw object carries own-properties `sid`/`_rec`, so `session["_rec"]` would disclose the whole record **including the §40.2 `csrfToken`** at HTTP 200. | auth.map.md · domain.map.md · dependencies.map.md |

---

## Map Index

| Map | Stamp | Contents |
|---|---|---|
| **primary.map.md** | **`a3a34d80`** | this file — fingerprint, **42 INVARIANTS (5 new)**, routing, key facts |
| **domain.map.md** | **`a3a34d80`** | TWO new sections: **§13.2** (the client server-fn call-site await + the ONE async-name provider, #429/#442) and **§20.5/§52.15.1** (the dangling-reference class + why the `session` bind is a Proxy, #435/#440). `compiler/SPEC.md` had ZERO diff, so the spec-index half is unchanged |
| **dependencies.map.md** | **`a3a34d80`** | FOUR new pipeline rows: the ASYNC-NAME PROVIDER (3 -> 1), the CLIENT SERVER-FN CALL-SITE AWAIT + its five-hop threading chain, the SESSION PROLOGUE BINDING, the DANGLING-REFERENCE class. External deps re-verified unchanged. Colorless-async section now carries the honest **142 bare sites, delta 0** status |
| **error.map.md** | **`a3a34d80`** | **806 §34 codes, UNCHANGED** (zero SPEC diff). `E-ASYNC-STDLIB-IN-SYNC-CALLBACK`'s firing surface WIDENED (#442) + a documented **live false positive left firing on purpose**; `E-SESSION-CONTEXT` widened-then-TRIMMED; a new gap against `E-CG-001`'s side-effect half. **`s34-census.ts` correction: Windows-only, not tool-wide** |
| **structure.map.md** | **`a3a34d80`** | counts re-derived (187 files / **238,198** lines; **1,323** tests). NEW per-file bullets for `async-combinators.ts`, `emit-expr.ts`, `emit-library-shared.ts`, `emit-functions.ts`, `emit-control-flow.ts`; `emit-server.ts` and `emit-client.ts` extended; `scripts/` gained the corpus-gate pair |
| **test.map.md** | **`a3a34d80`** | **1,323** test files (+4: unit +1, integration +2, browser +1); conformance corpus unchanged at 855. NEW section: **the pre-land gate for codegen, which is NOT `bun test`** |
| **build.map.md** | **`a3a34d80`** | **re-walked** (was deliberately older at `b929b9c9`). ZERO CI/packaging/CLI/Docker diff — re-walked anyway for the NEW `corpus-emit-differential` + `corpus-check-goggles` pre-land gate, with the `node --check` / bun `vm.Script` blindness stated in full |
| **auth.map.md** | **`a3a34d80`** | **re-walked** (was deliberately older at `df2ac831` across five windows — no longer defensible). The §20.5 `session` Proxy prologue binding, the `@currentUser` resolver gate + SSE splice, the `<channel auth=>` auth-check, and **two open auth gaps ROUTED TO BRYAN** |
| **non-compliance.report.md** | **`a3a34d80`** | 2 carried findings RESOLVED, 1 CORRECTED as over-stated (the s34-census claim — self-inflicted, caught only by running on a different clone), 1 new finding, 1 new uncertain item |
| config.map.md | `e80b692e` | **deliberately older.** Zero env-surface diff (re-verified) |
| infra.map.md | `e80b692e` | **deliberately older.** Zero infra diff (re-verified) |
| schema.map.md | `fe14c9b2` | **deliberately older.** `compiler/src/types/` has ZERO diff across FIVE windows now — the whole of this window lives in `compiler/src/codegen/` |
| migrations.map.md | `115e8b1b` | **deliberately older.** No DB/migration surface in five windows |
| api.map.md | absent | no REST/GraphQL/gRPC surface owned by this repo — the compiler EMITS API routes for generated apps |
| state.map.md | absent | no redux/zustand/jotai — not a frontend app |
| events.map.md | absent | no EventEmitter/pubsub in the compiler's own src |
| style.map.md | absent | Tailwind + §65 CSS-native are compiler FEATURES |
| i18n.map.md | absent | no locales/i18n dirs |
| jobs.map.md | absent | `scrml:cron` is a stdlib module FOR GENERATED APPS |

An honest older stamp beats a false "verified at HEAD".

## Task-Shape Routing

| If your task is about… | Read |
|---|---|
| **you are CHANGING ANYTHING under `compiler/src/codegen/` and need to know it did not break the corpus** | **`bun scripts/corpus-emit-differential.ts` — the standing PRE-LAND GATE (#428). It is NOT in `ci.yml`, NOT in `bun test`, NOT in a hook. Run it BY HAND, base-vs-head.** `capture` each side, then `diff`. 1878 sources / 7254 artifacts over `examples,samples,conformance,stdlib,benchmarks`. Reports compile-failure delta, artifact-set delta, artifact-CONTENT delta, syntax delta under three goggles, and the bare-server-fn-site count. **`diff` exit 2 means NOT A VALID COMPARISON — do not read it as "no differences".** Full invocation + flags in build.map.md; the why-it-cannot-be-`node --check` argument in invariant 41. |
| **"is this callee async?" / adding an await injector / an async predicate** | **STOP — there is exactly ONE provider (#442). `async-combinators.ts`'s `isAsyncCalleeName(name, AsyncNameFacts)`.** Do not hand-write a fourth disjunct; hand your consumer `AsyncNameFacts`. Mode selection lives in ONE place, `emit-expr.ts:asyncNameFactsOf`. Invariant 39 + dependencies.map.md's "ASYNC-NAME PROVIDER" row. |
| **a client->server call that hands back a pending Promise instead of a value** | **PARTLY FIXED (#429) and the map says so on purpose.** `emitCall`'s fourth await branch (`isClientServerFnCall`, emit-expr.ts:3274) awaits at the CALL SITE, which reaches receiver-tail and nested-argument positions. **It did NOT close the class: 142 bare sites remain in cleanly-compiling sources, delta 0** — `g-auto-await-family-not-closed-150-bare-server-call-sites-in-clean-sources` (HIGH, open; the id bakes the 150 harness figure, the landed count is 142). Unreached shapes: the CPS/failable-fn wrapper, module top-level init, the markup-interpolation lift. Invariant 38 + domain.map.md §13.2. |
| **`reset(@cell)` giving you a Promise instead of a value** | **OPEN, HIGH, not built.** `runtime-template.js:1168` re-invokes the init thunk with **no `await`**, so a cell whose init calls a server fn is correct at mount and wrong after `reset()`. `g-reset-writes-pending-promise-when-init-thunk-calls-a-server-fn`. The fix makes `_scrml_reset` async (every call site), and it is governed by the S322 absorb ruling — **option C is RULED but NOT BUILT**. |
| **`session.*` inside a `?{}` SQL interpolation / an HTTP 500 `ReferenceError` from a server handler** | **FIXED (#435 GH #357, #440).** This is the DANGLING-REFERENCE class — see invariant 42. `session` is bound in the handler prologue **as a Proxy** (`_scrml_session_bind`); a raw bind would disclose `_rec`/`csrfToken` at HTTP 200. `@currentUser` and `<channel auth=>` got the same treatment. **Two auth gaps are open and ROUTED TO BRYAN** — read auth.map.md's "Session read-side" block before touching the accessor. |
| **an emitted bundle that is dead on arrival in the browser while the compiler reports green** | **A goggle problem, not a diagnostic problem.** `node --check` accepts a top-level `await` in a bare `.js`; the compiler emits classic `<script src=…>` where it is fatal — **and bun's `vm.Script` does not reject it either.** invariant 41 + build.map.md + error.map.md's "Emitted-artifact SYNTAX" section. Live instance: `g-stdlib-module-resolver-emits-import-meta-into-a-classic-script-bundle`. |
| **"where is per-chunk MODULE-INIT emitted, and what owns the boundary with the soft-nav rehydrator?"** | **`codegen/emit-client.ts` (assembly) + `codegen/emit-reactive-wiring.ts` (the lifecycle bodies) + `codegen/emit-event-wiring.ts` (the boundary).** Unchanged this window. Full table in dependencies.map.md. |
| **a route's `<timer>`/`<poll>` that keeps firing after a soft nav** | **domain.map.md "The route region is a THIRD lifecycle owner"** — still open (`g-route-timer-poll-not-stopped-on-soft-nav`, HIGH). |
| **a `fn`/`function` whose body is `= <expr>` and now rejects at parse time** | **`E-FN-EQUALS-BODY` (§48.2, NEW #396).** `ast-builder.js` `rejectFnEqualsBody` (:3755), four decl-body call sites + the export re-parse. Sibling of `E-FN-ARROW-BODY`. Fix: use a block body (`{ return <expr> }` or the tail-return `{ <expr> }`). See error.map.md / domain.map.md. |
| **`<page keep-alive>` — what it actually does today** | **NOTHING at runtime yet.** The attribute is admitted (parses, validates, five-member `E-PAGE-INVALID-ATTR` set) but there is no cache and no invalidation wiring — Nominal/spec-ahead. See domain.map.md invariant 29. |
| **a server call inside a value-form `match` arm that isn't awaited** | **`scheduling.ts` `parenthesizeAwaitServerCallsInExpr` (NEW #394)** — parenthesize-wraps the call (`(await fn()).field`), not a bare prefix. Consumed by `emit-logic.ts`'s value-form match-arm lowering. See dependencies.map.md invariant 31. |
| **a diagnostic code — ANY code, any prefix** | **error.map.md**, starting at "HOW TO LOOK UP A DIAGNOSTIC CODE". `bun scripts/s34-census.ts` **currently ERRORS on this Windows clone** (`ENOENT`, malformed path) — fall to error.map.md's family table, then `grep -rn "<CODE>" compiler/src/`. |
| **the CPS auto-await choke point / `given`/`if`/`match` scheduler boundary** | **LANDED (PR #405, `649d6fce`).** `scheduling.ts`'s `isControlFlowBoundary` no longer fences the fn-body auto-await walker out of `given`/match-block/`try` bodies; `injectPromiseAwait` is retired in favor of the shared `collectAwaitSites`/`applyAwaitSites` walker. See dependencies.map.md's "§13.2 CPS auto-await CHOKE-POINT" row for the mechanism and which gaps it closed. |
| **a per-row `if=` on a NESTED element inside `<each>` that silently goes stale** | **`W-IF-IN-EACH` now WARNS at compile (§17.1, #416, GH adopter #409).** The gate is still create-time-only — the WARNING shipped, not the reactive fix (DEFERRED, routed to bryan). See domain.map.md. |
| **`reset(@cell)` restoring the wrong value after a top-level reassignment** | **FIXED (§6.8, #417, HIGH).** `_emitInitThunkSidecar` now skips the reset init-thunk for a reassignment of a structurally-declared cell (`collectStructuralDeclNames`). An implicitly-declared cell written TWICE at top level still has a residual gap — `g-implicit-cell-double-write-clobbers-reset-init` (MED, open). See domain.map.md. |
| **build commands / CI stages / a gate decision** | build.map.md. `gate` unchanged at 12 steps; `windows` job now skips the puppeteer download. |
| **types / interfaces / AST node shapes** | schema.map.md (stamp `fe14c9b2` — zero diff across four windows) |
| **environment variables / config keys / CI secrets** | config.map.md (stamp `e80b692e` — zero diff this window) |
| **auth flows / JWT / OAuth / protect-floor / session builtin** | auth.map.md (stamp `df2ac831` — honest, unchanged surface) |
| **per-session history: what landed when, and why** | **`docs/changelog.md` + `handOffs/delta-log.md` + `hand-off.md`. NOT these maps.** |
| **non-compliant / stale docs** | non-compliance.report.md |

## Key Facts

- Entry point: `compiler/bin/scrml.js` -> `compiler/src/cli.js` dispatches to `commands/*.js` (11 subcommands); the pipeline is `compileScrml()` in `compiler/src/api.js` (block-split -> AST-build -> type-check -> codegen).
- **This window is entirely `compiler/src/codegen/` + `scripts/`.** Nine codegen files, zero SPEC lines, zero manifest/CI/Docker lines, zero `compiler/src/types/` lines, zero `native-parser/` lines. If your task is not codegen or tooling, the older map stamps in the index above are still honest.
- **There is exactly ONE provider answering "is this name async in client mode" (#442).** Decision sites 3 -> 1. Before you add a fourth consumer or hand-write a disjunct, read invariant 39.
- **A codegen change has a pre-land gate and it is NOT in CI (#428).** `bun scripts/corpus-emit-differential.ts`, run by hand base-vs-head over 1878 sources. Its syntax half must stay a separate NODE subprocess — `node --check` AND bun's `vm.Script` are both blind to a top-level stranded `await`, which is this arc's dominant failure mode. Invariant 41.
- **#429 landed explicitly NOT claiming its bug class, and that is load-bearing, not modesty.** 142 bare client server-fn call sites remain in cleanly-compiling corpus sources with a base->head delta of ZERO. An independent reviewer refuted the authoring agent's "the corpus contains no compiling exemplar" conclusion by finding four unambiguous instances the fix does not reach. **Do not inherit "the auto-await family is closed" from anywhere.**
- **`scripts/s34-census.ts` WORKS on Linux/macOS — the three-pass "STILL BROKEN" claim was Windows-only and is retracted.** Run the oracle first; it answers the §34 lookup in one command. The `ENOENT` is `new URL(...).pathname` vs `fileURLToPath` at `:49`.
- **SPEC.md is the sole normative source.** PIPELINE.md documents stage internals. Any doc contradicting SPEC.md is non-compliant per pa.md Rule 4.
- **`.claude/` is gitignored; `.claude/maps/` and `.claude/agents/project-mapper.md` are FORCE-tracked.** Staging a map refresh requires `git add -f`, and the wrap commits it with an explicit pathspec (`git commit -- .claude/maps/`) so it does not sweep other in-flight files.
- **Two clones now land into the same `main` under colliding session numbers.** Disambiguate by clone NAME (bryan / peter) as `hand-off.md` does; treat the SHA as the only well-defined coordinate. These maps have no CI gate of their own and no scheduled refresh — any generation asserting completeness is a hypothesis until re-derived.

## Tags
#scrml #map #primary #index #compiler #bun #invariants #prohibitions #module-init #rehydrator-boundary #route-region #machine-retired #e-deprecated-001 #e-fn-equals-body #e-fn-arrow-body #fn-decl-parse-sites #export-reparse-swallow #keep-alive #§4.15 #§20.8.4 #§40.8 #page-fifth-attribute #w-route-request-duplicates-server-load #follow-on-not-alternative #timer-poll-first-tick #§6.7.5 #§6.7.6 #immediate-poll-tick #match-arm-autoawait #parenthesize-await-server-calls #scheduling-ts #crossmodule-async-markup #s239-catch #subparse-span-rebase #within-node-gate-windows-fix #export-let-var-emission #serve-tool-reachability #dist-relative-local-specifier #coordinate-space #§47.9.5 #cps-choke-point #auto-await #puppeteer-skip-download #windows-ci #review-debt-script #s34-census-broken #no-scheduled-map-refresh #changelog-dereferenced #pr-405-landed #cps-choke-point-landed #inject-promise-await-retired #w-if-in-each #each-nested-if-not-reactive #reset-init-thunk-reassignment #collect-structural-decl-names #§6.8 #§17.1 #correction-pass #g-implicit-cell-double-write-clobbers-reset-init #async-name-provider #async-name-facts #is-async-callee-name #is-server-boundary-callee #decision-sites-3-to-1 #one-provider-three-consumers #seed-trigger-not-result-set #u1 #dpa-020 #dpa-023 #client-server-fn-await #is-client-server-fn-call #client-async-body #can-suppress-never-strand #position-invariant #owning-file-filter #routemap-key-carries-the-file #decide-off-emitted-output #match-iife-header #await-absorb #auto-await-family-not-closed #142-bare-sites #option-c-ruled-not-built #reset-init-thunk-promise #corpus-emit-differential #corpus-check-goggles #pre-land-gate #codegen-task-shape #dual-goggle #node-check-blind-to-tla #bun-vm-script-blind #truncated-probe #1878-sources #exit-code-2-invalid-comparison #dangling-ref-class #session-proxy-bind #gh357 #csrf-token-disclosure #ast-reads-current-user-ambient #sse-currentuser-splice #channel-auth-only #permissive-by-design #s34-census-works-on-linux #windows-only-enoent #concurrent-clone-drift #session-numbers-collide #routed-to-bryan

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
- [known-gaps.md](../../docs/known-gaps.md)
- [changelog.md](../../docs/changelog.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
