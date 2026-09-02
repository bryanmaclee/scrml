# domain.map.md
# project: scrml
# updated: 2026-09-02T06:00:07-06:00  commit: ad7b65dc
# generated-at: ad7b65dc — **THE SAME SHA AS LINE 3, BY CONSTRUCTION, AND THAT IS THE POINT.** At this
# watermark `merge-base HEAD origin/main` == `origin/main` == `HEAD` == `ad7b65dc`, so there is no
# second SHA to record and none is invented. MAP-STAMP RULE run at WRITE time, all three commands:
# `BASE=$(git merge-base HEAD origin/main)` -> `ad7b65dc`; `git diff --name-only BASE..HEAD --
# compiler/ scripts/ conformance/ stdlib/ lsp/ .github/ package.json` -> **EMPTY**;
# `git merge-base --is-ancestor ad7b65dc origin/main` -> **exit 0**. Inbound check (invariant 48)
# also run: `git merge-base --is-ancestor 2ec2ce3a ad7b65dc` -> exit 0.
#
# ━━━━━━━ ⛑ S395 wrap-6c — STAMP ADVANCED `2ec2ce3a` -> `ad7b65dc` (25 commits) ━━━━━━━
#
# **TWO NEW SECTIONS, both added because the window's defects were CLASSES rather than instances:**
# **§17.1.1** — the `if-chain` node shape as a defect-family ROOT (the shape rule, the lone-`if=`
# discriminator, and the two walks that are DELIBERATELY not converted); and **§17.6.1 / §17.6.2 /
# §17.6.10** — the value-form sugar, where a SPEC amendment made a shipping emit non-conforming
# without touching one line of compiler code, and where two constructs correctly share a leaf
# predicate while correctly NOT sharing a shape rule.
#
# ⚠ **THE REST OF THIS FILE (~2,400 lines) WAS NOT RE-WALKED.** `SPEC.md` moved +108 in exactly ONE
# commit (#802, the §17.6 amendment) and `SPEC-INDEX.md` by 124 lines; **no §-anchor, line range or
# normative rule outside §17.6 changed**, so every §-anchored claim below still anchors. Claims this
# window's diff does not touch carry their PRIOR verification, not a fresh one.
#
# ━━━ HISTORICAL (S391 pass; line 3 has since advanced to `ad7b65dc`) ━━━ generated-at: 2ec2ce3a — **THE SAME SHA AS LINE 3, BY CONSTRUCTION.** S391 wrap-6c INCREMENTAL over `0dd659a1..2ec2ce3a`. MAP-STAMP RULE run at WRITE time (`BASE` = HEAD = `origin/main` = `2ec2ce3a`; source diff `BASE..HEAD` EMPTY; outbound `--is-ancestor` exit 0). ⛑ **A MAP-INTERNAL CONTRADICTION WAS RESOLVED HERE:** this file cited `SPEC.md:19722` and error.map.md cited `SPEC.md:19728` for the SAME `E-STATE-BLOCK-STATEMENT-FORM` §34 row — two watermark generations (`0dd659a1` vs `ff4b37e5`) that were never re-synced. Both are now `:19729`, re-derived by grepping the row.
# codegen surface S380 touched; NOT a full re-walk). `git merge-base --is-ancestor 48f0aaf8 0dd659a1`
# exits 0; HEAD == origin/main == 0dd659a1.
#
# ⛑ **POST-WRITE RE-CHECK: the wrap landed mid-pass and `origin/main` advanced `ff4b37e5` -> `9f75061c`
# (`wrap(s383)`, #753). `git diff --stat ff4b37e5..9f75061c -- compiler/` is EMPTY — the wrap is
# docs-only — so the SOURCE STATE READ IS `ff4b37e5` and every anchor below holds byte-identically at
# `9f75061c`. Named here rather than re-stamping, for the same reason lines 3–4 were not moved.**
# ━━━ ⛑ S383/S384 SCOPED INCREMENTAL — THE WHOLE-SET STAMP ON LINES 3–4 IS **DELIBERATELY NOT MOVED** ━━━
#
# Nine compiler-source files re-verified against `origin/main` == HEAD == **`ff4b37e5`**
# (`git merge-base --is-ancestor 0dd659a1 ff4b37e5` exits 0). NOT a re-walk of this map; lines 3–4
# stay at `0dd659a1` (the S382 pattern — bumping a whole-set stamp on a partial pass falsely claims
# the whole file was re-verified). Corrections below carry a `⛑ S383` / `⛑ S384` marker.
#
# **TWO NEW SECTIONS THIS PASS, both read from the actual diff, not from commit messages:**
#   · **§59.7 (NEW)** — #749's value-native map/set SERVER runtime and #748's server-pass
#     variant-field fallback. The shared shape is *a lowering that was silently client-only*.
#   · **§40.8 (AMENDED)** — ruling 3's arms are **HELD, not landed**; the §34 row that used to
#     contradict behaviour has been CORRECTED, so the doc/behaviour contradiction this map recorded
#     is CLOSED while the behaviour hole stays OPEN — and the class gained a FOURTH HIGH member.
#
# **TWO NEW SECTIONS ADDED THIS PASS, BOTH VERIFIED AGAINST THE ACTUAL S380 DIFF, NOT INFERRED FROM
# COMMIT MESSAGES:**
#   · **§16.6.1** — #726/#731/#733, three `component-expander.ts` fixes sharing one root shape
#     (a substitution site operating on TEXT instead of the parsed AST). #731 SUPERSEDES the
#     substitution MECHANISM §16.6 point (2) (S376) describes — that section is carried for its
#     still-current DECL-routing table, with a forward-pointer added at its head.
#   · **§51.3** — #732 (a `<match on=@derivedCell>` scrutinee wires via effect+`_scrml_derived_get`
#     instead of a subscribe that never fires on a derived recompute) and #735 (a per-item `<match>`
#     inside `<each>` now re-dispatches on a same-key reconcile field change, via the same per-item
#     effect wrapper the interpolations use), plus the same-value short-circuit both fixes needed to
#     avoid tearing down an unchanged arm on every reconcile pass.
#
# **Not otherwise re-walked this pass** — every other section (§4.18.1, §17.2 show=, for-lift
# reconcile, the DB-authoritative tier, etc.) carries from the prior watermark unverified beyond
# spot-checks where the S380 diff touched an adjacent citation (none did, outside the two sections
# above).
#
# generated-at: fc6df72e — **THE SAME SHA AS LINE 3, BY CONSTRUCTION.** Working tip at write time
# `60803548` on `wrap/s376`; `git diff --name-only fc6df72e..60803548` is FOUR DOCS FILES and ZERO
# source, so the source state read IS `fc6df72e`, which is `merge-base HEAD origin/main` and IS
# `origin/main`. Line 3 and line 4 carry one SHA on purpose (S372 shipped a self-contradicting pair).
#
# ⚑ **S376: `compiler/SPEC.md` MOVED BY EXACTLY ONE LINE (37,539 -> 37,540) AND THAT ONE LINE IS A
# LANGUAGE RULING, NOT AN EDIT.** The whole diff is a single new §34 catalog row at `SPEC.md:19729`
# — `E-STATE-BLOCK-STATEMENT-FORM` — which makes NORMATIVE what §34's
# `E-WRITE-NOT-IN-LOGIC-CONTEXT` and `W-STATE-BLOCK-BARE-WRITE-DECL` rows had only implied:
# **a `<db>` / `<state>` / `<schema>` STATE-block body is MARKUP context, so the §40.8
# `default-logic` auto-lift does not reach it, and logic written there is now REFUSED rather than
# silently shipped as page text.** Its own section below. (`SPEC-INDEX.md` also moved 110 lines —
# that is #709's boot-trim ROTATION of amendment narrative out of the index preamble; no §-anchor,
# line range or rule changed, so every §-anchored claim in this map still anchors.)
#
# **THE RULING BEHIND IT, because the code is downstream of it and a reader will ask:** S375
# ruling 1, limb (b) — *logic at a state-block locus is REFUSED, not linted* — with the S376 decision
# to allocate a FRESH code rather than fire the reserved `E-STATE-BLOCK-BARE-WRITE-DECL`. Per S368
# (logic at a markup locus is REFUSED, not linted) this is conformance restoration against a ruling
# already made, not new policy.
#
# **CARRIED FROM S372 AND RE-VERIFIED BY EXECUTION AT THIS WATERMARK — both still hold:**
#   · **CORRECTION 1 (§17.1.2.3)** — a markup `if=` on a NON-ROOT element inside a row template does
#     NOT "emit nothing and fail closed"; it emits a real create-time append gate plus `W-IF-IN-EACH`.
#     **`compiler/SPEC.md:11686` STILL carries the stale row** — re-checked here, still flagged in
#     `non-compliance.report.md`.
#   · **CORRECTION 2 (§17.2)** — `show=` on a STRUCTURAL element is never CAPTURED, not merely
#     unwired. **RE-GREPPED at this watermark: `grep -rn showCond compiler/src/` returns ZERO hits**,
#     and only `ifCond` is stamped (`ast-builder.js:16041`, `:17009`, `:18050`, `:18200` — ⛑ S383,
#     all four **+118**, were `:15892`/`:16891`/`:17932`/`:18082`; each re-verified individually this
#     pass and each still lands on the `ifRaw`/`ifCond` spread).
#     ⚠ **DO NOT CONFUSE THAT WITH THIS WINDOW'S #710**, which wired `show=` on an ordinary element
#     INSIDE an `<each>` row template. Those are different loci: #710 did not give a STRUCTURAL
#     `<each show=…>` a field to read, and `showCond` still does not exist.
#
# **THREE CLIENT-CODEGEN LOWERINGS ALSO LANDED AND EACH CLOSES A SILENT-WRONG-OUTPUT CLASS** —
# `show=` inside `<each>` (#710), parametric/arity-tolerant snippet fills (#713/#714), and a
# word-char-glued `${…}` in a for-lift reconcile child (#716). Sections below.
#
# content generated-at: `728bdc92` (the S368 pass — CARRIED for the un-touched §-surfaces. The
# line-3 stamp advanced `728bdc92` -> `b9e97f1b` (S371) -> `8b2e4053` (S372) -> `fc6df72e` (S376);
# the §-surfaces this window's diff touched are RE-WALKED and marked as such.)
# **INCREMENTAL over `c96e7012` -> `728bdc92` (21 commits, PRs #657-#676, TWO operators — bryan
# S368, peter S367/S369/S370).** Ancestry CHECKED (invariant 48); outbound MAP-STAMP check run
# (primary.map.md) at WRITE time: the source diff `merge-base..HEAD` is EMPTY and `728bdc92` is an
# ancestor of `origin/main` (it IS `origin/main`).
#
# **SPEC.md +241 lines (37,298 -> 37,539), TWO new codes (`E-STDLIB-CLIENT-CHUNK-MISSING`,
# `W-TYPE-031-UNPROVEN`). THE FRAMING THAT REORDERS EVERYTHING ELSE: bryan hand-wrote scrml for the
# first time this session, and it went badly. Every compiler defect in the bryan lane came out of
# that; peter's came out of dog-fooding an order dashboard and a signup form.** ⚠ A token-diff of
# SPEC for added codes returns THREE; `W-031-UNPROVEN` is FALSE — prose shorthand inside the
# `E-TYPE-031` row. See error.map.md.
#
# **THE FOUR THINGS THAT WILL BITE A DEV AGENT:**
#
# **1. §7.5/§14.7 — `asIs` AND `unknown` ARE NOW DIFFERENT VALUES, AND THE DISTINCTION IS NORMATIVE
# (#665, dpa-036 call 1).** `asIs` means **a developer signed for it** — §14.7's named escape hatch,
# what `E-TYPE-ANY-FORBIDDEN` steers to. `unknown` means **the compiler did not look, or looked and
# could not tell**; it is NOT an escape hatch and nobody signed for it. **Before S365 they were ONE
# value:** inference gave up by returning `tAsIs()`, so a gap in the type checker was spelled exactly
# like a deliberate opt-out, and *absence of a diagnostic* and *success* were the same observation.
# `UnknownType.reason` is REQUIRED and `tUnknown()` has no zero-arg overload — **an `unknown` that
# cannot say what defeated it has decayed back into an `asIs`.** New warning `W-TYPE-031-UNPROVEN`
# (SPEC §7.5.2) reports it, and it and `E-TYPE-031` are **COMPLEMENTS, not alternatives**: 031 is "I
# proved it does not fit", UNPROVEN is "I could not prove anything". ⚑ **This retires the prior map's
# "NOT ON MAIN, NOT MAPPED" note verbatim — the split LANDED.** schema.map.md · error.map.md.
#
# **2. §41 — A CLIENT-SIDE `scrml:NAME` IMPORT IS ONLY REAL IF THE MODULE HAS A RUNTIME CHUNK, AND
# 17 OF 21 DID NOT (#669).** A client bundle is a CLASSIC SCRIPT: it cannot resolve a bare
# specifier, so `import { slug } from 'scrml:format'` lowers UNCONDITIONALLY to
# `const { slug } = _scrml_stdlib.format;`, and `_scrml_stdlib.NAME` is defined by the `stdlib-NAME`
# entry in `RUNTIME_CHUNK_ORDER` **and by nothing else**. Four were registered. **Compile exit 0,
# `TypeError` at bundle load, dead page, zero diagnostics.** Registry 4 -> 13; the other 8 now refuse
# LOUDLY with `E-STDLIB-CLIENT-CHUNK-MISSING`. **Membership is DERIVED from the §12.2 Trigger 3
# two-limb criterion, not curated** — (a) host reach into `Bun.*`/`process.*`/`bun`/`bun:*`/`node:*`,
# or (b) credential handling. ⚑ **Two normative consequences worth carrying:** (i) **a submodule
# specifier is NOT a thing the registry can express** — `scrml:auth/jwt` lowers to
# `_scrml_stdlib.auth/jwt`, which JS parses as the DIVISION `_scrml_stdlib.auth / jwt`; refusing it
# is correct and teaching the registry about submodules is its own arc; (ii) **the gate that should
# have caught this watched the WRONG PROPERTY** — `W-STDLIB-SHIM-MISSING` probes whether a shim FILE
# exists (all 21 do), while the deciding property is chunk registration. **Obligation and probe
# resolving to different artifacts is the recurring shape here, not a one-off.**
#
# **3. §17.6 — THE VALUE-FORM `if` HAD THREE SEPARATE SILENT-WRONG HOLES, ALL FOUND BY DOG-FOODING,
# ALL FIXED THIS WINDOW (#670/#672/#673).** They are worth reading TOGETHER because the class is one
# thing: **a construct that is correct at TOP LEVEL and silently degrades in a NESTED or INDIRECT
# position.**
#   · **#670 — inside an `<each>` body.** `${ if c { a } else { b } }` as the SOLE content of an
#     interp inside an `<each>` was neither a `bare-expr` nor carried `stmt.raw`, so emit-each fell
#     to `inner = ""` and emitted an empty text node. The IDENTICAL form at top level lowered to a
#     reactive ternary correctly. **Filed residual: a value-form `match` in an each interp is STILL
#     dropped** (`g-each-inline-value-form-match-or-markup-branch-interp-dropped`).
#   · **#672 — an empty-string branch.** `{ "" }` collapsed to an empty BLOCK, because the parser's
#     blank-token skip tested `tok.text.trim() === ""` and an empty-string STRING literal has blank
#     `.text` while being a MEANINGFUL expression statement. The branch then failed value-form
#     recognition and rendered nothing.
#   · **#673 — a fn-call CONDITION.** `${ if isOn() { … } else { … } }` never re-rendered when a cell
#     `isOn()` reads changed, while `${ if @c … }` did. Root: the effect-vs-static decision
#     string-scanned the LOWERED value for `_scrml_reactive_get(...)`, which sees a DIRECT cell read
#     but **not a read hidden inside a called fn**. Now ANY call in the lowered value counts as
#     potentially-reactive. ⚑ **The fail-safe DIRECTION is the reusable part: a false positive is a
#     needless effect that never re-fires; a false negative is a stale display. Bias toward the
#     effect.** The static optimisation survives only for a genuinely-const value-form `if`.
#
# **4. §18 — A `match` OBJECT-LITERAL ARM IS A RETURNED VALUE, NOT A STATEMENT BLOCK (#664).** In
# library-mode `fn`, `1 :> { x: 1 }` emitted BARE; JS reads `{ x: 1 }` as a labeled-statement block,
# the IIFE falls off its end, and the fn silently returns `undefined`. It now emits in RETURN
# position, through `emitExprField` + `_awaitMatchArmServerCalls` so a server call inside the object
# (`{ rows: queryUsers() }`) is auto-awaited (§13.2/§19.9.3) exactly as the decl path does.
# ⚠ **RESIDUAL, OPEN, HIGH: the `else`/wildcard arm was NOT covered** —
# `g-library-fn-match-else-arm-object-literal-returns-the-bare-identifier`.
#
# ⚑ **THE OPEN ITEM THAT NOW HAS ITS OWN ROUTING ROW IN primary.map.md — §40.8 DEFAULT-LOGIC MODE
# SILENTLY EMITS NON-DECLARATION CODE AS PAGE TEXT.** THREE defects of ONE class landed on this
# surface this session and none of them is fixed on `main`. **All three PA-REPRODUCED at this
# watermark by compiling and reading the emitted `<body>`, not by reading the ledger:**
#   · `<program>` + `log("M1");` → exit 0, literal `log("M1");` in `<body>`.
#   · `<program>` + `if (1) { }` → exit 0, literal `if (1) { }` in `<body>`.
#   · `<program>` + `// c` + `log("M1");` → exit 0, literal `log("M1");` in `<body>` (the comment
#     FLUSHES the surrounding contiguous run, before AND after).
#   · Control: `<program>` + `<count> = 0` lifts correctly and emits NO page text.
# **The masking limb is why these are HIGH: a swallowed statement's diagnostics are swallowed too.**
# The original reproducer read an UNDECLARED cell and `E-STATE-UNDECLARED` did not fire, because the
# statement was never compiled. **A defect that turns code into text also deletes every diagnostic
# that code would have raised.** And `W-PROGRAM-REDUNDANT-LOGIC` actively routes authors INTO the
# broken mode — it tells you to remove the `${…}` wrapper, and the wrapped form is the one that works.
# ⚠ **THE BARE-CALL LIMB IS A RULING, NOT A FIX.** §40.8 (`### 40.8 v0.3 Program Shape` at `SPEC.md:23054`, the S123 amendment bullet at `:23064` — ⛑ **S391: the anchor here read `:22813-22814`, which the S383 note to the right had ALREADY flagged as wrong; an S391 delta-shift moved it to `:22821-22822`, which is SQL DDL prose (`response_body TEXT NOT NULL,`) and equally wrong. A KNOWN-WRONG ANCHOR MUST BE RE-DERIVED, NOT SHIFTED — shifting it preserves the error with a fresh-looking number.** Now derived from the section heading) enumerates what
# auto-lifts (DECLARATIONS), carves out writes with a diagnostic, and is **SILENT on a bare call** — (⛑ S383: the anchor to its left was WRONG BEFORE THIS WINDOW TOO — the S123 amendment is `SPEC.md:23064`, and `:22813-22814` is §19.9.6 shadow-table SQL prose. The NEW ruling-3 bullet sits at `SPEC.md:23065`.)
# so *"searched §40.8, no governing sentence found"* is a FINDING that converts it into an operator
# decision. The fork: **(a) lift every text run** (closes it, but prose written directly in a
# `<program>` body then parses as logic) vs **(b) diagnose non-declaration runs** (closes it, but
# must then reject `const bias = 1.2` followed by `log(x)`, which compiles today). **Either needs
# SPEC text. Nobody should guess.** ⚑ **The bare-`if` limb is NOT covered by that ruling.**
# ⛑ **CORRECTED S383 — the clause that used to follow ("and it contradicts a §34 row outright") IS
# NOW STALE AND HAS BEEN STRUCK. The §34 row was CORRECTED this window.** `SPEC.md:19824` (§34),
# `SPEC.md:11765` (§17.4) and a NEW `SPEC.md:23065` (§40.8) all now say the auto-lift covers
# DECLARATIONS ONLY and that this locus is covered by **NEITHER** the lift nor the diagnostic.
# **The doc/behaviour contradiction is CLOSED; the behaviour hole is OPEN** — PA-RE-REPRODUCED at
# `ff4b37e5`: `<program>` + `if (1) { }` exits 0 and the emitted `<body>` carries the literal line
# `if (1) { }`. The emit site (`ast-builder.js:1885-1888`; ⛑ S383, was `:1857-1860`) is gated
# `parentType === "markup"`, the COMPLEMENT of the §40.8 locus. ⛑ **Ruling 3's ENFORCEMENT arm is
# HELD, not landed** — `BARE_CONTROL_FLOW_AT_BODY_TOP_RE`, `findControlFlowStatementEnd`,
# `_DEFAULT_LOGIC_ROOT_NAMES` and an `isStateBlockBody` parameter are at ZERO occurrences in
# `compiler/src/` + `compiler/tests/` (grepped this pass). ⛑ **And the class gained a FOURTH HIGH:**
# `g-default-logic-auto-lift-silently-disabled-by-a-preceding-prose-line` — one prose line at this
# body-top silently disables the lift for every declaration below it, with zero diagnostics.
# ⚑ **AND THE CLASS IS WIDER THAN §40.8.** A corpus sweep read from source found at least four live
# members OUTSIDE it — most sharply **`on mount { loadDashboard() }` inside a `<db>` state-block body
# ships as page text and the mount hook NEVER RUNS** (`samples/htmx-debate-dashboard.scrml:143`,
# clean compile). SPEC says `<db>`/`<state>` bodies are NOT default-logic loci — a state-block body
# is markup context — and the sibling `W-STATE-BLOCK-BARE-WRITE-DECL` covers a bare *write* there at
# **Info**, deliberately, *"because a hard error there is a bigger call."* **That locus is an OPEN
# OPERATOR RULING, not a bug with a known fix.** Plus ~25 bare `@name = expr` writes emitted as text
# in `gauntlet-r10-bun-admin` / `samples/dashboard`, and `stdlib/http/index.scrml` leaking 8 lines of
# its own body. primary.map.md Task-Shape Routing · structure.map.md `ast-builder.js`.
#
# **§13.2 — A NEW HIGH, ROUTED NOT FIXED (S370-peter, filed at `674f890b`).** A server-fn call
# **nested inside a larger expression** (`call().length`, `f(call())`, `call() > 0`) is **not awaited
# at the inner call site** in markup interps and inline event handlers — renders `""`/`undefined`,
# exit 0, no diagnostic. **The asymmetry was executed, not inferred: fn bodies and direct
# cell-assign are correct, so the class is POSITION-SCOPED.** Deliberately routed rather than patched
# in-lane because it is the §13.2-SHALL-by-RETROFIT axis. Entry:
# `g-server-call-nested-in-expression-not-awaited-outside-fn-body`.
#
# **§6.8 — `reset(@cell)` NO LONGER HANDS BACK A PROMISE (#662).** `_scrml_reset` re-invoked the init
# thunk with no `await`, so a cell whose init calls a server fn was correct at mount and became a raw
# Promise on reset. Both re-invocation paths now route through `_scrml_reset_apply`
# (`runtime-template.js:1179`). ⚠ **The thenable correction is the durable part:** a bare
# `r.then(...).catch(...)` assumes `.then` returns a promise — true of a real Promise, NOT of an
# arbitrary thenable (`{ then: (res) => res(99) }` returns `undefined`, so `.catch` throws a
# `TypeError` SYNCHRONOUSLY out of the adopter's event handler and aborts the rest of it).
# `Promise.resolve(r)` FIRST is what makes the declaration-path parity claim true rather than
# plausible.
#
# **§1.4/§7.4 — a cross-file IMPORTED markup fn now MOUNTS in an `<each>` interp (#658)**, matching
# the same-file case. The predicate moved into `compiler/src/markup-return-scan.js`, a shared leaf
# both `emit-each.ts` and `module-resolver.js` import, with an import-graph FIXPOINT so a re-exported
# wrapper at any depth is classified. **Residual OPEN:** `g-each-nested-markup-interp-stringifies`.
#
# **CARRIED FROM THE PRIOR WINDOW, all still true and amended in place below:** §40.3/§40.8 the
# ONE-ONION rule and precedence-off-SOURCE-not-FILENAME · §40.3.3 the enforced pipeline order
# (CORS preflight is stage 1; a preflight carries no credentials) · `ratelimit=` is PER-ROUTE (§4.15)
# · §38 transitions moved runtime -> stylesheet because `headers="strict"` binds the COMPILER's own
# emissions (§39.2.5), and the §20.8.2 soft-nav stylesheet hole that forces the app-wide union in the
# `<program>` shell · §21.5 strip a delimiter pair as a MATCHED PAIR.
#
# Per-window landing narratives stay DELETED (S302 ruling). **History lives in `docs/changelog.md` +
# `handOffs/delta-log.md`.** What earns space here is rules a grep cannot find.
#

scrml is a single-file full-stack language + compiler (not a web app with a runtime business domain). "Domain concepts" here are the language's own primitives, normatively defined in `compiler/SPEC.md` (§1-§65+). This map is a navigation index into that spec, grouped by concern — not a restatement of the normative text.

## Core Concepts (by SPEC section)

**Reactivity** — `@cell` reactive declarations (§6, V5-strict access model); a cell auto-subscribes every read site. Value-native maps/sets (§59) give `@cell:[K]V` / `set[K]` first-class reactive collection types. §6.6.9: server-fn / client-cell read — "THE SPLIT" — a server function reading a client cell gets an explicit CPS-marshal boundary (E-REACTIVE-003 + W-SERVER-DERIVED-MARSHAL) instead of a silent value smuggle.
**State machines** — `<engine for=Type>` (§51) governs variant-graph progression via `rule=`/`initial=`/`<onTransition>`/`<onTimeout>`/`<onIdle>`; `<engine server=@source>` gives server-authoritative hydration (§52.4.4). Sibling: §54 nested substates. E-ENGINE-* is the largest single family (see error.map.md). **`<machine>` is GONE as of S307 — see "The `<machine>` keyword is REMOVED" below.**
**Client Router / soft navigation — §20.8, LANDED (Wave-1a soft-nav + Wave-1c PR-1 composition).** `<program>` is the persistent application shell (single-file `<page>` children or multi-file `pages/*.scrml`); it MAY contain exactly one `<outlet>` — the region into which the current route's SSR-fetched content swaps on navigation. §20.8.3 link-boost (a delegated document-level `click` listener in `compiler/src/runtime-template.js`, boot-wired only on an app with an `<outlet>`) intercepts internal same-origin cross-page `<a href>` clicks and routes them through the soft-nav engine instead of a full reload; `hard` opts a specific link out. See "The one-landmark invariant" below for the §20.8.1.1 / §40.8.2 emission + composition contract.
**Standalone tools — §64** — `<program kind="tool">` compiles to a CLI-style module with one `function main(args)` entry (E-TOOL-001..006). `<program kind="tool" serve=PORT>` emits a compiler-owned `Bun.serve` harness hosting the tool's `<endpoint>`/SSE routes headlessly (no CSRF, no cookie-session, no SSR); cookie-session `auth=` on a `serve=` tool is fail-closed rejected (E-TOOL-SERVE-AUTH-UNSUPPORTED). `<foreign lang="ts">` (§23.6) gives a library file its own foreign-language declaration.
**Pattern matching / enums** — `match`/`is` over closed enum unions (§18); shorthand `.Variant` forms (§14.5); exhaustiveness is a compile error, not a runtime default. E-TYPE-082 fail-arity ruling for enum-variant construction payload arity. **§18.0.1 block-form arm validity (NEW S288, #192):** a tag opener at a block-form `<match>` arm position that is neither a variant-named arm nor the wildcard `<_>` catch-all is `E-MATCH-INVALID-ARM` (the Ghost-Pattern `<when is="…">` an LLM/framework-refugee reaches for) — see error.map.md. A KNOWN residual: a no-`for=` block-form `<match on=@cell>` still skips exhaustiveness entirely (`g-match-nofor-block-form-skips-exhaustiveness`, MED, open, flagged for bryan — a SPEC/impl divergence, not yet reconciled).
**Absence** — `not` is the ONE canonical absence value (§42). `null` and `undefined` are NOT valid scrml tokens in ANY position (expression/attribute/type/identifier) — hard rule, W-ABSENCE-IN-SCRML-SOURCE lint + E-SYNTAX-042 hard error. Defined-but-empty values (`""`, `0`, `false`, `[]`, `{}`) are NOT absence.
**Logic contexts** — `${}` (logic), `?{}` (SQL), `#{}` (CSS), `_{}` (foreign/escape-hatch, §23), `^{}` (meta/compile-time eval, §22), `~{}` (test, §19.13), `!{}` (error-arm, §19). Each is a distinct parse context (§3-§4, §7-§9).
**SQL** — `?{}` inline SQL blocks (§8) resolve against `<db>`/`<schema>` (§39); `?{}` in a library context emits reactive-deps-aware client SQL (W5b). E-SCHEMA-001/002/004 + W-SCHEMA-001 strict §39.4 `<schema>` column-type checks wired; a real-DB conformance adapter (Bun.SQL in-memory seam, `sqlEngine` opt-in) exercises live-DB behavior in the D3 corpus. **`codegen/sql-lex.ts` (#120) is the SINGLE source of truth for which `${…}` inside a `?{}` body is LIVE (code context) vs INERT** (inside a string literal, `""`-quoted identifier, `E'…'`, `$tag$…$tag$` dollar-quote, `--` line comment, or a NESTED `/* */` block comment). The same function feeds BOTH the classifier (`collect.ts` load-kind / row-scope predicate) and the emitter (`rewrite.ts` `extractSqlParams`).
**Confidentiality — the four axes (§52.15.4).** route-admission (§52.15.2) ⟂ tenant-scope (§14.8.10) ⟂ per-user row-selection (§52.15.3) ⟂ column-redaction (§14.8.9). These STACK; none substitutes for another. The two compiler-enforced floors:
  - **§14.8.9 column floor** — a protected `<schema>` column can never reach the client bundle (E-CG-001, acorn-exact egress scan, `codegen/egress-field-scan.ts` + `codegen/protect-egress.ts`).
  - **§14.8.10 tenant-row isolation floor (#117/#118)** — the ROW-level twin of §14.8.9, one predicate deeper on the SAME schema registry and the SAME egress sinks. It owns ONLY the isolation INVARIANT ("a row of tenant A never reaches a request whose ambient tenant is B"), never policy (roles/grants/who-may-act-as stay app-owned). `tenant_id` is a CONVENTION, not a declaration keyword — a `<schema>` table carrying that column IS tenant-scoped, fail-closed by default. The ambient tenant is CONSUMED, never derived: the app pins `session.set("tenantId", t)` and the floor reads `@currentUser.tenantId`. REDACTION is the guaranteeing mechanism; INJECTION is mandatory only where redaction cannot cover (aggregates `E-TENANT-AGG`, writes `E-TENANT-WRITE`, raw/foreign egress `E-TENANT-RAW-EGRESS`). `.acrossTenants()` is the sole loud opt-out (`I-TENANT-ACROSS`). Implementation: `codegen/tenant-egress.ts`, consumed by `codegen/emit-server.ts`. **S288: `tenant-egress.ts`'s `buildTenantContext` now ALSO unions the `<schema>`-declared tables (`extractDesiredSchema`), not just the `<db>`-derived registry — see the §14.8.11 section below for why the `<db>`-only reading was a defect for a `<schema>`-only app.** **§14.8.11 below relocates this SAME invariant into the database, as an opt-in escalation — see "STACK, not supersede" there.**
**SSR sequencing — auto-make-safe, §52.15.5 (#120).** The SSR compose route is an ANONYMOUS-REACHABLE GET. Seeding an auth-scoped, UNSCOPED cell into that paint would bake one query result into every viewer's HTML. The compiler **auto-makes-safe rather than hard-erroring**: such a cell is OMITTED from the SSR seed entirely and hydrates client-side post-mount behind its already-gated `/__serverLoad` fetch. `I-SSR-AUTH-SCOPED-CLIENT-HYDRATED` (Info, per-var) records the omission. Row-scope identity is decided by the shared `sql-lex` LIVE-interpolation predicate.
**CSS — the §65 scrml-native model — Wave-1 EMISSION LANDED.** Deletes cascade specificity. `<theme>` + `<defaults>` are structural elements (NOT HTML). `:where()`-flat emission, the `@layer reset, global;` order, `<theme>` token → `:root` custom-property lowering via a `@`-sigil use-site syntax, and the §65.6 runtime theme-switch reflection are implemented. Diagnostic: `E-THEME-TOKEN-UNKNOWN`.
**Realtime — §38.13 `<channel watches=table>`** — a change-feed-over-external-DB-writes primitive, distinct from the general §38 WebSocket `<channel>`. Front-end recognition + `RowChange` synthesis (`channel-watches.ts`) + Postgres trigger DDL install + the bundled-`pg` LISTEN bridge + client `__change` frame dispatch are all landed. `<onchange>` is the client-side handler element.
**Auth / BaaS** — `scrml:auth` stdlib module: magic-link / email-verify / password-reset flows + HS256 JWT + JWKS RS256 verification + `generatePassword`. §20.5 session-establishment (`session.set`/`.destroy`/`.userId`/`.role`/`.get`/`.isAuth`) is the write half of the session model; `session.set("tenantId", t)` is also the §14.8.10 tenant-key establishment point AND the identity source the §14.8.11 DB-authoritative A1 wrapper's `_scrml_active_tenant`/`_scrml_active_caps` resolvers read. See auth.map.md.
**Server/client boundary** — inferred, not annotated: a function that REFERENCES a binding imported from a server-only stdlib module (or performs DB/crypto/host access) escalates to server-only (§12.2 Triggers 1+3 — **Trigger 3 was RULED at S280 and only BUILT at S299; any doc dated between those describing it as live was wrong**); referencing `session` also escalates (§20.5). Note the precise subject: **an import is FILE-scoped and cannot itself escalate anything** — the unit of escalation is the FUNCTION that uses the binding. `E-CG-001` is the fail-closed backstop that blocks any protected DB column from reaching the emitted client bundle (acorn-exact scan, §14.8.9). **§12.2 Trigger 6 clarified S288 (#195/#200, Peter):** a first-class function reference (not a call) keeps a function reachable, and reachability descends into nested closure bodies — closes a `W-DEAD-FUNCTION` false-positive class; no placement change. See error.map.md.
**Colorless async — §13.1/§13.2, ratified S258, Seam-A LANDED.** scrml source has no `async`/`await` keywords; the compiler infers async-ness by tracing calls to Promise-returning host primitives. **As of #442 there is exactly ONE provider answering "is this name async in client mode" — `codegen/async-combinators.ts`'s `isAsyncCalleeName(name, AsyncNameFacts)`. Decision sites 3 -> 1.** The rule is mode-FREE (not-shadowed, then stdlib-Promise-export OR server-boundary-fn OR transitively-async-local-peer; there is no fourth); mode selection lives in exactly one caller, `emit-expr.ts:asyncNameFactsOf`. See the new §13.2 section below and dependencies.map.md for the unit breakdown. **The family is NOT closed** — 142 bare client server-fn call sites remain in cleanly-compiling sources.
**Writer-ownership Axiom ① — §5.5.3/§5.5.4 (#81).** A physical DOM surface has AT MOST ONE wholesale reactive writer; a contending second writer fires `E-ATTR-WRITER-CONFLICT` naming both sites.
**Typed API surfaces** — `<api>` (§60, typed EXTERNAL API consumption) vs `<endpoint>` (§61, typed INBOUND endpoint — the serve-side mirror).
**Linear types** — `lin` (§35) + the `~` pipeline-accumulator keyword (§32) for exactly-once-consumed values.
**Input state** — `<keyboard>`/`<mouse>`/`<gamepad>` (§36) are LIVE-READ, not reactive-subscribed.
**Build/deploy asset addressing — §47.9.8.** Content-addressed per-page client bundles/CSS on `scrml build`. See build.map.md.

## §14.8.11 / §14.8.11.1 / §14.8.11.2 — the opt-in DB-authoritative security tier (M1/M2/P2)

**Read this before touching `schema-differ.js`, `codegen/db-authoritative.ts`, `codegen/sql-ident.ts`,
`commands/db-migrate.js`, or the §14.8.10 tenant floor's `tenant-egress.ts`.**

**What it IS — a trust-boundary REVERSAL, opt-in per table, that STACKS with §14.8.10 rather than
superseding it.** §14.8.10 owns the isolation invariant at scrml's compiler-owned client-egress
sink — a direct `psql` connection reads unredacted rows BY DESIGN. A `db-authoritative` table
relocates the SAME isolation invariant INTO the database (Postgres row-level security), so it holds
against ANY connection. It stays on the invariant side of the §14.8.10 "consume, never derive"
firewall through M1 (the RLS policy is keyed on the SAME app-pinned `@currentUser.tenantId` scalar);
P2 (below) is the first milestone that deliberately CROSSES that firewall. The two tiers compose as
defense-in-depth: an `invoices`-style `db-authoritative` table also carries a `tenant_id` column, so
it is ALSO a §14.8.10 tenant-scoped table and the §14.8.10 compile-time hard-fails (`E-TENANT-WRITE`/
`E-TENANT-AGG`) still apply on top.

**Milestone 1 — reads-authoritative (Postgres RLS).** A table opts in with a bareword
`db-authoritative` immediately after its closing `}` (Postgres-only; M1-PROVISIONAL surface). Emits,
idempotently (never clobbers a live policy on re-migration): a bounded `scrml_app` role (`NOLOGIN
NOBYPASSRLS` — MANDATORY, because a superuser/owner BYPASSES `FORCE ROW LEVEL SECURITY`, so A1
without this bounded role is a SILENT NO-OP, the "looks enforced and isn't" trap); `ENABLE`+`FORCE
ROW LEVEL SECURITY`; a `scrml_tenant_iso` policy keyed on `current_setting('scrml.tenant', true)`
(missing GUC -> NULL -> matches NO row -> fail-closed). **A1 — the per-request principal (S2 GUC
injection):** for an app with ≥1 `db-authoritative` table, EVERY `?{}` query runs inside a
`_scrml_sql.begin(async (tx) => …)` transaction that pins `scrml.tenant` (txn-scoped `set_config`,
so it auto-resets on commit — no cross-request bleed under a pool) then `SET LOCAL ROLE scrml_app`,
then runs the original query on `tx`. Conditional engagement: zero `db-authoritative` tables emits
BYTE-IDENTICAL to today. Mechanism: `schema-differ.js` (`generateDbAuthoritativeDDL`) +
`codegen/db-authoritative.ts` (`wrapPrincipalTxn`, `appDeclaresDbAuthoritative`).

**S288 fix — the session principal wasn't actually reaching a request (`g-dbauth-session-principal-
not-wired`, was HIGH, RESOLVED).** Two compounding defects made the tier non-functional end-to-end
for a `<schema>`-only app (no `<db>` block) — the exact shape it targets. Found by an adopter's
BEHAVIORAL run (real PG16, real Argon2id credentials, real cookie sessions over HTTP), not by any
suite (the tier's own tests hand-execute `set_config` inside a transaction and never issue a
request). **(C)** the RI-route handler a plain server `function` compiles to interpolated
`_scrml_currentUser` with ZERO bindings — a `ReferenceError` on every call; fixed by a NEW
`astSqlQueryUsesCurrentUser` walker in `emit-server.ts` (widens `_needsSessionInfra`'s gate to this
third shape) plus a handler-scope-entry splice of `const _scrml_currentUser = _scrml_current_user
(_scrml_req)` when the emitted body actually references it. **(D)** `@currentUser.tenantId` was
never projected for a `<schema>`-only app — `buildTenantContext` read ONLY the `<db>`-derived
registry, so `_tenantActive` was false and `_scrml_active_tenant()` returned null on every request,
even though §14.8.11 (which gates on the DIFFERENT `db-authoritative` marker) engaged anyway and
faithfully pinned a null tenant — each half internally consistent, the composition dead, and SILENT
(no diagnostic). Fixed: `buildTenantContext` now takes the `<schema>`-declared tables as a second
arg and unions them in. Regression lock: `compiler/tests/integration/schema-only-tenant-principal.
test.js` (verified to FAIL on pre-fix source). See schema.map.md for the `buildTenantContext` shape
detail.

**Milestone 2 — the migration-apply seam (`scrml db-migrate`).** M1 EMITTED the DDL but nothing
applied it — a shipped db-authoritative app never installed its own RLS policy. M2 closes that gap
with a PRIVILEGED OUT-OF-APP CLI, never auto-apply-on-boot: the running app is, by construction, the
bounded `scrml_app` role with NO DDL rights (a role that could install the RLS policy could also
`DROP` it), so applying the security DDL requires a DIFFERENT, more-privileged migrator/owner
principal, run out-of-process (`scrml db-migrate <project> --db <migrator-url>` — mirrors
PostgREST's migrator-vs-authenticator discipline). Under the migrator connection, in ONE
transaction: `pg_advisory_xact_lock` (serializes concurrent migrators, auto-releases on
commit/rollback) -> ensure the thin `_scrml_migrations` ledger (apply-atomicity + object-authorship,
NOT a versioned migration-file history) -> read actual state (`readActualSchemaPg` + a narrow
scrml-managed policy/role PRESENCE read) -> `diffSchema` -> apply + record. **S288: a statement
failure during apply is now ATTRIBUTED to its exact index + SQL text and echoed by the CLI** — see
migrations.map.md. The never-clobber fence:
a bare `DROP TABLE` for an actual-but-not-desired table is REFUSED by default
(`W-SCHEMA-DESTRUCTIVE-DROP`) because a Postgres DROP CASCADEs the attached RLS policy/grants —
`--allow-destructive` opts in. `scrml db-migrate` is ALSO general (Fork 5): it applies a plain
`<schema>` to SQLite too (no roles/policies), finally making `<schema>` do-something-at-deploy for
every adopter, not just db-authoritative ones. Identifier escaping (`codegen/sql-ident.ts`'s
`quoteIdent`) is a SECURITY INVARIANT here, not a nicety — names read from the live DB via
`readActualSchemaPg` are attacker-influenceable, and the seam applies each statement as the MIGRATOR
(the most-privileged principal) via `tx.unsafe(stmt)`.

**Milestone 2 / P2 — writes-authority (immutable columns + the SECURITY-DEFINER mutation choke).**
P2 DELIBERATELY CROSSES the §14.8.10 "consume, never derive" firewall — scrml now COMPUTES an
authorization decision in DDL it authored, not just relocates an isolation invariant. Two pieces:
- **S3 — the `immutable` column keyword.** A per-column bareword (mirrors `not null`/`unique`)
  marks a column `scrml_app` may INSERT but never UPDATE. Because a Postgres column-level `REVOKE`
  CANNOT narrow a table-level `GRANT`, a table with ≥1 EFFECTIVELY-immutable column gets its M1
  blanket `GRANT … UPDATE …` RE-SHAPED to `GRANT SELECT,INSERT,DELETE` + `REVOKE UPDATE` + a
  column-scoped `GRANT UPDATE (<mutable cols>)`. **S288 — auto-immutable PK/`tenant_id`, RULED
  bryan.** A `db-authoritative` table's PRIMARY KEY column(s) and `tenant_id` are now ALSO treated
  as immutable whether or not the author wrote the bareword (`isEffectivelyImmutable`,
  schema-differ.js) — before this, a WITHIN-tenant PK UPDATE succeeded (only a CROSS-tenant re-point
  was RLS-blocked), and silently re-pointing a row's identity under its own tenant is exactly the
  class the tier's audit-defensibility claim rests on. No per-column opt-out. **The PRIOR
  anti-regression guarantee — "zero `immutable` columns emits BYTE-IDENTICAL to M1" — is RETIRED**:
  a `db-authoritative` table always carries a PK, so it now ALWAYS takes the column-scoped grant
  path; SPEC §14.8.11.2 records the supersession explicitly. Non-`db-authoritative` tables are
  entirely unaffected. See schema.map.md.
- **S4 — the SECURITY-DEFINER `fn`, co-located in `<schema>`.** `fn NAME(args) security definer
  owner(<role>) requires cap("x") { """ <plpgsql> """ }` — the SOLE sanctioned mutation path for a
  column `scrml_app` was revoked from. The `fn` body is managed-migratable TEXT (opaque to the
  compiler, never compiled — the scrml→plpgsql mini-compiler is a deliberately-rejected trap, §23.5
  `_{}` precedent). SECDEF hardening is a CODEGEN INVARIANT, mandatory and gate-verified: `SET
  search_path = pg_catalog, public` (pins built-ins against shadowing — a missing search_path pin is
  a CVE-2020-25695-class privilege-escalation hole, WORSE than no enforcement, not merely
  unenforced); a bounded NOLOGIN owner role DISTINCT from `scrml_app` and from a superuser;
  `REVOKE EXECUTE FROM PUBLIC` + `GRANT EXECUTE TO scrml_app`. The compiler emits the `requires
  cap("x")` check as the FIRST statement inside its OWNED `BEGIN…END` envelope (un-bypassable). The
  capability GUC: a single txn-scoped `scrml.principal.caps` (JSON array), pinned by the A1 wrapper
  in the SAME reserved txn as `scrml.tenant`, read by ONE checked helper `scrml_has_cap(text)`
  (unpinned -> `false`, fail-closed). Source: `tenant-egress.ts`'s `_scrml_active_caps(req)` —
  reads `@currentUser.caps` (M1-PROVISIONAL; an empty array when no caps source exists yet).

**The threat-model honesty bar (tier-wide, not just P2 — do not over-claim).** The GUC-based
principal (`scrml.tenant` + `scrml.principal.caps`) is server-resolved per request, but the GUCs are
SELF-SETTABLE by the `scrml_app` role: a `scrml_app` connection with an INJECTABLE SQL channel could
forge either and then invoke a SECDEF. What survives EVEN a fully-compromised `scrml_app` SQL
channel: the S3 immutable-column `REVOKE` (a Postgres privilege grant, not GUC-gated), the
SECDEF-only mutation choke, and the `NOBYPASSRLS` bound. What does NOT survive that compromise: the
GUC-gated tenant scope and cap check — those hold only for a non-compromised app (i.e., as long as
scrml's own parameterized-query emission, §8.2, keeps the SQL channel un-injectable). This is the
same self-settable-GUC model M1's `scrml.tenant` already uses.

**The atomic-milestone acceptance gate (the negative test, doubled at P2).** No milestone counts as
landed except as ONE atomic unit proven via a DIRECT-CONNECTION NEGATIVE test against a real
Postgres — a bounded `scrml_app` connection with NO `set_config` reads ZERO rows; WITH the tenant
pinned it reads ONLY that tenant's rows; at P2, additionally: a direct `scrml_app` UPDATE of an
immutable column is DENIED, a locked-column mutation NOT via the SECDEF is DENIED, the SECDEF
enforces its cap check both ways, and `pg_proc.prosecdef`/`proconfig`/`EXECUTE`-grantee are asserted
hardened. A half-shipped RLS "looks enforced and isn't" — worse than none. **S288 adds a REQUEST-PATH
lock alongside the direct-connection negative test** (`schema-only-tenant-principal.test.js`) — the
DDL negative test proves the floor exists; only the request path proves the app is standing on it. A
stronger, full login-over-HTTP form is still open (`g-dbauth-no-request-path-test`, MED).

**Known open gaps** (`docs/known-gaps.md`; none blocking). **RESOLVED THIS WINDOW (S288):**
`g-db-migrate-check-constraint-oneof-pattern` (all three original sub-bugs verdicted against real
PG16 — see error.map.md/schema.map.md/migrations.map.md); `g-dbauth-p2-pk-tenant-not-auto-immutable`
(auto-immutable PK/`tenant_id`, above); `g-dbauth-session-principal-not-wired` (above, was HIGH).
**Still open:** `g-dbauth-p2-caps-provenance` (MED — `_scrml_active_caps` has no real session-caps
source yet, `@currentUser.caps` is always `[]`, so any `requires cap` SECDEF is inert-deny until
wired; couples to S8 live revocation); `g-dbauth-secdef-owner-crud-all-tables` (LOW, over-grant);
`g-schema-predicate-arg-parse-edges` (MED, NEW S288 — `oneOf([])` empty-array + a latent MySQL
`escapeSqlString` backslash gap); `g-dbauth-no-request-path-test` (MED, NEW S288 — the regression
lock asserts emission, not a full login-over-HTTP round trip); `g-dbauth-docs-no-do-not-mark-users-
example` (LOW, NEW S288 — the marker reads as "apply to everything"; ask is a worked
don't-mark-`users` counter-example in the docs). S5 (double-entry / DEFERRED-constraint balance
triggers) is a separate P3 milestone; S7-full object-aware policy diffing and the non-provisional
surface-syntax pass are separately scoped.

**Cross-references:** §14.8.10 (the egress-redaction floor this tier stacks with); §44.2 (driver
resolution, `resolveDbDriver`); §39 (`<schema>` tables); §20.5.1 (`session.set("tenantId", …)`, the
pinned scalar `set_config` injects); §23.5 (`_{}` managed-foreign-text precedent for the plpgsql
body). Authority: bryan RULED (S286 threshold + phasing; S287 migration-apply-seam DD all-five-forks;
S287 P2 writes-authority DD S4-A co-location + "your recs"; S288 auto-immutable PK/tenant_id +
E-SCHEMA-010 reject-bareword ruling). See error.map.md (the §34 codes), dependencies.map.md (module
graph), schema.map.md (`TableDecl`/`SecdefFnDecl`/`isEffectivelyImmutable`/the lowering functions),
build.map.md (`scrml db-migrate` flags), migrations.map.md (the whole apply model).

## The one-landmark invariant + multi-file shell composition (§20.8.1.1 / §40.8.2, #124 Wave-1c PR-1; widened #126/#128)

**Read this before touching outlet, `<main>`, or MPA composition anywhere in codegen.**

**`<outlet>` is NOT a dedicated AST node.** It is an ordinary `kind: "markup"` node with `tag: "outlet"` — and so is `<main>`. There is no typed edge set, no `OutletNode` interface in `types/ast.ts`, and no ast-builder case that constructs one. Every consumer matches structurally (`n.kind === "markup" && n.tag === "outlet"`). This is the single most load-bearing fact about this surface: any pass that expects a typed node will silently find nothing.

**The invariant (§20.8.1.1):** exactly one `<main>` landmark per COMPOSED document, and the route slot is identified by the `data-scrml-outlet` attribute NAME — never by tag. The marker-not-tag rule is what keeps codegen and the runtime (`querySelector("[data-scrml-outlet]")`, runtime-template.js) in agreement even though the slot's tag varies between `<main>` and `<div>`.

**Four arrangements, three legal:**

| # | Shell shape | Outcome |
|---|---|---|
| 1 | `<outlet>` alone | outlet emits AS `<main data-scrml-outlet tabindex="-1">` |
| 2 | `<main><outlet/></main>` (wrapping) | author's `<main>` is the landmark; outlet demotes to marked `<div>` |
| 3 | `<page>`-scoped / `pages/*.scrml` `<main>` | route content owns the landmark; slot demotes to marked `<div>` |
| 4 | BARE / SIBLING `<main>` next to the outlet | **`E-OUTLET-AND-MAIN`** — ambiguous, only the author can resolve |
| 3b | `<main>` arriving via **COMPONENT EXPANSION** | **content-owned — the case-3 family (#126).** The SYM pass provably cannot see it (component bodies are raw text pre-expansion); the emitter can, and decides there. NO diagnostic fires — BY DESIGN |

**Where each decision actually lives — three files, three different stages:**

- **`codegen/emit-html.ts` — the LANDMARK decision (per-file, emit time).** `treeHasAuthorMain(root)` is a deliberately BROAD walk over every array/object-valued property, WeakSet-cycle-guarded. Breadth is the point: a false positive costs a `<div>` where `<main>` would also have been valid (invisible), a false NEGATIVE emits two `<main>`s (the exact defect the invariant prevents).
- **`codegen/index.ts` — the COMPOSITION SLOT (cross-file, composition time).** Slot = the FIRST marked element, falling back to the FIRST bare `<main>` for the pre-§20.8 back-compat path. `findMatchingCloseIdx` is a DEPTH-COUNTING close-tag scanner (skips comments and raw-text elements). `routeOwnsLandmark`/`slotShouldPromote` DEMOTE/RE-PROMOTE per composed document.
- **`compiler/src/symbol-table.ts` — the DIAGNOSTIC (SYM PASS 15.5).** `walkValidateOutlets` -> `collectOutlets` groups outlets by nearest enclosing `<program>` (orphans -> `E-OUTLET-OUTSIDE-SHELL`; 2nd..nth -> `E-OUTLET-DUPLICATE`); `E-OUTLET-AND-MAIN` fires on case 4 only, naming all three resolutions.

**ONE shared `<main>` predicate — `compiler/src/landmark-tag.ts`.** `isAuthorMainTag(node)` — case-INSENSITIVE (HTML is case-insensitive) but NR-`resolvedKind`-guarded (a user component named `Main` is not mistaken for the HTML element). Imported by BOTH `collectOutlets` and `treeHasAuthorMain`, so they cannot disagree.

**Outlet diagnostic family (4 codes):** `E-OUTLET-DUPLICATE`, `E-OUTLET-OUTSIDE-SHELL`, `E-OUTLET-AND-MAIN`, `W-OUTLET-ABSENT-SOFT-NAV-DISABLED`. See error.map.md.

## Coordinate space: SOURCE vs DIST (§47.9.5) — a CLASS, not a bug (NEW section, S296 D-4)

**Read this before touching any path computation in codegen, api.js, or a path-shaped oracle.**

scrml's emitted tree is **not** a mirror of its source tree. SPEC §47.9.5 strips a leading `pages/`
segment from `dirname(relative(outputBaseDir, source))`, so:

| source | dist artifact |
|---|---|
| `pages/login.scrml` | `dist/login.server.js`, `dist/login.client.js`, `dist/login.html` |
| `pages/customer/home.scrml` | `dist/customer/home.server.js` |
| `models/auth.scrml` | `dist/models/auth.server.js` |
| `pages.scrml` (root-level file, not a dir) | `dist/pages.server.js` |

**The strip applies to the DIRNAME only; the basename is untouched.** `api.js`'s `pathFor` is the
reference implementation; `emit-server.ts`'s `distServerPathOf` and `computeServedPath`, and
`api.js`'s own forward-index builder, each mirror it explicitly.

**The failure mode this creates.** Any code that reasons about a relationship between two files in
SOURCE space and then emits or validates it against the DIST tree is off by **exactly one segment**
— constant at every nesting depth, because the strip removes exactly one — for every file under
`pages/`. It is off by ZERO on a project with no `pages/` segment, which is why it survives most
fixtures. D-4's instance: a source-space `../models/auth.scrml` import emitted as
`../models/auth.server.js`, which from `dist/login.server.js` points ABOVE `dist/`. **The compile
stays GREEN** (a missing FILE is not a syntax error) and the bundle dies at runtime with
`Cannot find module`.

**Three lessons that generalize past D-4:**
1. **A relationship between two files must be expressed in ONE space, consistently.** The fix is not
   a `../` adjustment; it is to express BOTH endpoints in post-strip dist space and take the
   relative path between them (`emit-server.ts` `distRelativeServerSpecifier`). `emit-client-esm.ts`
   already did this for the client half — which is precisely why the client half resolved at every
   depth while the server half did not.
2. **The inverse transform is AMBIGUOUS; reversal must be a FORWARD INDEX.** A dist
   `models/auth.server.js` could have come from `models/auth.scrml` OR from
   `pages/models/auth.scrml`. `api.js` therefore maps every compiled source to the dist path it
   WRITES (`distServerKeyToSource`) and looks the specifier up, rather than inverting.
3. **An oracle validating in the implementation's own coordinate space inherits its blind spot.**
   `W-SERVER-IMPORT-UNEMITTED` exists specifically to catch a cross-file `Cannot find module`, and
   it was SILENT on the D-4 reproducer because it reversed in SOURCE space — the one space where the
   path is always self-consistent. This is the S276 shape restated: *a guard written from the same
   assumption as the code it guards proves nothing.* Both reversal sites in `api.js`
   (`checkServerImportInvariant` and `emitValueOnlyServerJsForDanglingImports`) now route through
   the same two-tier `serverImportTargetSource`, mirroring emit-server's two emission modes
   one-for-one so guard and emitter cannot drift apart.

Adjacent, same family: `rewriteRelativeImportPaths` (`api.js`) skips `.server.js`/`.client.js`
specifiers. The SKIP is still correct — but its old justification ("they live in the dist tree at
the same relative position as their `.scrml` source") was **FALSE**, and is now annotated as such.
It is correct only because the emitter speaks dist space.

**Platform note.** `isOutsideBase` and `distRelativeServerSpecifier` split on the PLATFORM `sep` and
normalize to `/` — never on a hardcoded backslash, because on POSIX a literal `\` is a legal
filename character. Same rationale `stripPagesPrefix` documents. This is exactly the class the
non-blocking `windows` CI job exists to surface.

## §12.2 Trigger 3 — a server-only stdlib import escalates its USER (NEW section, S299)

**The concept.** Placement is inferred. A function whose body reaches a stdlib module that cannot
run in a browser must be relocated to the server, or the module — and whatever secret it handles —
ships to the client. This is a **CONFIDENTIALITY boundary**, and every design choice below follows
from which direction is safe to be wrong in.

**Two server-only module sets exist, in ONE file, and they are deliberately different.** This is the
single most important fact in this section, because conflating them is the mistake the S299 arc had
to correct mid-flight.

| Set | Feeds | Direction that is SAFE to be wrong |
|---|---|---|
| `SERVER_ONLY_SCRML_MODULES` (`route-inference.ts:579`) | the async fail-closed backstop (`api.js` STDLIB-EXPORT-SEED) | **OVER-inclusion.** Defaulting an unresolvable re-export to async costs nothing. |
| `ESCALATION_SERVER_ONLY_MODULES` (`route-inference.ts:656`) | **PLACEMENT** | **NEITHER, symmetrically-badly.** Under-include -> a server-only module ships to the browser (silent leak). Over-include -> correct CLIENT code is relocated to the server (a correctness/latency cost). |

Reusing the async set for placement was MEASURED at S299 to escalate **72** corpus import sites that
are correct client code today; `scrml:data` alone (`sortBy`/`schemaFor`/`tableFor`) is 72 of the 116
server-only-module imports in the corpus and ships a real client implementation in the runtime
bundle. The sets cannot be unified.

**Membership is TWO-limbed, and the second limb is the one that gets forgotten.** A module is
escalation-server-only if EITHER: **(a) HOST REACH** — its implementation touches `Bun.*`,
`process.*`, or imports `bun` / `bun:*` / `node:*` (note the BARE `bun` specifier with no colon —
`scrml:redis` is reached only that way, and a `bun:`-only scan misses it); **or (b) CREDENTIAL
HANDLING** — it accepts or transmits a secret that must not reach a client, *even with zero host
reach*. Limb (b) exists because a host-reach-only criterion was FALSIFIED in review: `scrml:oauth`
has zero host reaches and was cleared as client-safe on that basis, while putting `client_secret` in
its token-exchange body three times and carrying a module header that reads "SERVER-SIDE ONLY". **A
derived list is only as good as the property it derives from** — the criterion was the defect, not
the list, which is why both limbs are recorded beside the ten members rather than only the members.

**Reference, not call. Depth, not top level.** Escalation fires on ANY REFERENCE to an imported
binding, at ANY depth — inside a lambda body, inside a nested `function` declaration, inside
escape-hatch raw text. Matching only top-level CALLS was proven evadable four ways, each shipping
the module and its secrets to the browser at exit 0: `["PEPPER"].map(p => hashPassword(p))`, a
nested `function` decl, a bare callback reference `["x"].map(hashPassword)`, and
`let f = hashPassword; f(x)`. On a confidentiality boundary, over-firing costs a relocation and
under-firing costs a leak, so the fail-closed choice is the right one.

**Trigger 3 emits NO diagnostic — that is by design, and it is a debugging trap worth stating.** A
function silently moving to the server is the SUCCESS path. "My function vanished from the client
bundle and there are zero errors and zero warnings" is the expected shape, not a bug report.

**It reuses the EXISTING `server-only-resource` reason kind rather than adding an
`EscalationReason` variant.** §12.2 Trigger 1 is "accesses a resource not accessible from the
client", which a server-only module import IS. Two live consumers already encode that expectation:
`emit-server.ts`'s `isBodyOnlyEscalation` (§12.6 library mode) gates on EVERY reason being
`server-only-resource` — a fresh kind fails that `.every()` and silently re-attaches an HTTP wrapper
§12.6 says to drop — and `describeServerTrigger` renders it verbatim, so
`W-DEPRECATED-SERVER-MODIFIER` correctly reports an explicit `server` keyword as redundant for this
class. `resourceType` carries the module specifier, so nothing is lost for diagnostics and the union
stays small.

**Accepted residual, named rather than hidden:** a binding shadowed ONLY inside a nested lambda
still fires (an over-fire, never a leak), and a word-boundary scan of escape-hatch raw text can match
inside a string literal in that text (same direction).

**⚠ SCOPE — THE TRIGGER IS DEFINED PER-FUNCTION, AND EVERY NON-FUNCTION POSITION IS OUTSIDE IT
(NEW S331, SPEC.md:7312).** This is the correction that matters most in this section and it is
stated normatively in SPEC now, not just here. §12.4 says *"Route inference SHALL be per-function"*,
and `collectFileFunctions` honours it LITERALLY — it yields `function-decl` nodes only. A function
is the only unit that HAS a placement to change, so:

> **A server-only reach in a position that is not a function body does not escalate. It is not
> reached by this trigger at all.** Not "escalates differently", not "escalates later" — *not
> reached*.

The positions this leaves uncovered, and their status at this HEAD:

| Non-function position | Reaches a server-only module? | Status at `c93a692c` (re-verified — `route-inference.ts` zero-diff this window) |
|---|---|---|
| `const <name> = …` **derived cell** RHS, **AT ANY DEPTH** | yes — invisible to Trigger 3 | **CLOSED by refusal — `E-DERIVED-SERVER-ONLY-REACH` (§6.6.19, #486 shipped the refusal, #500 shipped its REACH; SIX positions still leaked in between)** |
| `<name> = …` **mutable-cell initialiser** | yes — same client position | **OPEN. NOT diagnosed.** The error text for §6.6.19 says so out loud (see below) |
| **markup interpolation** (`${ hashPassword(@pw) }`) | yes | **OPEN. NOT diagnosed.** |

The derived-cell case reproduced Trigger 3's OWN founding symptom exactly — measured S331: exit 0,
**no `.server.js` emitted at all**, `const { hashPassword } = _scrml_stdlib.auth;` in the client
bundle, and a real `Bun.password.hash` argon2id implementation in the shipped runtime (4 occurrences
vs 0 for a program not importing `scrml:auth`). SPEC's own instruction to a future reader:
*"A reader adding a new non-function position to the language should treat §6.6.19 as the pattern to
follow, not this trigger."*

## §6.6.19 — `E-DERIVED-SERVER-ONLY-REACH`: the derived RHS REFUSES, it does not escalate — AT ANY DEPTH (#486 S331, REACH FIXED #500 S337)

**Where it lives.** SPEC `§6.6.19`, §34 catalog row + the long row, and a §12.2 Trigger-3 scope block
at `SPEC.md:7312`. Emitted from `route-inference.ts` **Step 3b** (`:4526`, push at `:4572`), a pass
that runs after the per-function Step 3 loop.

> ⚠ **READ THIS BEFORE ANYTHING ELSE IN THIS SECTION. #486 SHIPPED THE REFUSAL; #500 SHIPPED ITS
> REACH, AND BETWEEN THEM THE GUARANTEE THIS SECTION DESCRIBED WAS NOT IN EFFECT FOR SIX POSITIONS.**
> `collectDerivedCellDecls` descended exactly `node.body` and `node.children` while its own doc
> comment claimed it found derived cells *"at any depth"*. **Measured leaking at S337 — exit 0, ZERO
> `.server.js` emitted, `const { hashPassword } = _scrml_stdlib.auth;` in the client bundle, and a
> real `Bun.password.hash(pw, { algorithm: "argon2id" })` in the shipped browser runtime:** a
> `for`-loop `lift` body, a `while`-loop `lift` body, an `<each>` row body, an `<engine>` state-child
> body, a loop nested inside a conditional, and each of those inside a `kind="tool"` program (where
> the §64 carve-out is what must hold instead). A `for`-loop stores its `lift` body under an `expr`
> wrapper, so the cell sits at `…expr.node.children[0].body[0]` and was never visited.
> **§6.6.19's SHALL is not qualified by position, so every position the implementation could not
> reach was a conformance hole — not a language boundary.**

**Why REFUSE and not escalate — the reasoning generalises past this code.** A derived cell is a
**synchronous lazy-pull recompute (§6.6.3)**: it is pulled on read, on the client, via a dirty flag.
Escalating its RHS would make every recompute a network round trip — a shape the derived model has
no way to express. So "place it on the server" is not an available answer, and inventing one would
pre-empt a language question (*may the derived position host server work at all?*) that this fix has
no mandate to answer. **Refusing is also the reversible direction**: newly-rejecting can be relaxed
later; accepting-and-escalating is a one-way door.

**Reach is REFERENCE, not call — identical to Trigger 3's own rule.** `[@x].map(hashPassword)` hands
the server-only implementation to a client call site as surely as calling it does. The walk descends
lambda bodies, `match`-arm block bodies, and escape-hatch raw text at any depth.

**ONE scanner backs both halves and it must stay one.** `scanForServerOnlyBindingRefs(root, live)`
(`route-inference.ts:3451`) is shared by the per-function `collectServerOnlyBindingModules` (`:3397`)
and the derived-cell `collectDerivedRhsServerOnlyRefs` (`:3616`). It was EXTRACTED at S331 with no
behavioural change to the function path. **It returns local binding NAMES mapped to modules, not
just modules** — the derived diagnostic is required to name the offending member, and a name thrown
away cannot be reconstructed from a module afterwards. Two callers, two shadow-set derivations, one
walk on one confidentiality boundary.

**The error message deliberately warns against the shortest edit that silences it**, and this is the
transferable part: dropping the `const` turns the derived cell into a plain cell initialiser, which
*reaches the same module from the same client position, is NOT yet diagnosed, and compiles clean
while shipping the implementation to the browser*. A diagnostic whose obvious workaround restores
the leak has to say so in its own text. The prescribed fix is: **move the call into a `function`
(which DOES escalate, §12.2) and write its result to a plain reactive cell the markup reads.**

**Carve-out: `kind="tool"` programs (§64).** No client boundary → no leak → refusing would reject
valid code. `isToolProgram(fileAST)` short-circuits the whole Step-3b file loop (`:4459`). This
mirrors the carve-out §12.2 Trigger 3 already takes for the §20.7 `print()`/`println()` signal.

**Shadowing and string literals.** A name bound inside the RHS shadows the import and does not fire
(`collectDerivedRhsLocalNames`, `:3562`, which stops at a nested `lambda`/`function-decl` binder). A
`lit` node returns immediately from the walk — a string literal is not a reference (§12.4). The
raw-text fallback for an unstructured RHS is a deliberate over-fire, never a leak.

**Migration measured at ZERO.** 59 repo files import an escalation server-only module; none reaches
one from a derived RHS. Pinned by
`conformance/cases/derived/e-derived-server-only-reach-{pos,neg,fn-path,nested-loop}` (the `-fn-path`
case is the prescribed fix compiling clean; **`-nested-loop` is new this window and pins the POSITION
axis**, and its own rationale records that `W-EACH-PROMOTABLE` fires there deliberately — promoting
the Tier-0 `for`/`lift` to `<each>` would change the position being pinned), plus
`unit/route-inference-derived-server-only-reach.test.js` (**836L, +459 this window**) and
`conformance/conf-DERIVED-SERVER-ONLY-REACH-artifacts.test.js` (275L, NEW — the artifact tier, which
is the one that would have caught the original leak).

### THE COLLECTOR IS NOW STRUCTURAL, AND "ADD THE MISSING FIELD" IS THE DEFECT CLASS, NOT THE FIX

`collectDerivedCellDecls` (`:3730`, **now EXPORTED**) descends **every array- and object-valued
property by default.** Exclusions are a DENY-list, `skipDerivedWalkKey` (`:3677`), and it is two
clauses: `key === "span" || key.startsWith("_")` — `span` is large node-free baggage, and `_`-prefix
is the codebase's side-table convention that every sibling generic walk already skips
(`protect-analyzer.ts:437`, `tag-canonicalizer.ts:167`, `indirect-callee-resolver.ts:160`).

**Adding `expr` to a list of two would have closed the reported shape and left the class open at the
next unenumerated property. This is the compiler's SECOND instance of the field-listed-walk class** —
see `emit-client.ts`'s hand-rolled seed walker drifting against `dependency-graph.ts`'s full sweep.
**DO NOT FIX A FUTURE MISS BY ADDING A FIELD NAME HERE.**

**The deny-list was MEASURED not load-bearing for the RESULT, only for the work done.** Over the
git-tracked corpus: shipped list **68** cells · without `parent`/`loc`/`spans` **68** · `span`+`spans`
only **68** · **no deny-list at all 68.** Identical. So the list is now the smallest one that is
actually justified rather than the safest-looking one. An S337 review deleted `parent`, `loc` and
`spans` because none exists as a node field at RI time and each was **pure fail-open surface**: the
day a node kind adopts `parent` for a child-bearing field, a derived cell under it is silently
missed — precisely the defect class this walk exists to close.

**THE DIRECTION RULE, and it is the sentence to carry off this section: for a confidentiality check
the safe error is descending one field TOO MANY** (worst case a spurious refusal — loud, reversible)
**never one too few** (worst case a silent leak).

**Termination and cost.** An identity `seen` set over EVERY visited object — not just nodes reached
through an array — so a shared subtree is walked once and a cycle cannot hang the walk; the same set
is what stops a node reachable by two paths producing two diagnostics. `MAX_DEPTH = 512` because the
walk now descends ESTree expression trees, which nest one level per term: a machine-generated RHS
with a few thousand `+` terms would otherwise blow the stack — **i.e. crash the compiler with no
diagnostic, inside a security check.** Measured corpus max depth: 37.

**The §64 carve-out is applied by the CALLER, not inside the walk** (`isToolProgram`, read off the
top-level `<program>`, applied by Step 3b before the walk runs) — **which is what makes it
depth-independent by construction** and why the structural change did not have to re-derive it.

⚠ **Two properties to know before writing a test here.** (1) `Object.keys` yields property-INSERTION
order from the AST builder, which is not guaranteed to be source order, and **Step 3b pushes
diagnostics in walk order without sorting by span** — do not assert source ordering. (2) The export
exists because the termination and single-visit properties are properties of THIS walk and must be
asserted against it directly; **driving them through `runRI` conflates them with every other walk in
the stage, demonstrably so — a synthetic cyclic AST blows the stack inside
`collectFileLevelBindingRoots` (`:2600`, a walk with NO `seen` set at all) long before it reaches
this one.** That sibling fragility is real and unfixed.


## Node identity is a CODEGEN CONTRACT, not a debugging convenience (NEW section, S299)

`node.id` on an AST node is not incidental. Codegen DERIVES emitted tokens from it — an `<each>`
fence comment (`<!--scrml-each:N-->`), the `_scrml_each_renderers[key]` registry key, the
`_scrml_find_each_anchor` lookup, chunk-namespace tokens. **Two nodes sharing an id therefore share
an emitted identity, and the second write wins.**

**The failure mode has no diagnostic and no visible symptom until runtime.** The S299 instance:
`component-expander.ts` expanded from `def.nodes` — the registry's SHARED parsed body, whose ids
come from a per-component parse that numbers from ZERO. So the same component instantiated twice
reused one id set, AND two different components each started at the same low numbers and collided
with each other. Two list components emitted ONE fence id; every anchor lookup resolved to the
first fence; the executed result was panel 0 rendering panel 1's data and panel 1 rendering empty.
**Compile: exit 0, zero errors, zero warnings.** Fixed by deep-cloning per expansion from the
FILE-level `NodeCounter`.

**The invariant, stated so it can be checked:** within one FileAST after component expansion, every
node id is unique. Across files, `chunk-namespace.ts` (S280/S282) prefixes every id-derived token
with a hash of the source path, so the two halves compose — but the cross-file namespace does NOT
save you from a within-file collision, and vice versa.

**Not fully restored at this HEAD, and the gap is specific.** A post-fix duplicate-id sweep over 877
corpus files went 28 files -> 16 (12 closed, 4 reduced, 0 newly broken). The residual families are
`def.defChildren` (returned by reference / shallow-spread with the id kept), `${children}`/slot-fill,
channel-inline, and for/match. The duplicated kinds there are only `text`/`li`/`p`/`logic` —
**zero `each-block`** — so nothing id-DERIVED collides today. Read that as "the live blast radius is
closed", not "duplicate ids are gone".

**One invariant deliberately MOVED:** native markup-value ids live in a high band
(`translate-expr.js` `{ next: 900_000_000 }`, chosen so they "can never collide with a sibling
FileAST node id"). Cloning a component body renumbers them DOWN into the per-file range. Harmless —
one monotone counter seeded above `maxExistingId`, and that comment itself states the embedded id is
not load-bearing for codegen — but the guarantee is no longer what the comment claims, so do not
rely on the band.

## §17.1.2 — `if=` on `<engine>` / `<match>` / `<each>` (NEW section, S302). A FENCED widening.

`if=` is honored on exactly THREE scrml-defined structural elements. Before S302 it *parsed* on them,
was DISCARDED at AST-build, and the element rendered unconditionally and permanently — green compile,
zero diagnostics. On an `<engine>` that meant the `initial=` arm rendered forever. The widening was
ratified on the consistency argument: a first-class compiler-supported element that cannot take a
directive every HTML element takes reads as toy-status, not as discipline.

**PROHIBITION 1 — the widening is exactly three elements wide and SHALL NOT be generalized to the
registry.** `<onTransition>` / `<onTimeout>` / `<onIdle>` / `<errors>` / `<channel>` / `<page>` are
declarations and lifecycle hooks, not rendered subtrees; a structural conditional on them has no
defined meaning and SHALL be rejected. **Enforcement is PARTIAL at this HEAD and §17.1.2 says so
rather than asserting a SHALL the impl does not keep:** `<page if=>` rejects
(`E-PAGE-INVALID-ATTR`) — conformant; `<channel>` and `<errors>` emit only a `W-ATTR-001` advisory
and ignore the attribute; `<onTimeout>` and `<onIdle>` ignore it with **zero** diagnostics. Tracked
as `g-if-reject-unenforced-on-structural-declaration-elements`. **`<auth>` is deliberately NOT on the
reject list** — it is a `kind:"markup"` node, takes the ordinary markup path, and gates its subtree
correctly (verified by execution: a real `scrml-if-marker` + `<template>` are emitted). The
`W-ATTR-001` the compiler nonetheless emits for `<auth if=>` — claiming the attribute "has no
compile-time effect" — is **FALSE**; that is its own defect
(`g-w-attr-001-false-on-auth-if-gate-is-applied`).

**PROHIBITION 2 — `if=` gates RENDERED OUTPUT, never the element's declaration, state or lifecycle
(§17.1.2.1, the load-bearing rule).** For `<engine if=expr>`:
- the auto-declared engine variable (§51.0.C) is declared and readable **regardless** of `expr` —
  including from other files that mount the singleton via `<EngineName/>` (§51.0.D);
- `rule=` contract enforcement (§51.0.F), `effect=` (§51.0.H), `<onTransition>`, `<onTimeout>`
  (§51.0.M) and `<onIdle>` (§51.0.R) remain **LIVE** while `expr` is false. Transitions continue to
  occur; only their rendering is withheld;
- the boot-only opener `effect=` (§51.0.H Form 3) fires **once at module-init** and is NOT re-fired
  on a false→true flip.

Tying an engine's lifecycle to a render predicate would make `if=` a state-destroying operator and
break the §51.0.A singleton invariant — a cross-file `<EngineName/>` mount would observe a different
engine depending on an unrelated page's conditional. **This is enforced STRUCTURALLY, not merely
documented:** `ifCond` lives on the AST node, where the JS-substrate emitters that build the engine's
cell and rules cannot reach it at all. For `<each if=>` the collection is not read and no rows are
reconciled while false (reconciler state rebuilds on re-entry); for `<match if=>` no arm dispatches.
Neither carries independent state, so the distinction is vacuous for them.

**PROHIBITION 3 — a structural `if=` INSIDE an `<each>` row template is NOT honored and fails OPEN
(§17.1.2.3).** Four positions, and markup vs structural fail in OPPOSITE directions:

| position | behaviour | measured how |
|---|---|---|
| structural element in ordinary markup | gated correctly, reactively — the §17.1.2 surface | S302 |
| markup `if=` on the ROW-ROOT of an `<each>` row | gated correctly + REACTIVE (`_scrml_ifrow_apply`, `emit-each.ts:1271`) — element⇄comment swap in place | S302 / source at this watermark |
| markup `if=` on a NON-ROOT element inside a row template | ⚠ **CORRECTED S372 — the SPEC row is STALE.** It does NOT emit nothing: it emits a **create-time append gate** (`emit-each.ts:1313`, `if (cond) frag.appendChild(el)`) and warns `W-IF-IN-EACH`. So it RENDERS correctly at row-build and then goes **STALE** — never re-added/removed on a same-key reconcile | **PA-REPRODUCED at `8b2e4053` by compiling**: emitted `if (_scrml_each_item.ok) _scrml_frag_3.appendChild(_scrml_el_4);` + the `W-IF-IN-EACH` warning |
| **structural `if=` inside a row template** | emits nothing — fails **OPEN** (**never gated**) | **PA-REPRODUCED at `8b2e4053`**: `<each in=@.tags if=@shown>` inside an `<each>` row emitted the inner list with **zero references to `shown`** in the row render path, exit 0, zero diagnostics, `@shown = false` |

**The two failure directions are still opposite, and that is still the point — but the loud one is
now a WARNING, not an absence.** A fail-OPEN miss silently ships content the author wrote a predicate
to withhold, and is invisible during development whenever that predicate is usually true; nothing
warns on it. Inherited from §17.1's row-template lowering, NOT introduced by the widening; the
durable fix is ONE diagnostic covering both positions
(`g-structural-if-inside-each-row-template-fails-open`, MED, open).

**AND `show=` NEVER GETS THAT FAR.** §17.1.2.2 says `else-if=` and `show=` on a structural element
are "silently dropped". **Measured at this watermark the mechanism is upstream of emission:
`showCond` does not exist anywhere in `compiler/src/`.** The ast-builder stamps only
`ifRaw`/`ifCond` onto `<match>` (`ast-builder.js:16041`, `:18200`), `<each>` (`:17009`) and
`<engine>` (`:18050`) — ⛑ S383, all four **+118** — and `emit-html.ts`'s `isGateableIfValue` (`:1490`) reads `node.ifCond` and
nothing else. A `show=` on a structural opener is discarded at AST-build, so the fix starts at
capture, not at emit (`g-structural-element-if-chain-and-show-composition-nominal`, MED, open).

**PROHIBITION 4 — `E-IF-IN-DISPATCHED-ARM` still guards ARM BODIES, and the guard must be reverted
as a UNIT, not eroded.** An `if=` INSIDE a dispatched arm (a `<match>` block-form arm, an `<engine>`
state-child) is a **separate and REJECTED** surface — the arm body is injected with `innerHTML` on
dispatch and wired by a per-arm wire function that cannot see into a `<template>`. Omitting the guard
on the new structural path was a measured **REGRESSION**, not a missing nicety: a
`<each … if=@shown>` inside a `<match>` arm rendered 2 rows on main and 0 on the branch after one arm
round-trip, with `@shown` never changing and no diagnostic — working code went silently blank.
Refusing **DROPS** the element rather than emitting it ungated; emitting ungated would silently
ignore the author's predicate, which is the §17.1.2 defect the whole arc removed. Guard:
`refuseConditionalInDispatchedArm` (`emit-html.ts:780`), **THREE** call sites — `:1508` structural,
`:1737` if/else-if/else chain, `:2727` markup. **The revert SHA `2fbe6520` named in `hand-off.md` is
NOT in this repo's history** (`git cat-file -t 2fbe6520` → *Not a valid object name*); revert by
symbol, in lockstep across all three call sites.

**PROHIBITION 5 — ONE `if=` lowering, and no second one.** `if=` used to have TWO lowerings with
different DOM semantics — a `<template>`+marker for a "clean" subtree, a `display` toggle for
anything carrying wiring — chosen silently by a purity test, so a single `${…}` flipped the attribute
between *removes* and *hides*. #289 (S301) deleted the second. `emitIfMountGate`
(`emit-html.ts:1421`) is now the sole lowering and all FOUR hosts call it; `isGateableIfValue`
(:1472) mirrors the markup kind test so a value shape the markup path ignores is ignored identically
on a structural element; `emitGatedStructural` (:1498) is the structural adapter (no `ifCond` field ⇒
byte-identical to the pre-§17.1.2 emitter). Hand-rolling the wrap at a new host is exactly how the
divergence grows back.

**The runtime mount contract WIDENED — and the unmount is a LIVE SPAN, not a node list.**
`_scrml_mount_template` (`runtime-template.js:1480`; ⛑ **S384 — `:1429` was ALREADY WRONG; re-derived by grep**) went from "exactly one element child" to "one or
more top-level nodes", because a gated `<each>` has no element to wrap: its mount is a COMMENT FENCE
(`<!--scrml-each:ID-->…<!--/scrml-each:ID-->`), and an element wrapper is not available to it —
`<each>` is legal directly inside `<ul>`, `<tbody>` and `<select>`, where a wrapper `<div>` is invalid
HTML the parser would foster-parent out. The clone's top-level nodes are recorded on the returned
handle as `_scrml_if_range` (recorded ONLY when the handle alone does not describe the mount, so the
single-element case is byte-identical to before).

`_scrml_unmount_scope` (:1468) then removes **first recorded node through last recorded node, walking
siblings AT REMOVAL TIME** — *not* the recorded list. MEASURED, not theorised: a gated `<each>`'s
recorded range is exactly its two fence comments, and the renderer inserts every row BETWEEN them
AFTER the mount, so removing the recorded list alone left all rows (and the `<empty>` fallback) in the
DOM and **four open/close cycles accumulated 12 rows where 2 belong**. A per-node backstop still
removes anything an adopter re-parented out of the span.

`_scrml_mount_wire` (:1599) binds a multi-node mount **node by node** across the recorded range.
Widening to the shared parent instead would re-bind SIBLING wiring that was never unmounted
(double-attached handlers), and a `TreeWalker` rooted at a fence comment never returns that comment
(a TreeWalker excludes its own root) — so `_scrml_remount_each` cannot see a TOP-LEVEL fence at all.
That is why `_scrml_remount_each_fence` (:1639) exists as a separate lookup: same
`_scrml_each_renderers` registry, same idempotence, different reach.

## §55 — the synth-surface COLLAPSE MATRIX for `if=`/`show=` (NEW section, S372, #704)

**The flagship's success confirmation had never rendered, in any build ever shipped, at exit 0.**
`examples/30-validated-form.scrml:136` is `<p … if=@signup.submitted>Account created.</p>`. Two
spellings of ONE predicate lowered two different ways, because
`computeDisplayToggleCondition`'s `varName`+`dotPath` branch consulted nothing while its `condExpr`
sibling three lines away already threaded `synthCellKeys`:

```
if=(@signup.isValid)   ->  _scrml_reactive_get("signup.isValid")    correct
if=@signup.isValid     ->  _scrml_reactive_get("signup").isValid    wrong
```

**Corpus blast radius, from #704's own five-round measurement: exactly 1 changed artifact of 7,388.**

**THE SHAPE FACT THAT MAKES THIS A MATRIX AND NOT A ONE-LINER: §55 does not give every synth cell a
scalar.** The compound-level `errors` and `touched` rollups are derived OBJECT MAPS keyed by field
name, and an object literal is **always truthy** — so collapsing them would take a gate that read
`undefined` (never mounts) to one that is unconditionally true, rendering a pristine form's error
block at boot. Their value spaces differ too: `errors` maps field → **array** (`[]`, truthy),
`touched` maps field → **boolean** (scalar). ⚑ **§6.11's table says `touched` is `boolean` and
`errors` is `string[]`; the implementation disagrees, and PRIMER §13.7 B11 records the object-map
shape as INTENTIONAL** — a non-blocking spec-prose drift for a separate amendment, not a bug to
"fix" at the lowering.

**PA-MEASURED at `8b2e4053`** by compiling a `<signup><name req length(>=2)> = ""</signup>` form and
reading the emitted client JS (the prefix is the chunk-scoped `_scrml_cs_*` alias):

| source | emitted | verdict |
|---|---|---|
| `if=@signup.submitted` | `_scrml_cs_reactive_get("signup.submitted")` | **COLLAPSED** — the #704 fix; compound-level scalar |
| `if=(@signup.isValid)` | `_scrml_cs_reactive_get("signup.isValid")` | collapsed (was already correct via the `condExpr` branch) |
| `if=@signup.name.isValid` | `_scrml_cs_reactive_get("signup.name.isValid")` | **COLLAPSED** — per-field scalar |
| `if=@signup.touched.name` | `_scrml_cs_reactive_get("signup.touched").name` | **COLLAPSED to the rollup + scalar tail** — a field-key tail off `touched` is a plain boolean |
| `if=@signup.errors` | `_scrml_cs_reactive_get("signup").errors` | **DECLINED** — rollup map, always truthy |
| `if=@signup.touched` | `_scrml_cs_reactive_get("signup").touched` | **DECLINED** — rollup map, always truthy |

**THE TWO DECLINED ROWS ARE RULING-GATED, NOT UNFINISHED.** Truthiness over a §55 rollup map or a
per-field error ARRAY is *meaningless*; which of {always-true, never-true, diagnose,
`?.`-on-declined-path-only} is right is an **operator ruling**, and the lowering declines to invent
one. They are byte-identical to pre-#704 main. `g-if-attr-per-field-synth-cell-crashes-boot` is
`status=ruling-gated`, **not** `resolved`.

⚠ **RESIDUAL, NAMED NOT BURIED: `if=@field.errors` on a MARKUP-TYPED field is STILL a dead page** —
the compound value is `{name: null}`, the 3-level read dereferences null, and the `TypeError` lands
inside `_scrml_nav_rewire` under `_scrml_boot`, so **every `${…}` interpolation on the page never
wires**. A test pins `ctl === ""` so it flips loudly when the ruling closes it.

⚑ **THE METHOD LESSON IS WORTH MORE THAN THE MATRIX, AND IT COST FOUR ROUNDS.** Two review rounds
justified collapsing per-field `.errors` on "base is a DEAD PAGE there, so there is no working
behaviour to preserve." That premise was measured on ONE field-declaration form. Vary it and the
premise evaporates: `<name req length(>=2)> = <input type="text"/>` (markup-typed) gives a compound
value of `{name: null}` → crash; `<name req length(>=2)> = ""` (literal-init) gives `{name: ""}` →
merely `undefined`, no crash, gate correctly false. **Fatal→wrong on one declaration form does not
license correct→wrong on another.** The through-line, in #704's own words: *a gate over a value needs
the value's TYPE, and the type is never recoverable from the syntax of the read* — not from the leaf
name, not from the declaration form, not from the presence of a tail, and not from key-registration
alone. See feedback memory "Decl form in reproducers" (S96): mixing declaration forms is how a bug
stops reproducing.

**How the gate avoids a second hand-maintained list (invariant 65):** `collectSynthCellKeys`
(**`codegen/reactive-deps.ts:1287`** — NOT in `emit-synth-surface.ts`, where a reader looks first) gives a
compound parent FOUR keys (errors/isValid/touched/submitted) and a field child THREE (no `submitted`
— §55.7). So `<prefix>.submitted ∈ synthCellKeys` **IS** the compound-parent test, and `seg` names a
FIELD iff `<prefix>.<seg>.errors ∈ keys` AND `<prefix>.<seg>.submitted ∉ keys`. Both terms are
required: a NESTED COMPOUND also gets `<compound>.<nested>.errors` registered, but the compound-level
rollup keys only `fieldChildren` (`emit-synth-surface.ts:220-232`, which EXCLUDES compound-typed
children), so a nested-compound tail is `undefined` — a correct false gate, exactly where collapsing
IS right. Gate and outcome read the same artifact, so they cannot drift.

⚠ **THE EMITTED KEY IS PLAIN, NOT `encode()`d, AND THE REASON IS NOT THE OBVIOUS ONE.** The
membership test runs on the plain `varName`+`dotPath`, so it still hits under a chunk encoding
context. What makes the plain key correct is that `encode()` is a pass-through for unregistered names
and only TOP-LEVEL state-decl names are ever registered — **a dotted synth key never is.** If dotted
keys are ever registered, this site and `emitMember` must start encoding **together**, or the two
spellings diverge again. See dependencies.map.md's §55 SYNTH-KEY RULE table (five copies, two
resolution orders) and primary.map.md Task-Shape Routing row 1.

## Runtime-chunk tree-shaking — a two-phase decision (§47.5, GH #234 / Bug 57 / GITI-036 class)

The client runtime ships as CHUNKS, and a chunk is included only if something proves it is needed.
The decision lives in **`codegen/emit-client.ts`**, in two phases, plus a declarative closure:

1. **Pre-emit** — `detectRuntimeChunks(fileAST, ctx)` walks the AST. Sound for anything a walkable
   node shape proves (an `<each>` needs `_scrml_reconcile_list`; a `==` on a structural value needs
   `equality`).
2. **Post-emit** — `POST_EMIT_HELPER_CHUNK_GATES` scans the EMITTED lines for helper references.
   Necessary because some wiring is minted from the binding registry at emit time and has no
   walkable pre-emit shape at all.
3. **Closure** — `runtime-chunks.ts`'s `CHUNK_DEPENDENCIES` is transitively closed at the END of
   `detectRuntimeChunks`, before the chunk set is frozen.

**The failure mode is always the same shape and always ships silently:** the compile is green, the
bundle references a helper nothing defined, and the app dies at load with
`ReferenceError: _scrml_* is not defined` — which, when it lands at the top of `_scrml_boot`, aborts
boot before ANY event handler binds. The adopter symptom is a page that renders correctly and does
nothing.

**Two traps specific to the post-emit phase.** (a) Entries match as SUBSTRINGS: a trailing `(` pins
a CALL site, a bare name also catches a VALUE or `typeof` reference. GH #234 needed the bare form
because `<errors of=…/>` captures `_scrml_message_for` as a value, never calling it. (b) A `typeof`
guard around the reference does NOT make it safe: `_scrml_message_for` is a `CELL_SCOPE_ACCESSOR`, so
`cell-accessor-rename.ts` rewrites BOTH occurrences — including the one inside `typeof` — to
`_scrml_cs_message_for`, whose wrapper the chunk prologue always defines, so the guard always takes
the true branch and the ReferenceError fires inside the wrapper body. The post-emit scan runs BEFORE
that rename, which is what keeps the bare-name entry exact.

## Cross-chunk soft navigation (§20.8.2 / §20.8.7) — SHIPPED (navigate-wave1c)

Previously HELD/parked. Now implemented and SPEC-ratified, with `W-NAV-CHUNK-LOAD-FAILED` cataloged.

A route served by a separate `pages/` file rides its OWN client chunk, and its reactive wiring lives
THERE — so hydrating a soft-nav target without that chunk swaps in correct markup that is completely
unwired. §20.8.2 step 3 therefore requires the runtime to LOAD the missing chunk(s) before swapping,
**in the fetched document's own script order** (deps-first — a dependency chunk precedes its
importer) and resolving URLs from that document's `<script src>` list rather than reconstructing
them by convention.

**"Already loaded" SHALL be decided by RESOLVED ABSOLUTE URL, never by file name.** A route's own
chunk is emitted with NO directory component, so `pages/reports` and `pages/admin/reports` both
reference `reports.client.js` while resolving to two distinct files
(`g-nav-chunk-basename-collision-key`, PA-reproduced). Content hashing does not disambiguate them
either — §47.9.8 hashing is build-path only, so `scrml compile`/`scrml dev` keep the un-hashed
suffix.

**On failure or timeout: hard-navigate, do not swap.** SSR-first is preserved; the destination still
loads, as a full document. A failure arriving AFTER a newer navigation superseded this one bails
SILENTLY — the newer navigation owns the outcome (last-nav-wins, §20.8.5).

**The boot-timing consequence, which is the subtle half.** An INITIAL page load defers to
`DOMContentLoaded` exactly as before. A chunk INJECTED after boot runs when DCL has already fired
and will not fire again, so it must boot IMMEDIATELY. The emitted boot dispatch
(`emit-event-wiring.ts`, mirrored in `emit-variant-guard.ts`) is therefore an IIFE around
`function _scrml_boot()` plus a branch on the runtime flag `_scrml_chunk_loading`.
**That flag is a DEPTH COUNTER, not a boolean** — the name is retained because the emitted dispatch
tests it for truthiness, which reads a non-negative count correctly. **And since #526 the deferred
branch registers with `{ once: true }`** (all three DCL boot registrations do — event-wiring,
variant-guard dispatcher init-fire, link-boost): DCL fires once per real document, so `once` changes
nothing in production; it auto-removes the listener so a longer-lived document (soft-nav'd page, a
shared test document) can never re-fire a stale boot against a later chunk's nodes — the S345
cross-file gate red. It must COUNT because two
OVERLAPPING navigations (an impatient double-click) each inject a script: with a shared boolean, the
first chunk's settle cleared the flag out from under the second, which then registered `_scrml_boot`
on a `DOMContentLoaded` that had already fired — so it never booted, never registered its
rehydrator, and the newer nav still swapped, producing correct SSR markup that was completely inert,
with no diagnostic and no hard-nav fallback.

## The route region is a THIRD lifecycle owner (§6.7.2.1 / §20.8.8, ratified S313 — Pole C)

**Read this before touching soft navigation, `<outlet>`, or anything that "runs when a route loads".**

**The false sentence that was struck.** §6.7.2 used to say the `<program>` scope "destroys once (on
page unload **or navigation**)". That was false under soft navigation and contradicted §20.8.1's
"boots once and stays live across soft navigations". All three deliberation poles agreed it had to
go. §6.7.2 now says plainly: **a soft navigation SHALL NOT mount or destroy any scope.**

**Scopes are of exactly TWO kinds, and the outlet region is NEITHER.** A lifecycle **scope** is the
`<program>` root or an `if=`-conditional element. **Scopes have no identity beyond their position in
the element tree**, and the memoryless-remount requirement — re-run all bare expressions, re-start
all `<timer>`/`<poll>` exactly as if mounting for the first time — **binds scopes only.** The region
governed by an `<outlet>` is a **route region**, whose **identity is the committed `(route, params)`
pair**. *Identity is the discriminating axis*: it is what makes `keep-alive` (§20.8.4) expressible
without carving an exception into a normative SHALL.

**Lifecycle edges SHALL be produced by exactly three events and no others:** document load/unload
(the `<program>` scope), an `if=` transition (a conditional scope), and a **committed** soft
navigation (a route region). A route region nests as the OUTERMOST lifecycle owner inside the
`<outlet>`; `if=` scopes in route content are its children and destroy depth-first at route-leave.

**The §20.8.8 edge contract, in the order it must hold:**
1. **Commit gate.** A navigation that fails, aborts, or is superseded before commit emits **NO
   lifecycle edge whatsoever**, and the live region stays fully live through the in-flight window.
2. **`route-leave`** fires after step 1 (Fetch) commits and **before** step 2 (Swap) — while the
   outgoing DOM is still ATTACHED. Order: dispose region display effects/subscriptions → stop
   `<timer>`/`<poll>` → abort in-flight `<request>`s → destroy `if=` scopes depth-first under §6.7.2's
   four steps → run author `cleanup()` **LIFO** → cancel pending `animationFrame()`. Steps 4 and 5
   SHALL observe live, attached DOM.
3. **`route-enter`** fires after step 4 (Hydrate/Adopt) — after SSR re-seed AND after `each`
   re-materialisation — and **before** step 5 (Transition), so enter-time paint is captured inside
   the View Transition instead of flashing after it.
4. Notification is **pre-order**; disposal is **post-order**.
5. **Ownership:** cells declared in route content are region-owned and re-seed from the incoming
   payload; cells declared in the shell are program-owned and survive the swap with author mutations
   intact.
6. **Initial load IS a `route-enter`.** Region bodies run exactly once on first paint — never zero,
   never twice.

**Spec-ahead, and it says so.** §20.8.8 is marked Nominal: the compiler wiring lands with the impl
(`docs/changes/route-region-teardown/`, `g-route-timer-poll-not-stopped-on-soft-nav`, HIGH/open) and
conformance CN-1..CN-10 land with it. **Two codes are NAMED but carry no §34 row at all** —
`W-ROUTE-REQUEST-DUPLICATES-SERVER-LOAD` (§20.8.7) and `E-ERROR-011` (§19.4.4.1) — because §34.0
outcome 2 plus the named-codes-land-with-impl rule puts the row in the same landing as the emitter.
**Do not grep §34 for them and conclude they do not exist; grep the prose section.**

**The ruling knowingly ships a footgun and therefore OWES a v1 diagnostic.** Pole C's failure mode is
redundant work (a double fetch, a duplicated analytics event, a re-POST on back/forward) — loud on
the bill, silent in the UI. The rejected alternative pays **staleness**, which is silent-wrong-UI and
is the failure that actually occurred in the field. Choosing a knowingly-undiagnosable-by-default
failure mode is what makes `W-ROUTE-REQUEST-DUPLICATES-SERVER-LOAD` an obligation rather than a
nice-to-have.

**WHAT THE IMPLEMENTATION ACTUALLY DOES TODAY — verify against this, not against the contract.**
- `_scrml_destroy_scope` (`runtime-template.js:1390`; ⛑ **S384 — `:1339` was ALREADY WRONG (a doc-comment `*`); re-derived by grep, and this file's sub-:5599 region did NOT move this window, so the drift predates it**) performs the §6.7.2 four steps and is reachable
  **ONLY** through `_scrml_unmount_scope` (:1469) — the `if=` path. The navigation path never calls
  it.
- `_scrml_nav_apply_html` (:2996) calls `_scrml_teardown_region(liveOutlet)` (:3026), which drains
  **only** `_scrml_region_cleanups` (:3122). Its doc-comment (:3114) claims it tears down "timers";
  that is true only for a `<timer>` **lexically inside the shell's `<outlet>` element**, and false for
  every route-chunk timer.
- **Why: the association is made at EMIT time and it is LEXICAL.**
  `codegen/emit-reactive-wiring.ts` `classifyMarkupNodes` (:1081) stamps `node._outletResident` when
  a `<timer>`/`<poll>` (:1105) or `<keyboard>`/`<mouse>`/`<gamepad>` (:1114) sits inside an
  `<outlet>` **in the same file**. Route content is in a different file from the shell, so the flag
  is never set and the stop lands on the boot-once `_scrml_register_cleanup` (beforeunload) path.
- **A route timer therefore starts exactly ONCE, at chunk module-init, and is never stopped OR
  restarted by navigation.** Beyond the leak, that also fails §20.8.8 step 3 (route-enter re-runs
  region-associated bodies), which is why the leave-edge and enter-edge halves are one arc.
- **A runtime-only fix cannot work.** `_scrml_timer_start(scopeId, timerId, ms, bodyFn)` takes no
  element and `<timer>` emits no DOM node, so `_scrml_teardown_region` — which holds only the outlet
  element — cannot discover which scope ids belong to the outgoing route. DOM query is impossible;
  `_scrml_region_track`'s `el.closest("[data-scrml-outlet]")` pattern does not transfer; and a
  boot-time snapshot ("scopes present after shell wiring are shell scopes") is REJECTED as fragile —
  an `if=` inside the shell can register a timer later and would be misclassified, i.e. a shell timer
  silently killed by a navigation, which is worse than the leak.
- **An active-region flag wrapped around the rehydrator loop captures NOTHING** — the timer already
  ran, at module-init, before any rehydrator. See structure.map.md's execution-boundary section and
  dependencies.map.md's module-init table for the exact producer chain.

## `<page keep-alive>` — the FIFTH per-route attribute (§4.15/§40.8/§20.8.4, ruled S314, #378)

`<page>`'s per-route attribute set widened from four to five: `db=`, `auth=`, `csrf=`, `ratelimit=`,
**`keep-alive`** (a bareword, no value). Before S314 it fired `E-PAGE-INVALID-ATTR`; the SPEC's own
four-set enumeration (§0.3, `dd:page-helper-element-design-2026-05-12`) was a CLASSIFICATION of the
`<program>`/`<page>` attribute surface as it stood at authoring time, not a designed bound — the DD's
governing rule is an app-wide-vs-per-route PARTITION, and `keep-alive` is per-route by construction
(§20.8.4: a route opts in; §20.8.8 keys the region by `(route, params)`). Admitting it is a
CONFORMANCE FIX ("newly-accepting toward the contract"), not a widening decision.

**Read this before assuming `keep-alive` caches anything.** Only the AUTHORING surface is admitted at
this HEAD — the attribute is recognized (`attribute-registry.js`) and validated
(`ast-builder.js` `validatePageAttrs`) — but **there is still NO runtime cache and NO §52/§38
invalidation wiring**. §20.8.4's design (once built) is SQL-server-load-scoped: keyed by only the
params that reach SQL, each sub-payload's table read-set derived via `extractSelectProjection()`,
invalidated by one Postgres `AFTER INSERT/UPDATE/DELETE` trigger per read table.

**`W-ROUTE-REQUEST-DUPLICATES-SERVER-LOAD`'s guidance was corrected in the same window it was named.**
The message steers to (a) reading the server-load payload directly, and — where that work is
genuinely per-visit but expensive — **(a) followed by (b) `<page keep-alive>`. (b) is a follow-on to
(a), never an alternative.** §20.8.4's cache does NOT cover a `<request>` (an HTTP fetch, §6.7.7/§60,
with no table read-set and no trigger), so an adopter who applies (b) alone still has the `<request>`
firing on every route-enter per §6.7.2.1 — now over a cached server load — and the two halves can
disagree. Both codes remain NAMED / spec-ahead — no emitter yet; the §34 row lands with the impl.

## `<timer>` / `<poll>` / `<timeout>` — SPEC-AHEAD SINCE S314, SHIPPED AT #510 (§6.7.5/§6.7.6/§6.7.8)

**READ THE SPLIT FIRST, because the prior generation of this section did not have one and therefore
read as done.** §6.7.5/§6.7.6's first-tick asymmetry was RATIFIED at S314 and this map has described
it in the present tense ever since. **The implementation landed at #510, in this window.** Everything
below is now shipped; nothing below is aspirational.

**The normative behaviour.** A `<timer>`'s first execution is **one interval AFTER arming** — it does
not fire immediately. A `<poll>`'s first execution **fires IMMEDIATELY on arming** — the deliberate
divergence, because a `<poll>` exists to keep a value fresh (the §6.7.6 worked example,
`<poll interval=10000>` fetching `@serverTime`, would otherwise render nothing for a full 10s) while
a `<timer>` makes no such promise.

**How it is implemented, and the locus is SPLIT — both halves matter.**
`_scrml_timer_start(scopeId, timerId, intervalMs, bodyFn, immediate)` gained a **fifth parameter**
(`runtime-template.js`); when truthy it calls `tick()` once directly after `setInterval` arms.
**The GATE is at the emit site and the FIRE is at the arm site:** `emit-reactive-wiring.ts`'s
`emitLifecycleNode` appends `, true` for an always-running `<poll>`, `, _scrml_reactive_get("<var>")`
for a reactive `running=@cell`, and **NOTHING at all** for a `<timer>` or a static `running=false`
poll. So a paused poll cannot smuggle in a tick, and a `<timer>`'s emission is byte-identical to
pre-fix.

**The two sub-rules, now enforced rather than described.** (a) The immediate tick runs through the
**SAME `tick()` path** as every later tick, so it inherits async queuing, error handling and
`<#id>.tickCount` accounting — it is not a special-cased pre-run. (b) It fires **once per ARMING, not
once per resume**: it lives in `_scrml_timer_start` and `_scrml_timer_resume` is untouched, so a
`running` false→true transition resumes the interval without re-firing. **The alternative would turn
a boolean write into a fetch trigger — a side effect at a distance.**

### The defect that was MASKING the missing feature, and why removing it needed the amendment

`collect.ts`'s `collectTopLevelLogicStatements` descended a `<timer>`/`<poll>`/`<timeout>` node's
children, which **collected the tick body a SECOND time as a top-level statement** — so the body ran
once at module init, before the timer ever fired. For a `<poll>` that accident LOOKED like the
immediate first tick §6.7.6 mandates; **for a `<timer>` it was a straight defect**, an unwanted run
at load. Removing the descent without shipping the real immediate tick would have been a visible
regression for every `<poll>` in the field. **The S313 "a bug fix is not automatically inert" shape,
restated: the fix and the feature had to land together, and at #510 they did.**

### `DEFERRED_LIFECYCLE_BODY_TAGS` — and the EXCLUSIONS are the load-bearing part

The fix is a deny-set in `collect.ts`: `{ timer, poll, timeout }`. `collectTopLevelLogicStatements`
does not descend a node whose `tag` is a member.

**The predicate is "this tag's `${}` body is a DEFERRED payload with its own Step-5 emitter", NOT "this
tag is a lifecycle tag".** Two lifecycle-adjacent tags are deliberately EXCLUDED from the set, and
adding either would DELETE a required emission:

| Tag | In the deny-set? | Why |
|---|---|---|
| `<timer>` · `<poll>` | **yes** | body is the interval tick callback, emitted by `emit-reactive-wiring.ts` (§6.7.5/§6.7.6) |
| `<timeout>` | **yes** | body is the `setTimeout` callback, emitted by `emit-reactive-wiring.ts` (§6.7.8) |
| `<request>` | **NO — deliberately** | its descent **IS** the designed canonical-form fetch, emitted once. Excluding it here would remove the fetch. |
| `<channel>` | **NO — deliberately** | its top-level `${}` is single-run INIT logic that the channel emitter does **not** re-emit, so the descent is its ONLY, correct emission. |

**Do not generalise this set by tag category.** The gaps it closes are
`g-timer-poll-body-runs-once-at-module-init` and `g-timeout-body-runs-once-at-module-init`.

### §6.7.8 `<timeout>` also had a FALSE-FIRE, fixed in the same PR

`name-resolver.ts`'s `SCRML_NON_ELEMENT_TAGS_EXTRA` lifecycle-keyword list omitted `"timeout"`, so
`<timeout>` — all-lowercase and not a known HTML element — **false-fired `E-MARKUP-001` in every
position.** One word. ⚠ **The hazard it exposes is structural and still live:** that list is
HAND-MAINTAINED, and the block immediately below it states that the sibling E-MARKUP-001 structural
exclusion is DERIVED, not hand-copied. **Two lists in one file; only one of them self-maintains, and
nothing asserts they agree.** A new lifecycle tag must be added to the hand list consciously.

## §6.7.7 — a `<#request>` ref in an ATTRIBUTE: the class is now closed on the two per-item paths (#484 → #511 → #512)

**The failure being fixed.** A `<#id>` reference must lower to the reactive `_scrml_request_<id>`
object. Mis-routing it to the §36 `_scrml_input_state_registry` yields `undefined.data` — **a runtime
TypeError from a bundle that compiled clean, with no diagnostic.**

**THREE PRs, and the reason it took three is the transferable part: each path reaches codegen as a
DIFFERENT NODE SHAPE, so one mechanism could not cover them.**

| Path | PR | Mechanism | Why not the other mechanism |
|---|---|---|---|
| top-level `value=` / Boolean attr / `class=` / `class:x=` / `if=` / `show=` | #484 | `reparseRequestRefEscapeHatch` + `collectRequestIds` at the top-level attr emitters | — |
| per-item `<each>` body attr | #511 | a module-level `_eachRequestIds` stash (built by `collectRequestIds` in `emitEachBodyRenderForFile`, cleared in the same `finally` as `_eachBindSupportCtx`), threaded into `emitExprField` via `lowerEachExpr` | the node here IS parsed; it only lacked the id set |
| Tier-0 `${for…lift}` attr | #512 | `reparseLiftAttrRequestRef` → `reparseRequestRefEscapeHatch`, applied at the three lift attr-value emit sites BEFORE `emitExprField` | **there is no structured node to thread into.** `ast-builder.shouldSkipExprParse` skips any `<`-leading expr (its HTML-fragment guard), so the attr arrives as an ESCAPE-HATCH node; handing that to `emitExprField` takes the string fallback, which BOTH mis-routes the ref AND mangles an `is some` LHS into `.get("profile").(data !== null && …)` → `E-CODEGEN-INVALID-LOGIC` |

**EVERY ONE OF THE THREE IS GATED TO REGISTERED `<request>` IDS** (`gateToRegisteredRequests = true`),
so a non-request `<#id>` — an input-state ref, or a typo — stays on its pre-fix path and emits
byte-identically. **That gate is why a class spanning three emitters could be closed incrementally
without a corpus-wide diff, and it is the move to copy: make the new path opt-in on a POSITIVE
membership test, never on the absence of one.**

⚠ **THE TWO HALVES OF THIS CLASS FAILED IN OPPOSITE DIRECTIONS, WHICH IS WHY "IS IT CLOSED?" CANNOT
BE ANSWERED BY GREPPING FOR ONE CODE.** The `<each>` half was a **SILENT MISCOMPILE** (clean compile,
TypeError at runtime); the `${for…lift}` half **FAILED LOUD** (`E-CODEGEN-INVALID-LOGIC`, no bundle
written). A mixed-text attr template remains in the loud category — verify against
`docs/known-gaps.md` before scoping.

## §17.7.3 — the `<each>` body scope is `@.` + an optional `as` alias, NOT author locals (`E-EACH-BODY-DECL-UNSUPPORTED`; WIDENED #515/#516)

**The scope rule.** Inside an `<each>` body, the readable surface is the `@.` contextual sigil and, if
declared, the `as` alias. **Author-declared locals are not part of it.**

**What used to happen, and it is the worst failure shape in the language: a silent-broken bundle.**
A `${ let nm = @.name }` in an each body produced a statement with no `exprNode` and no `raw`, so
codegen fell through to `inner = ""` and skipped it. **But a later `${nm}` still lowered to a bare
`String(nm)`** — a dangling reference that throws inside the per-item render factory and takes the
**WHOLE list** with it. Exit 0. No diagnostic. An empty list and a green compile.

**The ruling (bryan, S339) is FAIL-CLOSED: reject the form loudly rather than ship a broken render.**
**`emit-each.ts:1361`** fires and returns (⚑ **CORRECTED S376 from `:1416` — re-grepped; this file is unchanged below line 2028 this window, so the citation was already stale at the prior watermark**). **WIDENED at #515/#516 (S340-peter, bryan #508-review F2+F3):**
the guard scans EVERY body position (`body.find`), not just `body[0]` — a decl in a non-first
statement (`${ @.id  let nm = @.name }`) slipped the old guard and re-produced the same silent
miscompile one statement over — and keys on the full name-binding decl-kind SET
(`EACH_BODY_UNSUPPORTED_DECL_KINDS`: `let-decl`, `const-decl`, `function-decl`, `lin-decl`,
`tilde-decl` — the last covers BOTH `~name` and the `var` keyword, which parse to the same kind).
**The prior generation's carried belief that `~`/`var` "already fails loud via
`E-CODEGEN-INVALID-LOGIC`" held only for the first position** (bryan delta-log [1437],
PA-verified post-#515). Only `type-decl` is excluded — compile-time-only, no runtime local to
dangle.

**The row is careful about what it does NOT decide, and that care is the point.** Rejecting this form
is not a ruling that author locals in an each body are forbidden. **Supporting them — replay the
binding into the per-item factory closure, exactly as the `for`-lift path already does — is a separate
§17.7.3 language-surface ruling.** The diagnostic rejects until such a ruling lands; it does not
foreclose it. **Does NOT fire:** a bare field read (`${@.field}`, or `${x.field}` with `as x`), a
declaration OUTSIDE the `<each>` (the ordinary lift), or any non-declaration `${expr}`.

## §52.8 — the SSR `<each>` prerender FALLBACK is now LOUD (`I-SSR-EACH-CLIENT-RENDERED`, NEW)

**Nothing about what compiles changed. What changed is that a decline stopped being silent.**

A top-level `<each in=@cell>` over an SSR-seeded server-authority cell is a prerender CANDIDATE. If
its per-item template is outside the §52.8 renderable subset, the each falls back to client-only
first paint: **the list ships EMPTY in the server HTML and populates after hydration — no first paint
for crawlers or slow connections, and no DOM adoption.** That fallback is correct and conservative
(it never emits wrong markup) and it has always existed. **`buildOneRenderer` used to signal it by
returning a bare `null`, so the adopter got nothing at all.**

It now returns `{ fallback: <reason> }` and `buildSsrEachRenderers` — given `errors` and `filePath`
by `emit-server.ts:5360` (⛑ **S384: `:5162` was ALREADY WRONG pre-window; re-derived by grep**) — turns that reason into an **Info** lint. The reasons it can name: the
iteration shape is not `in=`; the row template has N root elements (multi-root); the root is not a
markup element; the row produced no server-renderable content; or an `SsrUnsupported` message from
`nodeToParts` (a non-field-read interpolation — call / ternary / method / `@cell` read — a non-literal
attribute value, an `if=`/`show=`/directive/reactive attribute, or a nested
`<each>`/`<match>`/component row).

**Info-level and never fatal, on purpose: it SURFACES pre-existing behaviour.** A lint that fires on
code that already compiled must not be able to break a build. **Does NOT fire** on a client-local
cell (never an SSR candidate), a nested each (emitted inline, no mount), or an each already inside
the subset.

⚠ **Do not confuse it with its prefix-sibling.** `I-SSR-AUTH-SCOPED-CLIENT-HYDRATED` (§52.15) is a
**CONFIDENTIALITY** auto-omission — the compiler declines to seed a cell because seeding it would
leak. This one is a **PERFORMANCE** decline. Same `I-SSR-` prefix, same "falls back to client
hydration" shape, entirely different reason and entirely different remedy. **Widening the renderable
subset is the ruling-gated `g-ssr-each-row-template-subset-blocks-all-prerender` /
`g-ssr-each-multi-root-client-only-fallback` — it is a decision, not a backlog item.**

## §20.5 / §52.15.1 — the DANGLING-REFERENCE class, and why the `session` prologue bind is a Proxy (NEW #435 + #440)

**Name the class, because three separate bugs this window were instances of it:** *a runtime reference
is emitted with its BINDING or DEFINITION gated more narrowly than the reference itself.* The file
compiles clean, there is no diagnostic, and the program throws `ReferenceError` -> **HTTP 500 at request
time**. Every detector in this family is therefore **PERMISSIVE BY DESIGN: a false POSITIVE only emits
unused session infra; a false NEGATIVE re-opens a 500.**

**Instance 1 — `session` inside a `?{}` SQL interpolation (GH #357, #435).** A `?{}` body is carried as
a raw STRING; its `${…}` params are captured verbatim and rewritten only for `@name` sigils. So a
`session` reference inside one is sigil-less AND invisible to the emit-expr member/index lowering, and
it survived into `.server.js` as a bare unbound identifier. Fixed by a TEXT-level detector that forces
the session infra on plus a conditional handler-prologue splice.

**And the binding SHALL be the `_scrml_session_bind` Proxy, never `const session =
_scrml_req._scrml_sess`.** That object is an accessor: getters `userId`/`role`/`isAuth`, methods
`get`/`set`/`destroy`, **and raw own-properties `sid`/`_rec`/`_changes` — where `_rec` holds the full
stored record INCLUDING the §40.2 `csrfToken`.** A raw bind would turn the dynamic-key form `session[k]`
into a raw property read at the wrong level: `session["sid"]` discloses the live session id and
`session["_rec"]` the whole record plus the CSRF token, **at HTTP 200** — the exact defeat of the
synchronizer-token defense the compiler owns. It would also make `session[customKey]` read `undefined`
instead of the record value. The Proxy preserves BOTH accessor shapes so the bare binding AGREES with
the AST lowering, which is **KEPT** (three security gates match the literal `_scrml_req._scrml_sess.`
and retiring it for a bare bind blinds them). Two implementation facts that are load-bearing rather than
stylistic: `Reflect.get(t, k, t)` uses the TARGET as receiver (the getters read `this._rec`; a Proxy
receiver re-enters the trap and yields a TypeError), and `set()` returns false so an assignment through
the binding is a loud strict-mode TypeError rather than a silent shadow write.

**RESIDUAL, HIGH, open, ROUTED-TO-BRYAN:** `g-session-get-reserved-key-read-disclosure` — a
request-controlled `session[k]` still reads compiler-owned internals through `.get()`. The §20.5
reserved-key guard covers the WRITE side (`session.set("csrfToken", …)`); the READ side is an unruled
language-surface question.

**Instance 2 — `@currentUser` read by a plain or SSE handler (#440).** §52.15.1 says the ambient is
"resolved server-side from the session middleware", so a read REQUIRES the resolver to be present. The
`_needsSessionInfra` detector matched only the `?{ … @currentUser … }` SQL shape, so a DIRECT expression
read (`return { id: @currentUser.id }`, which the parser lowers to `IdentExpr{name:"@currentUser"}`) in
an app with no `auth=`, no serverLoad and no `?{}` left `_scrml_current_user` unemitted while the
handler-scope splice still bound it. `astReadsCurrentUserAmbient` is the superset that catches both. The
§36 SSE `function*` path additionally never spliced the binding at all — now spliced at handler scope,
before the nested generator closure, using the byte-identical existing construction.

**Instance 3 — a `<channel auth=>` with no `<program auth>` (#440).** The WS-upgrade guard references
`_scrml_auth_check(req)`, which calls `_scrml_session_middleware(req)`, but both definitions were gated
on `authMiddlewareEntry` — so a channel-auth-only program dangled the reference and 500'd at upgrade.
`_hasChannelAuth` now forces `_needsSessionInfra`, and an `else if` arm emits **only** the auth-check
function — never the CSRF helpers, session-destroy, or the `@session`-projection routes, which stay
`<program auth>`-specific. A channel-auth-only program's route surface is unchanged.

**The store invariant was PROBED, not assumed:** widening `_needsSessionInfra` does NOT over-emit — a
read-only `@currentUser` program gets the in-memory Map + middleware + resolver and **not** the durable
on-disk store (§20.5 i29e; only an app that actually `session.set`/`.destroy`s gets the durable store).

**Standing lesson (delta-log [1186]): a gap entry's stated fix-locus is a HYPOTHESIS.** Both #440 gap
entries were outdated on the locus — one named a binding site a prior fix had already covered, the
other understated the dependency — and had to be re-diagnosed against HEAD before scoping.

**CORRECTION THIS WINDOW (#452, a side-landing of the `Response` arc): `session.get(key)` is now an
OWN-PROPERTY read.** `Object.hasOwn(this._rec, key) ? (this._rec[key] ?? null) : null`
(`emit-server.ts:2692`; ⛑ **S384: `:2593` was ALREADY WRONG pre-window — re-derived by grep, not shifted**). Pre-fix it was an ordinary property read, so it resolved up
`Object.prototype` for any key the record does not carry — measured on the emitted helper,
`.get("__proto__")` returned `Object.prototype` and `.get("constructor"/"toString"/"valueOf"/…)` each
returned a FUNCTION, with a function value reaching a `?{}` bind as an **HTTP 500 from a
request-controlled key**. `Object.hasOwn` rather than `this._rec.hasOwnProperty(key)` is load-bearing:
`_rec` is built from `session.set` writes and can carry an own key literally named `hasOwnProperty`.
**Scope: prototype-chain reads ONLY.** An own key still reads, including the compiler-owned §40.2
`csrfToken` — `g-session-get-reserved-key-read-disclosure` (MED, open, routed to bryan) covers the
remaining read-POLICY question, and this same window's `Response` landing took it from log-only to
wire-live. See auth.map.md.

## §13.2 — the client server-fn call-site await, and the ONE async-name provider (NEW #429 + #442)

**Read this before adding any await-injection, any async predicate, or any fourth consumer of "is this
name async".**

**§13.2 is POSITION-INVARIANT: `await` belongs at EVERY server-call site.** Until #429 the client side
enforced that with a statement-level post-pass, which by construction only ever reached STATEMENT
position — so a receiver-tail (`loadRows().length`) or a nested argument (`pick(loadRows())`) silently
handed back a pending Promise. #429 moves the decision to the emitter's own choke point: `emitCall`
gains a fourth await branch (`isClientServerFnCall`), sibling to the server-peer, client-peer and
stdlib-async branches. **Awaiting at the choke point every position already flows through replaces
retrofitting it downstream per position — which is what manufactured one silent gap per position.**

**The safety argument, because it is the part a future editor will be tempted to loosen.** A stranded
`await` in a non-async host is a WHOLE-BUNDLE SyntaxError, not a local defect. The branch fires only
inside a host the compiler has already coloured `async` (`ctx.clientAsyncBody === true`), and that flag
is **not an independent judgement** — it is threaded from the same `_fnIsAsync` that writes the `async`
keyword, which is `computeAsyncFnNames`'s `callsServerFn` seeding off `collectCalleeIdents`. So the
structural walk that SEES the callee is the same one that colours the host: walk sees it -> host async
AND branch may fire; walk misses it -> host sync AND branch cannot fire. **The gate can only ever
SUPPRESS an await (degrading to the pre-existing silent bug), never STRAND one.**

**Two rules this landing established that outlive it:**
1. **Filter a `routeMap` walk on the OWNING FILE.** `runRI` builds ONE `routeMap` across the whole
   resolved import graph and `FunctionRoute` carries no `filePath` field — the file lives ONLY in the
   map KEY (`<filePath>::<start>`). An unfiltered walk imported another file's server-fn names into this
   file's client emission; a purely local SYNC `save` then gained a spurious `await` and a FALSE
   `E-ASYNC-STDLIB-IN-SYNC-CALLBACK`, with renaming the local fn as the only user workaround.
   `declaredNames` cannot cover it — a TOP-LEVEL client fn name is never in that set.
2. **Decide off the EMITTED OUTPUT, not a re-derived predicate.** `emitMatchExpr` now writes a
   placeholder IIFE header and overwrites it at the close with `await (async function() {` iff the
   emitted arm bodies contain an `await` in code position. Same discipline as #391. Fail-safe direction
   is explicit: a false POSITIVE is valid JS; a false NEGATIVE is a broken bundle.

**ONE PROVIDER, THREE CONSUMERS (#442, Limb 1 / dpa-023). Decision sites 3 -> 1.** Three consumers
asked "is this name async in client mode" and one answered differently for a client server fn:
`combinatorIsAsyncName` said yes (four hand-written disjuncts), `isClientServerFnCall` said yes (its own
`serverFnNames` test), and the fail-closed drain's local closure said **NO** — because
`computeAsyncFnNames` treats `serverFnNames` as a **seed TRIGGER** (it colours the CALLER and never
admits the CALLEE to its result set). So `loadRows` was async to the emitter and sync to the drain **in
the same compilation**. The consequence was a MISSING diagnostic rather than a wrong emission: a client
server-fn call stranded in a raw escape-hatch, a template `.raw` body, or a fn-SIGNATURE parameter
default is structurally unreachable to `emit-expr`'s own `syncPeerCalls` sink. The fix is a
SUBTRACTION — the rule now lives once, in `async-combinators.ts`, and the drain is handed the
`serverFnNames` fact it never had.

**`isClientServerFnCall` shares only the provider's server-fn MEMBERSHIP component, and that is
deliberate.** It asks an IDENTITY question ("is this call a client->server RPC?"), not an asyncness
one. `emitCall` dispatches the three async surfaces to three DIFFERENT branches in order; widening this
predicate to the full provider would capture a stdlib-async callee here and route it away from its own
branch and its own fail-closed sink.

**HONEST STATUS — this section describes a shape, not a closed bug class.** #429 landed **explicitly
not claiming its bug class**: 142 bare client server-fn call sites remain in cleanly-compiling corpus
sources, base->head delta ZERO, measured two independent ways. The unreached shapes use different
emitter paths (CPS / failable-fn wrapper, module top-level init, markup-interpolation lift). See
`g-auto-await-family-not-closed-150-bare-server-call-sites-in-clean-sources` (HIGH, open). Its sibling
`g-reset-writes-pending-promise-when-init-thunk-calls-a-server-fn` (HIGH, open) is on the RUNTIME reset
path — `runtime-template.js:1219` re-invokes the init thunk without awaiting (⛑ **S384: `:1168` was ALREADY WRONG — a doc-comment line; re-derived by grep**), so a cell can be correct
at mount and wrong after `reset()`. The absorb-sequencing ruling that governs the fix (option **C**:
await the IIFE AND keep its `.catch`, §13.2 vs §19.6) is **RULED but NOT BUILT**.

## §12.5 — a route handler SHALL return a `Response`, on EVERY path (#452 code, #460 SPEC — S326-N1 CLOSED)

**⚠ NORMATIVE STATUS FIRST — and it CHANGED at #460 (`603ec12f`, S328 window).** The prior stamp of
this map recorded the obligation as *derived, not stated*: the SHALL lived only in an `emit-server.ts`
comment and `ec0142aa`'s commit subject, and §12.5 did not contain it. **`SPEC.md:7353` now does.** The
bullet reads "**A generated route handler SHALL produce a COMPLETE HTTP RESPONSE, not a bare value**",
binding on every path including every combination of `auth=` / `protect=` / tenant-context / `csrf=` /
`<endpoint>` (§61) / SSE (§37). Handing the host a bare value is **NON-CONFORMANT**.

**Three things about that bullet a reader must carry, because each one is easy to over-read:**

1. **It is an obligation on the emitted ARTIFACT's observable behaviour, deliberately NOT on its JS
   shape.** Per the S278 precedent — emitted-JS shape is compiler-spec, an implementation's freedom,
   not language-spec — the bullet mandates no host object. impl#1 targets Bun and satisfies it by
   returning a `Response`; an implementation on a host with a different dispatch convention satisfies
   it that host's way. **What is normative is that the wire carries the serialized value**, which is
   the half a conformance case can pin and the half §12.5.2 already presupposed.
2. **It carries NO diagnostic code.** It is enforced BY CONSTRUCTION, not by a §34 row — so the
   catalog did not move at #460 (806 rows then; **807 at `616688ea`** — `E-DERIVED-SERVER-ONLY-REACH` is the +1) and there is nothing for error.map.md to
   gain. **Do not go looking for an `E-` code to assert against; assert on the wire.**
3. **Its own provenance note records, honestly, that no debate or DD ratified the direction.** The PA
   decided all four structural rows (limit-not-widen · fails-closed · reversible/newly-rejecting ·
   root-not-position) under the FORK RULE at S325 and the operator authorized writing it in at S326.
   **Read it as an implementation contract promoted to normative text, not as a deliberated language
   decision.** The finding it closes is stated in the SPEC itself: *"A normative sentence that lives
   only in one implementation's source is not part of the contract."*

**The defect this closed, and why it survived so long.** The non-baseline-CSRF handler wrapped its body
in a value-capturing IIFE only when `_ext5DedupNonCsrf || _protectActive || _tenantActive`. Without
that wrap, **the adopter's `return` became the HANDLER's `return`** — a bare JS value handed straight
to `Bun.serve`, since both shipped hosts dispatch `return route.handler(req)` (`dev.js`, the built
`_server.js`). MEASURED over a real socket on Bun 1.3.14, **and the two halves diverge, which is the
whole reason it leaked quietly**:

| channel | what actually happened |
|---|---|
| WIRE | `200 text/plain;charset=utf-8` with the CONSTANT body `"Welcome to Bun! To get started, return a Response object."` — for EVERY non-`Response` return: string, number, object, `undefined`, `null` alike. **The adopter's value never reaches the client at all. It is dropped, not transmitted.** |
| STDERR | `error: Expected a Response object, but received '<value>'` — **and ONLY for `undefined` / `null`.** A bare `"ok"` / `42` / `{…}` logged NOTHING. |

So: the auth gate passed, the CSRF gate passed, the body ran, the value was correct — and the client
got a fixed English sentence while the server was, for the common shapes, completely silent about it.
The emitted client stub has always done `await _scrml_resp.json()` (emit-functions.ts), which throws on
that `text/plain` body, so the wire contract the client expects is the one now emitted.

**Why it hid: the exit was SPLIT THREE WAYS and only one third was tested.** The Ext-5 arm returned a
real `Response`; the protect/tenant arm returned a redacted RAW value; every other shape — including
the plain authed route — returned nothing here at all. **The ONE arm a test exercised asserted a
`Response`, and the two that were not asserted a value.** There is now ONE exit. This is the same
shape as the S276 lesson recorded against this landing: **20 tolerate-or-assert-bare test sites across
6 files were CORRECTED, not preserved — the oracle shared the implementation's blind spot.**

**TWO ORDERING RULES at that exit. Both are argued in-source and both are fail-direction asymmetric.**

1. **`if (_scrml_result instanceof Response) return _scrml_result;` sits BEFORE the redact.** A body
   that already produced a `Response` OWNS the response. Without the guard the envelope does
   `new Response(JSON.stringify(<a Response>), { status: 200 })`, and `JSON.stringify` of a `Response`
   is `"{}"` (no enumerable own properties) — so an adopter's deliberate `403`/`404`/redirect is
   re-emitted as a **200 with an empty-object body**. MEASURED with the guard removed: the 403 came
   back 200. **A DENY silently becoming a SUCCESS is the fail-OPEN shape this whole change exists to
   remove**, which is why it is guarded. §14.8.9/§14.8.10 already model a manual-`Response`
   / `handle()` body as a live server-fn egress kind, so the shape is anticipated, not hypothetical.
   **CORRECTION (S355, `a7e99e8f` / #590) — this guard flipped from belt-and-braces to LOAD-BEARING.**
   The sentence above used to end "...even though no corpus source reaches it today (a plain body
   naming `Response` build-blocks on `E-SCOPE-001`)" — that framing is now FALSE. `Response`/`Request`/
   `Headers` were added to `LOGIC_SCOPE_GLOBAL_ALLOWLIST` (`type-system.ts:7290`, adopter #471 PDF/binary
   egress), so a plain body naming `Response` no longer build-blocks on `E-SCOPE-001` — the shape is now
   adopter-reachable and this passthrough guard is exercised in production. The same commit flipped
   `authed-server-fn-response-http.test.js`'s pin from asserting the E-SCOPE-001 block to asserting the
   passthrough. `File`/`FormData`/`Blob` remain deliberately UNALLOWLISTED (open dpa-030 deliberation).
   Placement before the redact is also correct on its own terms: a `Response` is an opaque stream
   handle, not a row set — `_scrml_protect_redact` cannot inspect or strip it.
2. **`_egressRedact` runs BEFORE `JSON.stringify`.** §14.8.9/§14.8.10 are FLOORS; serializing first and
   redacting after would be a confidentiality regression. `_egressRedact` is the identity when neither
   floor is active, so a plain app is byte-unaffected.

**Load-bearing side effect nobody had connected to this defect.** `_scrml_session_cookie_wrap` appends
its `Set-Cookie: <sid>` onto the handler's return value and **skips when that value has no `.headers`**.
A bare return therefore also dropped the §20.5 session-establishment cookie silently — the store record
was written and the browser never got the sid.

**RESIDUAL, carried deliberately:** a hand-built `Response` bypasses the RUNTIME redaction floor by
design (the passthrough sits before the redact), relying on §14.8.9's compile-time
`detectProtectedRawEgress` instead.

**DOWNSTREAM — do not miss it.** This landing takes `g-session-get-reserved-key-read-disclosure` from
log-only to **WIRE-LIVE**. Fixing a fail-open defect made a separate open leak reachable. See
auth.map.md.

## Fencing a whole-buffer text pass: change its INPUT, not its PATTERN — TWO region classes (NEW #458)

**This is a compiler-architecture rule, not a language rule, and it is in this map because it
generalises past the mangler that occasioned it.** `emit-client.ts`'s `post-fn-name-mangle` is a
whole-buffer regex pass that rewrites user fn names to their generated forms. Every prior defect in it
(**Bug D · Bug I · Bug Z · g-spread · PGO P3.A**) was answered by editing the PATTERN — another
lookaround, another character class. #458 is the first structural answer, and it fixed three defects
at once.

**THE RULE: when a text pass acts in the wrong PLACE, change what it is given, not what it matches.**
A pattern patch has to be right about every context it will ever meet. A region fence only has to be
right about a boundary.

**Region class 1 — LEXICAL (pre-existing).** `code-segments.ts`'s `rewriteCodeSegments(expr, transform)`
splits a buffer into code vs opaque (string / regex literal / line- and block-comment) and applies
`transform` only to code. A template literal is a hybrid: its static spans are opaque, its `${…}`
interpolations are CODE and ARE descended into.

**Region class 2 — STRUCTURAL (NEW).** `findObjectShorthandRegions(code)` returns
`ObjectShorthandRegion[] {start, end, kind, names}`, each classified by `classifyBraceGroup` into
`BraceGroupKind = "object-literal" | "binding-pattern" | "unknown"`. **The two classes COMPOSE rather
than merge** — the structural finder runs INSIDE each lexical code segment, so a `{get, post}` that
occurs inside a string literal is never seen at all.

**The runtime slot is fenced by ORDERING, which is the purest form of the rule.**
`joinAroundRuntimeSlot(lines, runtimeSlotIndex, runtimeSource, rewrite)` applies `rewrite` to the client
body BEFORE and AFTER the slot and never to `runtimeSource` — **the runtime is not part of the rewrite
input at all**, so no lookaround has to recognise it and no pattern can reach into it. The bug: a user
`fn log()` rewrote the runtime's own `_scrml_replay(name, log, endIdx)` PARAMETER (followed by `,`,
inside the lookahead set) while the body's `log.length` reads (followed by `.`, outside it) stayed put
— **a runtime function silently rewired to a free variable.** Inert in the DEFAULT pipeline, which
slices the runtime back off; under `--embed-runtime` the corrupted text SHIPS. Byte-safety is provable
rather than asserted: with `rewrite` as the identity, the helper is exactly `lines.join("\n")` with the
runtime in its slot, which is what the pre-fence code produced.

**A FENCE ALONE WOULD HAVE BEEN A HALF-FIX, and the reasoning is the transferable part.** For the
object-shorthand defect (`{get, post}` — each identifier is simultaneously a property NAME and a value
reference, and the alternation renamed both halves at once, so `inner.get(...)` became `undefined` with
no syntax error and no diagnostic), simply fencing the region would trade a silent wrong answer for a
`ReferenceError` on a now-free `get`. So an object literal is **EXPANDED** instead — `get` becomes
`get: _scrml_get_2` — which keeps the object's public shape AND resolves to the real function.
**Net sites this pass stops rewriting: ZERO.**

**THE LIMITS ARE THE DESIGN. Each is a documented refusal, not a gap.**
- **Only `object-literal` is acted on.** `binding-pattern` is RECOGNISED and deliberately NOT acted on.
  An earlier revision emitted those verbatim; the S239 adversarial review showed that to be a
  HALF-REPAIR — fencing the pattern while the pass still rewrites the uses those bindings SHADOW leaves
  the bindings dead and the calls resolving to the module-level function, **turning a LOUD `TypeError`
  into a SILENT wrong answer**, the exact failure class the object-literal half exists to remove.
  Repairing a binding pattern honestly needs a scope model, which belongs to the mangler-RETIREMENT arc.
- **`unknown` obliges the caller to change NOTHING.** Narrowing on a guess is how a coverage hole opens.
- **`classifyBraceGroup`'s left-context set excludes `:` and `>` on purpose** — `label: {…}` and
  `case x: {…}` are BLOCKS, and the `>` of `=> {` opens a function BODY. `(` is genuinely ambiguous
  (`f({a,b})` is a call argument, `function f({a,b})` is a formal parameter) so only the
  `function`-headed form is decided; everything else reads as a call.
- **A region containing `__proto__` is skipped WHOLE.** ECMA-262 B.3.1: only the
  `PropertyName : AssignmentExpression` form with the name `__proto__` sets `[[Prototype]]`; the
  SHORTHAND form creates an ordinary own property. Expanding it is therefore NOT semantics-preserving
  (measured: own keys 2 -> 1, `typeof o.call` "undefined" -> "function"). The whole region is skipped
  rather than the one name because a BARE `__proto__` left beside expanded siblings is stranded as a
  free reference, and that is **ENGINE-DEPENDENT** — measured: node silently binds the global object's
  prototype, bun throws a `TypeError`.

**Third leg, same PR — a DATA-VALIDITY guard, not a behaviour change.** All four `fnNameMap.set` sites
now route through `registerFnName` (`emit-functions.ts:675`), which refuses any key failing
`/^[A-Za-z_$][A-Za-z0-9_$]*$/`. An EMPTY key made the consumer's alternation `\b(…|)\b`, which matches
**zero-width at every word boundary satisfying the lookahead** — 781 injections into one file. **The
test is IDENTIFIER SHAPE, not non-emptiness, so it closes the CLASS rather than the witnessed
instance**: `" "` is the same hazard. It deliberately raises no diagnostic — every §34 fire site for
the one code that fits (`E-CODEGEN-INVALID-LOGIC`) is `validate-emit.ts`, whose contract is "the emitted
artifact does not parse, here is the byte offset", so a declaration-site fire needs a NEW §34 row, and
that half was surfaced to the PA rather than smuggled in. The drop is testable (invariant 27) —
`mangler-region-fencing.test.js` §3 asserts it.

**Still open, and pinned by the suite at §2f rather than only in prose:** nested `{api: {get, post}}`,
spread, mixed `{get, post, n: 1}`, and the ternary **ALTERNATE** — *the same expression compiles
correctly on the consequent branch and incorrectly on the alternate*. `g-mangler-scope-blind-shorthand-key-rename`
stays `status=open` deliberately.

## A cross-module ASYNC import consumed in a markup interpolation is now awaited (#391)

`g-crossmodule-async-in-markup-position-not-awaited`: a cross-file import classified `async`
(colorless-async, §13.1/§13.2) and read directly inside a markup `${…}` interpolation previously
shipped as a bare unawaited Promise in that position — the interpolation rendered `[object Promise]`
or similar, silently. Fixed in `emit-client.ts`/`emit-reactive-wiring.ts`. **The wrap decision is made
off the injector's OWN EMITTED OUTPUT, not a re-derived predicate** — an S239 catch during the same PR
surfaced a page-breaking SyntaxError from an earlier version of the fix (an async fn used as a bare
combinator callback), which is why the landed shape decides off actual emitted text rather than
re-inferring async-ness a second time at a different stage. See dependencies.map.md's
Colorless-async section for the producer/consumer chain.


## `W-IF-IN-EACH` — a nested per-row `if=` inside `<each>` is create-time-only, not reactive (§17.1, NEW #416, GH adopter #409)

**The gap.** §17.1's per-row `if=` reactivity applies to exactly ONE position: the each body's SOLE
structural item root, lowered via `_scrml_ifrow_apply` (the element⇄comment structural swap). A per-row
`if=` on a NESTED (non-item-root) element inside the row is compiled to a plain CREATE-TIME append
gate — evaluated once when the row is first built, never re-evaluated on a SAME-KEY reconcile. When the
row's own item data later changes under that same key, the gated element is never re-added or removed
and silently goes stale — while sibling `class`/`${…}` text bindings on the identical row DO update,
which is what makes the frozen `if=` a footgun with no other build-time signal.

**The fix ships a build WARNING, not the reactive fix.** `emit-each.ts`'s deferred nested-per-row-`if=`
branch (inside `renderTemplateChildToJs`) now pushes `W-IF-IN-EACH` when the condition REFERENCES the
iteration item — an outer-state-only condition re-evaluates through the each render fn's own collection
effect and is not this footgun, so it is deliberately not warned. Two new helpers do the detection:
`_eachIfCondReferencesItem(rawCond, itemNames)` strips quoted string-literal interiors FIRST (so an
item-name-shaped word or an `@.`-substring inside a string literal cannot false-fire — the same
string/comment-fencing lesson `g-bare-variant-mask-leaks-into-string-literals` already forced onto
`preprocessForAcorn`) then matches `@.` or any item-binding name as a standalone identifier;
`_eachItemBindingNames(iterVarName)` widens the match set to a `as (k, v)` destructure pair via the live
each-reconcile context, not just the bare `as X` iter var. **The reactive fix is DEFERRED and ROUTED TO
BRYAN** (§17.1 nested per-row-`if=` reactive-surface extension — it needs a per-child anchor + a
reconcile-core interaction the original per-row-`if=` arc deliberately avoided). The warning surfaced
**37 real instances** in the trucking example's card components (nested item-`if=`, inlined into
`<each>`) — read as validation that the shape is common, not as a regression the warning introduced.

**Resolution advice the diagnostic itself gives:** drive per-row visibility with a reactive `class`
toggle instead (`class=(cond ? "" : "hide")` with a `.hide { display: none }` rule), or lift the `if=`
to the row's sole item root where it IS reactive today.

## RESTRICTED CONTENT MODELS — FOUR answers, and they do NOT agree (§4.14 / §17.7.6, #466, S328)

**⚠ READ THIS BEFORE TOUCHING ANY RCDATA / restricted-parent emission.** The question "may this
element body receive an element child?" is answered in **four independent places in this compiler**,
and they disagree. #466 shared ONE local between two of them. It did **not** unify the four, and
`emit-each.ts`'s own block comment says so in as many words: *"Do not read the shared local as 'the
compiler now has one content-model decision' — it does not, and an overstated invariant here would
mislead the next reader more than no comment would."*

| # | site | what it decides | what it leaves open |
|---|---|---|---|
| 1 | **`emit-each.ts:1169` — `const _isRcdataBody = isRcdataElement(tagName)`** | the `<each>` per-item body, BOTH branches: the `:`-shorthand mount refusal (`shMarkupCapable && !_isRcdataBody`, :1244) + the `.value` write (:1250), and the bare-body `_rcdataValueExpr` gate (:1183) | everything below |
| 2 | **`emit-each.ts:888` — `eachRcdataValueExpr` returns `null`** on a child shape it cannot concatenate | nothing — the `null` **falls through to the flow recursion, which MOUNTS.** So `<textarea>${it.name}<b>x</b></textarea>` STILL gets an element child | a surviving SECOND gate, pre-existing, **deliberately not closed by #466** |
| 3 | **`emit-html.ts:1835` — `isRcdataElement(tag)`** on the top-level (non-`<each>`) path | `analyzeRcdataContent(children)` + the `data-scrml-rcdata` placeholder instead of a `<span data-scrml-logic>`; **and it is the ONLY site that fires `W-RCDATA-BIND-VALUE-CONTENT-CONFLICT`** | **the `<each>` path is SILENT for the same conflict** — `<textarea bind:value= : expr>` emits two `.value`-surface writers with no warning |
| 4 | **the Tier-0 `lift` path** | answers separately again — `emit-lift.js` contains **ZERO** `rcdata` references (grep-verified across `compiler/src/codegen/`; the only hits are `binding-registry.ts`, `emit-event-wiring.ts`, `emit-html.ts`, `emit-each.ts`) | it never asks the question at all |

**Why the scope is RCDATA and NOTHING ELSE — this was measured, then narrowed, and the narrowing is
the load-bearing part.** The first attempt (`2c89086c`) introduced `eachBodyLowering(tagName)` with a
three-way `EachBodyLowering` type covering `<option>`/`<title>` as well. **It was rejected
`DO-NOT-LAND` by the S239 adversarial gate and deleted.** The measurement that killed it:

- **`<textarea>` LOSES DATA.** HTML defines its value as its child TEXT content, so with an element
  child `textarea.value` is `""` and the adopter's string is gone. Measured in real Chromium.
- **`<option>` does NOT.** A `<span>` child is invalid HTML but the DOM accepts it and the label still
  reads through — base emission renders `"alpha"` in real Chromium. Lowering it to
  `.textContent = String(expr)` fixed the SHAPE and **broke the LABEL** to `"[object HTMLElement]"`,
  with zero diagnostic. **That trades a silent-wrong shape for a silent-wrong label, which is worse —
  the label is what the user reads.** `<option>` and `<title>` are therefore left on the mounting path.
- `<style>`/`<script>` never reach this emission path at all (measured: zero `createElement`), so no
  lowering is defined for them.

**The MAY-vs-MUST analysis gap that caused the defect.** `shMarkupCapable` derives from
`fnBodyReturnsMarkup`, which admits a function into `_eachMarkupFnNames` if **ANY** of its returns is
markup. A mixed-return `fn label(n) { if n == "" { return <i>none</i> } return n }` is therefore
"markup-capable" even on the calls that hand back a plain string. #456's own rationale block asserted
that a string-returning shorthand "never over-wraps → no restricted-parent regression"; **that premise
is FALSE and is the whole defect** — `interpMayYieldNode` cannot distinguish the two when the callee
returns both. #466 left that block in place VERBATIM rather than silently rewriting it, because it
carries other review findings still awaiting an operator ruling. Widening the analysis to a MUST is a
separate, larger design question.

**Residuals stated plainly (all deliberate, none regressions):**
- A markup-ONLY-returning call in a `<textarea>` still stringifies to `"[object HTMLElement]"` via
  `.value`. That is the pre-existing bare-body behaviour — base and head are byte-identical there —
  so #466 extends nothing. The right answer is a NEW §34 diagnostic ("a markup-returning call has no
  valid rendering in an RCDATA content model"), which needs its own row and its own ruling.
- `<textarea>` shorthand moving `.textContent` → `.value` leaves `defaultValue === ""`, so
  `form.reset()` and a bfcache restore blank the field. The bare-body form has always had this; #466
  extends it to shorthand **as the price of §4.14 parity**.
- **`<title>` ORDERING TRAP — check this site if you touch `html-elements.js`.** Lines ~272-279 carry
  a standing invitation to register `<title>` with `rcdata: true`. If anyone accepts it,
  `isRcdataElement("title")` flips true and `<title>` silently starts lowering to `.value` — an
  expando on `HTMLTitleElement`, so **the title would never update.**

**The governing normative text** is SPEC §4.14 line 1021 — *"a `:`-shorthand body IS the element's
single-expression body, byte-identical to the bare-body form `<tag>${expr}</tag>`"* — carried verbatim
into `<each>` body scope by §17.7.6 (lines 12176-12177: *"No `<each>`-specific extension to the §4.14
grammar is introduced"*). **Byte-identity is the invariant; the shared local exists to keep the two
branches from drifting out of it.** Pinned by three conformance cases under `conformance/cases/each/`:
`shorthand-restricted-textarea` (the merge-blocker), `shorthand-longhand-parity-rcdata` (the same body
written FOUR ways — shorthand/bare × mixed-return-call/member-expr — all asserting `textarea *` count
0), and `shorthand-option-label-preserved` (**the counter-gate**: it exists specifically to fail if
anyone re-widens the refusal past RCDATA). Plus `browser/g-each-shorthand-rcdata-parent.browser.test.js`.

## §4.18.1 / §40.8 / §34 — a STATE-BLOCK body is MARKUP context, and logic there is now REFUSED (NEW section, S376, #718)

**The rule, in one sentence: `on mount { … }` is LOGIC in a `<program>` / `<page>` / `<channel>` body
and TEXT in a `<db>` / `<state>` / `<schema>` body, and until #718 nothing said so.**

**Where the asymmetry comes from.** §4.18.1 defines two body modes — free-text (plain markup) and
code-default (engine state-child, `match` block-arm, `:`-shorthand). `<program>` / `<page>` /
`<channel>` bodies are NEITHER: they are `default-logic`, "a distinct THIRD body-mode owned by §40.8"
(the S111 R3 reconciliation, 2026-05-20 — grep `SPEC.md` for "S111 amendment"). **A state block is
none of the three.** Its body is ordinary markup context, so §40.8's auto-lift — the mechanism that
turns a body-top `on mount { … }` into logic — does not reach it. §34 already said this twice, in the
`E-WRITE-NOT-IN-LOGIC-CONTEXT` row (*"`<db>` / `<state>` STATE-block bodies are NOT
default-logic-mode loci"*) and the `W-STATE-BLOCK-BARE-WRITE-DECL` row (*"A state-block body is
markup context (SPEC §4)"*). **What it did not say is what HAPPENS to the statement.**

**What happened to it: nothing, loudly.** The statement stayed in markup context, shipped into
`<body>` as literal page text, and never ran. Exit 0, zero diagnostics. **This is the
"my app doesn't load" failure mode, not a dropped assignment** — the page displays its own source and
the author's initialization silently never happened.

**As of #718 it is `E-STATE-BLOCK-STATEMENT-FORM`, severity error, CLI exit 1** (§34 row at
`SPEC.md:19729`; emitter `compiler/src/lint-e-state-block-statement-form.js` at `api.js` Stage 2.5c).
PA-VERIFIED at this watermark by compiling the landed reproducer.

**⚑ THE MESSAGE HAD TO BE MADE TRUE AT ALL THREE LOCI, AND ITS FIRST CUT WAS NOT.** It asserted flatly
that the statement "ships into the DOM as literal page text". MEASURED by compiling and counting
occurrences in the emitted HTML: `<db>` body -> **1**, deprecated `< state>` body -> **1**,
`<schema>` body -> **0**. **A `<schema>` body is consumed as DDL, so the statement is DISCARDED rather
than rendered.** The refusal is still correct at that locus — it never runs either way — but the
stated REASON was false there. Corrected in WORDING, not by carving `schema` out of the name set,
because removing the locus would restore the silence the diagnostic exists to end.

**⚠ THE COMPLEMENT AT THIS LOCUS IS STILL LEGAL, ON EVIDENCE.** A bare call (`loadDashboard()`) in a
state-block body remains accepted — the S368 bare-call ruling explicitly rejected "diagnose every
non-declaration run", and there is a MEASURED false-positive class: a TYPESTATE transition
declaration (`validate() => < Validated> { }`) sits inside a `< Draft>` block that the block splitter
classifies `type:"state"`, so a bare-call gate at this locus would reject **4 live conformance cases**
under `conformance/cases/type-state-codes/`. Out of scope by evidence, not by omission.

**⚠ AND `type:"state"` IS NOT A SEMANTIC CLASSIFICATION — this bites any pass that walks BS output.**
It is what the block splitter calls **ANY whitespace-form opener `< Name …>`**. MEASURED over the
2,353 corpus sources at the time of the fix: **123 `type:"state"` nodes, and only 44 are named `db`.**
The other 79 are `engine` (×31), typestate transition declarations (`Draft`, `Validated`,
`Submission`, `Todo`), whitespace-form COMPONENT definitions (`taskItem`, `siteHeader`, `sidebar`,
`statusBadge`, …) and plain HTML (`p`, `div`). A pass that treats `type:"state"` as "a state block"
claims all 123. **Name-guard both arms.** Related: invariant 70's `<each>` two-parse-origin split —
same species, different node.

**⚠ THE DEPRECATED WHITESPACE OPENER IS THE ONE THE CORPUS ACTUALLY USED.** The canonical no-space
`<db>` is BS-classified `type:"markup"` with `name:"db"`; the deprecated `< db>` is classified
`type:"state"`. **The single live corpus member of this defect
(`samples/htmx-debate-dashboard.scrml:143`) used the DEPRECATED form**, so a markup-only gate would
have missed it entirely. Migration measured at exactly one file across 2,194 `.scrml`; the fix wraps
it as `${ on mount { loadDashboard() } }` (verified against the landed diff).

**TWO OPEN HOLES, PA-REPRODUCED BY COMPILING AT THIS WATERMARK:** a `<div>` one level inside a `<db>`
body re-opens the defect at exit 0 with the statement in the HTML
(`g-state-block-statement-form-misses-a-wrapped-statement`, MED); and any unpaired `/`+`*` in prose —
a glob, a path, a spaceless division — opens a comment region and DISARMS the gate for the rest of
the block, also exit 0 with the statement shipped
(`g-state-block-statement-form-disarmed-by-an-unpaired-block-comment-opener`, LOW). **A glob disarms
a fatal gate.** error.map.md · structure.map.md · `docs/known-gaps.md`.

## §17.2 — `show=` INSIDE an `<each>` is a REACTIVE per-item toggle; a nested `if=` is CREATE-TIME FROZEN. The asymmetry is the rule (NEW section, S376, #710)

**Before #710, `show=` on an element inside an `<each>` row template fell through to the generic
value-attribute path and emitted `setAttribute("show", String(cond))` — a no-op HTML attribute.** The
element rendered UNCONDITIONALLY; the condition had zero effect; exit 0, no diagnostic. A dog-food
find (`g-each-peritem-show-emits-literal-attribute`).

**Now:** `emit-each.ts`'s `renderTemplateAttrToJs` carries an explicit `show=` arm (arm **1b**, added
directly after the `class:` arm), emitting `elVar.style.display = (cond) ? "" : "none"` and wrapping
it in `maybeWrapEachPerItemEffect`. **PA-VERIFIED BY COMPILING at this watermark** — a
`<span show=t.done>` inside `<each in=@tasks key=@.id as t>` emits:

    _scrml_mount_track(_scrml_effect(() => {
      let t = _scrml_resolve_item(_mount, _scrml_each_key_1);
      if (t === null) return;
      _scrml_el_4.style.display = (t.done) ? "" : "none";
    }));

and **zero `setAttribute("show"`** in the client bundle. It re-resolves the item BY KEY inside the
effect, so it survives reconcile.

**⚑ THE RULE THIS SECTION EXISTS FOR — `show=` IS REACTIVE HERE AND `if=` IS NOT, AND THAT IS
DELIBERATE, NOT AN OVERSIGHT.** A nested per-row `if=` inside `<each>` is create-time-frozen
(`W-IF-IN-EACH`, §17.1, #416) because a reactive STRUCTURAL swap would leave `_scrml_group` stale — the
element is added or removed, and the group bookkeeping cannot follow. **`show=` only toggles CSS
`display`; it never adds or removes the element, so it has none of that barrier** and re-evaluates on
in-place field mutation, matching the Tier-0 top-level `show=` and the sibling `class:` binding.
**Before you make a per-item binding reactive, ask whether it changes the DOM SHAPE.**

**⚠ AND THE `call-ref` ARM ROUTES DIFFERENTLY FROM ITS `class:` SIBLING, ON PURPOSE.** The `show=`
call-ref branch reconstructs the call and pushes it through `lowerEachExpr`, not the bare
`rewriteIterValueExpr` the `class:` call-ref arm uses. `lowerEachExpr` does the iter-scope rewrite
FIRST and escalates to the structured emitter only when the text carries a §42 operator — so
`show=isReady(t.status is some)` lowers correctly instead of reaching the client JS raw as
`E-CODEGEN-INVALID-LOGIC`. **That hole is still OPEN in the `class:` arm** (documented in-source at
~`emit-each.ts:2005`); the two arms are byte-identical for an operator-free call.

**⚠ DO NOT CONFUSE THIS WITH `show=` ON A STRUCTURAL ELEMENT.** `<each show=…>` / `<match show=…>` /
`<engine show=…>` are still never CAPTURED — `grep -rn showCond compiler/src/` returns ZERO hits at
this watermark, and only `ifCond` is stamped onto those nodes. #710 changed the row-template locus,
not the structural one. See the §17.2 SSR-hide section below and §55 above.

## §16.6 — a snippet fill is routed by the DECL's parametric-ness, ARITY-TOLERANTLY; and a `render`-bearing body forces the legacy path (NEW section, S376, #713/#714)

**⚠ READ §16.6.1 BELOW FIRST IF YOU ARE TOUCHING PARAMETRIC SNIPPET SUBSTITUTION — S380 (#731) REPLACED THE MECHANISM POINT (2) BELOW DESCRIBES.** This section (S376) is carried for the DECL-routing table and the crash-avoidance rules, both still current; only the SUBSTITUTION MECHANISM in point (2) is superseded.

**Two silent-empty classes and one crash class, all in `component-expander.ts`, all closed together.**

**(1) The render SITE is fixed by the DECLARATION, not by the fill's arity.** A parametric
`foo: snippet(v)` renders as `${render foo(arg)}` (via `parametricSnippets` / `renderParamMatch`); a
non-parametric `head: snippet` renders as `${render head()}` (via `slottedGroups` / `renderMatch`).
Phase 1.6 now routes every lambda fill by the DECLARED parametric-ness and admits BOTH `(param) =>`
and zero-arg `() =>`:

| decl | fill | outcome |
|---|---|---|
| parametric | `(v) =>` | substitute `v` -> arg (the canonical form) |
| parametric | `() =>` | body as-is; the empty `paramName` makes substitution a no-op |
| non-parametric | `() =>` | body into `slottedGroups` |
| non-parametric | `(v) =>` | **arity mismatch — EMPTY group**, body not emitted (it may read an unbound param) |

**⚑ CAPTURING EVERY LAMBDA FILL IS LOAD-BEARING FOR CORRECTNESS, NOT COMPLETENESS.** The #713
live-fallback guard rewrites `render NAME(...)` -> `__scrml_render_NAME__(...)`. **If a fill is left
uncaptured, the render-slot detection never consumes that call and it survives into the client as an
UNDEFINED-FUNCTION `ReferenceError` that kills the whole page at boot.** Registering the fill — even
as an empty group — guarantees the call is consumed. So the arity-mismatch row above is not
politeness; an unregistered mismatch is a dead page. **Whether a genuine arity mismatch should ALSO
be a compile diagnostic is a §16.6 semantics question, DEFERRED to the operator — the codegen
contract here is render-sensibly-and-never-crash.**

**(2) A parametric fill used to substitute into a node codegen no longer reads.** The old path pushed
`{ kind:"logic", body:[{ kind:"bare-expr", expr: <substituted-string> }] }`, but codegen migrated to
`exprNode` (Phase 4d Step 8) and the legacy `bare-expr.expr` STRING is no longer consumed — **so the
node emitted NOTHING and the render site rendered empty at exit 0.** `parseSnippetBodyNodes` now
reparses the substituted body into REAL AST nodes and `_deepCloneAst`s them with the file-level
`counter` so ids cannot collide with the host file's (#273).
**⚠ A bare IDENTIFIER body is treated as TEXT, not interpolated** — `foot={ (v) => Active }` wrapped
as `${Active}` would `ReferenceError` on an undefined name and kill the page at boot. A body that
genuinely means a variable read is written `${var}` or returns markup.
**⚠ And `counter` is defensively defaulted to a high-seeded local (`{ next: 900_000_000 }`) rather
than dropping the render node** — emitting nothing would reintroduce the exact silent-empty class the
fix closes.

**(3) `sourceNeedsLiveFallback` gained a RENDER-BEARING guard, and it matches the CALL form.** The
NATIVE translator discards a `Render` expr into an empty escape hatch
(`translate-expr.js:296`, `case ExprKind.Render: return makeEscapeHatch("Render", "")`), so
`_injectChildrenWalk`'s render-slot detection never matches and the site renders EMPTY at exit 0. The
LEGACY path rewrites `render name(...)` -> `__scrml_render_name__(...)`
(`expression-parser.ts:1745`), which parses as a real call node the detection consumes — so a
render-bearing component body is routed onto the legacy path. **The guard is
`/\brender\s+[A-Za-z_$][A-Za-z0-9_$]*\s*\(/` — the `(` is load-bearing.** A bare `render <word>`
would fire on incidental prose ("please render your account") or a comment and needlessly route the
body off the native path, skipping the native-only props/call-ref AST upgrades. **The native discard
itself is a separate, still-open native-parser fix.**

## §16.6.1 — parametric snippet param substitution is now AST-SCOPED, not textual; and two adjacent silent-wrong classes closed with it (NEW section, S380, #726/#731/#733)

**(1) #731 — `render name(argExpr)` substitution moved from a textual `\b<param>\b` regex replace to an AST-level rename, closing two corruption classes at once.** The S376 mechanism (§16.6 point (2) above) reparsed the snippet body AFTER doing a **string** `.replace(new RegExp("\b" + paramName + "\b", "g"), () => argExpr)` on it. Two shapes defeated that regex:

- **The param name appearing as ordinary author TEXT inside the body**, not as a reference — `v: snippet(v)` filled with a body reading "the v value" corrupted the PROSE, not just the reference.
- **A `$`-prefixed param name** (a legal identifier) — a `\b` word-boundary anchor does not match adjacent to `$` (not a word character), so `\b$x\b` never matched the name at all and the reference silently passed through unsubstituted.

**Now:** the snippet body is parsed into REAL AST nodes FIRST (`parseSnippetBodyNodes`, unchanged from S376 — fresh ids via the file's `counter`, defaulting to a high-seeded local `{ next: 900_000_000 }` if absent, so a render node is never silently dropped). **Two cases, in `component-expander.ts`'s `_injectChildrenWalk`:**

- **Body IS exactly the bare param name** (`trimmedBody === snippet.paramName`) — this is a param REFERENCE, not code containing one. Because `parseSnippetBodyNodes` classifies a bare identifier as a TEXT node (deliberately — so a non-param name like `Active` renders literally instead of throwing a `ReferenceError`), the AST-identifier-substitution path below would never see a substitutable node here. The body is replaced WHOLESALE with `parseSnippetBodyNodes(argExpr, …)` instead.
- **Otherwise** — parse the body, then `argExpr` is itself parsed to an `ExprNode` (`parseExprToNode`) and threaded through the SAME node-level substitution component-prop expansion already uses (`substituteProps(node, new Map(), paramMap)`, `paramMap = Map([[paramName, argNode]])`) — identifier POSITIONS only; markup/text literals are left untouched by construction (a string literal node is never an identifier node).

**(2) #726 — a string-literal prop substituted into an EXPRESSION context (`is some`, `==`, member-access) no longer splices as a bare identifier.** Same file, `substituteProps`'s `exprVal.raw`-string branch. The LEGACY textual rewrite (`substitutePropsInRawExpr`) splices a prop's value in as a bare identifier — correct for a var/member/call prop (`title=(label)` → `title=(userName)`), but for a STRING-LITERAL prop (`note="present"`) it spliced the value as a bare identifier too (`"present" is some` reaching the emitter as literal, unquoted, invalid JS) — a `ReferenceError` that throws inside `_scrml_boot` and **silently kills the whole page** (exit 0 at compile). **The fix is conditional, not a wholesale mechanism swap** (every var/member/call/loop-emitter `@.`-sigil raw still takes the byte-identical legacy path): when — and only when — a string-literal prop name actually appears in the raw (checked via a per-prop identifier-boundary regex against `propExprMap`, which carries each prop's already-parsed `ExprNode`), the raw is parsed with scrml's own parser (`parseExprToNode` — §42-aware: it models `is some`/`==`/member as NODES and constant-folds a literal operand), substituted at the node level (`substitutePropsInExprNode`), and re-serialized (`emitStringFromTree`) with the resulting `exprNode` attached so the `if=`/`show=` emitter lowers from the NODE, not the raw text. A `"has note here"` string containing the SUBSTRING `note` round-trips verbatim (the structured path only substitutes identifier-reference nodes, never text inside a string-literal node) — the legacy raw rewrite would have corrupted the word inside the string.

**(3) #733 — an optional SNIPPET prop that IS filled must read `is some`-TRUE, not the generic `null`.** `expandComponentNode`'s prop-defaulting: an optional prop with no author-supplied `default(...)` used to fill `null` UNCONDITIONALLY (`props.set(decl.name, "null")`). For an ordinary optional prop this is correct — but for an optional SNIPPET prop that WAS actually filled (via `slot=` → `slottedGroups`, or a lambda → `parametricSnippets`), the prop is PRESENT, and a `<prop> is some` guard around its render site must read true. The generic `null`-fill made that guard `null !== null` — always false — and silently dropped the filled slot's guarded region (broke `examples/12`, the flagship). **Fix:** `snippetPresent = decl.isSnippet && (slottedGroups.has(decl.name) || parametricSnippets.has(decl.name))`; fills `"true"` when present, `"null"` only for a genuinely absent optional. The render path itself is unaffected — it already reads `slottedGroups`/`parametricSnippets` directly, never this defaulted value; only the `is some` GUARD reads it.

**All three share one root shape, worth naming: a prop/param SUBSTITUTION site that operates on TEXT rather than the parsed representation is the recurring defect class in this corner of the compiler** (`source-text-regex-census.ts`'s POST-AST rule, build.map.md — `component-expander.ts` runs well after AST-build, so a raw-text regex here is exactly the class that script exists to catch; these three predate its coverage of this file).

## §51.3 — `<match>` dispatch has TWO reactivity gaps closed this window: a DERIVED-cell scrutinee, and a same-key PER-ITEM reconcile (NEW section, S380, #732/#735)

**(1) #732 — a `<match on=@derivedCell>` scrutinee froze at its initial value, because `on=` wiring assumed every cell subscribes the same way and a DERIVED cell does not.** `emit-match.ts`'s `resolveOnExpr` has always emitted Shape A (`_scrml_reactive_subscribe`) for a bare `on=@cell` scrutinee — correct for a MUTABLE cell, which fires the subscribe callback on `.set()`. **A DERIVED cell (`const <x> = …`) never `.set()`s — it recomputes through a separate mechanism (`_scrml_derived_get`), which `_scrml_reactive_subscribe` does not observe at all.** So a `<match on=@derivedCell>` (or the member-access form, `on=@derivedCell.path`) dispatched once at compile-implied init and then silently froze on every subsequent recompute, while a sibling `${@derivedCell}` interpolation or `if=@derivedCell` updated correctly on the same recompute — the asymmetry is what made it a dog-food find, not a designed-in restriction.

**Fix: a derived-cell scrutinee routes through Shape B (an `_scrml_effect` reading `_scrml_derived_get`) instead of Shape A.** `resolveOnExpr` checks the scrutinee cell name against `collectDerivedVarNames(fileAST)` (`reactive-deps.ts`, memoized per-`fileAST` in a `WeakMap` since `resolveOnExpr` runs 2-3× per match block) and, when it names a derived cell, returns `variantExprAccessor: "_scrml_derived_get(name)"` with a new `derivedScrutinee: true` flag — `variantSubscribeName` is KEPT (still drives `_armCellName`/arm-payload-each stamping downstream), only the SUBSCRIPTION MECHANISM changes. `emit-variant-guard.ts`'s `emitVariantGuardedRender` reads the flag: when set, it emits `_scrml_effect(function() { <dispatchFn>(<accessor>); })` instead of the subscribe call, and SKIPS the separate DOMContentLoaded init-fire the subscribe path needs (an effect fires at init on its own — a second init-fire would double-dispatch).

**(2) #735 — a per-item `<match>` inside an `<each>` row froze on a SAME-KEY reconcile field change, one gap over from #732 and caused by the SAME class of assumption: a per-item factory call site assumed create-time dispatch is enough.** A keyed `_scrml_reconcile_list` REUSES the DOM node for an item whose key is unchanged, so the per-item match factory (`emit-each.ts`'s `renderTemplateChildToJs`) never re-runs on that reconcile — but the bare `<dispatchFn>(<mount>, <discriminant>)` call it had always emitted only fires ONCE, at create time. If the item's discriminant FIELD changes on a same-key reconcile (the row stays, one of its fields updates), the arm stayed frozen at its create-time value while a sibling `${item.field}` interpolation in the same row updated correctly — the identical asymmetry shape as #732, in the per-item axis instead of the derived-cell axis.

**Fix: route the per-item dispatch call through the SAME per-item effect wrapper the interpolations already use.** `maybeWrapEachPerItemEffect([dispatchLine], iterVarName, indent)` re-resolves the iteration var (and any enclosing-each var the discriminant reads, for a nested `<each>`) via `_scrml_resolve_item` inside an effect, so READING the discriminant through it tracks the value and the effect re-fires the dispatch on a field change. Outside a reconcile ctx (no enclosing per-item effect stack — see `EachReconcileCtx`, schema.map.md) it returns the line unchanged, matching every other per-item binding's behaviour on that path.

**(3) A same-value short-circuit was added to `emitVariantGuardedRender` alongside #735, and it is load-bearing for BOTH fixes, not just the per-item one.** Wrapping the dispatch call in a per-item effect (or the #732 derived-cell effect) means the dispatcher now potentially re-fires on every reconcile pass, including one where the discriminant DID NOT actually change. Without a guard, an UNCHANGED arm would tear down and re-parse its `innerHTML` on every list update — losing focus/selection/nested state inside that arm and wasting re-parse work. The dispatcher now caches the last-dispatched value on the mount node itself (`_mount["__scrml_match_lastv_<idPrefix>"]`) and returns early when `=== ` holds. **`===` is the correct comparator for both variant shapes**: a unit-variant tag is a bare STRING (stable identity across reads), so an unchanged tag short-circuits; a payload-bearing variant is a FRESH tagged-object every dispatch (`{variant, data}`, never memoized), so `===` correctly FAILS and the arm still rebuilds — the guard cannot mask a payload change. A fresh mount (a genuinely new row, not a reconcile reuse) has no cached value, so it always renders on first dispatch.

**Both #732 and #735 are the SAME underlying lesson from two different angles: `<match>`/`<engine>` dispatch wiring has as many "how does this scrutinee change" cases as the reactive-cell model has update mechanisms, and a NEW mechanism (derived recompute; per-item reconcile reuse) is invisible to a dispatcher built when only ONE mechanism (mutable-cell `.set()`, create-time-only per-item) existed.** Before adding a new scrutinee/dispatch shape, check `resolveOnExpr` and the per-item wrapper decision both cover it — see the GITI-031 member-access sub-path precedent this section's fixes both extend (schema.map.md's `LogicBinding` section covers the sibling `directiveIsFormValue` case of the same "which write mechanism" question).

## §59 / §52 — TWO LOWERINGS THAT WERE SILENTLY CLIENT-ONLY, AND THE SERVER PAID AT REQUEST TIME (NEW section, ⛑ S384, #748/#749)

**The shared shape, and it is the transferable part: a codegen branch gated `ctx.mode === "client"` is
not a *client optimisation* — it is a SERVER HOLE, and the compile stays GREEN either way.** Both
defects below emitted a clean bundle and threw at REQUEST time. Neither is a parse or type failure,
so nothing upstream can catch them; the only signal is running the server.

**(1) `g-value-native-map-set-server-runtime` — a server fn that builds or returns a `[K:V]` map or a
`set[K]` threw `ReferenceError: _scrml_map_from_entries is not defined`.** Two independent halves,
both landed:

  · **Part A — the METHOD lowering (`codegen/emit-expr.ts`).** Every value-native map/set lowering
    (`.size`, bracket read, set-native methods, map methods, the combinator-collision guard) gated on
    `ctx.mode === "client"`. Server-fn bodies therefore left `m.insert(…)` / `m["k"]` / `m.size` as
    VERBATIM member/index/call expressions — and the runtime map is a **tagged PLAIN object with no
    methods**, so those became `m.insert is not a function` or a JS-array index read. The gate is now
    a shared helper, `mapSetLoweringBoundaryOk(recvNode, ctx)` (`emit-expr.ts:2777`), which returns
    true unconditionally on the CLIENT boundary (byte-identical output) and on the SERVER boundary
    **only for a bare, non-reactive, non-`@` LOCAL receiver.** ⚑ **Two independent guards make that
    safe, and both are load-bearing:** (i) `emit-server.ts` threads ONLY the per-fn
    `localMapVarNames`/`localSetVarNames` and **never** the reactive `mapVarNames`/`setVarNames`, so a
    classifier can only match a LOCAL server-side; (ii) the helper additionally demands a bare ident
    receiver, so even if reactive names were threaded here later, the reactive path — whose server
    semantics read the REQUEST BODY, not a live map — stays out. ⚠ **The bracket-read site
    (`emitIndex` at `:2805`, the map branch at `:2825`) is the one exception and it says so in source:** a nested read's immediate
    `.object` is an inner `index`, not an ident, so the per-receiver guard cannot apply and the safety
    rests on the opts contract alone.
  · **Part B — the RUNTIME (`runtime-template.js` + `emit-server.ts`).** A standalone `.server.js`
    never imports the client runtime, so the `_scrml_map_*` helpers simply were not there.
    `runtime-template.js` now exports **`SERVER_VALUE_NATIVE_MAP_HELPER` (:6355)**, an IIFE that
    slices the §59 runtime VERBATIM out of `SCRML_RUNTIME` between two marker comments —
    `// __SCRML_MAP_RUNTIME_START__` (**:5602**) and `// __SCRML_MAP_RUNTIME_END__` (**:6135**).
    `emit-server.ts` injects it after the module header at TWO sites — the value-only path
    (**:1478**, in `generateValueOnlyServerJs`) and the assembled route-handler path (**:5835**, in
    `generateServerJs`; the import is `:45`) — each **REACHABILITY-GATED** on
    `/_scrml_map_[a-z]/` surviving in the emitted body, so a bundle with no map/set use is
    byte-unchanged. ⚑ **Single-source by construction, not by discipline:** there is no second copy to
    drift, exactly as with the structural-eq and enum-lookup-table server ports. ⚑ **The slice
    contract is stated in source and is the thing to preserve:** everything between the markers MUST
    be pure hoistable `function` declarations, and a missing/renamed marker makes the IIFE **THROW at
    first use** — deliberately loud, because an empty helper would resurface the original
    `ReferenceError` as a silent runtime bug.

**(2) `g-server-fn-bare-dot-payload-variant` — a bare-dot payload constructor `.Variant(args)` inside
a `server function` body emitted the broken `"Variant"(args)` (runtime `TypeError: "Variant" is not a
function`).** Root cause is a REGISTRY POPULATED ON ONE PASS ONLY: `getVariantFieldSchema` reads the
`emit-control-flow.ts` registry, which `setVariantFieldsForFile` populates on the **CLIENT** emit pass
alone, so on the server pass it returns `null` and the constructor site fell through to the
string-as-function emission. The fix reads the OTHER registry: **`getVariantFieldSchemaFromRewriter(variantName)`
(`codegen/rewrite.ts:151`)** exposes `_rewriterVariantFields`, populated by `setVariantFieldsForRewriter`,
which runs in **BOTH** `generateClientJs` and `generateServerJs` and carries the identical
`buildVariantFieldsRegistry` data. It applies the SAME collision policy (a name in >1 enum in the file
returns `null`, so the caller falls through to qualified `Enum.Variant` dispatch). ⚑ **Deliberately
NOT folded into `getVariantFieldSchema`, and the reason is a coverage boundary, not taste:** the
fail-state lowering (`emit-logic.ts:emitFailExpr`) and the match / `!{}` binding-projection paths also
read `getVariantFieldSchema` and MUST keep their existing server-pass behaviour (a null schema → a
bare-value `.data`). **Only the constructor call site in `emit-expr.ts` opts into the fallback**, so
those paths remain byte-identical. ⚠ The call site uses a `require("./rewrite.ts")` inside `emitCall`
rather than a top-level import — a deliberate cycle-avoidance, flagged in source with an eslint
disable.

## for-lift reconcile — a WORD-CHAR-GLUED `${…}` was shipping as literal text (NEW section, S376, #716)

**`emit-lift.js`'s reconcile path used to skip interpolation lowering entirely.** The guard was
`if (_hasInterp && !currentLiftReconcileCtx())`, on the theory that "the each path owns its own
interp". **It does not own the GLUED case, and that was the bug.** The AST only splits an
interpolation preceded by a NON-word character — `n=${…}` / `Val: ${…}` split upstream into a sibling
bare-expr child, which the reconcile branch already lowered. A LITERAL PREFIX glued directly to the
interp (`P${it.x}`) stays as ONE text child, fell through to the raw `JSON.stringify(text)` append,
and **shipped a literal `${it.x}` to the DOM.**

Now the reconcile context gets its own branch: split, then lower each `${…}` LIVE-KEYED — stable text
node + `maybeWrapLiftPerItemEffect` — byte-identical to the sibling logic-block bare-expr reconcile
branch (Bug 64, S159). No double-emission, because the each path never owned this child.

**⚠ SCOPE, STATED IN-SOURCE AND WORTH CARRYING: a SEPARATE, PRE-EXISTING UPSTREAM BUG IS NOT FIXED
HERE.** The AST strips the whitespace ADJACENT to a non-word-split interp — `Val ${x}` -> `"Val7"`,
`Saved ${@cell}` -> `"Savedhello"`. **Different root (parser, not codegen), broader surface (top-level
too), its own reds** in `g-emit-lift-markup-text-interp.browser.test.js`. Tracked as
`g-ast-markup-text-interp-adjacent-space-dropped`. **Do not read #716 as closing the interp-in-lift
class; it closed the glued limb of it.**

## §17.2 `show=` — the SSR-hide was REVERTED, and the reason generalises (#464, S328, operator-ruled)

**There is NO SSR `display:none` injection for `show=` in this compiler.** #450 added one; **#464
backed it out in full** — `emit-html.ts` is byte-identical to `71623be3` (verified:
`git diff 71623be3 6f176c0d -- compiler/src/codegen/emit-html.ts` is EMPTY). `buildInitialBoolMap`,
`initialBoolMap`, `_showInjectFreshStyle` and `_showMergeIntoStyle` **do not exist**. §17.2 first paint
is owned entirely by the client hydration controller.

**The reason it had to go, and it is a reusable rule, not a one-off.** A `<match>` arm body is lowered
by the SAME `generateHtml` as file-level markup, so an emit-time hide becomes part of the string
literal `dispatch` assigns to `_mount.innerHTML`. The re-mounted element carries no controller —
`wire_<Arm>` does not re-bind a visibility toggle and `_scrml_nav_rewire` is never re-run on a variant
swap — so **a baked `display:none` can NEVER be cleared.** §17.2 mandates a *toggle*; **a toggle needs
a toggler.** SPEC is SILENT on the pre- vs post-hydration timing axis, so an SSR-time hide is
*permissible but unmandated* — and it is **not** permissible where it cannot be undone.

**The governing direction is now fail-OPEN: a missed hide is a brief flash; a wrong hide is
permanently invisible content.** Four conformance cases pin the post-revert contract as regression
guards — `control-flow/ctrl-017` (variant-render, no baked hide), `ctrl-018` (module-init write,
fail-open), `ctrl-019` (spelling parity), `ctrl-020` (no duplicate `style`) — each asserting `count: 0`
for both `[style*="display:none"]` and `[style*="display: none"]`.

**⚠ A DEPENDENCY A FUTURE READER MUST KNOW:** `ctrl-017`'s rationale states that the
`_scrml_nav_rewire` variant-render REWIRE hole is **pre-existing and deliberately NOT fixed here**
(tracked separately). Before the revert that hole failed CLOSED (element baked hidden, permanently
invisible); it now fails OPEN (element visible, binding stale). **`ctrl-017` pins the DIRECTION, not
ideal visibility — when the rewire hole is closed, the re-mounted element will legitimately carry a
controller-set `display:none` again and THAT ASSERTION MUST BE REVISITED. A failure there after a
rewire fix is expected, not a regression.**

## §18.5 BLOCK-ARM VALUE LOWERING — FOUR EMISSION ROUTES, ONE LEAF PREDICATE (#469/#470/#479, S330-S331)

**⚠ READ THIS TABLE BEFORE SCOPING ANY §18.5 WORK. The prior generation of this map implied
`planBlockArmLift` was "the single classifier every path routes through". That overstates it, and
the overstatement sent a dispatch to two wrong loci in one session (S331).** `planBlockArmLift` is
the shared **segmenter + plan** for the two RAW-STRING routes. The single shared LEAF PREDICATE — the
thing that actually answers value-vs-void — is **`_blockTailIsValueExpr`**, and all four routes call
it, two of them directly.

| # | Route | Where | Segmentation | Value/void decision | Emission shape |
|---|---|---|---|---|---|
| **A** | local-decl, **structured AST** arm (`const x = match … { . V => { … } }`) | `emit-logic.ts:emitMatchExprDecl` (:4763), structuredBody branch (~:4840) | none needed — AST nodes ARE the statements | **`_blockTailIsValueExpr`** on the last `bare-expr` node's text (:4882) | assign tail to the tilde result var |
| **B** | local-decl, **raw-string** arm | `emit-logic.ts:_emitBlockArmValueFromString` (:4734), gated by `_matchArmResultIsBlockBody` (:4637) | **`planBlockArmLift`** (:4715) → `_splitBlockStatements` (:4580) | `planBlockArmLift`'s call to `_blockTailIsValueExpr` | assign tail to the tilde result var |
| **C** | value-returning **IIFE**, **structured AST** arm | `emit-control-flow.ts:emitMatchExpr` (~:2320) | none needed — AST nodes | **`_blockTailIsValueExpr`** directly (:2354) | `return <tail>;` inside the IIFE |
| **D** | value-returning **IIFE**, **raw-string** arm (incl. §18.19 multi-scrutinee via `emitMultiArmBody`) | `emit-control-flow.ts:emitIifeBlockArmBody` (:2090) | **`planBlockArmLift`** | via `planBlockArmLift` | `return <tail>;` inside the IIFE |

**The consequences for a dispatch brief, stated plainly:**
- **`planBlockArmLift` has exactly TWO call sites** (`emit-logic.ts:4738`, `emit-control-flow.ts:2109`).
  A grep for it will NOT find routes A and C. Grep `_blockTailIsValueExpr` to enumerate all four.
- A defect in **segmentation** (`_splitBlockStatements`) can only reach B and D. A defect in the
  **predicate** reaches all four. Scope from which layer moved.
- Routes A and C do not segment because they do not have to — that is a design property, not an
  omission. A string has to be re-derived into statements; an AST body already is a statement list.
- `_matchArmResultIsBlockBody` (:4637) is the **object-literal fence** for the string routes only:
  a `{ … }` that the expression parser resolves to an `object` node is a VALUE (`1 :> { x: 1 }`) and
  stays byte-identical to the pre-#447 emission. Only a genuine `{ statement* expression? }` block
  reaches the tail lift. Routes A and C never see a string, so they never need it.

### §18.5(b) — a block-arm tail is SEPARATOR-DEPENDENT, and the `}` that closes a block statement IS a boundary (#479, S331)

**The defect.** `_splitBlockStatements` treated only `;` and newline as top-level statement
separators. Neither JS nor scrml requires a separator after the `}` that closes a block-bodied
statement, so `{ let a = 0; for (…) { a = 1 } a }` split into **two** segments — `let a = 0` and
`for (…) { a = 1 } a`. The §18.5 tail `a` was swallowed into a segment headed by `for`,
`_blockTailIsValueExpr` (correctly) called that a statement, and the arm classified **VOID**. In an
IIFE value position the emitted function then fell off its end and the arm evaluated to `undefined`
— **which does not exist in scrml (§42.1.1)**.

**The transferable read: the defect is SEPARATOR-dependent, not position-dependent.** The tail lifted
correctly the moment a `;` or newline preceded it. That is exactly why the corpus never tripped it
(corpus authors write the separator) and exactly why the symptom reads like a position bug when it
is not. **A classifier that reads source text is only as good as its model of that text's
separators.**

**The fix is gated THREE ways, and the gating is the interesting part** — `_closesBlockStatement`
(`emit-logic.ts:4550`) returns true only when all three hold:
1. the segment so far is headed by a block-statement keyword — `_BLOCK_STMT_HEAD_RE` (:4520),
   `/^(for|while|do|if|switch|try|match|given|each)(?![A-Za-z0-9_$])/`. **This is what keeps
   `const o = { … }` / `const f = () => { … }` off the path**: those segments are headed by
   `const`/`let` and already carry a genuine separator.
2. the text after the brace does not begin with a **continuation** keyword — `_BRACE_CONTINUATION_RE`
   (:4528), `/^(else|while|catch|finally)(?![A-Za-z0-9_$])/`. Splitting at `} else` / `} while (c)` /
   `} catch` would tear one statement into two invalid halves.
3. the text after the brace begins a **statement** — `/^[A-Za-z_$@{"'`0-9]/`, a **WHITELIST, not a
   blacklist**. An expression that merely continues off the brace (`{ … }.a`, `{ … }[0]`, `{ … })`,
   `{ … } + 1`) can never be split, because every one of those next-chars is simply absent from the
   admitted set. **Prefer a whitelist wherever "everything else" is the dangerous side.**

Both new regexes carry the **`(?![A-Za-z0-9_$])` fence OUTSIDE the alternation** — invariant 46,
applied at authoring time rather than after a second incident.

### §18.5(c) — a nested assignment inside a block arm lost its `opts`, and a match-expr arm needs a PER-ARM `declaredNames` (#479, S331)

**`_emitForStmtWithTilde` (`emit-logic.ts:4186`) dropped the options argument on its fallback path.**
Both fallbacks (C-style `for` head, reactive `@var` iterable) called `emitForStmt(node)` with `opts`
**omitted** — losing `declaredNames`, `boundary`, `serverFnNames`, `asyncRouteMap` and the engine
bindings in one hop. The visible symptom was `declaredNames`: with an absent set, `emitLogicBody`
opened a FRESH empty one, the `const-decl`/`tilde-decl` reassignment guard could not see the
enclosing `let a`, and a nested bare assignment `a = 1` emitted as a **shadowing `const a = 1`**
(and the self-referencing `a = a + 1` as a **TDZ `const a = a + 1`**).

**The fix re-dispatches through `emitLogicNode` with `tildeContext: undefined`** rather than calling
`emitForStmt` directly. Two gains, and the second is the durable one: (1) `opts` survives; (2) the
fallback runs the SAME canonical `case "for-stmt"` opts assembly as the non-tilde path, instead of a
hand-copied argument list that can drift out of step with it. `tildeContext: undefined` is what makes
the recursion terminate — the `case "for-stmt"` guard routes back into `_emitForStmtWithTilde` only
when a tilde context is present. **Prefer re-dispatch over a hand-copied argument list; this file
already carries that hazard elsewhere.**

**`emitMatchExprDecl` now builds a PER-ARM `declaredNames` set** (`emit-logic.ts:4867` —
`new Set(opts.declaredNames ?? [])`, then `{ ...bodyOpts, declaredNames: armDeclaredNames }`).
Threading ONE set through every arm let a name declared in arm 1 suppress the decl in arm 2, even
though the arms are mutually exclusive branches that never both run. The structuredBody path in
`emit-control-flow.ts` gets this for free because it re-enters `emitLogicBody` per arm.


### §18.5(a) — a block-arm tail merely PREFIXED by a keyword is a VALUE (#463, S328)

**The defect.** `emit-logic.ts`'s `_blockTailIsValueExpr` (**:4653** at `616688ea`; the line moved with #479) decides whether a `match` block-arm's
last segment is the arm's RESULT (lift it to the tilde result var) or a STATEMENT (emit and produce
nothing). It shipped as
`/^(const|let|var|return|if|for|while|do|switch|lift|throw|fail|on\b)/` — **the word boundary was
INSIDE the alternation, so it fenced only `on`.** Every other keyword matched as a bare PREFIX: a tail
named `formatted` matched `for`; `doc`/`document`/`domNode` matched `do`; `letter` matched `let`;
`constant`, `returnValue`, `iface`, `lifted`, `failCount`, `varName` likewise. Each was misclassified
as a statement head, the tail was never lifted, **and the arm silently produced `null` with no
diagnostic.** It shipped because the corpus tests used `base`/`b`-shaped tail names.

**The fix, and why the obvious fix would have been wrong.** The fence moved OUTSIDE the alternation
and became **`(?![A-Za-z0-9_$])` — deliberately NOT `\b`.** JS `\b` is defined against `\w` =
`[A-Za-z0-9_]`, which **excludes `$`**; scrml identifiers admit `$` (`compiler/src/tokenizer.ts:1343`,
`isIdentPart = /[A-Za-z0-9_$]/`). A `\b` fence therefore still reads `do$thing` / `const$x` / `on$c`
as keyword-then-boundary and **silently reproduces the very class the line exists to remove —
including for `on`, the one keyword that always carried a fence.** Matching the fence to the
language's OWN identifier charset closes the class at the root instead of at twelve positions.
`on foo` still matches; `onClick` still does not.

**The generalisable rule: a keyword fence in a scrml-facing regex must be matched to scrml's
identifier charset, not to `\w`.** Grep for `\b` in any classifier that reads scrml source text.

Measured at authoring time: **zero** corpus identifiers of the form `<keyword>$…`, though `$`-bearing
identifiers (`item$`, `acc_$`, `_$1`) ARE in live corpus use — so the `$` half pins a reachable class
with no current instance. Pinned by `unit/match-block-arm-keyword-prefixed-tail.test.js` (190L) and
conformance `match-block/value-decl-block-arm-keyword-prefixed-tail`, which asserts **both** consumers
of the classifier (the structured/variant-arm path and the raw/literal-arm path), both `$`-continuation
anchors, the `on`-prefixed no-change anchor, **and the opposite direction** — a block whose last
segment IS an assignment statement still produces void.

## Reset init-thunk no longer clobbers on a structural-cell reassignment (§6.8, NEW #417, HIGH)

**The defect, `g-assignment-emits-init-set-inverting-reset`, now FIXED.** The ast-builder emits the
same `state-decl` node SHAPE for both a genuine `<name> = expr` DECLARATION (`structuralForm:true`)
and a later `@name = expr` REASSIGNMENT of that already-declared cell (`structuralForm:false`,
`shape:"plain"`). Because the runtime's `_scrml_init_fns[name]` reset-thunk registry is LAST-WRITE-WINS
and `_scrml_reset` calls it, a top-level reassignment reaching `_emitInitThunkSidecar` used to
OVERWRITE the decl's init-thunk with the assignment's own expression — so `reset(@ticks)` after
`${ @ticks = @ticks + 1 }` re-ran the INCREMENT instead of restoring the declared initial value. Silent
wrong output on two documented primitives (originally surfaced as a `<timer>`/`<poll>` scoping defect,
S314; re-scoped S321 as the general top-level-assignment case).

**The fix, safe-by-construction.** `emit-logic.ts`'s `_emitInitThunkSidecar` now skips registering the
reset init-thunk when a node is a `structuralForm:false` / `shape:"plain"` / non-const write AND its
name is a member of `collectStructuralDeclNames(fileAST)` (`reactive-deps.ts`, NEW — walks logic bodies
incl. `if`/`for`/`while`/`match`/`try` for `state-decl` nodes carrying `structuralForm:true`). A write
NOT in that set is an IMPLICIT `@`-declaration (e.g. an SSE/channel bind `@latest = ticks()`) and
correctly KEEPS its thunk — reset must still re-establish that binding. **S239 caught a control-flow
gap (F1) before land:** a reassignment nested inside a TOP-LEVEL `if`/`for`/`while` body still clobbered,
because that dispatch re-emits through a hand-picked `opts` object that omits `structuralDeclNames` —
fixed with a module-level fallback, `setStructuralDeclNamesForFile` (emit-logic.ts), populated once per
file by `emit-reactive-wiring.ts` (mirrors the existing `_eachBindSupportCtx` module-fallback pattern;
file-immutable, so the fallback can never disagree with the opts value when both are present). Threaded
through `codegen/index.ts`'s two `EmitLogicOpts` construction sites too.

**Residual, explicitly out of this fix's scope — `g-implicit-cell-double-write-clobbers-reset-init`
(MED, NEW).** An IMPLICITLY-declared cell (`@x = 0`, no `<x>`) written a SECOND time at top level
(`@x = @x + 1`) still clobbers, because the static structural-decl set cannot distinguish the first
implicit write (the decl, must keep its thunk) from a later one (a reassignment, should skip) — that
needs emission-ORDER tracking, a larger change. Pre-existing; the S321 fix neither introduced nor
worsened it. Rarity: an implicit `@`-declaration is unusual (adopters conventionally `<x>`-declare),
double-writing one at top level rarer still.

## The `<machine>` keyword is REMOVED (§63.7 / §51.0.L, ruled S305, landed S307)

**`<machine>` is not a deprecated alias any more. It does not compile.** `E-DEPRECATED-001` (Error)
fires from `ast-builder.js:17378` (⛑ **S383: `:16839` was ALREADY WRONG pre-window — re-derived by grep, not shifted**); `W-DEPRECATED-001` is a §34 tombstone. Any doc presenting it as
"deprecated but still compiles / hard-removal at v0.3.0" is stale — `docs/PA-SCRML-PRIMER.md`,
`compiler/PIPELINE.md` and `compiler/SPEC-INDEX.md`'s authored half all still do.

**Three properties of the removal worth carrying:**

1. **It still PARSES (§63.5).** The builder accepts `block.name === "machine"`, pushes the one
   diagnostic, and BUILDS the `engine-decl` anyway, so a `<machine>` source reports exactly ONE error
   naming the migration instead of a cascade of secondary errors from an unbuilt node. Nothing
   downstream consumes the node — the compile fails on the error.
2. **It is NOT a §63.3(2) MAJOR-boundary removal.** The keyword was never in a released contract
   (§62.2), the codemod is verified-landed, and corpus migration measured ZERO. That is the standing
   template for removing a pre-1.0 form.
3. **The codemod is the load-bearing half, and a blind keyword swap would have been a silent
   semantics change.** `<machine … derived=@x>` + a `.A => .B` body compiles to a real MAPPING
   function; `<engine … derived=@x>` is an IDENTITY projection **that drops the rules body with no
   diagnostic**. `commands/migrate.js` Migration 2a therefore lifts the body into §51.0.J
   `derived=match @x { … }`, normalizes `=>` → `:>`, replaces `name=` with an explicit `var=` (on a
   derived engine `name=` marks the legacy NAMED form, which auto-declares no cell), and synthesizes
   a state-child per projected-TO variant. **It fails CLOSED — any unparseable body line leaves the
   declaration untouched** rather than half-migrating it. Migration 2b rewrites the `</machine>`
   CLOSER, without which the opener swap alone yields a mismatched tag.

**Both subsystems the keyword fronted were PORTED onto `<engine>`, not retired.**
- **§51.11 `audit`** — `emit-engine.ts` registers a per-engine recorder CLOSURE into the runtime's
  `_scrml_engine_audit_targets`; the runtime pushes the §51.11.4 entry on every committed transition.
  The make-it-loud placeholder `E-ENGINE-AUDIT-UNSUPPORTED-BODY` existed for exactly one arc and is
  now a tombstone — a code rejecting the clause would reject a working form.
- **§51.13 auto-generated property tests** — `projectStateChildRules` maps a modern `<engine>`'s
  state-child `rule=` graph into the `TransitionRule[]` shape the generator already consumed. The
  vacuous `test("no qualifying machines", () => expect(true).toBe(true))` is now `test.skip(...)`.
  **That artifact is AUTO-GENERATED into an adopter's suite, which is why a false green there is
  worse than usual — and it fired precisely for the canonical form we tell people to write.**

## §19.4.4.1 — a failable function's error type SHALL be an ENUM (ruled S313)

`fn f() ! E` : **`E` SHALL be an enum type** — a `:enum` declaration, or the built-in default `Error`
enum when the annotation is omitted (§19.4.2). A non-enum error type is **`E-ERROR-011`**, covering
scalar (`! string`), array (`! string[]`), generic (`! Map<K,V>`) and paren/union (`! (A|B)`) forms
**uniformly — they fail for one reason, not several**. Reserved / spec-ahead: no emitter yet, and per
§34.0 outcome 2 the §34 row lands WITH the implementation.

**Why the requirement is load-bearing rather than ceremony:** only a VARIANT can carry a `renders`
clause (§19.2), and that clause is what lets the compiler statically prove every error reachable
inside an `<errorBoundary>` is displayable (`E-ERROR-005`, §19.6.6). A non-enum error type has no
variants, carries no `renders`, and such a function sits **silently outside** the display guarantee.
Verified by execution at S313: inside an `<errorBoundary>` with no `fallback`, a `! LoadError` whose
variant lacks `renders` fires `E-ERROR-005`; a `! string` in the identical position compiles clean.

**Two process facts this ruling is now the worked example of:**
- **The corpus migrated FIRST, so the rejection lands inert.** Six sites carried a non-enum error
  type; all six were migrated at S313 *before* any rejection was specified (five
  `conformance/cases/form-for/formfor-*`, where `! string` was incidental, plus
  `examples/29-engine-vs-flags.scrml`, which additionally TAUGHT the wrong form in a comment and now
  teaches why the enum is required). Conformance held at 850/850 across the migration. **Per §62.2
  the corpus IS the versioned contract, so that migration — not the SPEC sentence — is what moved
  it.**
- **It carries the first `provenance:` field in SPEC (pa-base v2.10 Rule 4b).** The provenance block
  explicitly SUPERSEDES a PA-authored scalar/compound split that had no design provenance and
  sanctioned the very form the recorded 2026-04-04 reasoning condemns. *A parser defect (`! string[]`
  broke #228) is not a language-design reason* — and that was invisible until it had to be written
  down.

## §6.7.1a — "bare expression" is a LIFECYCLE CATEGORY, not an arity limit (clarified, PR #359)

`on mount { body }` desugars into the §17.3 bare-expression-at-mount position. **"Bare expression"
there names the §7.3 lifecycle category** (executes at initial render, as against `function`/`fn`,
which execute only when called) — it does **NOT** constrain `body` to a single expression. `body` is
`logic-content` (§7.2), and **any construct valid in a `${ }` logic context SHALL be valid in an
`on mount { }` body**; `on mount` is sugar for that position and adds no restriction of its own.

**The sugar-equivalence SHALL is NOT met by impl #1, and §6.7.1a says so in place rather than
asserting it.** Measured on `a4a4d55f`: multi-statement bodies, `const`/`function` declarations, `@`
writes and `match` all lower correctly; **`lift`, markup-as-expression, `?{}` and a `!{}` error arm
each fail with `E-CODEGEN-INVALID-LOGIC`.** All four fail CLOSED — nothing broken ships. Tracked at
`g-onmount-multistatement-bypasses-statement-codegen` (the gap's NAME predates the measurement; the
real discriminator is the §7.2 extension set, not statement count). Direction of change: clarifying —
when the gap closes those programs become newly ACCEPTED, a conformance restoration rather than a
widening, so it is not a §62 version event.

**Adjacent implementation fact worth knowing before touching the mount path:** a multi-statement
mount body is lowered through the STRING pipeline, not a statement list, because
`safeParseExprToNode` parses exactly one expression. `ast-builder.js`'s `mountBodyExprNode` (:355)
drops a TRUNCATED parse so all statements survive — before it, a body whose first statement happened
to parse had **every following statement silently dropped, with zero diagnostics** (GH #264 Defect 2).

## A `fn`/`function` body admits exactly ONE shape — `E-FN-EQUALS-BODY` (§48.2, NEW, #396)

`fn`/`function` bodies are `{ … }` blocks ONLY. The `=`-expression shorthand —
`fn <name>(args) [-> T] = <expr>`, e.g. `fn pick(k:int) -> bool = match k { 1 :> true  _ :> false }`
— is **NOT a sanctioned scrml form** and is rejected at parse with `E-FN-EQUALS-BODY`, the sibling of
the `=>`-arrow reject `E-FN-ARROW-BODY` (§48.2.1). Fix: a block body (`fn f(args) { return <expr> }`)
or the implicit tail-return form (`fn f(args) { <expr> }` — a block body already returns its tail
expression, so the shorthand added no expressive power the block form lacks).

**Before the reject, the shape SILENTLY MISCOMPILED, and the mechanism is worth knowing beyond this
one code.** The `-> T` / `: T` return-type consumer breaks at a depth-0 bare `=` (the same consumer
that handles `route=` and other trailing attributes), so it swallowed `= match k {…}` whole and the
match's own `{` was misread as the FUNCTION body brace — the entire match collapsed to
`function _scrml_pick(k){ 1; }` (the first arm's TEST literal as a bare statement, every arm RESULT
dropped, the function returning `undefined`), with **zero diagnostics**. `= if …` tail forms instead
hit `E-CODEGEN-INVALID-LOGIC` (a different, louder failure, which is why only the `match`-tail shape
went undetected long enough to reach a filed gap).

**Topology: `rejectFnEqualsBody` (`ast-builder.js:3930`, throw at `:3930`) fires at FOUR duplicated decl-body call
sites** (`:9487` / `:9769` / `:12825` / `:13126`) — ⛑ **S383: these six anchors were ALREADY WRONG before this window (`:3755` / `:9310`/`:9592`/`:12645`/`:12946`), not merely shifted; RE-DERIVED BY GREP.** The same four-site duplication `E-FN-ARROW-BODY`
already lives at) **plus a FIFTH site that behaves differently on purpose: the `export` re-parse**
(`:11625-11654`). Before this fix, that re-parse SWALLOWED every sub-error from its inner parse
(including this one) — an exported form of the shorthand compiled to a silently-empty exported
function rather than reporting anything. The fix surfaces ONLY `E-FN-EQUALS-BODY` from the sub-parse
(other sub-errors stay suppressed, deliberately — widening what the re-parse surfaces is a separate,
unscoped change), so an exported form now gets the same diagnostic a top-level one does. **Any future
fn-decl parse fix owes all five sites, not the four `rejectFnEqualsBody` call sites alone** — see the
`scrml-fn-decl-parse-sites-topology` memory note for the general shape (route= trailing-attribute
over-consumption at the same consumer is a documented sibling risk).

**One residual, explicitly out of this fix's scope:** an ANONYMOUS `let f = fn(x) = expr` still routes
to `E-CODEGEN-INVALID-LOGIC` rather than `E-FN-EQUALS-BODY` — a different parse path
(`expression-parser.ts`, not `ast-builder.js`'s decl-body sites) — tracked as
`g-fn-anon-expr-equals-body-emits-invalid-js` (LOW, open).


## §44.3 `E-SQL-006` now fires at COMPILE time on EVERY server-fn emit path (#476, S333-peter)

**What changed.** A `.prepare()` on a `?{}` SQL result used to reach the emitted artifact and throw
at RUNTIME on the async server paths — a green compile that died in production. It is now a
compile-time diagnostic on every server-fn emit path.

**The mechanism is worth copying, because the bug was a SINK-WIRING bug, not a detection bug.**
`emit-logic.ts`'s `case "sql"` (`method === "prepare"`) already pushed the error — into
`(opts as any).preparedStmtErrors`. The **broad `opts.errors` sink is deliberately NOT wired** on
these paths. So the fix is ONE function-scoped narrow sink, `_sqlPrepareErrors`, threaded into EVERY
server-body / direct-emit call and **drained at the tail** (`emit-server.ts`), including the §39.3
`handle()` escape-hatch body. The library path (`emitModuleValueExportLines`) had to have `errors`
threaded before its sink was drained at all — an EXPORTED async `?{}`-using fn emits there, so
before the thread it pushed into a sink nobody read. **Deduped at the drain**, because a fn emitted
on BOTH paths would otherwise report the same `prepare` twice.
Pinned by five NEG conformance cases (`sql/prepare-{server-fn,cps-return,pattern-c-cell,sse-generator,ws-onserver}-e-sql-006-neg`).

## `<#request>.data is some` — the ESCAPE-HATCH substrate, and the per-callsite gate (#484 · #511 · #512)

> **The CLOSURE STATE of this class now lives in the §6.7.7 section above** — two of the three
> siblings this section used to list as open were closed by #511 and #512. **This section keeps the
> SUBSTRATE detail**, which is what you need if you are adding a fourth call site.

**The class.** `ast-builder.shouldSkipExprParse` skips a `<#`-leading expression (its HTML-fragment
guard), so a `<#request>` ref arrives at codegen as an **escape-hatch raw string**. Whichever
lowering receives it then has to re-derive the ref, and the ones that did not thread `requestIds`
mis-routed it to the **§36 input-state registry** (`_scrml_input_state_registry`) — which a
`<request>` never populates → `undefined.data` → runtime TypeError.

**The shared substrate is `reparseRequestRefEscapeHatch(exprNode, raw, ctx, requestIds, gate)` in
`emit-expr.ts`**, with `collectRequestIds(fileAST)` (in `reactive-deps.ts`) supplying the id set.
Consumers: `emit-bindings.ts`, `emit-event-wiring.ts`, `emit-html.ts` (#484) and now
`emit-lift.js` via `reparseLiftAttrRequestRef` (#512). The `<each>` path (#511) does NOT use the
reparse — its node IS parsed and it only lacked the id set, so it threads `requestIds` through
`lowerEachExpr` from a module-level `_eachRequestIds` stash instead.

⚠ **THE `gate` PARAMETER DIFFERS BY CALL SITE ON PURPOSE, AND GETTING IT WRONG BREAKS A DIFFERENT
FEATURE.** `gateToRegisteredRequests: false` for `if=`/`show=` — an input-state `<#field>.value is
some` toggle MUST reparse there, or the string fallback mangles its `is some` LHS. `true` everywhere
else (value / bool / class / each-attr / lift-attr), so a non-request `<#id>` stays byte-identical to
its pre-fix emission. **Read the gate at the site you are copying from before you copy it.**

**Still open, and it fails in the LOUD direction:** `g-request-is-some-in-mixed-text-attr-template-misroute`
(mixed-text attr template, e.g. `title="state: ${<#r>.data is some}"`) → `E-CODEGEN-INVALID-LOGIC`,
no bundle written. **Verify against `docs/known-gaps.md` before scoping — this map does not own that
ledger's status.**

**The convergent fix is the `shouldSkipExprParse` substrate, which S312 deliberately did NOT touch
after a global attempt regressed.** Every landed fix is per-callsite on purpose. **A brief that says
"route request refs correctly" without naming the callsite is under-specified — three PRs proved it,
and two of them needed different mechanisms.**

## Read-side diagnostics inside an `<each>` in a `<match>` arm (#477, §6.1.1, S333-peter)

An each-bearing bare-body `<match>` arm was **BLANKED** (`children: []`) by the ast-builder to avoid
the S153 `collectEachBlocks` double-emit. That blanking dropped the read-side walk for **every** read
in such an arm — the nested-`<each>` read AND a direct read that merely shares the arm with an
`<each>`. `E-STATE-UNDECLARED` and every other read-side ident diagnostic went silent.

**The fix re-parses the arm body LOCALLY in `type-system.ts`** off a raw body + absolute file
coordinates the ast-builder now stamps on the wrapper (`_reparseEachArmBodyRaw` /
`_reparseEachArmFileStart` / `_reparseEachArmBaseLine` / `_reparseEachArmBaseCol`). Three properties
make it safe and each is a reusable rule:
- **The re-parsed nodes are throwaway** — discarded after the walk, never attached to `fileAST`, so
  `collectEachBlocks`/codegen are wholly unaffected.
- **A disjoint id range is claimed** (`_nextReparseIdBase()`), because `buildAST` resets its OWN
  counter to 0 per call and the throwaway ids would otherwise **clobber the `nodeTypes` memo keys**
  (`String(node.id)`) of real nodes.
- **The REAL `filePath` is passed** (no `#match-arm-each` suffix), because a suffixed path breaks
  `build.js`/`dev.js` editor jump-to-location.

Spans are rebased to file-absolute, and the rebase recurses so a depth-2 read still locates
correctly. Pinned by `unit/g-nested-each-in-match-arm-diagnostics.test.js` (232L) +
`conformance/cases/type-state-codes/e-state-undeclared-nested-each-in-match-arm-pos`.


## §38.1 / §38.12.2 — A CROSS-FILE CHANNEL MOUNT IS POSITION-SENSITIVE, BUT A CHANNEL'S *CELLS* ARE NOT (NEW section, S391, #781/#789)

**The rule, and the asymmetry is the whole point:** a channel is an **app-scope singleton** (§38.1),
and CHX **inlines a mount in place** (§38.12.2). So a mount (`<channelAlias/>`) placed inside a
CONDITIONAL or ITERATIVE container cannot emit the channel's cells, its exported functions, or its
WebSocket route. **But the channel's cells stay readable everywhere in the file — including inside
the very arm the mount was wrongly placed in. Mount position does not scope a channel.** That
asymmetry is why the failure was confusing enough to need its own diagnostic: the author's mental
model ("I mounted it where I use it") is coherent, and wrong, and the old behaviour rewarded it with
markup that compiled.

**What the old behaviour was:** the tag was emitted VERBATIM into the markup and every `@cell` read
of it resolved to a cell that never syncs — **at exit 0**. The originating gap is
`g-state-undeclared-over-fires-on-imported-channel-cell-read-inside-a-match-arm`.

**Now refused by name:** `E-CHANNEL-MOUNT-IN-CONDITIONAL` (§38.1, §38.4, §38.12.2), §34 catalog row
`SPEC.md:19629`, second table row `SPEC.md:21701`. Emitter
`component-expander.ts:4968`, sole call site `:4687` in `runCEFile` — **run BEFORE `expandChannels`,
so the file fails CLOSED rather than half-wired.**

⚠ **THE SPEC ROW AND THE CODE COUNT DIFFERENTLY, AND BOTH ARE RIGHT.** The row says **"Four
containers are refused"**, enumerating LOCI: a `<match>` arm body · an `<engine>` state-child body ·
an `<each>`/`<match>` that is a DIRECT child of an `<engine>` body · any subtree of one of those.
The CODE's discriminant set is **THREE AST kinds** — `match-block`, `each-block`, `engine-decl`
(`component-expander.ts:5028`) — and the remaining loci fall out of the nearest-enclosing-container
walk rather than a fourth `kind`. **Read the row for the refused POSITIONS; read the code for the
discriminants. Do not go looking for a fourth `kind` string.**

⚑ **A DELIBERATE NON-MECHANISM, RECORDED SO IT IS NOT "FIXED" BACK IN:** the
`_reparseEachArmBodyRaw` TEXT STASH is not scanned. That scan existed and **was deleted at S385 by
ruling, because it refused a valid file over a comment that merely NAMED the alias.** Detection is
node-path only, and the §34 row explicitly declines to claim otherwise. **A textual scan over a body
that can contain comments and strings is the same class of mistake as `maskCommentRegions` over a
`<db>` body (see error.map.md): it trades a visible wrong answer for an invisible missing one.**


## §17.1.1 — THE `if-chain` NODE SHAPE IS A DEFECT-FAMILY ROOT, NOT A DEFECT (NEW section, S395, #805/#811)

**THE ONE FACT.** `collapseIfChains` (`ast-builder.js:18871`; node construction `:19024`) rewrites an
`if=` / `else-if=` / `else` chain **that has an else arm** into a NEW node:

    { kind: "if-chain", branches: [{ condition, element }, …], elseBranch }

The branch bodies live under **`branches[].element`** and **`elseBranch`** — and under **none** of
the container keys the compiler's many hand-rolled walks recurse into (`children` / `body` /
`bodyChildren` / `nodes` / `arms` / `templateChildren`). ⚑ **`branches` is an array of
`{condition, element}` RECORDS, not of nodes**, so even a generic walk that happens to list
`branches` among its keys silently fails to reach `element`: the entries carry no `.kind`, and the
standard `default` recursion in this repo descends only array fields whose entries do.

⚑ **THE DISCRIMINATOR IS THE `else` SIBLING, AND THIS IS THE REPRODUCTION RECIPE FOR THE WHOLE
FAMILY.** A **lone `if=` with no else** is passed through as plain markup and never becomes an
`if-chain`. So the SAME source works with one element and breaks the moment an `<div else>` sibling
is added — which is why *"add an `else`"* turned a working `<each>` into **zero renderers at exit 0**
(`g-each-in-if-else-chain-emits-zero-renderers`, HIGH). Any bug report of the shape *"it worked until
I added an else"* starts here.

**THE FAMILY, as measured (each was ONE fact copied into a different walk):**

| symptom | walk that was blind | severity |
|---|---|---|
| `<each>` in a branch emits **zero renderers**, exit 0, zero diagnostics | `codegen/collect.ts` `collectTopLevelLogicStatements` | HIGH |
| a branch-declared state cell reads as a false **`E-STATE-UNDECLARED`** | `symbol-table.ts` PASS-1 container list | HIGH |
| the entire chain subtree **invisible to the type system** — `type-system.ts` had ZERO occurrences of both `if-chain` and `elseBranch` | `type-system.ts` `visitNode` (no case; `default` recurses only `.kind`-bearing array entries) | HIGH |
| a branch cell is **subscribed but never created** (13 collectors) | `codegen/reactive-deps.ts` | HIGH |
| **`W-EACH-KEY` stops firing** for every `<each>` under a chain | `lint-w-each-key.js` | adopter-facing |
| four **promotable lints** + `scrml promote` go silent | `lint-i-fn-promotable.js` · `lint-i-match-promotable.js` · `lint-w-each-promotable.js` · `commands/promote.js` | MED |
| the **ordered-map iteration-order exemption** goes blind | `lint-w-map-iteration-order.js` | MED |
| a `<timer>` in a branch **never starts** (`_scrml_timer_start` count 0 vs 1 on the lone-`if=` oracle) | the lifecycle emitter — **not traced**, same class | MED, open |
| a cell read ONLY as a chain condition or ONLY in a branch interp **false-fires `E-DG-002`** | `dependency-graph.ts` usage analysis | open |

**THE FIX IS A SHARED ENUMERATOR, NOT A SEVENTEENTH COPY.** `compiler/src/ast-if-chain.js`
(⚠ `src/` ROOT — `compiler/src/codegen/ast-if-chain.js` **does not exist**) exports
**`ifChainChildNodes(node)`**: every `branches[].element` in source order, then `elseBranch`; an
EMPTY array for any non-`if-chain`, so a caller may invoke it unconditionally. **#805 created it
with six consumers; #811 closed ten more.** At `ad7b65dc`: **13 importing modules, 32 call sites.**

⚠ **TWO WALKS ARE DELIBERATELY NOT ROUTED THROUGH IT, AND BOTH READ AS OVERSIGHTS. THIS IS THE MOST
LIKELY WAY A FUTURE AGENT BREAKS THIS AREA.**

1. **`codegen/collect.ts:173` `collectFunctions` — BACKED OUT ON PURPOSE; closing it is a SECURITY
   REGRESSION.** That walk feeds the CLIENT function emitter while the server-boundary routing walk
   is **separately** blind, so adding the descent emits a `server fn` **BODY into `client.js`** with
   no `server.js` at all. **Trading a loud `ReferenceError` for a silent server-code-in-client leak
   is strictly worse**, so #811 reverted it, filed the pair HIGH
   (`g-collect-functions-branch-decl-vs-server-boundary-routing`) and shipped a **LEAK GUARD** test
   that reds if anyone closes it without closing the routing walk first
   (`compiler/tests/unit/g-if-chain-branch-cell-never-wired.test.js:124`).
2. **`symbol-table.ts:10642` — must stay a TOTAL `Object.keys` walk.** It already reaches
   `branches[].element` because it descends **everything**. `ifChainChildNodes` is an ENUMERATOR of
   KNOWN fields, so substituting it there **removes coverage**. #811's own dispatching brief named
   this site as a gap; the brief was wrong in the dangerous direction, and the agent's verify
   instruction is what caught it.

⚠ **ONE KNOWN SPEC DIVERGENCE SHIPPED WITH #811, DELIBERATELY AND ON THE RECORD:**
`g-if-chain-all-arms-run-at-module-init` (MED). Every arm's `${}` body now runs at module init, in
source order, **last writer wins** — so a cell declared or written in the DEAD arm overwrites the
live one. §17.1.1 forbids it. It landed because **the property never held**: PA-verified on untouched
main, a LONE `if=` with a FALSE condition still fires its body, so this brings the chain into parity
with the existing non-conformance rather than inventing a class, no currently-correct program
regresses, and corpus impact measured zero. **Closing it means ruling whether a markup `${}` body is
file-scope or branch-scoped — which changes lone `if=` too, and is the operator's call.**

⚠ **OPEN, LOW — the module over-claims its own authority.** `g-ast-if-chain-one-place-claim-overstated`:
`ast-if-chain.js:2` calls itself *"the ONE place that knows where a §17.1.1 `if-chain` node keeps its
child markup"* and instructs *"add it HERE and every consumer inherits it."* Given the two deliberate
non-consumers above, a new branch-carrying field would reach neither `collectFunctions` nor the total
walk. **The `⚠` is worth keeping; the word "ONE" is not load-bearing truth.**


## §17.6.1 / §17.6.2 / §17.6.10 — THE VALUE-FORM SUGAR: ONE PREDICATE, TWO SHAPE RULES, AND AN AMENDMENT THAT BROKE A SHIPPING EMIT WITHOUT TOUCHING CODE (NEW section, S395, #802/#815)

**THE SURFACE.** §17.6 makes an `if` an EXPRESSION when it is the RHS of a `const`/`let` (§17.6.1's
`if-binding ::= ('const'|'let') identifier '=' if-as-expr`) or a self-contained operand. An arm body
produces its value in exactly **two** ways, and `SPEC.md:11888` says so normatively:

> *"An if-as-expression arm body SHALL produce its result value via a `lift` statement, **or** by
> being exactly one expression, which is sugar for `lift` of that expression (§17.6.10). These are
> the only two ways an arm body produces a value."*

**#802 (`79bd992b`) IS THE ONLY COMMIT THAT TOUCHED `SPEC.md` IN THIS 25-COMMIT WINDOW** (+108
lines, ZERO new §34 rows). It added the `arm-body ::= '{' expression '}'` alternative to the §17.6.1
grammar (`SPEC.md:11851`), rewrote §17.6.2 item 3 (`:11874`), and added a whole new subsection
**§17.6.10 "Value-Form Control Flow in a Markup Interpolation" (`SPEC.md:12143`)** naming the shape
normatively for both the `if` and `match` limbs, with the trailing `else` OPTIONAL and a missing
`else` contributing `not` (§17.6.4) — the compiler SHALL NOT warn about it.

⚑ **THE AMENDMENT MADE A SHIPPING EMIT NON-CONFORMING WITHOUT TOUCHING ONE LINE OF COMPILER CODE,
AND THAT IS THE INSTRUCTIVE PART.** Under the PRE-amendment §17.6.2 a lift-less arm contributed
`not`, and `null` **is** `not` (§42) — so the bound-position `null` was **CONFORMING** until the SPEC
edit landed. **This is the over-claiming-row shape in mirror image:** normally a §34 row promises
behaviour the code does not have; here an amendment retroactively converted correct output into a
HIGH defect. ⚠ **And the only diagnostic that could have surfaced it was normatively RETIRED in the
same edit** — `SPEC.md:11893` states an exactly-one-expression arm SHALL NOT surface `W-LIFT-001`, a
code with **zero** fire sites in `compiler/src/` against a live §34 catalog row.

**WHAT #815 (`908a631c`) ACTUALLY DID — `emit-logic.ts` ONLY, +116/-17, and it is a REDIRECT.**
`_emitValueFormSugarArm(body, tildeVar, bodyOpts)` (`emit-logic.ts:4438`) returns a single
`  <tildeVar> = <rhs>;` line for a sugar arm and `null` otherwise, so explicit-`lift`, statement and
multi-statement arms are byte-unchanged. `tildeVar` threads through `emitIfExprAltChain` (`:4462`),
called on BOTH limbs — nested `else if` consequent (`:4477`) and terminal `else` (`:4502`) — and
`emitIfExprDecl` (`:4525`) calls it on the `then` arm (`:4546`). Before it, a sugar arm fell through
to the shared `bare-expr` handler, which under an active `tildeContext` mints a FRESH
`let _scrml_tilde_N = <expr>;` **and rebinds `tildeContext.var` to it** — so the arm wrote a
block-scoped temp, the result var stayed at its `let … = null` seed, and **the binding was always
`null`, at exit 0, with zero diagnostics.**

⚑ **ONE LEAF PREDICATE, TWO SHAPE RULES — AND CONFLATING THEM WOULD BE A WIDENING (invariant 83).**
Two redirects now sit on the same leaf and that is correct:

| | §18.5 match block-arm bare tail | §17.6.2 value-form sugar arm |
|---|---|---|
| **shared** | `_blockTailIsValueExpr` (`emit-logic.ts:4871`, exported) — *"is this bare-expr a value at all?"* | same function, same call |
| **consumed at** | `emit-control-flow.ts:2479` (structuredBody path) · `emit-logic.ts:4938`/`:5100` (raw-string twin) | `emit-logic.ts:4449` |
| **SHAPE rule — NOT shared** | result is the **LAST** expression: a tail after N statements. *Positional.* | the arm is **EXACTLY ONE** expression (`arm-body ::= '{' expression '}'`, `SPEC.md:11851`): `body.length !== 1 -> decline`. *Local.* |

Routing the sugar arm through §18.5's tail rule would silently admit `{ doWork()  "pos" }` as a
value-form — **a shape the grammar does not define.** The markup-interpolation twin
`_soleBareExprValue` (`emit-control-flow.ts:2699`) uses the SAME `length !== 1` test, so all three
positions agree. **The general rule: when two constructs converge, converge on the LEAF QUESTION,
never on the ENCLOSING SHAPE** (invariant 75, second measured instance).

⚠ **A DERIVED CELL IS AN UNSPECIFIED SHAPE THAT FAILS LOUD, AND THAT IS THE SAFE DIRECTION
(invariant 85).** §17.6.3 (`SPEC.md:11898`) names the binding site as a `const`/`let` **declaration**
and nothing else. `const <label> = if (…) { … }` — a derived STATE cell — fails with
`E-CODEGEN-INVALID-LOGIC` in **both** the sugar form and the explicit-`lift` form. ⚑ **The #815 gap
entry as originally filed said "the explicit-`lift` twin is the control and is correct"; that holds
for a LOCAL binding ONLY**, and anyone building against that sentence in a derived cell would have
been working from a false control. **The asymmetry is real: `const <label> = match @level { … }` in a
derived cell DOES work and ships as a conformance case.** Making the `if` form work is a WIDENING of
§17.6.3 and is the operator's, not a defect fix.

⛑ **VERIFIED BY EXECUTION AT THIS WATERMARK, TWO-SIDED, NOT RELAYED.** Compiled on merged `main`: `<label> = if (@x > 0) { "pos" } else { "neg" }` (sugar form) -> **`E-CODEGEN-INVALID-LOGIC`**; the explicit-`lift` twin `<label> = if (@x > 0) { lift "pos" } else { lift "neg" }` -> **`E-CODEGEN-INVALID-LOGIC` as well**, so BOTH forms fail and the gap entry's "the explicit-`lift` twin is the control and is correct" is confirmed false at this position. The LOCAL binding is the control and it is clean: `${ const label = if (@x > 0) { "pos" } else { "neg" } … }` compiles at exit 0 and emits `let _scrml_tilde_2 = null;` then `_scrml_tilde_2 = "pos"` / `_scrml_tilde_2 = "neg"` — **arm-local `let _scrml_tilde_N = "…"` shadow count is 0**, which is #815 working. ⚠ **THE `match` HALF IS RELAYED, NOT VERIFIED HERE.** The claim that `<label> = match @level { … }` DOES work in a derived cell comes from the gap entry; this pass's reproducer used an `asIs`-typed subject and was refused by `E-TYPE-025` before reaching codegen, so it answered a different question. **Treat the `match` asymmetry as RELAYED-UNVERIFIED until someone compiles it with a properly typed subject.** The `if` half above is executed.

⚑ **BLAST RADIUS, MEASURED — and the zero is EXPLAINED rather than assumed.** #815's corpus emit
differential was **2 of 7,408**, both of them the new conformance cases, **zero** pre-existing corpus
files. A census found exactly **5** bound-position sites in the whole corpus, all in
`samples/compilation-tests/gauntlet-s19-phase2-control-flow/`, and **all 5 write the explicit `lift`
form** — so nothing could have moved. `ctrl-023` / `ctrl-024` FAIL on base and PASS on head.
⚠ **Corpus-zero here is blast radius, NOT demand evidence** (the standing reverse-ouroboros caution):
the corpus is 100% LLM-authored, so its avoidance of the sugar form is an artefact of who wrote it.


## Business Invariants (language axioms, not app rules)

- **`if=` on a scrml-defined structural element is admitted on exactly THREE (`<engine>`/`<match>`/`<each>`) and SHALL NOT be generalized to the registry (§17.1.2).**
- **`if=` gates RENDER, never LIFECYCLE (§17.1.2.1)** — a gated `<engine>`'s cell, `rule=`, `effect=` and timers stay live; only the rendering is withheld. The alternative reading is state-destroying and breaks the §51.0.A singleton invariant.
- **A structural `if=` inside an `<each>` row template fails OPEN (§17.1.2.3)** — carved out explicitly because markup fails CLOSED in the same position and the two are therefore inconsistent in the dangerous direction.
- **One `if=` lowering serves all four hosts** — the second (display-toggle) lowering was deleted at #289 because a purity test chose between *removes* and *hides* silently.
- **A soft navigation SHALL NOT mount or destroy any SCOPE (§6.7.2).** Lifecycle edges come from exactly three events: document load/unload, an `if=` transition, and a COMMITTED soft navigation. An aborted or superseded navigation emits NO edge at all.
- **The `<outlet>` region is NOT a scope — it is a route region identified by `(route, params)` (§6.7.2.1).** Scopes are positional and memoryless; the region has identity, which is what makes `keep-alive` expressible without an exception to a SHALL.
- **A body associated with a route region runs on EVERY route-enter INCLUDING THE FIRST — never zero times, never twice — and its `cleanup()` runs on the matching route-leave, LIFO, against still-attached DOM (§20.8.8).**
- **A failable function's error type SHALL be an ENUM (§19.4.4.1)** — because only a variant can carry `renders`, and without `renders` the function sits silently outside the `<errorBoundary>` display guarantee that `E-ERROR-005` enforces.
- **`<machine>` does not compile (§63.7).** `E-DEPRECATED-001`, Error. It still PARSES so the report is one diagnostic rather than a cascade; the two subsystems it fronted (§51.11 audit, §51.13 property tests) were PORTED onto `<engine>`, not retired.
- **A NEW or TOUCHED §34 catalog row SHALL state where it fires, or honestly declare that it does not (§34.0)** — a catalogued code that cannot fire is a false claim inside the §62.2 versioned contract. Diff-scoped by construction; never retrofitted as a hard gate over the legacy corpus.
- `null`/`undefined` do not exist in scrml source, in ANY position (§42). Absence is `not`.
- **A server-only stdlib module never reaches the client bundle (§12.2 Trigger 3, S299)** — enforced by REFERENCE at any depth, fail-closed; the escalation set is separate from the async-classification set precisely because the two have opposite safe-error directions.
- **Within one FileAST after component expansion, every `node.id` is unique (S299).** Codegen derives emitted identity from it; a collision is a green compile with wrong rendered output.
- Specificity is deleted under §65: an unconditional same-property overlap on a provably-shared element is a COMPILE ERROR (E-STYLE-CONFLICT), never a silent cascade pick.
- A protected DB column can never reach the client bundle — fail-closed, acorn-exact (E-CG-001, §14.8.9).
- A row of tenant A never reaches a request whose ambient tenant is B (§14.8.10) — a FLOOR (isolation invariant only), not a policy engine; the ambient tenant is CONSUMED from `session`, never derived by the compiler.
- **A `db-authoritative` table's tenant-isolation invariant holds against ANY connection, not just scrml's own egress sink (§14.8.11) — but the bounded `scrml_app` role is MANDATORY, because a superuser/owner BYPASSES `FORCE ROW LEVEL SECURITY` (a silent no-op trap without it).**
- **The security DDL an app declares is applied by a DIFFERENT, more-privileged principal than the app runtime, out-of-process, NEVER auto-apply-on-boot (§14.8.11.1) — a role that could install its own RLS policy could also drop it.**
- **A Postgres column-level REVOKE cannot narrow a table-level GRANT — an EFFECTIVELY-immutable column (author-marked, OR the table's PK, OR `tenant_id` — auto-immutable as of S288) requires the WHOLE grant to be re-shaped, never a partial per-column subtraction (§14.8.11.2 S3).**
- **A SECURITY-DEFINER function missing `SET search_path` is a privilege-escalation HOLE (CVE-2020-25695 class), not merely unenforced — the pin is a mandatory codegen invariant, not a nicety (§14.8.11.2 S4).**
- An auth-scoped UNSCOPED cell is never SSR-seeded into the anonymous-reachable compose route (§52.15.5) — auto-omitted + Info-lint, never a hard error and never a silent leak.
- Server/client execution boundary is INFERRED from usage (import/API surface, or `session` reference), never author-annotated.
- Match/enum coverage must be exhaustive at compile time (§18) — no runtime default-arm fallthrough. **Known residual:** a no-`for=` block-form `<match on=@cell>` currently skips this exhaustiveness check entirely (open gap, see the §14.8.11-adjacent match note above — NOT a §14.8.11 concept, cross-referenced here only because it's a live exhaustiveness hole).
- `async`/`await` are not scrml keywords (§19.9.8/§13.1) — async is an inferred/desugared codegen concern.
- Auth tokens (magic-link/verify/reset) are single-use (get-then-delete) and namespace-scoped per purpose — a reset token cannot replay as a magic link.
- A shell SHALL contain at most one `<outlet>` (§20.8) — no nested/multiple outlets in V1.
- **A composed document SHALL carry at most one `<main>` landmark, and the route slot is identified by the `data-scrml-outlet` attribute NAME, never by tag (§20.8.1.1).**
- **A `<main>` arriving through COMPONENT EXPANSION is content-owned, never a competing shell landmark (§20.8.1.1).** The SYM pass provably cannot see it; the emitter can, and decides there.
- **One predicate decides "is this element a `<main>` landmark" for the whole compiler** (`src/landmark-tag.ts`, §20.8.1.1).
- **A nested `<program>` inherits NOTHING from its parent — including route scope (§4.12.1).**
- **A diagnostic whose rule SPEC states as a property of a DECLARATION fires at the declaration, not at a use site (§6.2 Shape 2, `E-CELL-RENDER-SPEC-NOT-BINDABLE`).**
- **scrml admits neither `<style>` nor `<script>` as elements (§4.17).** Both are rejected at the block-splitter with a scan-past-close recovery; CSS lives in `#{...}`, scrml logic in `${...}`, genuine foreign JS in `_{...}` (§23).
- A `serve=` headless tool target has NO cookie-session auth surface — fail-closed rejected, not silently unguarded (§64.9).
- An unresolved server-only `scrml:*` re-export's async classification defaults to async (fail-closed), never sync.
- A `@`-sigil is required at a CSS value use site to reference a `<theme>` token or a reactive cell (§65.3.2/§25).
- Cache immutability for a build artifact is decided by EXACT set membership in the compiler's own content-addressed output (§47.9.8).
- Each physical DOM surface has at most ONE wholesale reactive writer (§5.5.3/§5.5.4, Axiom ①).
- `session` is reachable ONLY from a server-escalated function body (§20.5) — a client-side/top-level `session` reference is E-SCOPE-012.
- `session.set("csrfToken", …)` is a reserved-key write and is rejected at compile time when literal (§20.5.1).
- LIVE-vs-INERT identity for a `?{}` `${}` interpolation is decided by ONE shared lexer (§52.15.5, `codegen/sql-lex.ts`).

- **A `fn`/`function` body admits exactly ONE shape, `{ … }` — the `=`-expression shorthand SHALL be rejected (§48.2, `E-FN-EQUALS-BODY`).** Sibling of the `=>`-arrow reject `E-FN-ARROW-BODY`. Pre-reject, the shape silently miscompiled a `match`-tail body to a degenerate function returning `undefined`.
- **`<page>` admits a FIFTH per-route attribute, `keep-alive` (§4.15/§20.8.4)** — but only the authoring surface is wired; there is no runtime cache or invalidation yet. `<page keep-alive>` is a follow-on to reading the server-load payload directly, never an alternative to it.
- **A `<poll>` fires its first tick IMMEDIATELY on arming; a `<timer>` does not (§6.7.5/§6.7.6)** — the deliberate asymmetry (freshness vs periodicity), gated once-per-arming, not once-per-resume.
- **A per-row `if=` on a NESTED (non-item-root) element inside `<each>` is a CREATE-TIME append gate, NOT reactive on a same-key reconcile (§17.1)** — only the row's sole item-root `if=` reactively swaps. The compiler WARNS (`W-IF-IN-EACH`) when the condition references the item; the reactive fix itself remains open, routed to bryan.
- **A top-level `@name = expr` REASSIGNMENT of a structurally-declared (`<name>`) cell SHALL NOT re-register the cell's reset init-thunk (§6.8)** — `_scrml_init_fns` is last-write-wins, so a naive re-registration inverts `reset()`. An IMPLICIT `@`-declared cell (no `<name>`) still keeps its thunk on write, by necessity (SSE/channel binds must re-establish on reset).

## Domain Events (compiler-pipeline analogs)
`RowChange` — synthesized per §38.13 watched-table row mutation (INSERT/UPDATE/DELETE), dispatched client-side via the `__change` frame to `<onchange>` handlers.
Engine variant transition — an `<engine>` cell's `rule=`-governed state change, optionally observed via `<onTransition>`/`<onTimeout>`/`<onIdle>`.
Soft navigation — a route swap into the `[data-scrml-outlet]` region (fetch → swap → hydrate → transition), NOT a shell re-boot (§20.8.2).
**`route-leave` / `route-enter`** — the two REGION lifecycle edges (§20.8.8, ratified S313). Emitted only for a COMMITTED navigation; `route-leave` between Fetch and Swap against attached DOM, `route-enter` between Hydrate/Adopt and Transition. Spec-ahead: the compiler wiring lands with the impl.
Engine transition AUDIT entry — `_scrml_engine_audit_push(varName, from, to)` appends a frozen `{from, to, at, rule, label}` record to the engine's `audit` cell on every COMMITTED transition (§51.11.4, ported onto `<engine>` at S307).
Shell composition — a BUILD-time (not runtime) event: each `pages/*.scrml` route body is spliced into the shell's slot (§40.8.2).
Theme-switch reflection — a `<theme for=@cell>` binding re-runs a `_scrml_effect` on every `@cell` change (§65.6).
Diagnostic emission — every pipeline stage emits `{code, message, severity, span}` records partitioned into `result.errors`/`result.warnings` (see error.map.md).
**DB-authoritative migration apply — a DEPLOY-time (not build-time, not runtime) event: `scrml db-migrate` reconciles a project's `<schema>` (incl. the M1/P2 security DDL) against a live Postgres, recording object-authorship in the `_scrml_migrations` ledger (§14.8.11.1).**

## Aggregates (structural elements that own a bounded body)
`<engine>` in compiler/src/ast-builder.js — owns its variant-graph rules + state-child bodies (EngineDeclNode.bodyChildren).
`<channel>` in compiler/src/ast-builder.js — owns its watches= table binding + message/broadcast handlers (ChannelDeclNode).
`<theme>` in compiler/src/theme-body-parser.ts — owns its named-token bindings + `.Variant`/`@media` re-bind blocks (§65.6); its emission is owned by `compiler/src/codegen/emit-theme-reset.ts`.
`<schema>` — owns its table/column DDL surface (§39), consumed by protect-analyzer.ts for the §14.8.9 protect-floor, by codegen/tenant-egress.ts for the §14.8.10 tenant floor (a `tenant_id` column IS the tenant declaration), and by schema-differ.js's `parseSchemaBlock`/`generateDbAuthoritativeDDL`/`generateSecdefDDL` for the §14.8.11 DB-authoritative tier (a `db-authoritative` bareword after `}` IS the opt-in; a co-located `fn … security definer …` block IS the writes-authority mutation choke).
`<outlet>` — owns the swappable route-content region inside a `<program>` shell (§20.8.1). **NOT a dedicated AST node** — a `kind: "markup"` node with `tag: "outlet"`; the emitted region is identified downstream by the `data-scrml-outlet` ATTRIBUTE, not by tag.
A returned function-expression closure (`return function name(){…}`, GITI-038) — owns its own body's scope/type/async analysis independent of its enclosing factory (`ReturnStmtNode.fnExprNode`, see schema.map.md).

## Tags
#scrml #map #domain #asis-unknown-split #stdlib-client-registry #value-form-if #default-logic-lift #section-40-8 #silent-wrong #match-object-arm #reset-thenable #trigger-3 #escalation-server-only #two-set-distinction #confidentiality-boundary #node-identity #node-id-freshness #component-expander #language-primitives #css65 #theme #realtime #channel-watches #auth #baas #reactivity #engine #not-absence #e-style-conflict #outlet #soft-nav #server-shape #tool-serve #link-boost #css-wave1 #theme-token #content-hash #colorless-async #giti-037 #giti-038 #writer-ownership #session-establishment #position-invariant-await #one-landmark #shell-composition #e-outlet-and-main #tenant-floor #ssr-auto-make-safe #sql-lex #confidentiality-axes #landmark-tag #component-expansion #total-walk #nested-program-isolation #e-script-001 #decl-scoped-diagnostics #dbauth #db-authoritative #rls #secdef #immutable-column #privilege-separation #db-migrate #trust-boundary-reversal #half-rls-honesty-bar #auto-immutable #is-effectively-immutable #session-principal-wiring #e-match-invalid-arm #ghost-pattern #w-dead-function #resolved-gaps #tenant-context-union #dist-space #source-space #coordinate-space #d4 #pages-prefix-strip #forward-index #w-server-import-unemitted #oracle-blind-spot #runtime-chunks #detect-runtime-chunks #post-emit-chunk-gates #chunk-dependencies #gh234 #navigate-wave1c #cross-chunk-nav #w-nav-chunk-load-failed #chunk-loading-depth-counter #boot-dispatch #last-nav-wins #structural-if #§17.1.2 #render-not-lifecycle #fenced-widening #each-row-template-fails-open #fail-open-vs-fail-closed #e-if-in-dispatched-arm #one-if-lowering #emit-if-mount-gate #emit-gated-structural #is-gateable-if-value #if-cond #live-span-unmount #scrml-if-range #remount-each-fence #mount-contract-widening #w-attr-001-false-on-auth #route-region #§6.7.2.1 #§20.8.8 #pole-c #third-lifecycle-owner #route-leave #route-enter #commit-gate #keep-alive #outlet-resident #region-cleanups #module-init #rehydrator-boundary #machine-retired #e-deprecated-001 #§63.7 #projection-codemod #engine-audit #§51.11 #§51.13 #property-tests #enum-only #§19.4.4.1 #e-error-011 #renders-clause #e-error-005 #corpus-first-migration #provenance-field #§34.0 #named-codes-land-with-impl #§6.7.1a #bare-expression-category #sugar-equivalence #mount-body-expr-node #e-fn-equals-body #e-fn-arrow-body #fn-decl-parse-sites #export-reparse-swallow #keep-alive #§4.15 #§20.8.4 #§40.8 #page-fifth-attribute #w-route-request-duplicates-server-load #follow-on-not-alternative #timer-poll-first-tick #§6.7.5 #§6.7.6 #immediate-poll-tick #crossmodule-async-markup #s239-catch #pr-405-landed #cps-choke-point-landed #w-if-in-each #each-nested-if-not-reactive #reset-init-thunk-reassignment #§13.2-call-site-await #async-name-provider #decision-sites-3-to-1 #one-provider-three-consumers #u1 #dpa-020 #dpa-023 #can-suppress-never-strand #owning-file-filter #decide-off-emitted-output #auto-await-family-not-closed #142-bare-sites #option-c-ruled-not-built #dangling-ref-class #session-proxy-bind #gh357 #csrf-token-disclosure #§20.5 #§52.15.1 #currentuser-resolver-gate #channel-auth-only #permissive-by-design #collect-structural-decl-names #§6.8 #g-implicit-cell-double-write-clobbers-reset-init #§12.5 #response-contract #one-exit #instanceof-response-passthrough #redact-before-serialize #fail-open-403-to-200 #bun-welcome-page #stderr-only-for-undefined #session-cookie-wrap #spec-silent-shall #derived-not-stated #region-fence #two-region-classes #lexical-vs-structural #change-the-input-not-the-pattern #join-around-runtime-slot #classify-brace-group #object-shorthand-expansion #binding-pattern-half-repair #proto-shorthand-b31 #engine-dependent #register-fn-name #identifier-shape-guard #zero-width-alternation #object-hasown #prototype-chain-read-closed #§6.6.19 #e-derived-server-only-reach #refuse-not-escalate #per-function-scope #§12.4 #non-function-positions #derived-rhs #scan-for-server-only-binding-refs #one-scanner-two-callers #kind-tool-carve-out #shortest-edit-restores-the-leak #§18.5-four-routes #plan-block-arm-lift-is-not-the-segmenter #leaf-predicate-not-single-classifier #separator-dependent #closes-block-statement #whitelist-not-blacklist #brace-continuation #per-arm-declarednames #re-dispatch-not-hand-copied-opts #emit-for-stmt-with-tilde #e-sql-006-compile-time #narrow-sink-wiring #request-ref-escape-hatch #reparse-request-ref #two-siblings-open #silent-vs-loud #each-arm-reparse #throwaway-id-range #nodetypes-memo-clobber #real-filepath-not-suffixed #spec-ahead-vs-shipped #ratified-is-not-implemented #§6.7.5 #§6.7.6 #§6.7.8 #deferred-lifecycle-body-tags #request-and-channel-excluded-deliberately #predicate-is-own-step5-emitter #poll-immediate-first-tick #split-locus-gate-and-fire #never-refired-on-resume #timeout-false-fire #hand-maintained-vs-derived-list #§6.7.7 #request-ref-attr-class-closed #three-prs-three-node-shapes #escape-hatch-node #should-skip-expr-parse #gated-to-registered-ids #positive-membership-test #silent-miscompile-vs-fail-loud #§17.7.3 #each-body-scope #e-each-body-decl-unsupported #fail-closed-not-silent-drop #rejects-a-form-not-the-feature #§52.8 #i-ssr-each-client-rendered #fallback-descriptor-not-null #surfaces-not-changes #performance-decline-not-confidentiality #do-not-confuse-with-i-ssr-auth-scoped #structural-walk-not-field-listed #skip-derived-walk-key #deny-list-not-load-bearing #descend-one-field-too-many #second-instance-of-the-class #do-not-add-the-field-name #depth-cap-512 #identity-seen-set #carve-out-applied-by-the-caller #object-keys-is-insertion-order #exported-for-testability #six-leaking-positions #40.3-request-onion #app-scope-not-per-route #e-mw-007 #precedence-off-source-not-filename #cors-preflight-stage-1 #ratelimit-per-route #38-transitions-to-stylesheet #headers-strict-binds-compiler-emissions #csp-default-src-self #ssr-seed-application-json #soft-nav-never-loads-target-stylesheet #app-wide-union #21.5-matched-pair-strip #trailing-newline-hid-it #library-mode-match-lowering #endpoint-400 #noarg-server-fn-empty-body #is-standard-html-render-element #asis-split-NOT-on-main #section-55 #synth-surface #collapse-matrix #ruling-gated #rollup-map-truthiness #declaration-form-premise #section-17-1-2-3 #fail-open #show-cond-absent #structural-if-row-template #spec-stale-table #e-state-block-statement-form #state-block-body-is-markup #§4-18-1 #§40-8-default-logic #schema-body-is-ddl #type-state-is-not-semantic #show-in-each-reactive #if-in-each-frozen #§16-6-snippet-arity #parse-snippet-body-nodes #render-bearing-live-fallback #glued-interp-lift-reconcile #s380-incremental #§16-6-1 #ast-scoped-snippet-substitution #g-string-prop-in-is-some #g-snippet-prop-in-is-some-guard #g-parametric-snippet-param-substitution #§51-3 #derived-cell-scrutinee #g-match-on-derived-cell-scrutinee-frozen #g-match-per-item-in-each-frozen #match-same-value-short-circuit #resolveonexpr #collectderivedvarnames

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [schema.map.md](./schema.map.md)
- [error.map.md](./error.map.md)
- [auth.map.md](./auth.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [structure.map.md](./structure.map.md)
- [migrations.map.md](./migrations.map.md)
