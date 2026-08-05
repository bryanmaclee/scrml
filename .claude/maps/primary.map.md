# primary.map.md
# project: scrml
# updated: 2026-08-05T00:00:00Z  commit: 15e5e070
# NOTE (S321 INCREMENTAL pass): over `b929b9c9` -> `15e5e070` — **~19 commits, three session-windows**
# (the S320 continuation/tail + S319 + S321-peter — session numbers collide across clones per
# `hand-off.md`'s own disambiguation note; this pass reconciles all of it into ONE maps stamp). 7
# `compiler/src` files + SPEC.md touched across 4 landed PRs (#405 #416 #417 #418 — #414/#415 are
# review/process PRs with no source diff). Re-walked: primary, domain, dependencies, error, structure,
# test, non-compliance. NOT re-walked: schema, migrations, auth, config, infra, build (zero diff in
# their surfaces this window — each keeps its own honest stamp in the Map Index).
#
# **CORRECTION — the prior pass's headline finding is now WRONG and is fixed throughout this map set.**
# PR #405 (the CPS auto-await choke-point consolidation) was reported "HELD, unmerged, pending bryan's
# ruling" at the `b929b9c9` stamp. **It has since LANDED** (`649d6fce`, merged S319 after bryan's `go,
# your recs` delegation — see `hand-off.md`'s S321 top block) and was reviewed clean at `bbd77bec`
# (#413). Every "#405 HELD" sentence this map set carried — in this file, dependencies.map.md,
# domain.map.md, error.map.md, structure.map.md — is corrected this pass. Two further landings this
# window: `W-IF-IN-EACH` (§17.1, #416, GH adopter #409) and the reset init-thunk reassignment skip
# (§6.8, #417, HIGH).
#
# Per-window landing narratives stay DELETED (S302 ruling). **History lives in `docs/changelog.md` +
# `handOffs/delta-log.md`.** What earns space here is rules a grep cannot find.

## Project Fingerprint
Language:   TypeScript / JavaScript (mixed) + scrml itself (self-hosting stdlib + self-host compiler experiments)
Framework:  Custom compiler pipeline (no web framework) — Bun-native
Runtime:    Bun >=1.3.13 (no Node support; Bun-specific APIs throughout — `Bun.serve`, `bun:sqlite`, `Bun.$`, `Bun.SQL`, `Bun.hash`)
Type:       CLI compiler + language toolchain (single-file full-stack web-language compiler, with LSP + editor-tooling + MCP surfaces)
Size:       `compiler/src/` **187 files / 237,399 lines** (FACTS.md, mechanically derived — grew this window without a file-count change). `compiler/tests/` **1,319** `*.test.js`. Conformance **855** cases.
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
is the authority for published counts. At this HEAD: `live compiler source` **237,399** lines / 187
files; `test files` **1,319**; `specification lines` **37,066**; `conformance cases` **855**. stdlib
modules (21), CLI verbs (11), LSP capabilities (7) unchanged.

Second generated authority: `compiler/SPEC-INDEX.md`'s totals block, gated by `--check` in CI `gate`
AND the local pre-push hook. **Only the totals are gated — the AUTHORED half is ungated and has
rotted further this window** (non-compliance.report.md C5, carried, not re-derived this pass).

**FACTS.md deliberately does NOT publish a §34 diagnostic-code total.** error.map.md carries the
reconciled count — **806 at this HEAD (+1: `W-IF-IN-EACH`)** — re-derived by the same table-column
methodology error.map.md documents (its own oracle, `bun scripts/s34-census.ts`, **still errors on this
Windows clone** — `ENOENT` on a malformed leading-backslash path, unchanged since the prior pass, not
re-chased; use the manual methodology instead; see non-compliance.report.md).

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
| **35** | **The §13.2 CPS auto-await choke-point is CONSOLIDATED (PR #405, `649d6fce`, LANDED — corrects the prior pass's "HELD" status).** `injectPromiseAwait` (the old per-statement string-regex pass) is RETIRED. ONE shared AST walker now backs all three auto-await entry points (on-mount, every client fn-body statement, match-arm expressions), and — the part that actually changes program behavior — auto-await now DESCENDS into `given`/match-block/`try` bodies that were previously opaque `isControlFlowBoundary` nodes to the scheduler. Closes the `g-cps-scheduler-opaque-boundary-hides-nested-server-calls` family. | dependencies.map.md · structure.map.md |
| **36** | **A per-row `if=` on a NESTED (non-item-root) element inside `<each>` is a CREATE-TIME append gate, not reactive on a same-key reconcile — the compiler now WARNS (`W-IF-IN-EACH`, §17.1, #416, GH adopter #409) when the condition references the iteration item.** Only the row's SOLE item-root `if=` is reactively swapped today; the reactive fix for the nested case is DEFERRED and routed to bryan. | domain.map.md · error.map.md |
| **37** | **A top-level `@name = expr` REASSIGNMENT of a structurally-declared (`<name>`) cell SHALL NOT re-register the cell's reset init-thunk (§6.8, #417, HIGH) — the runtime's thunk registry is last-write-wins, so a naive re-registration inverted `reset()`.** `collectStructuralDeclNames` (reactive-deps.ts, NEW) distinguishes a genuine reassignment (skip) from an IMPLICIT `@`-declaration (keep — an SSE/channel bind must still re-establish on reset). Residual, out of scope: `g-implicit-cell-double-write-clobbers-reset-init` (MED, NEW — a double-write of an IMPLICITLY-declared cell still clobbers; needs emission-order tracking). | domain.map.md |

---

## Map Index

| Map | Stamp | Contents |
|---|---|---|
| **primary.map.md** | **`15e5e070`** | this file — fingerprint, 37 INVARIANTS (3 new), routing, key facts |
| **domain.map.md** | **`15e5e070`** | NEW: `W-IF-IN-EACH` nested per-row `if=` non-reactivity (§17.1, #416); the reset init-thunk reassignment skip (§6.8, #417). `#405 HELD` framing CORRECTED to landed throughout |
| **dependencies.map.md** | **`15e5e070`** | `scheduling.ts` rewritten: `injectPromiseAwait` RETIRED, ONE shared `collectAwaitSites`/`applyAwaitSites` walker now backs all three auto-await sites (#405, LANDED); `collectStructuralDeclNames` (§6.8, #417); `W-IF-IN-EACH` detection helpers (§17.1, #416) |
| **error.map.md** | **`15e5e070`** | **806** §34 codes (+1, `W-IF-IN-EACH`); `#405 HELD` framing corrected; `g-given-block`/`g-hash87`/`g-ternary-init` auto-await gaps RESOLVED by #405 |
| **structure.map.md** | **`15e5e070`** | counts re-derived (187 files / 237,399 lines, unchanged file count); `scheduling.ts` bullet rewritten for the #405 landing; 3 new per-file bullets (reactive-deps.ts, emit-logic.ts §6.8, emit-each.ts §17.1) |
| **test.map.md** | **`15e5e070`** | 1,319 test files (+5: unit +4, conformance +1); 855 top-level conformance cases (+2); new coverage for #405/#416/#417 |
| build.map.md | `b929b9c9` | **deliberately older.** Zero CI/build-surface diff this window (`git diff b929b9c9..HEAD -- .github/ package.json scripts/` is empty) |
| **non-compliance.report.md** | **`15e5e070`** | `#405 HELD` staleness (this map set's own prior-pass claim) is the headline finding this pass; carried findings re-verified where touched |
| config.map.md | `e80b692e` | **deliberately older.** Zero env-surface diff this window |
| infra.map.md | `e80b692e` | **deliberately older.** Zero infra diff this window |
| schema.map.md | `fe14c9b2` | **deliberately older.** `compiler/src/types/` has ZERO diff across five windows now |
| migrations.map.md | `115e8b1b` | **deliberately older.** No DB/migration surface touched in five windows |
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
| **the CPS auto-await choke point / `given`/`if`/`match` scheduler boundary** | **LANDED (PR #405, `649d6fce`) — corrects the prior pass's "HELD" status.** `scheduling.ts`'s `isControlFlowBoundary` no longer fences the fn-body auto-await walker out of `given`/match-block/`try` bodies; `injectPromiseAwait` is retired in favor of the shared `collectAwaitSites`/`applyAwaitSites` walker. See dependencies.map.md's "§13.2 CPS auto-await CHOKE-POINT" row for the mechanism and which gaps it closed. |
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
- **This window's headline is a CORRECTION, not a new feature.** The prior pass reported PR #405 "HELD, unmerged" — it landed in the interim (`649d6fce`) and this pass propagates that fact through every map that carried the stale claim. The two genuinely new landings (`W-IF-IN-EACH` #416, the reset-init-thunk skip #417) are each a single focused fix, not a restructuring.
- **The maps-refresh cadence caught up at the prior pass, then slipped again for the S320-tail + S319 + S321 window before this pass ran.** `cloud-maps` still has no scheduled leg to catch this — see the currency warning above. The standing recommendation (non-compliance.report.md S313-N4) — a deterministic non-AI map-currency check in `cloud-maps` Stage 1 — remains unactioned and gets another data point supporting it.
- **PR #405 (CPS auto-await consolidation) is LANDED (`649d6fce`) — the prior pass's "verified, gate-green, deliberately UNMERGED" note is stale and is retracted.** Bryan delegated the fix-locus ruling ("go, your recs") and the consolidation-not-root-fix approach landed; reviewed clean at `bbd77bec` (#413).
- **SPEC.md is the sole normative source.** PIPELINE.md documents stage internals. Any doc contradicting SPEC.md is non-compliant per pa.md Rule 4.
- **`.claude/` is gitignored; `.claude/maps/` and `.claude/agents/project-mapper.md` are FORCE-tracked.** Staging a map refresh requires `git add -f`.
- **These maps have no CI gate of their own and no scheduled refresh.** Any generation that asserts completeness is a hypothesis until re-derived.
- **`bun scripts/s34-census.ts` is STILL BROKEN on this Windows clone** (`ENOENT` on a leading-backslash path when invoked from `compiler/`-relative cwd) — unchanged since the prior pass, not re-chased this window. Use the manual §34 table-column methodology (error.map.md) until fixed.
- **New this pass:** `W-IF-IN-EACH` (§17.1, #416) and the reset init-thunk reassignment skip (§6.8, #417) — see invariants 36/37 and domain.map.md.

## Tags
#scrml #map #primary #index #compiler #bun #invariants #prohibitions #module-init #rehydrator-boundary #route-region #machine-retired #e-deprecated-001 #e-fn-equals-body #e-fn-arrow-body #fn-decl-parse-sites #export-reparse-swallow #keep-alive #§4.15 #§20.8.4 #§40.8 #page-fifth-attribute #w-route-request-duplicates-server-load #follow-on-not-alternative #timer-poll-first-tick #§6.7.5 #§6.7.6 #immediate-poll-tick #match-arm-autoawait #parenthesize-await-server-calls #scheduling-ts #crossmodule-async-markup #s239-catch #subparse-span-rebase #within-node-gate-windows-fix #export-let-var-emission #serve-tool-reachability #dist-relative-local-specifier #coordinate-space #§47.9.5 #cps-choke-point #auto-await #puppeteer-skip-download #windows-ci #review-debt-script #s34-census-broken #no-scheduled-map-refresh #changelog-dereferenced #pr-405-landed #cps-choke-point-landed #inject-promise-await-retired #w-if-in-each #each-nested-if-not-reactive #reset-init-thunk-reassignment #collect-structural-decl-names #§6.8 #§17.1 #correction-pass #g-implicit-cell-double-write-clobbers-reset-init

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
