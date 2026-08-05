# primary.map.md
# project: scrml
# updated: 2026-08-04T20:30:00Z  commit: b929b9c9
# NOTE (S320 INCREMENTAL pass): over `e80b692e` -> `b929b9c9` — **31 commits, six sessions**
# (S313-cont/S314-bryan-crash/S315/S316-bryan/S317-peter/S318-peter/S319-peter/S320-peter). 18
# `compiler/src` files + SPEC.md touched across 15 landed PRs (#376 #378 #379 #381 #382 #384 #385
# #386 #387 #388 #389 #390 #391 #394 #396). Re-walked: primary, domain, dependencies, error, structure,
# test, build, non-compliance. NOT re-walked: schema, migrations, auth, config, infra (zero diff in
# their surfaces this window — each keeps its own honest stamp in the Map Index).
#
# **Held OUT of this pass on purpose:** PR #405 (the CPS auto-await choke-point consolidation,
# `s320-cps-autoawait-choke-point` branch) is verified but **NOT merged to `main`** — bryan must rule
# on the fix locus (his `emitCall` root-fix vs #405's injector consolidation) before it lands. This
# pass maps `main` @ `b929b9c9` only; do not read anything below as describing #405's state.
#
# Per-window landing narratives stay DELETED (S302 ruling). **History lives in `docs/changelog.md` +
# `handOffs/delta-log.md`.** What earns space here is rules a grep cannot find.

## Project Fingerprint
Language:   TypeScript / JavaScript (mixed) + scrml itself (self-hosting stdlib + self-host compiler experiments)
Framework:  Custom compiler pipeline (no web framework) — Bun-native
Runtime:    Bun >=1.3.13 (no Node support; Bun-specific APIs throughout — `Bun.serve`, `bun:sqlite`, `Bun.$`, `Bun.SQL`, `Bun.hash`)
Type:       CLI compiler + language toolchain (single-file full-stack web-language compiler, with LSP + editor-tooling + MCP surfaces)
Size:       `compiler/src/` **187 files / 237,162 lines** (FACTS.md, mechanically derived — grew this window without a file-count change). `compiler/tests/` **1,314** `*.test.js`. Conformance **853** cases.
Version:    v0.7.1 (root package.json — the SOLE manifest; not a workspace monorepo, `files`-allowlisted, publishable). **Zero manifest diff this window.**
CI:         GitHub Actions — three workflows on `main`. `gate` is unchanged at **12 steps** this window. `windows` job gained one line: `PUPPETEER_SKIP_DOWNLOAD: "true"` on `bun install` (that job runs unit+conformance only, never the browser tier — the puppeteer postinstall download was pure cost and a flake source, witnessed on PR #382). `advisory-review` stays DISABLED (manual fire only); `cloud-maps` Stage 2 stays DELETED (no scheduled map refresh — see the S313 warning below, still true).

## ⚠️ MAP CURRENCY IS NOW MANUAL — READ THIS BEFORE TRUSTING A STAMP
`cloud-maps` **no longer refreshes `.claude/maps/` on any schedule.** Map regeneration reverted to the
PA at wrap. A stamp is exactly as old as the last wrap and **nothing will move it for you.** This
window's own maps sat **31 commits / 6 sessions** behind before this pass caught them ("Maps OWED" was
recorded at the end of S317, S318, S319 and S320 in a row, each session deferring the agent dispatch).
Treat any map line as a *verify-against-source hypothesis* if `git log --oneline <stamp>..HEAD` is
non-trivial.

## Derived-figure authority
`docs/FACTS.md` is GENERATED (`bun scripts/facts.ts --write`) and CI-gated (`--check` in `gate`). It
is the authority for published counts. At this HEAD: `live compiler source` **237,162** lines / 187
files; `test files` **1,314**; `specification lines` **37,065**; `conformance cases` **853**. stdlib
modules (21), CLI verbs (11), LSP capabilities (7) unchanged.

Second generated authority: `compiler/SPEC-INDEX.md`'s totals block, gated by `--check` in CI `gate`
AND the local pre-push hook. **Only the totals are gated — the AUTHORED half is ungated and has
rotted further this window** (non-compliance.report.md C5, carried, not re-derived this pass).

**FACTS.md deliberately does NOT publish a §34 diagnostic-code total.** error.map.md carries the
reconciled count — **805 at this HEAD (+1: `E-FN-EQUALS-BODY`)** — re-derived by the same table-column
methodology error.map.md documents (its own oracle, `bun scripts/s34-census.ts`, **errors on this
Windows clone** — `ENOENT` on a malformed leading-backslash path; not chased, use the manual
methodology instead; filed as a new gap candidate, see non-compliance.report.md).

---

## INVARIANTS AND PROHIBITIONS — the rows grep cannot find

> This is the section that earns the map set. Everything here is a rule about what you must NOT do,
> or a property that must keep holding — none of it is discoverable by grepping for a symbol. The long
> form of each lives in the map named in the right column. **Rows 1-27 carried unchanged from the
> `e80b692e` pass (re-verified where the diff touched them); rows 28+ are NEW this pass.**

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

---

## Map Index

| Map | Stamp | Contents |
|---|---|---|
| **primary.map.md** | **`b929b9c9`** | this file — fingerprint, 34 INVARIANTS (7 new), routing, key facts |
| **domain.map.md** | **`b929b9c9`** | NEW: `E-FN-EQUALS-BODY` concept note; `keep-alive` fifth `<page>` attribute + the (a)-then-(b) follow-on correction; `<timer>`/`<poll>` first-tick asymmetry; crossmodule-async-in-markup. `<machine>`-removal doc drift RESOLVED (#376) |
| **dependencies.map.md** | **`b929b9c9`** | NEW: `parenthesizeAwaitServerCallsInExpr` (match-arm auto-await); `distRelativeServerSpecifier` → `distRelativeLocalSpecifier` generalization (#390); `crossFileClientReads` context field (#358 series); `export let`/`var` + serve-tool reachability fix (#388) |
| **error.map.md** | **`b929b9c9`** | **805** §34 codes (+1, `E-FN-EQUALS-BODY`); sub-parse span rebase (#389) fixed the within-node gate's Windows dead-canary symptom; conformance 850→853 |
| **structure.map.md** | **`b929b9c9`** | counts re-derived (187 files / 237,162 lines, unchanged file count); span-rebase note cross-referenced |
| **test.map.md** | **`b929b9c9`** | 1,314 test files (+10); 853 conformance cases (+3); new conformance pins for #389/#391/#394/#396 |
| **build.map.md** | **`b929b9c9`** | `windows` job: `PUPPETEER_SKIP_DOWNLOAD` env added; `scripts/review-debt.ts` (NEW, S316) — a PR review-floor tracker, boot-wired, NOT CI-blocking |
| **non-compliance.report.md** | **`b929b9c9`** | S313-N1 (`<machine>` doc drift) RESOLVED by #376, re-verified; new uncertain entry for `docs/changes/onmount-c-build/BRIEF.md` (untracked, live dispatch brief for parked work) |
| config.map.md | `e80b692e` | **deliberately older.** Zero env-surface diff this window |
| infra.map.md | `e80b692e` | **deliberately older.** Zero infra diff this window (the one CI line change is in build.map.md's CI section, not infra's deploy-target surface) |
| schema.map.md | `fe14c9b2` | **deliberately older.** `compiler/src/types/` has ZERO diff across four windows now |
| migrations.map.md | `115e8b1b` | **deliberately older.** No DB/migration surface touched in four windows |
| auth.map.md | `df2ac831` | **deliberately older.** Correct at its stamp for JWT/OAuth/protect-floor/CSRF/§20.5 session |
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
| **"where is per-chunk MODULE-INIT emitted, and what owns the boundary with the soft-nav rehydrator?"** | **`codegen/emit-client.ts` (assembly) + `codegen/emit-reactive-wiring.ts` (the lifecycle bodies) + `codegen/emit-event-wiring.ts` (the boundary).** Unchanged this window. Full table in dependencies.map.md. |
| **a route's `<timer>`/`<poll>` that keeps firing after a soft nav** | **domain.map.md "The route region is a THIRD lifecycle owner"** — still open (`g-route-timer-poll-not-stopped-on-soft-nav`, HIGH). |
| **a `fn`/`function` whose body is `= <expr>` and now rejects at parse time** | **`E-FN-EQUALS-BODY` (§48.2, NEW #396).** `ast-builder.js` `rejectFnEqualsBody` (:3755), four decl-body call sites + the export re-parse. Sibling of `E-FN-ARROW-BODY`. Fix: use a block body (`{ return <expr> }` or the tail-return `{ <expr> }`). See error.map.md / domain.map.md. |
| **`<page keep-alive>` — what it actually does today** | **NOTHING at runtime yet.** The attribute is admitted (parses, validates, five-member `E-PAGE-INVALID-ATTR` set) but there is no cache and no invalidation wiring — Nominal/spec-ahead. See domain.map.md invariant 29. |
| **a server call inside a value-form `match` arm that isn't awaited** | **`scheduling.ts` `parenthesizeAwaitServerCallsInExpr` (NEW #394)** — parenthesize-wraps the call (`(await fn()).field`), not a bare prefix. Consumed by `emit-logic.ts`'s value-form match-arm lowering. See dependencies.map.md invariant 31. |
| **a diagnostic code — ANY code, any prefix** | **error.map.md**, starting at "HOW TO LOOK UP A DIAGNOSTIC CODE". `bun scripts/s34-census.ts` **currently ERRORS on this Windows clone** (`ENOENT`, malformed path) — fall to error.map.md's family table, then `grep -rn "<CODE>" compiler/src/`. |
| **the CPS auto-await choke point / `given`/`if`/`match` scheduler boundary** | **Do NOT build on this without reading `hand-off.md`'s S320 top block first.** PR #405 (the consolidation) is HELD, unmerged, pending bryan's ruling on the fix locus. Nothing in `.claude/maps/` describes #405's state — only `main` @ `b929b9c9`, where `scheduling.ts`'s `isControlFlowBoundary` still treats `given`/`if`/`match` bodies as opaque (unchanged this window). |
| **build commands / CI stages / a gate decision** | build.map.md. `gate` unchanged at 12 steps; `windows` job now skips the puppeteer download. |
| **types / interfaces / AST node shapes** | schema.map.md (stamp `fe14c9b2` — zero diff across four windows) |
| **environment variables / config keys / CI secrets** | config.map.md (stamp `e80b692e` — zero diff this window) |
| **auth flows / JWT / OAuth / protect-floor / session builtin** | auth.map.md (stamp `df2ac831` — honest, unchanged surface) |
| **per-session history: what landed when, and why** | **`docs/changelog.md` + `handOffs/delta-log.md` + `hand-off.md`. NOT these maps.** |
| **non-compliant / stale docs** | non-compliance.report.md |

## Key Facts

- Entry point: `compiler/bin/scrml.js` -> `compiler/src/cli.js` dispatches to `commands/*.js` (11 subcommands); the pipeline is `compileScrml()` in `compiler/src/api.js` (block-split -> AST-build -> type-check -> codegen).
- **This window's PR count (15) is much larger than its invariant count (7 new).** Most landings were narrow codegen-completeness fixes (`export const`/`let`/`var` client/server gating, tool-import re-basing, span rebasing) that widen an existing mechanism rather than add a new one — read the invariants table before assuming a large commit count implies large conceptual surface.
- **The maps-refresh cadence failed for FOUR consecutive sessions before this pass ran** (S317, S318, S319, S320 each recorded "Maps OWED" and deferred the agent dispatch). `cloud-maps` has no scheduled leg to catch this — see the currency warning above. If this pattern repeats, the standing recommendation (non-compliance.report.md S313-N4) — a deterministic non-AI map-currency check in `cloud-maps` Stage 1 — gets stronger with each deferred window.
- **PR #405 (CPS auto-await consolidation) is verified, gate-green, and deliberately UNMERGED.** Do not build further auto-await work and do not merge it until bryan rules on the fix locus (his `emitCall` root-fix vs #405's injector consolidation) — see `hand-off.md` S320 top block.
- **SPEC.md is the sole normative source.** PIPELINE.md documents stage internals. Any doc contradicting SPEC.md is non-compliant per pa.md Rule 4.
- **`.claude/` is gitignored; `.claude/maps/` and `.claude/agents/project-mapper.md` are FORCE-tracked.** Staging a map refresh requires `git add -f`.
- **These maps have no CI gate of their own and no scheduled refresh.** Any generation that asserts completeness is a hypothesis until re-derived.
- **`bun scripts/s34-census.ts` is currently BROKEN on this Windows clone** (`ENOENT` on a leading-backslash path when invoked from `compiler/`-relative cwd) — a new finding this pass, not previously recorded. Use the manual §34 table-column methodology (error.map.md) until fixed. Candidate for a fresh gap filing.

## Tags
#scrml #map #primary #index #compiler #bun #invariants #prohibitions #module-init #rehydrator-boundary #route-region #machine-retired #e-deprecated-001 #e-fn-equals-body #e-fn-arrow-body #fn-decl-parse-sites #export-reparse-swallow #keep-alive #§4.15 #§20.8.4 #§40.8 #page-fifth-attribute #w-route-request-duplicates-server-load #follow-on-not-alternative #timer-poll-first-tick #§6.7.5 #§6.7.6 #immediate-poll-tick #match-arm-autoawait #parenthesize-await-server-calls #scheduling-ts #crossmodule-async-markup #s239-catch #subparse-span-rebase #within-node-gate-windows-fix #export-let-var-emission #serve-tool-reachability #dist-relative-local-specifier #coordinate-space #§47.9.5 #cps-choke-point #pr-405-held #auto-await #puppeteer-skip-download #windows-ci #review-debt-script #s34-census-broken #no-scheduled-map-refresh #maps-owed-four-sessions #changelog-dereferenced

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
