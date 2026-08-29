# error.map.md
# project: scrml
# updated: 2026-08-27T17:17:26-06:00  commit: 0dd659a1
# generated-at: 0dd659a1 (S380 window, INCREMENTAL_UPDATE by the project-mapper — scoped to the
# codegen surface S380 touched: emit-each.ts, emit-match.ts, emit-server.ts, emit-variant-guard.ts,
# build.js, dev.js, component-expander.ts; NOT a full re-walk). `git merge-base --is-ancestor
# 48f0aaf8 0dd659a1` exits 0; HEAD == origin/main == 0dd659a1.
#
# ⛑ **POST-WRITE RE-CHECK: the wrap landed mid-pass and `origin/main` advanced `ff4b37e5` -> `9f75061c`
# (`wrap(s383)`, #753). `git diff --stat ff4b37e5..9f75061c -- compiler/` is EMPTY — the wrap is
# docs-only — so the SOURCE STATE READ IS `ff4b37e5` and every anchor below holds byte-identically at
# `9f75061c`. Named here rather than re-stamping, for the same reason lines 3–4 were not moved.**
# ━━━ ⛑ S383/S384 SCOPED INCREMENTAL — THE WHOLE-SET STAMP ON LINES 3–4 IS **DELIBERATELY NOT MOVED** ━━━
#
# Nine compiler-source files were re-verified against `origin/main` == HEAD == **`ff4b37e5`**
# (`git merge-base --is-ancestor 0dd659a1 ff4b37e5` exits 0). The rest of this map was NOT re-walked,
# so lines 3–4 stay at `0dd659a1` — the S382 pattern. Bumping a whole-set stamp on a partial pass
# falsely claims the whole file was re-verified. Corrections below carry a `⛑ S383` / `⛑ S384` marker.
#
# **§34 CATALOG IS FLAT AT 813 — ZERO codes in, ZERO out.** `compiler/SPEC.md` DID move this window
# (+9/-2) but every insertion is PROSE: the §34 `E-CONTROL-FLOW-IN-MARKUP` row (`:19823`), the §17.4
# paragraph (`:11765`) and a NEW §40.8 bullet (`:23063`). `grep -c '^| E-' compiler/SPEC.md` returns
# **916**, unchanged. S383/S384's five landed source fixes are a span `col` correction, a comment-only
# banner, a module extraction and two SILENT-WRONG-OUTPUT codegen fixes — none allocates a code.
#
# ⛑ **THE ONE CLAIM IN THIS FILE THAT WENT STALE THIS WINDOW IS THE `E-CONTROL-FLOW-IN-MARKUP`
# DOC-CONTRADICTION FINDING — see the corrected block below. The §34 row no longer contradicts
# behaviour; the BEHAVIOUR hole it exposed is still open, PA-RE-REPRODUCED at `ff4b37e5` by
# compiling** (`<program>` + `if (1) { }` → exit 0, and the emitted `<body>` literally contains
# `if (1) { }` on its own line, read from `dist/*.html` this pass).
#
# **§34 catalog is UNCHANGED at 813 — `compiler/SPEC.md` has ZERO diff over this window**
# (`git diff --stat 48f0aaf8..0dd659a1 -- compiler/SPEC.md` is empty). S380's six landed fixes
# (#726, #728, #731, #732, #733, #735) are all SILENT-WRONG-OUTPUT corrections (a `<match>` arm
# frozen on a derived-cell scrutinee or a same-key reconcile field change, a snippet param
# substituted textually instead of structurally, a string-literal prop mis-lowered, an unprotected
# auth-required document) — NONE allocates a new diagnostic code or changes an emit-site COUNT.
#
# **TWO pre-existing (NOT S380-caused) stale `file:line` citations found and corrected while
# verifying this window's `emit-each.ts`/`emit-lift.js` diffs did not touch them:**
# `W-EACH-PERITEM-IF-MULTIROOT-DEFERRED` was cited `emit-each.ts:1143`, actually `:1286`;
# `emit-lift.js`'s two `W-LIFT-TIER0-*` deferred-lowering tokens were cited `:1448`/`:1450`, actually
# `:1484`/`:1486`. Both sit BEFORE S380's insertion points in their files, so the drift predates this
# window — undetected by whichever pass last touched these lines. See non-compliance findings.
#
# **Not otherwise re-walked this pass** — the §34 census, catalog-vs-impl facts, and every other
# section carry from the prior (fc6df72e) watermark unchanged and unverified beyond the two spot-
# checks above.
#
# generated-at: fc6df72e — **THE SAME SHA AS LINE 3, BY CONSTRUCTION.** Working tip at write time
# `60803548` on `wrap/s376`; `git diff --name-only fc6df72e..60803548` is FOUR DOCS FILES and ZERO
# source, so the source state read IS `fc6df72e`, which is `merge-base HEAD origin/main` and IS
# `origin/main`. Line 3 and line 4 carry one SHA on purpose (S372 shipped a self-contradicting pair).
# **INCREMENTAL over `8b2e4053` -> `fc6df72e` (S376, 8 commits, PRs #709-#718).** Ancestry CHECKED
# (invariant 48); outbound MAP-STAMP check run at WRITE time.
#
# ═══ ONE NEW DIAGNOSTIC CODE, AND IT IS THE FIRST `E-` PASS TO RUN PRE-AST ═══
#
# **`E-STATE-BLOCK-STATEMENT-FORM` (Error, #718, S375 ruling 1 / S376 code-name decision).** Catalog
# **812 -> 813**. Census RE-EXECUTED at this watermark, not carried:
#
#     813 rows (§34 19352..20236, derived) · 1963 source files · 883 conformance cases
#     STRUCK 34 · PINNED 343 · IMPL-SITES 303 · DECLARED-AHEAD 18 · RUNTIME-SURFACED 3 · FALSE-CLAIM 112
#     dispositions: BUILD-ARC 71 · HOME-NO-SHALL 27 · NOMINAL-HOME 10 · ORPHAN-INDEX 4
#
# **The +1 lands in IMPL-SITES (302 -> 303), not PINNED, and that is a FACT not an inference:**
# `grep -rl E-STATE-BLOCK-STATEMENT-FORM conformance/` returns NOTHING at this watermark — the code
# has a live emitter and a 476-line unit suite (`compiler/tests/unit/state-block-statement-form.test.js`)
# but **no conformance case asserts it in `expect.codes`**, which is what PINNED measures. Every
# other bucket is flat. ⚠ `filesScanned` moved 1958 -> 1963 and is STILL not a repo fact — it walks
# ten roots on disk and counts gitignored build output. Do not publish it.
#
# **PA-VERIFIED BY EXECUTION, not by reading the module:** compiling
# `docs/changes/db-state-block-locus-2026-08-25/repro.scrml` at this watermark prints
# `error [E-STATE-BLOCK-STATEMENT-FORM]` at `repro.scrml:6:3` with `stage: BS-LINT` and
# `FAILED — 1 error`. Its own section below.
#
# ⚑ ═══ AND A CENSUS TABLE INSIDE THIS FILE WAS WRONG — AGAINST ITS OWN WATERMARK, AND AGAINST
# ANOTHER TABLE IN THIS SAME FILE ═══
#
# The section "**Census buckets at this HEAD**" carried `PINNED 338 · IMPL-SITES 320 ·
# DECLARED-AHEAD 14 · FALSE-CLAIM 95`. Those are **S346 figures**, three windows stale, and the
# catalog section ~35 lines ABOVE it in the same file printed `PINNED 343 · IMPL-SITES 302 ·
# FALSE-CLAIM 112` for the same HEAD. **One file, two bucket tables, both labelled current,
# disagreeing by 17 on FALSE-CLAIM.** A reader who scrolled to the section whose heading says "at
# this HEAD" got the wrong one. Corrected below to the re-executed run. **The lesson is the heading:
# "at this HEAD" is a claim that decays silently — a bucket table needs the SHA it was run at
# printed beside it, which the corrected table now carries.**
#
# **CARRIED, still true and STRENGTHENED this window: `W-DEAD-FUNCTION`'s locus is
# `route-inference.ts:5614-5616`, NOT `codegen/usage-analyzer.ts`** (search `W-DEAD-FUNCTION — THE
# LOCUS`). #700 upgraded that from "wrong locus" to **"dead surface"** by reproduce-first: the
# `FeatureUsage` bitmap `analyzeUsage` computes is never read to gate emission. RE-MEASURED here —
# `grep -n featureUsage compiler/src/codegen/index.ts` returns **ZERO hits**. **Fixing anything there
# changes zero emitted bytes.**
#
# **Carried from S368 — CATALOG 810 -> 812 (+2). BUCKETS ESSENTIALLY FLAT.** The S368 -> S371 run
# for comparison (superseded by the re-execution above, which returns identical buckets):
#
#     812 rows (§34 19352..20235) · 1950 source files · 883 conformance cases
#     STRUCK 34 · PINNED 343 · IMPL-SITES 302 · DECLARED-AHEAD 18 · RUNTIME-SURFACED 3 · FALSE-CLAIM 112
#
# vs the S368 run (`810 · STRUCK 34 · PINNED 343 · IMPL-SITES 300 · DECLARED-AHEAD 18 ·
# RUNTIME-SURFACED 3 · FALSE-CLAIM 112`). **IMPL-SITES +2, everything else flat — the +2 is exactly
# the two new codes, both of which shipped WITH a live emitter and neither of which is pinned by a
# conformance case yet.** FALSE-CLAIM dispositions unchanged: `BUILD-ARC 71 · HOME-NO-SHALL 27 ·
# ORPHAN-INDEX 4 · NOMINAL-HOME 10`. **The §34 range MOVED (19113..19994 -> 19352..20235) — derive
# it from headings, never from a baked line number.**
#
# ⚠ **The prior window's warning still stands and is now testable: DO NOT read "FALSE-CLAIM 112" as
# 112 broken diagnostics.** The census's classifier gained a disposition axis at #646; a bucket
# figure from before that is not comparable. Re-run the census on BOTH sides or do not make the claim.
#
# **EXACTLY TWO NEW CODES IN SPEC THIS WINDOW. ZERO removed. And the counting METHOD earned its keep
# AGAIN.** A token-diff of `compiler/SPEC.md` between the watermarks returns THREE
# (`E-STDLIB-CLIENT-CHUNK-MISSING`, `W-TYPE-031-UNPROVEN`, `W-031-UNPROVEN`) and **one is FALSE**:
# `W-031-UNPROVEN` is PROSE SHORTHAND inside the `E-TYPE-031` catalog row (`SPEC.md:19474` — *"031 is
# 'I proved it does not fit', W-031-UNPROVEN is 'I could not prove anything'"*), not a code. It has
# **no catalog row, no fire site and no SPEC-INDEX entry.** The census total agrees with TWO:
# 810 -> 812. **Count a code as new only when `git show <base>:compiler/SPEC.md | grep -c '<CODE>'`
# is 0 AND it owns a §34 row.** `compiler/SPEC.md` **37,298 -> 37,539 lines** (+241).
#
# ─── THE TWO NEW CODES, BOTH GROUNDED, BOTH WITH A GAP WORTH KNOWING ───
#
# **1. `E-STDLIB-CLIENT-CHUNK-MISSING` (§41, ERROR) — #669. The most consequential diagnostic added
# in several windows, because it closes a SILENT DOA class.**
#   · SPEC row: `compiler/SPEC.md:19868`. SPEC-INDEX entry: `SPEC-INDEX.md:214`. Both present.
#   · Fire site: `compiler/src/codegen/emit-client.ts:3946` — the ONLY emit site.
#   · **ERROR, not warning, DELIBERATELY: the compiler can PROVE the artifact is dead.** A client
#     bundle is a classic script, so `import { x } from 'scrml:NAME'` lowers to
#     `const { x } = _scrml_stdlib.NAME;`, and that property is defined by the `stdlib-NAME` entry in
#     `RUNTIME_CHUNK_ORDER` and by NOTHING else. Absent, the destructure reads `undefined` and throws
#     AT LOAD — the whole page dies, not one call. There is no runtime configuration under which it
#     succeeds. Emitting a guaranteed-dead bundle and exiting 0 is the pathology being removed.
#   · ⚠ **IT FIRES AGAINST THE FINAL EMITTED CLIENT TEXT, AFTER `pruneUnusedClientImports`, AND THAT
#     PLACEMENT IS THE LESSON.** Gating at the emit-site `lines.push` — which LOOKS co-located —
#     rejected **21 correct corpus files, MEASURED**, because the prune drops a lowered read no client
#     code references (`examples/23-trucking-dispatch` imports `scrml:store` and uses it only inside a
#     `?{}`-escalated server fn: the read is emitted, then pruned, and the shipped bundle is CORRECT).
#     **The emit site is not the final word when a later stage can delete its output.**
#   · ⚠ **TWO FALSE-POSITIVE ROUNDS, BOTH FIXED BY CHANGING THE SCAN'S *INPUT*, NOT ITS PATTERN
#     (invariant 43).** (a) it matched the runtime's own comment `// const { x } = _scrml_stdlib.NAME;`
#     and invented a module named `NAME` → fixed by excising the runtime span; (b) a plain string
#     literal — `<tip> = "the slot is _scrml_stdlib.wombat"` in valid scrml with ZERO stdlib imports —
#     produced a HARD ERROR naming `scrml:wombat`, a module that has never existed → fixed with
#     `maskStringLiteralSpans` (`emit-client.ts:3907`), the helper both sibling stdlib scans already
#     used and this one was the only of the three to omit. **Measured FP matrix after: string literal
#     (1 name / 2 names / single-quoted) all clean; adopter `//` comment and regex literal were never
#     affected.** So string literals were the ENTIRE live FP surface.
#   · **A SUBMODULE SPECIFIER ALWAYS FIRES, and that is correct:** `scrml:auth/jwt` lowers to
#     `_scrml_stdlib.auth/jwt`, which JS parses as the DIVISION `_scrml_stdlib.auth / jwt` and dies
#     with `ReferenceError: jwt is not defined` even though `_scrml_stdlib.auth` IS defined.
#   · **DISTINCT FROM `W-STDLIB-SHIM-MISSING`, and the distinction is the whole point.** That warning
#     probes `existsSync(compiler/runtime/stdlib/<name>.js)` — "does a shim FILE exist" — which is
#     TRUE for all 21 modules, so **it never fired for this condition while 17 of 21 client stdlib
#     imports were DOA.** The obligation and the probe resolved to different artifacts. The new gate
#     reads `RUNTIME_CHUNK_ORDER` itself via `hasStdlibClientChunk`, i.e. the artifact that DECIDES
#     the outcome, so gate and outcome cannot drift.
#   · **DIRECTION OF CHANGE: NEWLY-REJECTING.** (The dispatch's first wording said "inert at the
#     language level"; a reviewer corrected it and the correction is right — a branch that adds an
#     error can refuse source that previously compiled, and the string-literal FP is proof it could.)
#     Measured migration = **0 files**, which is a BLAST-RADIUS fact, not a classification.
#   · ⚠ **CARRIED GAP — no `lsp/handlers.js` `ERROR_DESCRIPTIONS` entry.** `E-MW-007` got one the
#     window it landed; this one did not.
#
# **2. `W-TYPE-031-UNPROVEN` (§7.5.2, WARNING) — #665, the `asIs`/`unknown` split.**
#   · SPEC row: `compiler/SPEC.md:19475`; normative prose §7.5.2 at `:6302`; the behaviour table at
#     `:6229`. Fire site: `compiler/src/type-system.ts:10600` — the ONLY emit site.
#   · **It reports a gap in the COMPILER, not a defect in the program.** The program compiles and
#     emits exactly as before, no previously-performed check is skipped, and the exit status is
#     unchanged. It fires when a `let`/`const` carries NO annotation and inference could not type the
#     initializer; the message names the AST expression node kind at which inference stopped.
#   · **It and `E-TYPE-031` are COMPLEMENTS, not alternatives** — 031 is "I proved it does not fit",
#     UNPROVEN is "I could not prove anything". Do not treat one as a weaker form of the other.
#   · **Two resolutions, both one edit:** PROVE it (`x: T = …`) or SIGN for it (`x: asIs = …`, silent
#     by design per §14.7). **Does NOT fire** when an annotation is present, for a `?{ … }` SQL
#     initializer (`W-SQL-ROW-UNTYPED` owns that path), or for an admitted `_={ … }=` foreign
#     initializer.
#   · ⚠ **TWO CARRIED GAPS: no `SPEC-INDEX.md` entry, and no `lsp/handlers.js` hover.** `E-TYPE-031`
#     has no SPEC-INDEX entry either, so the index gap is a family-level omission rather than a
#     regression; `ERROR_DESCRIPTIONS` carries 42 `W-*` codes but **zero `W-TYPE-*`**, so the hover
#     gap is likewise family-level. Recorded so nobody re-derives it as new.
#
# **CARRIED: `E-MW-007` (§40.3/§40.8) remains fully grounded** — SPEC `§34` catalog + `§40` family
# table, sole fire site `compiler/src/commands/select-request-onion.js:72`, LSP hover
# `lsp/handlers.js:1127`. Its neighbours carry unchanged: **`E-PROGRAM-002` is DECLARED-AHEAD and
# does NOT fire** (no emit site in `compiler/src/`; the only hit is a COMMENT at
# `select-request-onion.js:41`) — do not write a test asserting it fires; **`E-IMPORT-005` is
# pre-existing and FULLY LIVE** (`module-resolver.js:206`) — do not record it as new.
#
# **CARRIED FINDING C4 — still NINE.** Live `W-LINT-*` codes with no §34 TABLE ROW:
# `W-LINT-016 017 018 019 020 021 022 023 024`, all firing from
# `compiler/src/lint-ghost-patterns.js`. ⚠ **A naive `comm` of "codes in source" vs "codes anywhere
# in SPEC.md" returns TEN and is WRONG in both directions:** it adds `W-LINT-009`, which is not a
# fire site (`lint-ghost-patterns.js:929` is the comment "No separate entry for W-LINT-009 —
# W-LINT-004 subsumes it"), and drops `W-LINT-018`, which appears in SPEC PROSE but has no row.
# **Grep the fire site before counting; a code's presence in a comment is not a fire.**
#
# ⛑ **CORRECTED S383 — THIS BLOCK USED TO READ "A §34 ROW THAT CONTRADICTS MEASURED BEHAVIOUR".
# THE CONTRADICTION IS NOW CLOSED. THE BEHAVIOUR HOLE IS NOT.**
#
# What the prior text asserted (and what is no longer true): that `E-CONTROL-FLOW-IN-MARKUP`'s §34
# row claims the §40.8 auto-lift *"fires only at `<program>`/`<page>`/`<channel>` direct-child roots"*
# so a bare `if (1) { }` there is covered. **The documentation half of ruling 3 LANDED this window.**
# `SPEC.md:19823` (§34 row), `SPEC.md:11765` (§17.4 prose) and a NEW `SPEC.md:23063` (§40.8 bullet)
# now each state in terms that the auto-lift covers **DECLARATIONS ONLY** and that the default-logic
# body-top is covered by **NEITHER** the lift nor this code. The row's **Does NOT fire** list still
# names the default-logic root, but now carries the explicit rider *"NOT because that locus is safe,
# but because this diagnostic does not reach it … Do not read this entry as coverage."*
#
# **THE BEHAVIOUR IS UNCHANGED AND STILL WRONG, PA-RE-REPRODUCED AT `ff4b37e5` BY COMPILING:**
# `<program>` + `if (1) { }` + markup exits **0** with zero diagnostics and the emitted `<body>`
# contains the literal line `if (1) { }` (read from `dist/*.html`, not inferred). The mechanism is
# structural: the emit site (`ast-builder.js:1882-1885`, `TABError` push at `:1906`; ⛑ S383, was
# `:1857-1860`) is gated `parentType === "markup"`, the **COMPLEMENT** of the §40.8 locus.
#
# ⛑ **RULING 3'S ENFORCEMENT ARM IS HELD, NOT LANDED — GREPPED AT `ff4b37e5`, NOT RELAYED.**
# `BARE_CONTROL_FLOW_AT_BODY_TOP_RE`, `findControlFlowStatementEnd`, `_DEFAULT_LOGIC_ROOT_NAMES` and
# an `isStateBlockBody` parameter are at **ZERO occurrences** across `compiler/src/` +
# `compiler/tests/`. `E-CONTROL-FLOW-IN-MARKUP` fires at **exactly one locus** and has exactly one
# emit site. **Any map/doc text implying the §40.8 body-top is diagnosed is WRONG.** The hold is
# structural, not a bug count: the recognizer needs a `{`, so `if (@a) log(1)` (braceless),
# `switch (@a) { }`, a labelled `for` and `do { … } while (@a)` ship raw **at the markup locus too** —
# a permanent hole inside the very class the code exists to close. Grammar-derived arc:
# `docs/changes/ruling3-grammar-derived/PROBLEM-STATEMENT.md`.
#
# ⛑ **A FOURTH HIGH JOINED THIS CLASS THIS WINDOW: `g-default-logic-auto-lift-silently-disabled-by-a-preceding-prose-line`.**
# ONE prose line at a §40.8 body-top silently disables the auto-lift for every declaration below it in
# the same text run — not lifted, not compiled, **not diagnosed**. Reproduced in three shapes; the
# nastiest is the structural form, where the compile fails on the READ with `E-STATE-UNDECLARED`, **so
# the only diagnostic the author gets blames the wrong line and prescribes a declaration that is
# already two lines above.** Distinct from ruling 3 (a declaration not LIFTED vs a statement not
# REFUSED); fixing either does not fix the other. Siblings: `g-default-logic-bare-call-is-unspecified-and-ships-as-page-text`
# (HIGH, open — a RULING, not a fix: §40.8 is SILENT on a bare call) and
# `g-default-logic-comment-flushes-a-run-severing-a-statement-from-its-declaration` (HIGH, open).
#

## HOW TO LOOK UP A DIAGNOSTIC CODE (read this first)

This map is the FIRST stop for any `E-*` / `W-*` / `I-*` lookup, and as of this pass it is
answerable for **every** code family, not only the ones a recent window happened to touch. The
`g-maps-error-map-missing-diagnostics-and-emit-client` gap (filed independently by two lanes at
S295) was exactly this: a lookup for `E-PA-002` or `TAILWIND` routed here and found **zero hits**,
so both loci had to be found by grep. Both families now have rows below.

**MEASURED COVERAGE — re-derived at `e80b692e`; the shape of the finding is unchanged.** The prior
generation of this preamble claimed the table is "keyed by PREFIX, so a code this map does not name
individually is still routed by its family." **That claim is false for most of the catalog and is
withdrawn.** Mechanically re-derived at `e80b692e`: §34 carries **187 distinct code prefixes**
(`E-CG`, `W-AUTH`, `I-TENANT`, …); the family table below names ~**70**. The other ~**117 prefixes
have no row** — among them `W-AUTH-*`, `W-CG-*`, `W-IMPORT-*`, `W-STATE-*`, `E-RI-*`, `E-DG-*`,
`E-PROTECT-*`, `I-AUTH-*`, `I-MATCH-*`. A lookup for one of those falls through to step 2, and the
map should say so instead of implying a hit. `W-AUTH-*` was the live proof: S299 split
`W-AUTH-MIDDLEWARE-AUTO-INJECTED` out of `W-AUTH-001`, and neither code nor its prefix had any row
here — the fire site was found by grep, exactly the failure mode
`g-maps-error-map-missing-diagnostics-and-emit-client` was filed for.

**The reliable procedure, in order:**
0. **`bun scripts/s34-census.ts --full` (NEW, S310) — the MACHINE ORACLE, and it is in-repo and
   current by construction.** It derives §34's range from the headings every run (no baked line
   numbers), scans EVERY source tree quote-agnostically, and classifies every catalogued code into
   **STRUCK / PINNED / IMPL-SITES / DECLARED-AHEAD / RUNTIME-SURFACED / FALSE-CLAIM**. Use it to
   answer "does this code have an emitter at all?" and "is it conformance-pinned?" before you grep.
   **Its authority is asymmetric, by its own statement: the NEGATIVE is reliable** (zero emitter
   mentions anywhere ⇒ it cannot fire today); **a FALSE-CLAIM verdict is a HYPOTHESIS** that still
   owes an execution check. Three traps it encodes that a hand-rolled probe repeats: a retired row is
   `~~CODE~~` and a `^| CODE |` probe returns the same NO-ROW it gives an UNCATALOGUED code (that
   conflation inflated the freeze denominator by 5); a code named in an `expected.json`
   `description`/`rationale` is NOT a pin, only `expect.codes` is; and a RUNTIME-SURFACED code is
   implemented as a runtime enum VALUE with no diagnostic push, so it appears in no emitter while
   being fully built (all three `E-PARSEVARIANT-*` were written up as the sharpest false-claim case
   before the runtime was checked).
0b. **`.claude/maps/error.generated.md`** — the mechanical code -> message -> `file:line` index, 353
   entries. **Three hard limits now:** it is **E-codes ONLY** (zero `W-*`, zero `I-*`, so a warning
   lookup returns nothing and looks like proof the code does not exist); it is stamped **2026-06-25**
   — ~5.5 weeks and **~144 commits** stale at this HEAD, with drifted line numbers; and it is
   regenerated by `flogence/scripts/mapgen.ts`, **an out-of-repo script this project's CI does not
   run, and the only CI leg that ever refreshed these maps was deleted this window.** Treat its FILE
   attribution as reliable and its LINE numbers as a starting point. Prefer step 0.
1. Read the **"Diagnostic families by feature area"** table below and take its `Fire site` column —
   for the 68 prefixes it covers (`E-PA-*` -> protect-analyzer.ts, `*-TAILWIND-*` ->
   tailwind-classes.js, and so on). If your prefix is not in the table, **skip to 2 rather than
   guessing from an adjacent family** — the families are feature-scoped, not name-scoped
   (`W-AUTH-MIDDLEWARE-AUTO-INJECTED` fires from `route-inference.ts`, NOT from the `E-AUTH-*` row's
   `auth-graph.ts`/`type-system.ts`).
2. `grep -rn "<CODE>" compiler/src/` — the fire site is always a `code:` field, a `"<CODE>"` string
   argument, or an interpolated message prefix. **This is the ONLY complete method** and it is two
   seconds; the tables above are a shortcut, not a substitute.
3. For the NORMATIVE definition, grep `compiler/SPEC.md` for the code. §34 is a lookup index only;
   each code's meaning lives in the section that introduces it (cited in §34's Section column).
4. **Before concluding "one code, one meaning", grep for OTHER fire sites.** Two S297/S299 rulings
   (`E-IMPORT-007`, `W-AUTH-001`) were the same defect: one code carrying two unrelated meanings from
   two different files, only one of them documented. `grep -rn` returning fire sites in two unrelated
   modules is the tell.

**Do not** assume a code is unimplemented because §34 lists it — nine live `W-LINT-*` codes have no
§34 row at all (below), and until this window `W-NAV-CHUNK-LOAD-FAILED` was the mirror case (a §34
row now exists AND it fires; the prior "NOT implemented — do not add" note here is RETIRED).

## Diagnostic Catalog (SPEC §34, `compiler/SPEC.md` §34 through §35)

**813 distinct diagnostic codes** cataloged in §34 at `fc6df72e` — **`bun scripts/s34-census.ts` is
the ORACLE and it was RE-EXECUTED this pass**, returning
`813 rows (§34 19352..20236, derived) · 1963 source files · 883 conformance cases`. **+1 this window
(`E-STATE-BLOCK-STATEMENT-FORM`, §38.4/§40.8/§4.18.1, `SPEC.md:19728` — ⛑ S383 +6), zero removed** — and the
catalog row landed in the SAME commit as the emitter, so §34.0 well-formedness is satisfied at
landing. The historical `728bdc92` narrative that followed this paragraph is retained below.

**+2 at `728bdc92`, the prior legs:** **+2 net
(`E-STDLIB-CLIENT-CHUNK-MISSING` §41 — #669, the client stdlib registry gate; `W-TYPE-031-UNPROVEN`
§7.5.2 — #665, the `asIs`/`unknown` split), zero removed.** ⚠ A token-diff of SPEC returns THREE;
**one is a false positive** — `W-031-UNPROVEN` is prose shorthand INSIDE the `E-TYPE-031` row
(`SPEC.md:19474`), with no catalog row, no fire site and no SPEC-INDEX entry. §34's range shifts
release-to-release — derive it from the `## 34. Error Codes` / `## 35.` headings, never a baked line
number (**it moved +239 this window: 19113..19994 -> 19352..20235**).

**BUCKETS ARE FLAT EXCEPT IMPL-SITES, WHICH MOVED BY EXACTLY THE TWO NEW CODES.**

| bucket | S368 (`c96e7012`) | THIS pass (`728bdc92`) | delta |
|---|---|---|---|
| STRUCK | 34 | 34 | flat |
| PINNED | 343 | 343 | flat |
| IMPL-SITES | 300 | **302** | **+2** |
| DECLARED-AHEAD | 18 | 18 | flat |
| RUNTIME-SURFACED | 3 | 3 | flat |
| FALSE-CLAIM | 112 | 112 | flat |

**Both new codes landed WITH a live emitter and NEITHER is pinned by a conformance case**, which is
why the +2 lands in IMPL-SITES rather than PINNED. FALSE-CLAIM dispositions are unchanged
(`BUILD-ARC 71 · HOME-NO-SHALL 27 · ORPHAN-INDEX 4 · NOMINAL-HOME 10`). Source-file denominator
moved 1940 -> 1950.

<!-- Prior-window narrative on the S346->S368 bucket SWING (IMPL-SITES -20 / FALSE-CLAIM +17), which
     was a census RECLASSIFICATION rather than regressions, is retained below because the caution it
     carries still governs any cross-window bucket comparison. -->

**BUCKETS MOVED MUCH FURTHER THAN THE TOTAL, AND THE CAUSE IS THE INSTRUMENT, NOT THE CATALOG.**

| bucket | S346 (`c93a692c`) | S368 (`c96e7012`) | delta |
|---|---|---|---|
| STRUCK | 34 | 34 | flat |
| PINNED | 343 | 343 | flat |
| IMPL-SITES | 320 | **300** | **-20** |
| DECLARED-AHEAD | 14 | **18** | **+4** |
| RUNTIME-SURFACED | 3 | 3 | flat |
| FALSE-CLAIM | 95 | **112** | **+17** |

`scripts/s34-census.ts` gained +143 lines this window (#646, the instrument-integrity sweep) and now
emits a FALSE-CLAIM **disposition** table it did not previously have — `BUILD-ARC 71 · HOME-NO-SHALL
27 · ORPHAN-INDEX 4 · NOMINAL-HOME 10`. **A -20 / +17 swing against a +1 total is a
RECLASSIFICATION.** Rows that landed in IMPL-SITES under the weaker pre-#646 emitter test now land in
FALSE-CLAIM with a disposition naming why. ⚠ **Do NOT diff 112 against 95 as though one instrument
produced both, and do NOT report "112 broken diagnostics".** If you need a real trend, re-run the
census on BOTH sides of your window; otherwise do not make the claim.

**Independent cross-check, run because a single oracle is a single point of failure.** The manual
`awk -F'|'` field-split methodology (below) remains the cross-check, not a fallback. Raw prefix greps
over the whole SPEC are **NOT** the catalog figure and must not be quoted as one: they sweep the
§34.x sub-tables AND later tables outside the §34..§35 bounds, and they count rows rather than unique
codes. **Bound the extraction; do not prefix-grep the file.** ⚠ **The two series diverge** — the
catalog and the `^| E-` row-grep move by different amounts for the same landing, and neither is
derivable from the other.

⚠ **THE CENSUS'S `source files` FIGURE IS NOT A REPO FACT — AND THIS PASS IS THE CLEANEST PROOF YET.**
`filesScanned` (`s34-census.ts`) increments over a FILESYSTEM walk of ten roots, so it counts whatever
gitignored build output the checkout holds. It printed **1858** at S341, **1864** at S346 (in a fresh
worktree), and **1940** here — in the MAIN checkout, which carries build output the worktree did not.
**The `810` and `883` figures ARE index-derivable and were independently reproduced; the file count is
not. Do not use it as a delta signal, and do not publish it.**
any commit. **The `809` and `883` figures ARE index-derivable and were independently reproduced; the
file count is not. Do not use it as a delta signal.**

### Count methodology (re-derivable; do NOT hand-roll it with a bare grep)

Bound the extraction at the `## 34. Error Codes` heading and the `## 35.` heading, split on `|`,
strip `~~`-tombstone markers, and count UNIQUE code strings (not raw rows). The §34.1 native-parser
sub-tables (`E-EXPR-*`, `E-STMT-*`, `E-MARKUP-VALUE-UNCLOSED`, `I-NATIVE-BLOCK-*`) are legitimately
part of the catalog and are included.

- **UNIQUE code strings is the authoritative figure.** The raw-ROW count runs +1 high because §34
  carries TWO rows for `E-MARKUP-003` (two different retired-S263 meanings). Do not carry a
  raw-row baseline forward.
- **A bare `grep -oP '^\|\s*~{0,2}\K[EWI]-\S+'` over the whole `SPEC.md` silently omits at least one
  matching row** (`E-CG-013`) in this environment, though it extracts correctly when that line is
  isolated. Root cause not chased (this map does not need to own a grep-tooling defect) — use the
  `awk` field split.
- `docs/FACTS.md` deliberately does NOT publish this figure: it states the total "is load-bearing
  but not reliably extractable — a scan from the §34 heading over-counts by catching later tables,
  and in a file whose whole purpose is accuracy, a wrong number is worse than an absent one." **This
  map is the reconciled answer.**

### Delta ledger, every leg `comm`-set-diff-verified

| Window | Count | Delta |
|---|---|---|
| `df2ac831..58c8161d` | 779 -> 785 | +7 (`E-ERROR-010`, `E-TENANT-AGG`/`-WRITE`/`-RAW-EGRESS`, `I-TENANT-STRIP`/`-ACROSS`), -1 (`W-SSR-PRERENDER-UNSCOPED` renamed to the I-code) |
| `58c8161d..c48e59a2` | 785 -> 786 | +1 `E-OUTLET-AND-MAIN` |
| `c48e59a2..9481bc69` | 786 -> 787 | +1 `E-SCRIPT-001` |
| `a0344d75..f8a138e9` | 787 -> 793 | +6: `E-DBAUTH-SQLITE`, `E-DBAUTH-NO-TENANT-COLUMN`, `W-DBAUTH-MARKER-NEARMISS`, `W-SCHEMA-DESTRUCTIVE-DROP`, `E-CG-018`, `W-EACH-BIND-ITEM-FIELD-DEFERRED` |
| `f8a138e9..c700c435` | 793 -> 795 | +2: `E-SCHEMA-010`, `E-MATCH-INVALID-ARM` |
| `c700c435..115e8b1b` | 795 -> 799 | +4: `E-SCHEMA-011`, `W-SCHEMA-CONSTRAINT-TIGHTENED`, `W-SCHEMA-CONSTRAINT-DRIFT-UNAPPLIED`, `W-NAV-CHUNK-LOAD-FAILED` |
| `115e8b1b..d0763cff` | 799 -> 800 | +1 `W-AUTH-MIDDLEWARE-AUTO-INJECTED` (a SPLIT out of `W-AUTH-001`; the fire already existed) |
| `d0763cff..fe14c9b2` | 800 -> 801 | +1 `E-IF-IN-DISPATCHED-ARM` (S301) |
| **`fe14c9b2..e80b692e` (prior pass)** | **801 -> 804** | **+3, zero removed:** `E-FOR-UNPARENTHESIZED-HEAD` (§17.4a — ⛑ **THREE fire sites, not two: `ast-builder.js:8758` · `:10809` · `:13298`.** The carried `:8535` / `:12927` were ALREADY WRONG pre-window AND under-counted; `:10809` uses SINGLE quotes so the mechanical E-code index misses it too. RE-DERIVED BY GREP), rejects a braceless `for … of` head INCLUDING a destructuring one); `E-SERVER-FN-IN-SYNC-CALLBACK` (**pre-existing FIRE, newly CATALOGUED** at S305 — `emit-server.ts:3388`; ⛑ **S384: `:2860` was ALREADY WRONG pre-window, re-derived by grep**); `E-ENGINE-AUDIT-UNSUPPORTED-BODY` (added AND retired inside the same window — the §51.11 make-it-loud placeholder, struck by the port). **The +3 count is NOT the interesting number this window — see the two rows below it.** |
| **`e80b692e..b929b9c9` (prior pass)** | **804 -> 805** | **+1, zero removed:** `E-FN-EQUALS-BODY` (§48.2 — `ast-builder.js:3927` `rejectFnEqualsBody`, throw at `:3930` — ⛑ **S383: `:3755` was ALREADY WRONG pre-window; re-derived by grep, not shifted**), four decl-body call sites + the export re-parse; rejects the `fn/function … = <expr>` shorthand, sibling of `E-FN-ARROW-BODY`). Tombstone count unchanged. |
| **`97576f35..6f176c0d` (S328)** | **806 -> 806** | **ZERO in, ZERO out — and the zero is load-bearing twice over.** (1) #460 added a normative §12.5 `SHALL` with **no code** (enforced by construction). (2) #464 REVERTED #450's `show=`-false SSR-hide, which also had no code — so ~122 lines of `emit-html.ts` left the tree without moving a single census number. #463 (`_blockTailIsValueExpr` keyword fence) and #466 (RCDATA per-item body) are both silent-wrong-output fixes with no diagnostic. **#466 explicitly DEFERS one: "a markup-returning call has no valid rendering in an RCDATA content model" needs a NEW §34 row and its own ruling — it was surfaced, not smuggled in.** |
| **`4f034e13..c93a692c` (S340-S346)** | **809 -> 809** | **ZERO in, ZERO out — SPEC byte-identical, so the zero is by construction, not by census.** The window's one catalog-adjacent move is a FIRE-SURFACE widening of an existing code (`E-EACH-BODY-DECL-UNSUPPORTED`, #515/#516 — any body position, full name-binding decl set incl. `lin`/`~`/`var`; fire site now **`emit-each.ts:1361`** (⚑ CORRECTED S376 from `:1416`)), which no catalog count can see. |
| **`c93a692c..c96e7012` (THIS pass, S347-S366)** | **809 -> 810** | **+1 LIVE, +2 DECLARED-AHEAD, zero removed — and the BUCKETS moved 20x further than the total.** The live one is **`E-MW-007`** (§40, S365-bryan): more than one module in a build declares a request pipeline, so two applications were emitted into one compiled server. Fires from the shared `commands/select-request-onion.js:72`; surfaced by BOTH `scrml build` and `scrml dev`; SPEC rows at `:19693` + `:22715`; LSP hover at `lsp/handlers.js:1127`. **`E-PROGRAM-002`** and **`E-IMPORT-005`** entered SPEC the same window and DO NOT FIRE — §40.8 explicitly reserves `E-PROGRAM-002` for the second-`<program>` shape and states that `E-MW-007` "is the emitted-server consequence, and fires today". Bucket deltas (IMPL-SITES -20, FALSE-CLAIM +17, DECLARED-AHEAD +4) are a census RECLASSIFICATION from #646's +143-line instrument-integrity rewrite, not twenty regressions — see the catalog section above before quoting any of them. |
| **`8b2e4053..fc6df72e` (S376, THIS pass)** | **812 -> 813** | **+1 LIVE, zero removed: `E-STATE-BLOCK-STATEMENT-FORM`** (Error; §38.4/§40.8/§4.18.1; catalog row `SPEC.md:19728` (⛑ S383 +6, was `:19722`); emitted `compiler/src/lint-e-state-block-statement-form.js` `runEStateBlockStatementForm` -> `scanStateBlockChildren`, wired `api.js` Stage 2.5c). ⚑ **THE FIRST `E-`-SEVERITY PASS IN THE COMPILER TO RUN PRE-AST** — it consumes block-splitter output (`bsResults`), not the AST, which is why its regex over source text is NOT an invariant-55 violation. **Migration MEASURED from the compiler over 2,194 `.scrml`: exactly ONE file newly rejects** (`samples/htmx-debate-dashboard.scrml`), migrated in the same landing. Enters **IMPL-SITES, not PINNED** — no conformance case asserts it. **Scope is ONE named form and the complement is refused on EVIDENCE, not omission:** bare calls stay legal (a measured typestate false-positive class — `validate() => < Validated> { }` sits in a BS `type:"state"` block and would break 4 live `conformance/cases/type-state-codes/` cases), control flow is already `E-CONTROL-FLOW-IN-MARKUP` at this locus, bare writes belong to the `W-STATE-BLOCK-BARE-WRITE-DECL` deprecation cycle, prose must keep compiling. **A FRESH code rather than the reserved `E-STATE-BLOCK-BARE-WRITE-DECL`** — that row is shape-specific to `@name = init` and is a live deprecation ENDPOINT; firing it for a lifecycle block would make one row mean two shapes while being simultaneously reserved and live. |
| **`8863d457..4f034e13` (S334-S340)** | **807 -> 809** | **+2, zero removed, and the two are opposite in kind.** `E-EACH-BODY-DECL-UNSUPPORTED` (Error; §17.7.3/§17.7.2; catalog row `SPEC.md:19577`; emitted **`codegen/emit-each.ts:1361`** — ⚑ **CORRECTED S376 from `:1387`; the sibling citation in the ledger row below said `:1416`, a THIRD value. Both were stale at the prior watermark (this file is `--name-only` unchanged below line 2028 this window), and one file carrying two different wrong line numbers for one emit site is the citation-rot class §34 stripped `:line`s to stop**) **REJECTS** a form that previously produced a silent-broken bundle — the decl was dropped, a later `${nm}` still emitted `String(nm)`, and the whole list rendered empty at exit 0. `I-SSR-EACH-CLIENT-RENDERED` (Info; §52.8; catalog row `SPEC.md:19429`; emitted `codegen/emit-ssr-render.ts:432`, wired `emit-server.ts:5360` — ⛑ **S384: `:5162` was ALREADY WRONG pre-window; re-derived by grep**) **REJECTS NOTHING** — it names a pre-existing conservative SSR fallback that used to be a bare `null` return. **Both PINNED in the same PR that emitted them** (`each/each-body-decl-unsupported-pos`, `ssr/i-ssr-each-client-rendered-subset-pos`; each `expected.json` READ to confirm a real `expect.codes` assertion, not a rationale-prose mention), so PINNED moved 341 -> 343 in lockstep and every other bucket is FLAT. **FOUR other fixes landed this window with NO code and each declined one for a different reason** — see the header's NEW NEGATIVES block; in particular #510's `<timeout>` fix is a **false-FIRE** repair, which moves no catalog number in either direction. |
| **`35d4d32e..616688ea` (S330-S334)** | **806 -> 807** | **+1, zero removed: `E-DERIVED-SERVER-ONLY-REACH`** (Error; §6.6.19 `SPEC.md:3694`; catalog row `:3304`; long row `:19483`; emitted `route-inference.ts:4429`, Step 3b). Landed WITH three conformance cases and a 379L unit test, so it enters **PINNED**, not IMPL-SITES — Rule 4 satisfied at landing. **Read the row's own scope sentence before asserting against it:** it fires ONLY for a `const <name>` DERIVED-cell RHS. A plain cell initialiser and a markup interpolation reach the same module from the same client position and are **NOT diagnosed** — the error text says so out loud, because deleting the `const` is the shortest edit that silences it and it restores the leak. Carve-out: NOT emitted in a `kind="tool"` program (§64). Migration measured at ZERO. **Second, timing-only movement in the same window: `E-SQL-006` (§44.3) now fires at COMPILE time on every server-fn emit path (#476) — no new code, a narrow sink (`preparedStmtErrors`) threaded and drained; +5 NEG conformance cases.** Third: #479's §18.5 fixes and #484's request-ref routing fix are silent-wrong-output classes with **no diagnostic added**, deliberately. |
| **`b929b9c9..15e5e070` (prior pass)** | **805 -> 806** | **+1, zero removed:** `W-IF-IN-EACH` (§17.1 — `emit-each.ts`'s `renderTemplateChildToJs`, the deferred nested-per-row-`if=` branch; warns when a NESTED, non-item-root, per-row `if=` inside `<each>` references the iteration item — the condition is a create-time-only append gate, not reactive on a same-key reconcile). GH adopter #409. |
| **`fe14c9b2..e80b692e` — TOMBSTONES** | **18 -> 34 struck** | **+16 newly struck**, which the code TOTAL does not show (the count methodology deliberately strips `~~`): six phantom `E-ENGINE-*` (003/006/007/008/009/011/012 — seven rows, one of which was already struck), four `E-COMPONENT-*` (002-005), `E-PROTECT-002`, `W-PROTECT-001`, `E-TYPE-042`, `W-DEPRECATED-001`, `E-ENGINE-AUDIT-UNSUPPORTED-BODY`. **A struck row still counts in the 804 — read the tombstone bucket, not the total, to answer "what got withdrawn".** |
| **`fe14c9b2..e80b692e` — CITATIONS** | **103 -> 5** `file:line` citations inside §34 | Q3 ruling: **strip the stale `:line`, keep the file path.** A baked line number in a maintained artifact rots silently and nothing fails — the same defect class as the 3,140-line stale SPEC-INDEX (S290) and the ~9x-wrong LOC figure (S280), which is why `docs/FACTS.md` exists. |

### SPEC §34.0 — the row well-formedness rule (NEW this window, and it changes how to read §34)

**Every NEW or TOUCHED §34 row SHALL carry exactly one of:** (1) an **emitter provenance note** —
the source path (optionally `:line`) where the code is pushed; (2) an explicit **spec-ahead
declaration** — `Reserved`, `Nominal`, `spec-ahead`, `not yet emitted`, or `lands with the impl`;
or (3) **strikethrough** plus a retirement note.

**Why that specific form.** It is a discriminator the catalog had already proved, not an invention:
at the time the rule landed, **131 rows carried an emitter note and 0 of 108 unfireable rows did** —
perfect separation both directions. A provenance note is free to write when the code is real and
impossible to write when it is not, so the requirement cannot be satisfied by a code that does not
exist. **Outcome (2) is a first-class answer, not a loophole.**

**Binding scope: NEW and TOUCHED rows only, enforced DIFF-SCOPED** (`bun scripts/s34-census.ts
--check-new --base <ref>`, a CI `gate` step; `gate`'s checkout gained `fetch-depth: 0` so merge-base
resolves). It SHALL NOT be retrofitted over the legacy corpus — a gate that is instantly red for
reasons no change caused is bypassed, then deleted. The legacy population drains through
`docs/changes/s34-catalog-truthfulness/`. **It is an editorial well-formedness rule, not a language
rule** — no program's meaning or acceptance status changes, so it is not a §62 version event.

**Consequence for lookups: a NAMED code may have NO §34 row at all, deliberately.**
`W-ROUTE-REQUEST-DUPLICATES-SERVER-LOAD` (§20.8.7) and `E-ERROR-011` (§19.4.4.1) are both named
normatively in prose and both absent from §34, because outcome 2 + the named-codes-land-with-impl
rule puts the row in the landing that adds the emitter. **Grep the prose section, not just §34.**

### Census buckets — RE-EXECUTED at `fc6df72e` (S376). Re-derive rather than cite.

⚑ **CORRECTED S376. This table previously carried `PINNED 338 · IMPL-SITES 320 · DECLARED-AHEAD 14 ·
FALSE-CLAIM 95` under the heading "at this HEAD" — those are S346 figures, three windows stale, and
they contradicted the catalog section ~35 lines above in THIS SAME FILE, which printed 343 / 302 /
112 for the same HEAD. One file, two current-labelled bucket tables, disagreeing by 17 on
FALSE-CLAIM.** The heading now names the SHA the run was executed at, because "at this HEAD" is a
claim that decays silently and nothing fails when it does.

`bun scripts/s34-census.ts` at `fc6df72e` — **813 rows (§34 19352..20236, derived) · 883 conformance
cases**:

| bucket | count @ `fc6df72e` | prior (`8b2e4053`) | meaning |
|---|---|---|---|
| STRUCK | 34 | 34 | retired — must NOT enter any freeze denominator |
| PINNED | 343 | 343 | a conformance case positively asserts it fires (`expect.codes` only) |
| IMPL-SITES | **303** | 302 | live + unpinned + has an emitter — the fire-attempt backlog |
| DECLARED-AHEAD | 18 | 18 | no emitter, and the row honestly says so |
| RUNTIME-SURFACED | 3 | 3 | surfaces at runtime as a VALUE — verify the runtime, not the diagnostic stream |
| FALSE-CLAIM | 112 | 112 | no emitter AND the row promises a live diagnostic (71 BUILD-ARC / 27 HOME-NO-SHALL / 10 NOMINAL-HOME / 4 ORPHAN-INDEX) |

The single moving bucket is IMPL-SITES **+1**, and it is `E-STATE-BLOCK-STATEMENT-FORM`: live
emitter, 476-line unit suite, **zero conformance cases** (`grep -rl` over `conformance/` returns
nothing), so it enters the fire-attempt backlog rather than PINNED.

### Standing catalog-vs-impl facts

1. **CORRECTED — EIGHT live `W-LINT-*` codes have no §34 row, not nine.** Re-derived at this HEAD:
   live `code:` emit sites in `compiler/src/lint-ghost-patterns.js` are `W-LINT-001..008` +
   `010..024` (**23 distinct**); §34 now catalogs `W-LINT-001..015` **plus `018`** (**16 rows**).
   Uncatalogued-but-live: **`016`, `017`, `019`, `020`, `021`, `022`, `023`, `024` — eight.** Inverse
   case: **`W-LINT-009` is CATALOGUED and NOT live** (the `:868` hit is the comment *"No separate
   entry for W-LINT-009 — W-LINT-004 subsumes it"*). Grep `code:\s*"W-LINT-`, never the bare string.
   **804 remains a count of §34, not of the implementation.**
2. **`W-MODULE-FORMAT-ESM-INCOMPLETE` is NOT a diagnostic code.** It is an OPERATIONAL stderr notice
   key printed by `compiler/src/commands/module-format-notice.js` for `--module-format=esm`. No §34
   row by design; never enters `result.errors`/`result.warnings`; must not be counted or asserted on.
3. **`W-EACH-TABLE-FOSTER` is RETIRED and DELETED (#131).** Code, module
   (`compiler/src/lint-w-each-table-foster.js`), Stage-6.4f wiring and unit test are all gone. No
   §34 impact (it never had a row). Do not re-add it.
4. **`W-`-SHAPED TOKENS THAT ARE NOT DIAGNOSTICS — three NEW this window.** `emit-lift.js` and
   `emit-each.ts` now push `W-`-prefixed strings into the EMITTED JavaScript **as `//` comments**,
   to mark a deliberately-deferred lowering at the site where a reader will hit it:
   `W-LIFT-TIER0-IF-VALUE-INDEXED-DISPLAY-TOGGLE-DEFERRED` and `W-LIFT-TIER0-IF-MULTIROOT-DEFERRED`
   (`emit-lift.js:1484` / `:1486`, ⚑ CORRECTED — was `:1448`/`:1450`, pre-existing drift found and fixed during S380 verification, not caused by S380) and `W-EACH-PERITEM-IF-MULTIROOT-DEFERRED` (`emit-each.ts:1286`, ⚑ CORRECTED — was `:1143`, same class, also pre-existing).
   **None is a diagnostic code**: no §34 row, no `code:` field, never in `result.errors` /
   `result.warnings` / `lintDiagnostics[]`, and a test cannot assert on one except as emitted TEXT.
   A `grep -rn "W-LIFT"` over `compiler/src/` finds them and looks like a discovery; it is not.
   Same class as `W-MODULE-FORMAT-ESM-INCOMPLETE` above. Do NOT add them to §34 and do not count
   them; if the deferral is ever promoted to a real diagnostic, that is an allocation decision.
5. **§34's `E-IF-IN-DISPATCHED-ARM` row is STALE BY ONE CALL SITE.** Its parenthetical says
   "emitted at `compiler/src/codegen/emit-html.ts:refuseConditionalInDispatchedArm`, **two call
   sites**". There are **three** at this HEAD — S302 added the structural one (`:1508`) and did not
   update the row. Harmless to a reader looking for the fire site, load-bearing to anyone planning
   the revert: the guard comes out at three sites or not at all.
6. **The revert SHA for that guard, `2fbe6520`, is NOT in this repo's history.** `hand-off.md:318`
   says "revert `2fbe6520` whole when the split lands"; `git cat-file -t 2fbe6520` returns *Not a
   valid object name* (a pre-squash branch SHA). **Revert by SYMBOL** — the three
   `refuseConditionalInDispatchedArm` call sites plus the function — not by SHA. The inverting
   conformance case is `conformance/cases/control-flow/if-in-dispatched-arm-neg/`, whose own
   `description` carries the flip instructions verbatim (move the code to `notCodes`, add the runtime
   half, **do not delete the case**).
7. **`E-LIFECYCLE-001` / `-002` / `-004` NOW FIRE (S310 W1, #353) — they did not before.** All three
   are the §6.7.3 `cleanup()` argument-shape + scope battery in `compiler/src/type-system.ts`
   (:18834 / :18843 / :18853). `E-LIFECYCLE-002` (the argument is a CALL expression, not a function
   expression) is the load-bearing one; `E-LIFECYCLE-004` covers a non-call non-function shape;
   `E-LIFECYCLE-001` covers `cleanup()` outside any element scope. **Any doc or map listing these as
   catalogued-but-unwired is stale at this HEAD.**
8. **`E-MW-006` is STRUCTURALLY DEAD (S-ss63 finding) — middleware is dropped silently.** The code
   exists and has a fire site (`ast-builder.js:19398`; ⛑ **S383: `:18890` was ALREADY WRONG pre-window — it named a bare doc-comment `*`; re-derived by grep, not shifted**), but the shape it guards cannot reach it. Do
   not read the presence of the row + the presence of the `code:` string as coverage; that is the
   `E-CHANNEL-INSIDE-PAGE` lesson one file over.
9. **RETIRED NOTE — `W-NAV-CHUNK-LOAD-FAILED`.** Prior generations of this map said "NOT implemented
   — do not add" and treated any doc naming it as describing planned work. **That is no longer
   true at this HEAD**: navigate-wave1c landed, the code fires from `runtime-template.js`'s
   `_scrml_nav_chunk_failed`, and §34 carries its row. See "New fire sites this window" below.
10. **NEW — `E-FN-EQUALS-BODY` (§48.2, #396).** Rejects a `fn`/`function` `= <expr>` expression body
    (sibling of `E-FN-ARROW-BODY`, §48.2.1). Before the reject the shape SILENTLY MISCOMPILED a
    `match`-tail body to a degenerate function returning `undefined` with zero diagnostics. Fire site:
    `ast-builder.js:3927` (`rejectFnEqualsBody`; the throw is `:3930`), FOUR decl-body call sites
    (`:9487`/`:9769`/`:12825`/`:13126`) plus the `export` re-parse's `_eqBodyErr` surface (`:11834`)
    — ⛑ **S383: ALL SIX WERE ALREADY WRONG BEFORE THIS WINDOW, not merely shifted.** The carried
    values `:3755` / `:9310`/`:9592`/`:12645`/`:12946` / `:11625-11654` land on unrelated
    `consumeBalanced` / brace-depth / `try {` lines. **RE-DERIVED BY GREP at `ff4b37e5`**; a
    mechanical +118 would have preserved the error, which used to SWALLOW this exact error and
    now surfaces it (and only it) from its sub-parse. See domain.map.md.
11. **RETIRED — `bun scripts/s34-census.ts`'s Windows-only breakage is FIXED (#473 `0beddacc`, S332-peter).**
    It resolved its `ROOT` from `new URL(import.meta.url).pathname`, which on Windows yields a
    leading-slash path (`/C:/…`) that `join()` turns into a malformed leading-backslash path,
    `ENOENT`-ing on every read. It now uses `fileURLToPath(import.meta.url)` — the pattern
    `scripts/facts.ts` had one file over the whole time. **RUN THE ORACLE FIRST, ON ANY PLATFORM.**
    The sibling platform-path class this repo documents elsewhere (`isOutsideBase` /
    `distRelativeServerSpecifier`'s separator discipline, domain.map.md's "Coordinate space"
    section) is unchanged and still worth reading. ⚠ **The gap ledger has NOT caught up:**
    `g-s34-census-windows-only-url-pathname-…` is still `status=open` at `docs/known-gaps.md:54`
    and its `locus=scripts/s34-census.ts:49` now points at the comment explaining the fix — see
    non-compliance.report.md N3.
12. **NEW — `W-IF-IN-EACH` (§17.1, #416).** Warns when a per-row `if=` on a NESTED (non-item-root)
    element inside `<each>` references the iteration item — the gate is create-time-only, not reactive
    on a same-key reconcile. Fire site: `codegen/emit-each.ts` `renderTemplateChildToJs`. The reactive
    fix itself remains OPEN (routed to bryan, §17.1 nested per-row-`if=` reactive-surface extension).
    See domain.map.md.
13. **CORRECTED — PR #405 LANDED.** The prior pass's several "#405 HELD, unmerged" statements
    (including this map's own tags line) are stale. #405 (the CPS auto-await choke-point consolidation)
    merged at `649d6fce` and was reviewed clean at `bbd77bec`. It retired `injectPromiseAwait` and
    closed the `g-cps-scheduler-opaque-boundary-hides-nested-server-calls` family (resolves
    `g-given-block-server-call-no-autoawait`, `g-hash87-member-read-await-misparen`,
    `g-ternary-init-server-call-await-misbind` — see `docs/known-gaps.md`). No new diagnostic code
    resulted from #405 itself; see dependencies.map.md for the mechanism.

## Diagnostic stream partition (how severity routes)
`W-` prefix + `severity:"info"|"warning"` -> `result.warnings` (non-fatal, CLI exit unchanged).
Everything else -> `result.errors` (CLI exit 1). Tests asserting on `W-*`/`I-*` codes must check
BOTH streams — `result.errors.filter(...)` silently misses warning-partitioned codes. Partition
logic lives in `compiler/src/api.js` (`collectErrors`, severity-keyed pushes).

**Third stream — `lintDiagnostics[]`.** The ghost-pattern lint pre-pass (runs BEFORE Stage 2/BS) and
the two Tailwind detectors return into `allLintDiagnostics`, NOT into `errors[]`. A test asserting
on `W-LINT-*` / `W-TAILWIND-*` must read that array (or the CLI's `[LINT]` output), not
`result.errors`.

**Span lift (`api.js` `collectErrors`).** `bsSpan -> span` and, **NEW this window (S294)**,
`tabSpan -> span`. `TABError` (`compiler/src/ast-builder.js`) bakes `(line X, col Y)` into
`.message` for the compile-path formatter but sets no `.span`; without the lift, EVERY TABError
reached `dev.js`/`build.js` with `filePath` stamped but no `:line:col`, while sibling
CGError/protect diagnostics (which carry `span`) showed it. Closes
`g-estmt-missing-semicolon-no-source-span`.

**Sub-parse span rebasing (`ast-builder.js` `_rebaseSubparseSpans`, NEW #389).** A diagnostic raised
INSIDE a sub-parsed region (a `<match>`-arm or `<each>` body re-parsed as its own mini-source) used to
report the SUB-PARSE's own line/col, not the file's — before the fix, a diagnostic pointing at line 3
of a 400-line file was routine and load-bearing tooling read it literally. The rebase walks the
sub-parsed node tree, recomputes `line`/`col` against the FILE's absolute offset, and was verified to
fix a DOWNSTREAM symptom nobody had connected to it: the within-node parser-parity gate was silently
dead on Windows because its span-comparison assertions never matched (enumerator backslash relpaths
compounding the un-rebased span mismatch). SPAN-COORD parity improved by −1470 mismatches corpus-wide.

## W-DEAD-FUNCTION — THE LOCUS, THE GATE, AND THE FILE THAT IS **NOT** THE LOCUS

⚑ **NEW SECTION S371-bryan. It exists because this map set had NO row for reachability at all, and a
WRONG locus for this code lived in `docs/known-gaps.md` from S369 until S371** — the `locus=` field
named `compiler/src/codegen/usage-analyzer.ts`, a dispatch brief repeated it, and nothing here said
otherwise. **The omission is what let the false claim stand.**

**`compiler/src/codegen/usage-analyzer.ts` CANNOT EMIT THIS WARNING — verified at this watermark:**

| probe | result |
|---|---|
| `grep -c W-DEAD compiler/src/codegen/usage-analyzer.ts` | **1**, and it is a PROSE mention inside a comment at `:692` |
| what the file exports | `FeatureUsage` (a boolean bitmap) + `emptyUsage` / `fullUsage` / `mergeUsage` / `analyzeUsage` — no diagnostic type, no `errors` array |
| its own header, `:16-17` | *"**What C0 does NOT do:** zero new diagnostics, zero AST mutation, zero emission. Pure analysis pass producing a structured data record."* |

**THE REAL MACHINERY — `compiler/src/route-inference.ts`:**

| element | site | note |
|---|---|---|
| SOLE emit site | **`:5615-5616`** | `new RIError(` at `:5615`, the code string `"W-DEAD-FUNCTION"` at `:5616`;, `warn.severity = "warning"`, pushed to `errors` |
| the D4 block | **`:5575`** | inside `for (const [fnNodeId, record] of analysisMap)` at `:5564`; D5 (`W-DEPRECATED-SERVER-MODIFIER`) follows in the same loop |
| the gate | **`:5614`** | a **TEN-TERM conjunction**: `!isHandleHatch && !hasCallers && !isExported && !isExplicitServer && !isMarkupReferenced && !isEndpointReferenced && !isGenerator && !isToolMainEntry && !isReturnedInline && !isLogicReferenced` |
| markup-reference set | **`:4852`** built · **`:4876`** `walkMarkupContext` | the false-positive suppressor that most fixes belong in |
| logic-reference set | **`:5505`** `logicReferencedFnNames` (declared; populated `:5556`) | adopter #195 — callee inside a nested closure, or a bare first-class value |
| `<each>` OPENER block | **`:4966`** (NEW #688) | collects idents from `inExprRaw` / `ofExprRaw` / `keyExprRaw` / `ifRaw` |

**WHY THE `<each>` OPENER NEEDED ITS OWN BLOCK:** an `<each>` does **not** parse to a `markup` node —
it lowers to `kind === "each-block"` with **no `attrs` array at all**, so the attribute branch that
already covered `<span if=fn()>` never saw it. The `<each>` BODY was always covered
(`bodyChildren` / `templateChildren` are ordinary markup arrays the generic recursion descends).
**Only the OPENER was blind, and all four positions fired.**

⚠ **THE SUPPRESSION SET IS NOT DIAGNOSTIC-ONLY (primary.map.md invariant 68).**
`markupReferencedNames` is also read at **`:5210`** (Step-5c indirect server-escalation, #284 FIX B)
and **`:6242`** (`clientRootIds` -> `endpointClientSkipIds`). **Widening it moves CODE PLACEMENT.**
(The in-source comment at `:4959-4962` cites `:5201`/`:6233` for these — both **9 lines short** at
this watermark. Grep; do not cite the comment.)

⚠ **THE MESSAGE TEXT MAKES A FALSE PREDICTION, AND IT IS FALSE IN THE SIMPLE CASE.** The warning says
*"It will be tree-shaken from the output."* **PA-EXECUTED at this watermark:**
`<program>${ fn reallyDead() { return 41 } }<p>hello</p></program>` warns, and
`dist/page.client.js` still contains `reallyDead`. Gap `g-wdead-function-tree-shaken-claim-is-false`.
**Do not repeat the message's own claim back to an adopter as a fact.**

**KNOWN FALSE-POSITIVE SHAPES.** PA-REPRODUCED at this watermark: **`<match for=T on=fn()>` opener**
— a fn used only as the match scrutinee fires `W-DEAD-FUNCTION`
(`g-match-block-opener-expr-not-a-wdead-reachability-root`, OPEN; same walker, same one-block shape
as the `<each>` fix). **LEDGER-SOURCED, not re-executed this pass:** arrow-callback bodies
(`G-DEAD-FUNCTION-MISSES-ARROW-CALLBACK-BODIES`) and match-ARM call edges
(`g-ri-dead-function-match-arm-edges`).

## `E-STATE-BLOCK-STATEMENT-FORM` — the state-block locus, Stage 2.5c (NEW section, S376)

**Code:** `E-STATE-BLOCK-STATEMENT-FORM` · **severity** `error` (fatal, CLI exit 1) ·
**stage line** `BS-LINT` · SPEC §34 row at `SPEC.md:19728` (⛑ S383 +6), sections §38.4 / §40.8 / §4.18.1.

**Emitter:** `compiler/src/lint-e-state-block-statement-form.js` — `runEStateBlockStatementForm(bsResults)`
-> `walk` -> `isStateBlock` -> `scanStateBlockChildren`. **Wired at `compiler/src/api.js` Stage 2.5c**,
between the two sibling markup-text lints (2.5 `W-INTERP-IN-RAW-CONTENT`, 2.5b
`W-INPUT-STATE-MARKUP-NONREACTIVE`) and Stage 3 (TAB). Diagnostics are drained through
`collectErrors("BS-LINT", …)`, so the `stage:` line an author sees is byte-identical to the siblings';
`BS-LINT-STMT-FORM` is a `--verbose` / `--debug-perf` timing label only.

**Fires when:** a lifecycle statement `on mount {` / `on dismount {` appears in a `<db>` / `<state>` /
`<schema>` STATE-block markup body. `STATE_BLOCK_ON_LIFECYCLE_RE = /^\s*on\s+(mount|dismount)\s*\{/`,
deliberately the same shape as `TOPLEVEL_ON_LIFECYCLE_RE` (`ast-builder.js:765-766`; ⛑ S383 +9, was `:756-757`) — **the point of
the diagnostic is that this exact form IS logic at `<program>`/`<page>`/`<channel>` (the §40.8
default-logic auto-lift) and is TEXT here.** The trailing `\{` is what keeps prose out: a run
beginning "on mount points are documented below" does not match.

**What it closed.** `on mount { loadDashboard() }` inside a `<db>` body compiled at **exit 0 with
zero diagnostics**, shipped the statement into `<body>` as literal page text, and never invoked the
function. The author's initialization silently never happened and the page displayed its own source.
PA-VERIFIED at this watermark by compiling `docs/changes/db-state-block-locus-2026-08-25/repro.scrml`:
`error [E-STATE-BLOCK-STATEMENT-FORM] --> repro.scrml:6:3`, `stage: BS-LINT`, `FAILED — 1 error`.

**⚠ FIRST `E-`-SEVERITY PASS THAT RUNS PRE-AST, AND THAT IS THE ANSWER TO THE INVARIANT-55 QUESTION
YOU ARE ABOUT TO ASK.** Its input is `bsResults` — the block splitter's `{filePath, blocks}` output,
whose state-block children are captured TEXT runs. There is no AST at Stage 2.5c to consult, so a
text scan is the only available representation and the anchored regex is the right instrument.
Invariant 55 forbids a text pass in a stage that ALREADY HAS the AST; this is not that.

**⚠ NO `try`/`catch`, DELIBERATELY, AND THE ASYMMETRY WITH ITS TWO SIBLINGS IS THE POINT.** 2.5 and
2.5b swallow a throw and log only under `--verbose` — correct for a WARNING, where the worst case is
a lost hint. In an ERROR GATE the direction inverts: a swallowed throw means a file that SHOULD be
refused compiles at exit 0 with nothing saying the gate never ran — fail-OPEN, the exact silent-success
mode the diagnostic exists to close, one layer up. The codebase's own convention already splits on
severity: `LINT-TRY-CATCH` (3.007) and `REJECT-ASYNC-AWAIT` (3.008, `E-ASYNC-NOT-IN-SCRML`) both run
bare through `stage()`, which does not catch.

**SCOPE — one named form, and the complement is refused on MEASURED evidence, not by omission:**

| shape at this locus | disposition | why |
|---|---|---|
| `on mount {` / `on dismount {` | **`E-STATE-BLOCK-STATEMENT-FORM`** | the form that would be logic one locus up |
| bare call `loadDashboard()` | **stays legal** | S368 bare-call ruling + a MEASURED false-positive class: a typestate transition decl `validate() => < Validated> { }` sits in a BS `type:"state"` block, so a bare-call gate here rejects 4 live `conformance/cases/type-state-codes/` cases |
| control flow `if (…) { }` / `for` / `while` | already covered | `E-CONTROL-FLOW-IN-MARKUP` fires here — adding it would double-fire |
| bare write `@x = init` | already covered | `W-STATE-BLOCK-BARE-WRITE-DECL` (Info), whose reserved endpoint `E-STATE-BLOCK-BARE-WRITE-DECL` is a still-OPEN deprecation cycle |
| prose / free text | must keep compiling | regression-covered |

**Why a FRESH code, not the reserved `E-STATE-BLOCK-BARE-WRITE-DECL`.** That row is SHAPE-specific
(`@name = init`), not locus-specific, and it is the endpoint of a deprecation window that is still
open. Reusing it would put the catalog in an incoherent state — one code simultaneously "RESERVED,
not yet emitted" for writes and live for lifecycle blocks — against the standing rule that a code
shall not carry two unrelated meanings. `DIAGNOSTIC_CODE` is a single exported constant so the
allocation is a one-line flip if that is ever re-ruled.

**⚠ DO NOT CITE A SIBLING CODE BY ITS BARE TOKEN IN THIS DIAGNOSTIC'S MESSAGE.**
`scripts/corpus-emit-differential.ts:431` builds each source's fired-code set by regexing
`\b[EWI]-[A-Z0-9-]+\b` out of the compiler's OUTPUT TEXT, so a code merely CITED in prose is
indistinguishable from one that FIRED. The first cut of this message cross-referenced
`E-WRITE-NOT-IN-LOGIC-CONTEXT` and the differential duly reported that code as newly firing on
`samples/htmx-debate-dashboard.scrml` — a phantom. Cite the SPEC SECTION, never the code token.
**This constrains every future diagnostic message in this repo, not just this one.**

**Corpus impact, MEASURED not estimated:** exactly ONE file newly rejected across 2,194 `.scrml` —
`samples/htmx-debate-dashboard.scrml:143`, migrated in the same landing to
`${ on mount { loadDashboard() } }` (VERIFIED here by reading the landed diff).

**TWO OPEN HOLES, BOTH PA-REPRODUCED BY COMPILING AT THIS WATERMARK — not read off the module's own
comments:**

1. **`g-state-block-statement-form-misses-a-wrapped-statement`** (MED, open). The scan reaches DIRECT
   text children only — the sibling's node domain, chosen for consistency. `<div>on mount { … }</div>`
   ONE level inside a `<db>` body compiles at **exit 0, zero diagnostics**, and the statement ships
   into the emitted HTML (1 occurrence, counted). Byte-for-byte the defect the gate exists to close,
   one nesting level deeper. ⚠ The module's ORIGINAL rationale for the domain — "nested markup is
   governed by its own element's body mode" — was **FALSE and has been corrected in-source**; it is
   governed nowhere.
2. **`g-state-block-statement-form-disarmed-by-an-unpaired-block-comment-opener`** (LOW, open). The
   comment machine tracks `/*` … `*/` but deliberately does NOT track string literals (a
   string-literal tracker over prose would open a "string" at every apostrophe and never close it).
   Consequence, and it is broader than a string literal: **ANY unpaired `/`+`*` in ordinary prose
   opens a comment region and disarms the gate for the REST OF THE STATE BLOCK.** A `<db>` body
   reading `note about src/* paths` followed by `on mount { loadDashboard() }` compiles at **exit 0,
   zero diagnostics** and ships the statement. **A glob disarmed a fatal gate.** Realistic triggers:
   a glob, a recursive glob, a bare path-with-star, a spaceless division. NOT a URL — `https://`'s
   `//` is a LINE comment, so it disarms only the remainder of that line.

**⚠ AND A SIBLING DEFECT THAT WAS FILED RATHER THAN FIXED.** `W-STATE-BLOCK-BARE-WRITE-DECL`
(`ast-builder.js:2020`, `scanStateBlockBareWriteDecls` at `:1979`) has **no comment handling at all** — not even the
`//` carve-out this module started with — so a `@count = 0` inside a block comment in a `<db>` body
still draws it. Same false-positive class, one severity down (warning, non-fatal), in a file that was
out of scope for the fix. **Do not read the sibling's silence as evidence the shape is fine.**

⛑ **S383 UPDATE — THE SILENCE IS NOW A RECORDED DESIGN DECISION, NOT AN OVERSIGHT, AND THE OBVIOUS
FIX IS FORBIDDEN IN SOURCE.** The comment-masking helper (`maskCommentRegions`,
`lint-e-state-block-statement-form.js`) was exported and wired into BOTH sibling scanners —
`scanStateBlockBareWriteDecls` (`:1979`) and `scanMarkupBodyConstAtDecls` (`:2094`, emits
`W-CONST-AT-DEPRECATED`) — and **REVERTED both times in one session, because both regressed a live
lint.** The rule that came out of it, and it generalises past these two codes: **`maskCommentRegions`
is only safe over text that CANNOT contain a STRING LITERAL.** A `<db>` body holds string values, and
a string value holds globs, paths, URLs and regexes — every phantom-comment opener there is. A/B
MEASURED on the `<db>` twin: `@pattern = "src/*.js"` / `@count = 0` / `@other = 1` emitted **3**
warnings before the masking and **1** after — the glob's `/*`, inside a QUOTED STRING, opened a block
comment that never closed and silenced the rest of the body. **For a lint, that trade is backwards:
it swaps a VISIBLE wrong warning for an INVISIBLE missing one.** Closing the residual needs a
STRING-AWARE comment scanner, which is a larger thing than that helper. The helper is now
module-private by contract, with a source-level tripwire in
`compiler/tests/unit/state-block-bare-write-comment-state.test.js` asserting it is not exported and
that `ast-builder.js` does not reference it. Registered gap id:
**`g-state-block-bare-write-scan-has-no-comment-state`** — ⚠ an earlier draft cited
`g-markup-body-const-at-scan-false-fires-inside-a-block-comment`, a WIDER id that was proposed and
**never registered**. Cite the one that resolves.

⛑ **S383 (F5) — BOTH SCANNERS ALSO SHIPPED A WRONG `col` AND BOTH ARE FIXED.** `colStart` is an
offset into the LINE, not a source column, and the two coincide only from the second line of a text
child onward. A child can begin MID-LINE (`<db src=… tables=…>@count = 0</db>`), so line 0 reported
**col 1** for a write at col 33 — `col` disagreed with the byte-exact `start` beside it, and any
consumer navigating by line/col (LSP, editor, formatter) jumped to the wrong place. Both now compute
`const col = li === 0 ? baseCol + colStart : colStart + 1`. **`line` deliberately gets no matching
correction** — `baseLine` IS line 0 of the child. **This changes only span metadata: no code was
added or removed from either diagnostic's fire condition, and the §34 catalog is unmoved.**

## A PREDICATE WITH NO DIAGNOSTIC — the accepted-then-discarded `if=`/`show=` class (NEW section, S372)

**This section exists because this map is organised by CODE, and this class has none.** A reader
working backwards from an `E-`/`W-` token will never reach it; it is reachable only from the SYMPTOM
("the compiler accepted my predicate and the content ships anyway"). Everything below is **exit 0,
zero diagnostics, fail-OPEN** — the dangerous direction: the content the author wrote a predicate to
WITHHOLD is shipped, and it is invisible during development whenever that predicate is usually true.

| shape | what happens | where it is decided | tracked as |
|---|---|---|---|
| `show=` on `<each>` / `<match>` / `<engine>` | **discarded at AST-BUILD.** `grep -rn showCond compiler/src/` returns **ZERO hits** at this watermark — only `ifRaw`/`ifCond` is stamped onto a structural opener (`ast-builder.js:16010`, `:17009`, `:18050`, `:18200`; ⛑ S383 — all four +118, were `:15892`/`:16891`/`:17932`/`:18082`), so there is no field for a gate to read | capture, not emit — `emit-html.ts`'s `isGateableIfValue` (`:1490`) reads `node.ifCond` and nothing else | `g-structural-element-if-chain-and-show-composition-nominal` (MED, open) |
| `else-if=` on a structural element | silently dropped; an `else` SIBLING after a gated structural element fires **`E-CTRL-001`** instead, because the chain detector recognizes only `kind:"markup"` nodes as chain members | the chain detector | same gap |
| structural `if=` INSIDE an `<each>` row template | **never gated.** The row renderers (`emit-each.ts`, `emit-lift.js`) do not read `ifCond` at ALL; only `emit-html.ts`'s `emitGatedStructural` (`:1516`) does, and a row template does not route through it | **PA-REPRODUCED at `8b2e4053` by compiling:** `<each in=@.tags if=@shown>` inside an `<each>` row emitted the inner list with ZERO references to `shown`, `@shown = false`, exit 0 | `g-structural-if-inside-each-row-template-fails-open` (MED, open) |

**THE ONE POSITION IN THIS FAMILY THAT DOES WARN — and it is the contrast that makes the rest
legible.** A MARKUP `if=` on a NON-ROOT element inside a row template emits a create-time append gate
(`emit-each.ts:1313`) and fires **`W-IF-IN-EACH`**, because it renders correctly and then goes STALE
rather than never gating at all. §17.7's deferred `W-EACH-PERITEM-IF-*` family is the reactive fix.

⚠ **DO NOT SCOPE THIS FROM `compiler/SPEC.md:11686` — THE SPEC'S OWN TABLE IS STALE THERE.** It still
says that markup non-root position *"emits nothing — fails CLOSED (never renders)"*. **It does not**;
the measured-S302 row was overtaken by #416/GH #409 and never updated. Filed in
`non-compliance.report.md`. **The durable fix for the whole family is ONE diagnostic covering markup
and structural positions together**; until it lands, an author placing a conditional in either
position gets no signal on either path.

## Diagnostic families by feature area — THE ROUTING TABLE

Keyed by PREFIX. A code not named individually below is still routed by its family row.

| Area | Prefix(es) | Count | Fire site |
|---|---|---|---|
| Engine / state machine | E-ENGINE-* | 44 | symbol-table.ts, type-system.ts, engine-statechild-parser.ts |
| Type system | E-TYPE-* | 41 | type-system.ts |
| Component | E-COMPONENT-* | 22 | component-expander.ts, type-system.ts |
| Lifecycle annotations | E-LIFECYCLE-* / W-LIFECYCLE-* | 35 | type-system.ts (§14.12) |
| Realtime channel | E-CHANNEL-* | 18 | route-inference.ts, channel-watches.ts, emit-channel.ts (§38), **`symbol-table.ts` (`E-CHANNEL-INSIDE-PAGE`)**. **`E-CHANNEL-INSIDE-PAGE` was CATALOGED-BUT-NEVER-WIRED until S301 (#286)** — a `<channel>` inside a `<page>` compiled clean and wired PROGRAM-scoped, and a Wave-1 code comment asserting it fired kept anyone from re-checking. The lesson generalizes: **a §34 row is not evidence of a fire site; `grep -rn` is.** Sibling landing (#281): the LISTEN channel name is now QUOTED — a camelCase `<channel watches=>` was folded to lowercase by Postgres and delivered ZERO rows, silently. |
| Syntax | E-SYNTAX-* | 14 | ast-builder.js, tokenizer.ts |
| Lint (info-tier) | W-LINT-* | 14 cataloged / **23 live** | `lint-ghost-patterns.js` + the other `lint-*.js` modules. **Returns into `lintDiagnostics[]`, not `errors[]`.** `W-LINT-016..024` have no §34 row — see above. |
| **Tailwind / utility-class lint (§26.3 / §26.5)** | **W-TAILWIND-001 · W-TAILWIND-UNRECOGNIZED-CLASS · E-TAILWIND-001** | **3** | **`compiler/src/tailwind-classes.js` is the SOLE fire site for all three.** `findUnsupportedTailwindShapes(source)` -> `W-TAILWIND-001` (a class whose SHAPE suggests Tailwind variant/arbitrary-value syntax but does not match the registered utility set). `findUnrecognizedClasses(source)` -> `W-TAILWIND-UNRECOGNIZED-CLASS` (any `class="…"` name that does not resolve via the registry — typos, unsupported arbitrary values, AND custom CSS classes, which are acknowledged false positives at floor level). `validateArbitraryCss` -> `E-TAILWIND-001` (invalid arbitrary-value syntax: empty `[]`, whitespace inside `[]`, illegal characters, backtick, embedded quote, empty `_`-list segment, unbalanced parens, malformed `url()`/`var()`, unknown CSS function). **WIRING:** both detectors are invoked from `compiler/src/api.js`'s ghost-error lint pre-pass (~:1025-1050), which runs BEFORE Stage 2/BS and pushes into `allLintDiagnostics`. **SUPPRESSION:** `compilerSettings.lintTailwindUnrecognizedClass = "off"` (default `"warn"`) — the SPEC §28 `lint.*` knob family; unknown keys are silently ignored. **A false-fire here is a REAL bug, not noise** — see the D-3 `outline-*` narrative below. |
| Foreign (`_{}` / `<foreign>`) | E-FOREIGN-* / W-FOREIGN-* | 15 | ast-builder.js, type-system.ts (§23). `W-FOREIGN-UNDECLARED-CAPABILITY` is suppressible via `compilerSettings.lintForeignUndeclaredCapability` (SPEC §28 `lint.foreign-undeclared-capability = off`). |
| Reactive cells | E-REACTIVE-* / E-STATE-* | 19 | type-system.ts. ⚠ **ONE `E-STATE-*` CODE DOES NOT FIRE FROM `type-system.ts` AND WILL DEFEAT A FAMILY-ROW GREP: `E-STATE-BLOCK-STATEMENT-FORM` (NEW #718) fires from `lint-e-state-block-statement-form.js` at `api.js` Stage 2.5c — PRE-AST, so `type-system.ts` has not run yet when it is emitted.** Its own section above. |
| Codegen | E-CG-* | 13 (incl. E-CG-018 chunk-token distinctness) | codegen/*.ts (incl. E-CG-001 protected-field egress). **`E-CODEGEN-INVALID-LOGIC` is the emitted-JS validity backstop** — a `let` redeclaration from a per-item reconcile prelude is the shape S294's shadow-safe selection prevents; **this window it was the fail-loud that caught U1's F1 defect** (an arm body emitting `await` into the client match's unconditionally-SYNC IIFE), which under `--no-validate-emit` would have been a whole-bundle SyntaxError instead. **NEW GAP against `E-CG-001` itself (`g-compiler-writes-unverifiable-client-bundle-to-disk-under-e-cg-001`, MED, open): the VERDICT half fails closed and the SIDE-EFFECT half does not.** When a malformed client emit makes the bundle unparseable, `E-CG-001` correctly refuses to certify it ("the §14.8.9 confidentiality backstop fails CLOSED: an unverifiable bundle is treated as a potential leak") — **and the compiler writes the unverifiable bundle to disk anyway.** A build that emits an artifact its own confidentiality gate declined to clear is one `--force`-shaped habit away from shipping it. Distinct from the broad pre-existing partial-emission property (1207 of 1878 sources compile OK while 1878 emit *something*): this one lands on a security path. |
| Standalone tool | E-TOOL-* | 11 | ast-builder.js, tool-program.ts, type-system.ts, codegen/emit-tool.ts (§64) |
| Meta (`^{}`) | E-META-* | 12 | meta-eval.ts, meta-checker.ts |
| Import | E-IMPORT-* | 10 | module-resolver.js |
| SQL | E-SQL-* | 10 | type-system.ts, sql-projection.ts, ast-builder.js (E-SQL-003 runtime-expr body), codegen/emit-server.ts + emit-tool.ts (E-SQL-004 `?{}`-without-`db=`). **`E-SQL-006` (§44.3, `.prepare()` on a `?{}` result) CHANGED TIMING at #476 — it now fires at COMPILE time on EVERY server-fn emit path** (was: reached the artifact and threw at RUNTIME on the async paths). The detector was always correct; the **narrow sink was not drained**. `emit-logic.ts`'s `case "sql"` pushes into `(opts as any).preparedStmtErrors`; `emit-server.ts` now threads ONE function-scoped `_sqlPrepareErrors` into every server-body / direct-emit call — including the §39.3 `handle()` escape-hatch body — and drains it at the tail, **deduped** because a fn emitted on both the async and library paths would otherwise report twice. 5 NEG conformance cases pin it. |
| **Protect-analyzer (§14.8.9 protect-floor + shadow-DB schema resolution)** | **E-PA-001 … E-PA-007** | **7** | **`compiler/src/protect-analyzer.ts` is the SOLE fire site** (`PAError`, :127). `E-PA-001` legacy/superseded for the missing-file case; **`E-PA-002`** = `src=` file does not exist AND one or more `tables=` names have no `CREATE TABLE` (emit at :828, in `resolveDb`); `E-PA-003` = cannot open. **CHANGED THIS WINDOW (S292):** `E-PA-002`'s message now LEADS with the `<schema>` + `scrml db-migrate` remedy and demotes hand-written `CREATE TABLE` advice to an "Otherwise" fallback — see below. The file also documents two historical FALSE-FIRE classes at :415 / :493 / :626 / :948 (a `db` shape whose DDL the analyzer could not see); read those comments before "fixing" a spurious E-PA-002. |
| **DB-authoritative tier (§14.8.11/.1/.2)** | E-DBAUTH-* / W-DBAUTH-* | 3 | `codegen/index.ts` (`annotateDbScopes`, compile-time `E-DBAUTH-SQLITE`) + `commands/db-migrate.js` (deploy-time `E-DBAUTH-SQLITE` / `E-DBAUTH-NO-TENANT-COLUMN` pre-flight) + `codegen/db-authoritative.ts` (`extractDesiredSchema`, `W-DBAUTH-MARKER-NEARMISS`) |
| **Schema (§38.6 / §39.5)** | E-SCHEMA-* / W-SCHEMA-* | **16** | protect-analyzer.ts, type-system.ts, **schema-differ.js** (`diffSchema` — `W-SCHEMA-002`, `W-SCHEMA-DESTRUCTIVE-DROP`, and NEW this window `W-SCHEMA-CONSTRAINT-TIGHTENED` :843/:857/:876/:895 + `W-SCHEMA-CONSTRAINT-DRIFT-UNAPPLIED` :916), **gauntlet-phase1-checks.js** (`E-SCHEMA-010` via `findNonLiteralSetItems`; NEW `E-SCHEMA-011` :796-810 via `parseColumns`'s `malformedReferences` + `referencesHint`) |
| Confidentiality — tenant-row floor (§14.8.10) | E-TENANT-AGG/WRITE/RAW-EGRESS / I-TENANT-STRIP/ACROSS | 5 | codegen/tenant-egress.ts, emitted at codegen/emit-server.ts **:1865 (E-TENANT-WRITE) · :1881 (E-TENANT-AGG) · :1908 (E-TENANT-RAW-EGRESS) · :6132 (I-TENANT-STRIP) · :6146 (I-TENANT-ACROSS)** — ⛑ **S384: the carried :1389/1405/1432 + :4893/4907 were ALL ALREADY WRONG before this window (doc-comment lines); RE-DERIVED BY GREP at `ff4b37e5`, not shifted** |
| **SSR prerender FALLBACK visibility (§52.8) — NOT a confidentiality code, do not merge with the row below** | **`I-SSR-EACH-CLIENT-RENDERED`** | **1 (NEW this window)** | `codegen/emit-ssr-render.ts:432`, wired at `emit-server.ts:5360` (the `buildSsrEachRenderers(...)` call) — ⛑ **S384: `:5162` was ALREADY WRONG pre-window; re-derived by grep, not shifted**. **Info, never fatal, changes nothing about what compiles** — it names a per-item template that falls outside the §52.8 renderable subset so the list ships EMPTY in the server HTML. **The sibling row below (`I-SSR-AUTH-SCOPED-CLIENT-HYDRATED`) is a CONFIDENTIALITY auto-omission and this one is a PERFORMANCE decline; they share a prefix and a fallback shape and nothing else.** |
| **`<each>` body scope (§17.7.3)** | **`E-EACH-BODY-DECL-UNSUPPORTED`** | **1 (S339; WIDENED #515/#516)** | `codegen/emit-each.ts:1416`, in `renderTemplateChildToJs`'s logic-child handler — fires on a name-binding decl (`let`/`const`/`function`/`lin`/`~`/`var`) at ANY body position (`body.find`, not `body[0]`); `type-decl` excluded. Partitions into `result.errors`. **Fail-CLOSED against a silent-broken bundle**, not a language prohibition — supporting author locals in an each body is a separate §17.7.3 ruling the row declines to pre-decide. |
| SSR prerender confidentiality (§52.15.5) | I-SSR-AUTH-SCOPED-CLIENT-HYDRATED | 1 | type-system.ts:10894 / :10935; auto-omit at codegen/emit-server.ts |
| Auth (compile-time graph + §52 checks) | E-AUTH-* / E-AUTH-GRAPH-* | 9 | auth-graph.ts, type-system.ts (§52) |
| **Auth WARNINGS — two DIFFERENT owners, do not merge with the row above** | **`W-AUTH-001`** · **`W-AUTH-MIDDLEWARE-AUTO-INJECTED`** · W-AUTH-PAGE-INFERRED / W-AUTH-LOGIN-MISSING / W-AUTH-RUNTIME-FALLBACK | 5+ | **`W-AUTH-001` -> `compiler/src/type-system.ts:10820`** — §52.11 ONLY: a `<var server>` with no detectable initial load. **`W-AUTH-MIDDLEWARE-AUTO-INJECTED` -> `compiler/src/route-inference.ts:5648` (Step 8b)** — §40.1.1/§12.2: `protect=` fields present with NO explicit `auth=` on `<program>` or any `<page>`, so auth middleware is auto-injected. **SPLIT AT S299** — these were ONE code with two unrelated meanings and only the §52.11 one documented. See "Code split" below. |
| Session (§20.5) | E-SCOPE-012 / E-SESSION-* | 4 | type-system.ts, codegen/emit-expr.ts, emit-server.ts. **THIS WINDOW (#435, GH #357): `E-SESSION-CONTEXT`'s scan was widened to match the new bare-`session` text form, the widening REGRESSED §20.5 conformance, and it was TRIMMED before landing** — the over-broad scan string-matched the compiler's OWN emitted comments and generated guards. The PA adversarial fix-vs-prefix pass caught it; the agent had reported clean. **The sound-scan reimplementation is open and ROUTED-TO-BRYAN** (`g-session-context-scan-bare-form-sound`, MED — dpa-021 §6.1's non-route residual needs a LOWERING-SITE RECORD, not a text scan; it is a newly-REJECTING language surface, so it is bryan's call, not a fix-forward). Companion HIGH, also routed to bryan: `g-session-get-reserved-key-read-disclosure` — the §20.5 reserved-key guard covers the WRITE side; a request-controlled `session[k]` READ still reaches compiler-owned internals (`csrfToken`) through `.get()` at HTTP 200. |
| Error handling (`!{}`/fail) | E-ERROR-* | 9 | emit-logic.ts, type-system.ts (E-ERROR-010 at type-system.ts:9853) |
| Functions | E-FN-* | 10 (+1 `E-FN-EQUALS-BODY`, NEW #396; E-FN-009 Nominal/deferred — zero fire site) | type-system.ts (§48.5); **`E-FN-EQUALS-BODY` / `E-FN-ARROW-BODY` fire from `ast-builder.js`, not type-system.ts** — a parse-time reject, not a type-check |
| Route inference (client/server boundary) | E-ROUTE-* / E-RI-* / **E-DERIVED-SERVER-ONLY-REACH** / **W-DEAD-FUNCTION** / W-DEPRECATED-SERVER-MODIFIER | — | route-inference.ts (§12.4 E-ROUTE-002/005; §12.2 Trigger 6 `W-DEAD-FUNCTION`; §38.4 E-RI-002). **§12.2 Trigger 3 (S299) produces NO diagnostic when it FIRES** — it silently RELOCATES a function to the server. "Why did my function move / why is there no `.server.js`" is a PLACEMENT question, not a diagnostic one. **But as of #486 there IS a code for the position Trigger 3 cannot reach:** `E-DERIVED-SERVER-ONLY-REACH` (§6.6.19, Step 3b `:4429`) REFUSES a `const <name>` derived-cell RHS that reaches an `ESCALATION_SERVER_ONLY_MODULES` binding, because a synchronous lazy-pull recompute (§6.6.3) has no escalation to be given. **Scope discipline: this code covers ONE position.** A plain cell initialiser and a markup interpolation are still undiagnosed — see the §12.2 scope table in domain.map.md before you assert coverage. **⚑ `W-DEAD-FUNCTION` HAS ITS OWN SECTION ABOVE ("THE LOCUS, THE GATE, AND THE FILE THAT IS NOT THE LOCUS") — read it before touching reachability; `codegen/usage-analyzer.ts` is NOT the locus.** |
| **Server-import cross-file invariant** | **W-SERVER-IMPORT-UNEMITTED** + W-SERVER-* | 2 | **`compiler/src/api.js` `checkServerImportInvariant`** — runs on the COMPILE, before the write gate. **Reverses the emitted specifier in DIST space via `serverImportTargetSource` since D-4 (S296); a source-space reversal made this guard blind to the exact class it exists to catch.** See dependencies.map.md's "Coordinate space" section. |
| Markup / element name | E-MARKUP-001 | 1 live | name-resolver.ts (§4.1 gate) + html-elements.js |
| Middleware (§40) | E-MW-002/005/006 | 3 live | ast-builder.js §40-block (:18190, :18231) |
| Control-flow-in-markup | E-CTRL-* / E-CONTROL-FLOW-IN-MARKUP | 8 | ast-builder.js |
| Loops | E-LOOP-* | 7 | ast-builder.js, type-system.ts |
| Attributes | E-ATTR-* | 8 (E-ATTR-012 RETIRED tombstone — DROPPED-BY-DESIGN, S249; E-ATTR-WRITER-CONFLICT #81) | attribute-registry.js, validators/attribute-*.ts, codegen/emit-html.ts (`analyzeWriterConflict`) |
| API declarations | E-API-* | 7 | type-system.ts (§60) |
| CPS / batch | E-CPS-* | 6 | cps-batch-planner.ts, batch-planner.ts |
| Test blocks | E-TEST-* | 6 | codegen/emit-test.ts (§19.13) |
| Linear types | E-LIN-* | 6 | type-system.ts (§35) |
| Endpoint declarations | E-ENDPOINT-* | 6 | ast-builder.js, type-system.ts, emit-server.ts (§61) |
| Client Router / outlet (§20.8) | E-OUTLET-DUPLICATE / E-OUTLET-OUTSIDE-SHELL / E-OUTLET-AND-MAIN / W-OUTLET-ABSENT-SOFT-NAV-DISABLED | 4 | symbol-table.ts PASS 15.5 `walkValidateOutlets` (:10210) -> `collectOutlets` (:10318); the W-code fires at the ast-builder.js filesystem-inference site |
| **Client Router — cross-chunk soft nav (§20.8.2/§20.8.7)** | **W-NAV-CHUNK-LOAD-FAILED** | **1 — NEW, IMPLEMENTED** | **`compiler/src/runtime-template.js` `_scrml_nav_chunk_failed`** (:2660-2667). Info-level, emitted by the RUNTIME in the generated app (a `console` line, not a compile diagnostic). See below. |
| Async/stdlib callback | E-ASYNC-* | 2 | async-stdlib-in-sync-callback guard, codegen/emit-server.ts, codegen/emit-expr.ts. **CHANGED THIS WINDOW (#442): `E-ASYNC-STDLIB-IN-SYNC-CALLBACK`'s FIRING SURFACE WIDENED without a spec change.** The fail-closed drain (`emit-library-shared.ts:collectNonAwaitableAsyncCalls`) now routes through the one async-name provider and is handed `serverFnNames`, so it finally sees a CLIENT SERVER-FN call stranded in a raw escape-hatch body, a template `.raw` body, or a fn-SIGNATURE parameter default — three positions `emit-expr`'s own `syncPeerCalls` sink structurally cannot reach. Before this the drain answered "not async" for `loadRows` while the emitter answered "async" **in the same compilation**, so those leaks shipped with ZERO diagnostics. **KNOWN LIVE FALSE POSITIVE, LEFT FIRING ON PURPOSE — do not "fix" it by suppressing:** `g-drain-textscan-overfires-on-awaited-nested-arm-site` (MED, open). The scan is POSITION-BLIND over `!{}` arm-handler RAW TEXT: on the client caller `emitArmBody`'s re-parse genuinely awaits the nested arm's server call, so the report is wrong while the emission is verified correct. **Two suppression attempts each silently deleted real fail-closes** — skipping all block handlers blinded 55 arms in 17 files (incl. `stdlib/auth/jwt.scrml`, 10 arms); gating on the re-parse predicate still lost fail-closes on the LIBRARY caller, where the re-parse does not await at all. The structural reason: **the gate is ARM-granular and the hazard is SITE-granular.** Corpus impact of leaving it firing: **0 of 1878 sources**; in-repo, exactly 2 test fixtures narrowed their blanket `errors.toHaveLength(0)`. **The guard is self-retiring** — `compiler/tests/unit/async-name-provider.test.js` §5 asserts the diagnostic IS present AND the emission it fires against IS correct, so fixing the root fails that test and tells you to delete it. Proposed (not built, not a ruling): run the drain against the RE-PARSED AST so awaitable positions are real positions. **Also this window (#429, F5): a CROSS-FILE server-fn name collision produced a FALSE `E-ASYNC-STDLIB-IN-SYNC-CALLBACK`** on a purely local sync client fn — root-caused to an unfiltered `routeMap` walk (the owning file lives only in the map KEY) and fixed by the owning-file filter, not by relaxing the diagnostic. |
| CSS (§65 native model) | E-STYLE-* / W-STYLE-* / E-THEME-* / E-DEFAULTS-* | 4 live | E-STYLE-001 at block-splitter.js:3475; codegen/css-conflict-check.ts; api.js Stage 3.4; codegen/emit-theme-reset.ts |
| Foreign element rejection (§4.17) | E-SCRIPT-001 | 1 | block-splitter.js:3498-3528. Exact `===` tag compare (never a prefix), so `<noscript>` is untouched; recovery scans to a case-insensitive `</script>` or EOF. SOURCE-side only. |
| Cell render-spec (§6.2/§6.6.17) | E-CELL-NO-RENDER-SPEC / E-CELL-RENDER-SPEC-NOT-BINDABLE / E-CELL-OUT-OF-SCOPE | 3 | symbol-table.ts — deliberately two different scopes (#128): NO-RENDER-SPEC is USE-scoped (PASS 5 `walkRenderByTagUses`); NOT-BINDABLE is DECL-scoped (PASS 5a `walkNonBindableMarkupDecls`) |
| `<each>` per-item bind (i175) | W-EACH-BIND-ITEM-FIELD-DEFERRED | 1 | codegen/emit-each.ts `renderTemplateAttrToJs` |
| `<each>` per-item nested `if=` non-reactivity (§17.1, NEW #416) | W-IF-IN-EACH | 1 | codegen/emit-each.ts `renderTemplateChildToJs`, the deferred nested-per-row-`if=` branch. Scoped to item-referencing conditions (`_eachIfCondReferencesItem`); does not fire for the reactive sole-item-root `if=` or an outer-state-only condition. |
| Enum case | E-ENUM-VARIANT-CASE / E-ENUM-TYPE-CASE | 2 | type-system.ts (§14.4) |
| Block-form `<match>` arm validity (§18.0.1) | E-MATCH-INVALID-ARM | 1 | match-statechild-parser.ts `parseMatchArms` (Phase-2 tokenizer — STRUCTURAL, distinct from the SYM-pass SEMANTIC E-MATCH-* checks) |
| **Deprecation lifecycle (§63)** | **E-DEPRECATED-001** · ~~W-DEPRECATED-001~~ · E-DEPRECATED-SERVER-MODIFIER · W-PURE-DEPRECATED / E-PURE-DEPRECATED | 5 | **`E-DEPRECATED-001` FIRES as of S307 — `compiler/src/ast-builder.js:17347` (⛑ **S383: `:16839` was ALREADY WRONG pre-window — re-derived by grep, not shifted; the `<machine>`/`<engine>` accept is `:17343`**), the engine-decl path** (the keyword distinction is decided at TAB time). `<machine>` no longer compiles; **`W-DEPRECATED-001` is a §34 TOMBSTONE** — the warning has no trigger. Per §63.5 the form still PARSES, so the report is exactly ONE diagnostic naming the migration rather than a cascade; `symbol-table.ts:6177` (⛑ S383 −12, was `:6189` — the file SHRANK when the Unit CC exemption loader was extracted to `default-logic-exemption.ts`) records that no second redundant diagnostic is emitted. `E-PURE-DEPRECATED` / `E-DEPRECATED-SERVER-MODIFIER` remain RESERVED (their warnings are the active stage). See domain.map.md. |
| **Lifecycle `cleanup()` (§6.7.2/§6.7.3)** | **E-LIFECYCLE-001 / -002 / -004** | **3 — NEWLY WIRED S310** | `compiler/src/type-system.ts` :18834 / :18843 / :18853. Conformance: `conformance/cases/lifecycle/cleanup-error-{call-expression,non-function,outside-element-scope}` + `cleanup-happy-arrow-and-reference`. |
| **Braceless loop head (§17.4a)** | **E-FOR-UNPARENTHESIZED-HEAD** | **1 — NEW S309** | `compiler/src/ast-builder.js:8758` + `:13298` + ⛑ **a THIRD site at `:10809` no map has ever named** (it uses SINGLE quotes, so the generated E-code index misses it as well). The carried `:8535` + `:12927` were ALREADY WRONG pre-window — RE-DERIVED BY GREP, not shifted. Rejects a braceless `for … of` head, **including a DESTRUCTURING one** (`for [a,b] of xs` — the second call site, #330). |
| **Server fn in a sync callback (§12/§19.9.9)** | **E-SERVER-FN-IN-SYNC-CALLBACK** | **1 — newly CATALOGUED S305, fire pre-existed** | `compiler/src/codegen/emit-server.ts:3388` (⛑ **S384: `:2860` was ALREADY WRONG pre-window; re-derived by grep**; the shared emitter used by both the structured and escape-hatch walks). Recorded via `syncPeerCalls`, threaded from `emit-expr.ts` / `emit-control-flow.ts`. **A catalog addition is not a behaviour change — the fire had been live.** |
| **NAMED but deliberately ABSENT from §34 (§34.0 outcome 2)** | **W-ROUTE-REQUEST-DUPLICATES-SERVER-LOAD** (§20.8.7) · **E-ERROR-011** (§19.4.4.1) | 2 | **No §34 row, no emitter, by design** — the row lands WITH the implementation. Both are normative in their prose sections and both would return "does not exist" to a §34-only lookup. `W-ROUTE-…` is a v1 OBLIGATION, not a nice-to-have: Pole C knowingly chose redundant work over staleness as its failure mode, and a knowingly-undiagnosable-by-default failure mode obligates the diagnostic. `E-ERROR-011` was NAMED at S313 for a narrower "compound" rule and REDEFINED to the general non-enum rule before ever being emitted — safe precisely because it never shipped. |
| **`if=` inside a dispatched arm (§17.1/§17.1.1/§18.0.1/§51.0.B)** | **E-IF-IN-DISPATCHED-ARM** | **1 — NEW S301** | **`codegen/emit-html.ts` `refuseConditionalInDispatchedArm` (:780) is the sole fire site — THREE call sites, not two: `:1508` (structural `if=` on `<engine>`/`<match>`/`<each>`, added S302), `:1737` (an `if`/`else-if`/`else` CHAIN), `:2727` (markup `if=`).** **TEMPORARY IMPLEMENTATION RESTRICTION, not a language rule** — §34 says so and says the row is expected to be REMOVED, not amended. Refusing DROPS the element; it does not emit an ungated one. Do not "fix" a report of this code by deleting one call site: the three are a unit (see domain.map.md §17.1.2, Prohibition 4). |

## Per-session diagnostic history — DEREFERENCED

Which code landed in which window, and the narrative of why, lived here across ~120 lines and
duplicated `docs/changelog.md`. **Deleted this pass.** For history read `docs/changelog.md` and
`handOffs/delta-log.md`. What stays here is the delta LEDGER above (a count, re-derivable) and any
fact that is a RULE rather than an event — those are folded into the family table and the standing
catalog-vs-impl facts.

## sql-lex (§52.15.5) — a shared LIVE/INERT `${}` classifier, not a code
`compiler/src/codegen/sql-lex.ts` is the SINGLE source of truth for which `${…}` interpolations in a
`?{}` body are LIVE (code context) vs INERT (inside a string literal, `""`-quoted identifier, `E'…'`
escape string, `$tag$…$tag$` body, or `--` / nested `/* */` comment). ONE scanner feeds BOTH the
CLASSIFIER (`collect.ts`) and the param EMITTER (`rewrite.ts extractSqlParams`), so the two cannot
disagree. Exports `liveSqlInterpolations`, `liveSqlInterpolationExprs`, `sqlHasLiveInterpolation`.
Known low-sev hardening: the `E'…'` branch assumes Postgres while the default db is SQLite
(`g-ssr-auth-scoped-hardening-trio` finding 2).

## sql-table-refs (§14.8.11, NEW S292) — a bounded scanner, not a code and not a parser
`compiler/src/sql-table-refs.js` extracts the table identifiers a `?{}` body references, paired with
the PRIVILEGE each reference implies. **Its contract is two-valued and the second value is the
load-bearing one:** `{tables, privileges, undetermined}`. A caller MUST NOT treat an empty `tables`
as "touches nothing" — `commands/db-migrate.js` prints an explicit operator warning naming every
`undetermined` fragment, because an unreported miss re-creates
`g-dbauth-migrate-no-grants-for-unmarked-identity-table` on a different table and fails CLOSED at
runtime as an opaque `permission denied`. Not itself a diagnostic (no §34 row).

## semdiff (#6b P0) — a diagnostic-CONSUMING classifier, not a code
`compiler/src/semdiff.ts` `classifySemdiff(base, head)` classifies a change by AXIS
(`opaque`/`source`/`use-site`/`context`) + soundness TIER (`0` proven cosmetic / `2` behavioral),
never a boolean "safe". One of its three P0 signals is a use-site diagnostic-set diff
(`diffDiagnostics`) — a diagnostic that appears/disappears between versions is a Tier-2 `use-site`
axis. Exposed as `scrml semdiff`.

## Custom Error Classes (compiler-internal, one per pipeline stage)
| Class | File | Stage |
|---|---|---|
| BSError | compiler/src/block-splitter.js:59 | Block-splitter |
| TABError | compiler/src/ast-builder.js:2145 (⛑ **S383: `:2001` was ALREADY WRONG pre-window — it named a `file: filePath,` span field. `export class TABError extends Error` is `:2145`; re-derived by grep**) | AST builder — carries `tabSpan`, lifted to `.span` in api.js since S294 |
| DGError | compiler/src/dependency-graph.ts:233 | Dependency graph |
| TSError | compiler/src/type-system.ts:702 | Type system |
| RIError | compiler/src/route-inference.ts:398 | Route inference |
| PAError | compiler/src/protect-analyzer.ts:127 | Protect analyzer |
| ModuleError | compiler/src/module-resolver.js:34 | Module resolution |
| MetaError | compiler/src/meta-checker.ts:67 | Meta checker |
| MetaEvalError | compiler/src/meta-eval.ts:54 | Meta eval |
| CGError | compiler/src/codegen/errors.ts:11 | Codegen (shared across all emit-*.ts) |

`schema-differ.js` / `commands/db-migrate.js` / `codegen/db-authoritative.ts` / `codegen/sql-ident.ts`
/ `sql-table-refs.js` / `tailwind-classes.js` declare NO Error class. `schema-differ.js` returns
`{sql, warnings}` structurally; `db-migrate.js` reports via `console.error` + `process.exit(1)` (a
CLI, not a pipeline stage feeding `collectErrors`) and since S288 attaches
`e.scrmlFailedStatement = {index, total, sql}` to a per-statement throw, echoed by
`printFailedStatement`. `tailwind-classes.js` returns `{error: {code, reason}}` objects.
`match-statechild-parser.ts` returns a `diagnostics` array on its `MatchParseResult`.

## Runtime error classes (emitted into generated apps, compiler/src/runtime-template.js)
`_ScrmlError` (base) -> NetworkError, ValidationError, SQLError, AuthError, TimeoutError, ParseError,
NotFoundError, ConflictError. These ship in the CLIENT bundle for generated apps' `!{}`
error-handling / failable-fn machinery — not this compiler's own error handling.

**Also runtime-side (prior window):** `_scrml_error_boundary_log("on mount", err)` is the `.catch(…)`
sink the GH #237 `on mount` async wrap attaches, so a rejected server call in a mount block surfaces
instead of becoming an unhandled rejection.

**Runtime helper, NOT error machinery (carried):** `_scrml_ifrow_apply(cur, el, ph,
on)` (`runtime-template.js:2398`; ⛑ **S384: `:2131` was ALREADY WRONG — re-derived by grep**) is the §17.1 per-row `if=` element⇄comment structural swap shared
by Tier-1 `<each>` and Tier-0 `${for…lift}`. It throws nothing and reports nothing. Named here only
because its failure mode LOOKS like an error-handling bug: if `_scrml_key` is not transplanted onto
the replacement node the reconciler stops finding the row, and rows silently stop updating with no
diagnostic anywhere.

## Error Handling Patterns
Every pipeline stage returns/throws its own `<Stage>Error`; `compiler/src/api.js` wraps each stage
call and calls `collectErrors(stageName, result.errors, filePath)` to normalize into
`{code, message, severity, stage, …}`, lift `bsSpan`/`tabSpan` to `span`, stamp `filePath`, and
partition the error/warning streams. Generated scrml apps use `!{}` error-arm blocks + `fail`/`?`
propagation (ErrorArm/FailExprNode/PropagateExprNode — see schema.map.md) lowered to try/catch
envelopes by emit-logic.ts.

**`scrml dev` compile-failure serving (#518, adopter #517).** `runOnce` records every pass's outcome
via `noteCompileResult(result)` (exported; `getCompileFailure()` reads it); while `errors` is
non-empty the fetch handler serves the REAL compile error at every non-infra request — HTML overlay
(with hot-reload, auto-recovering on the next green pass) for `Accept: text/html`, JSON otherwise —
and the last-good on-disk output is never served while broken, so the partial write is inert.
⚠ A compileScrml THROW (as opposed to a returned `errors[]`) is NOT yet fail-closed on main — that is
PR #539, in flight; do not read it as landed at this watermark.

## Global Error Boundaries
`<errors>` element (§55.8) — the scrml-level component error boundary; ast-builder.js recognizes it
as a structural element and codegen/emit-error-boundary.ts emits the boundary wiring (re-parsing via
block-splitter/ast-builder). **`<errors of=…/>` is ALSO a runtime-chunk trigger** — its wiring
references `_scrml_message_for` from the `messages` chunk as a VALUE, which is why GH #234 needed a
POST-EMIT reference gate in `emit-client.ts` rather than a pre-emit AST gate. See
dependencies.map.md's "Runtime-chunk gating" section.

For the full per-session diagnostic-change narrative (S148 onward), see `docs/changelog.md`.

## Emitted-artifact SYNTAX is now gated wide — and `node --check` was the wrong instrument

Not a diagnostic code, but it belongs here because it is the class of failure §34 cannot express: an
emitted artifact that is a hard **SyntaxError at load** while every compiler diagnostic reads green.
`scripts/corpus-emit-differential.ts` + `scripts/corpus-check-goggles.js` (NEW #428) parse every
emitted artifact across **1878 sources / 7254 artifacts** under BOTH parser goggles.

**`node --check` on a bare `.js` ACCEPTS a top-level stranded `await`** — Node resolves it by
module-syntax auto-detection. **The compiler emits `<script src=…>` with no `type="module"`**, i.e. a
classic script, where the same bytes are fatal and the bundle is dead on arrival. That is precisely the
auto-await work's own dominant failure mode, and every measurement in that arc had run under the
blindness. **`node --check` must not be reintroduced.** Compounding it: **bun's `vm.Script` does not
reject a top-level `await` either**, which is why the goggles run in a separate **node** subprocess
rather than in-process under Bun. First real run surfaced
`g-stdlib-module-resolver-emits-import-meta-into-a-classic-script-bundle` (MED, open) — a cleanly
compiling stdlib source emitting a browser-DOA bundle, invisible to every prior gate on TWO counts at
once (wrong goggle AND `stdlib/` outside the corpus roots). See build.map.md for how to run it.

## Tags
#scrml #map #error #diagnostics #w-dead-function #reachability #route-inference #not-usage-analyzer #dead-function-locus #routing #e-stdlib-client-chunk-missing #w-type-031-unproven #asis-unknown-split #stdlib-client-registry #e-control-flow-in-markup #default-logic-lift #semdiff #css65 #diagnostic-partition #result-warnings #lint-diagnostics #tab-span-lift #outlet #tenant-floor #ssr-auth-scoped #sql-lex #sql-table-refs #catalog-count-audit #catalog-vs-impl #w-lint-uncatalogued #dbauth #e-dbauth-sqlite #e-dbauth-no-tenant-column #w-dbauth-marker-nearmiss #w-schema-destructive-drop #db-migrate #rls #secdef #e-cg-018 #w-each-bind-item-field-deferred #e-schema-010 #e-schema-011 #w-schema-constraint-tightened #w-schema-constraint-drift-unapplied #w-nav-chunk-load-failed #navigate-wave1c #e-match-invalid-arm #e-if-in-dispatched-arm #structural-if #§17.1.2 #three-call-sites #revert-by-symbol #e-channel-inside-page #cataloged-but-unwired #listen-quoting #changelog-dereferenced #ghost-pattern #w-dead-function #e-pa-002 #protect-analyzer #tailwind #w-tailwind-unrecognized-class #e-tailwind-001 #outline-family #w-server-import-unemitted #dist-space #d4 #on-mount #gh237 #gh234 #messages-chunk #w-auth-001-split #w-auth-middleware-auto-injected #code-split #trigger-3 #escalation-server-only #route-inference #prefix-coverage-audit #error-generated-index #not-a-diagnostic #w-lift-tier0 #ifrow-apply #§34.0 #row-provenance #s34-census #census-buckets #false-claim #declared-ahead #runtime-surfaced #struck-tombstone #line-citation-strip #e-deprecated-001 #machine-retired #w-deprecated-001-retired #e-lifecycle-001 #e-lifecycle-002 #e-lifecycle-004 #cleanup-diagnostics #e-for-unparenthesized-head #e-server-fn-in-sync-callback #e-mw-006-dead #e-error-011 #w-route-request-duplicates-server-load #named-codes-land-with-impl #w-lint-uncatalogued-eight #generated-index-unmaintained #e-fn-equals-body #fn-decl-parse-sites #subparse-span-rebase #within-node-gate-windows-fix #s34-census-broken #fileURLToPath-vs-pathname #pr-405-landed #w-if-in-each #s34-census-works-on-linux #windows-only-enoent #async-name-provider #drain-widening #position-blind-textscan #self-retiring-guard #arm-granular-vs-site-granular #cross-file-server-fn-collision #e-session-context-trimmed #session-read-disclosure #e-cg-001-writes-anyway #dual-goggle #node-check-blind-to-tla #bun-vm-script-blind #import-meta-classic-script #each-nested-if-not-reactive #cps-choke-point-landed #zero-new-codes #806-unchanged #silent-drop-testable #no-diagnostic-by-design #register-fn-name #e-codegen-invalid-logic #validate-emit-contract #e-scope-001 #response-contract-has-no-code #spec-silent-shall #807-codes #e-derived-server-only-reach #§6.6.19 #step-3b #refuse-not-escalate #per-function-scope-only #one-position-not-a-class #shortest-edit-restores-the-leak #kind-tool-carve-out #e-sql-006-compile-time #sink-not-detector #prepared-stmt-errors #narrow-sink-drain #dedup-at-drain #handle-escape-hatch-body #census-oracle-re-executed #pinned-341 #impl-sites-320 #false-claim-95-unchanged #prefix-grep-is-not-the-catalog-figure #silent-wrong-output-no-code #§18.5-no-diagnostic #undefined-does-not-exist-§42.1.1 #809-codes #catalog-moved-two-windows-running #e-each-body-decl-unsupported #i-ssr-each-client-rendered #§17.7.3 #§52.8 #pinned-in-the-emitting-pr #pinned-341-to-343 #silent-broken-bundle-to-compile-error #surfaces-not-changes #fallback-descriptor-not-null #four-fixes-no-code #false-fire-is-a-defect-with-no-count #e-markup-001-false-fire #silent-vs-loud-same-class #awk-cross-check-810-ewih #prefix-grep-series-diverges #filesscanned-is-not-a-repo-fact #810-codes #e-mw-007 #e-program-002 #e-import-005 #declared-ahead #census-reclassification #false-claim-disposition #build-arc #home-no-shall #orphan-index #nominal-home #impl-sites-minus-20 #w-lint-nine-no-row #fire-site-not-comment #files-scanned-not-a-fact #select-request-onion #one-onion-rule #no-diagnostic-class #accepted-then-discarded #fail-open #structural-show #structural-if-row-template #census-re-executed #files-scanned-not-a-repo-fact #e-state-block-statement-form #813-codes #impl-sites-303 #bs-lint-stage #pre-ast-error-gate #fresh-code-not-reserved-code #do-not-cite-a-code-token-in-a-message #glob-disarms-a-fatal-gate #census-table-needs-a-sha #s380-incremental #w-each-peritem-if-multiroot-deferred #w-lift-tier0-line-fix #silent-wrong-no-new-code #§52.13

## Links
- [primary.map.md](./primary.map.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
- [schema.map.md](./schema.map.md)
- [domain.map.md](./domain.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [build.map.md](./build.map.md)
- [auth.map.md](./auth.map.md)
- [migrations.map.md](./migrations.map.md)
- [non-compliance.report.md](./non-compliance.report.md)
