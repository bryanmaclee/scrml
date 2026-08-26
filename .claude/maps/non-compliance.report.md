# non-compliance.report.md
# project: scrml
# generated: 2026-08-26T13:28:37-06:00  commit: fc6df72e
# generated-at: fc6df72e — **THE SAME SHA AS LINE 3, BY CONSTRUCTION.** Working tip at write time
# `60803548` on `wrap/s376`; `git diff --name-only fc6df72e..60803548` is FOUR DOCS FILES and ZERO
# source, so the source state read IS `fc6df72e`, which is `merge-base HEAD origin/main` and IS
# `origin/main`. Line 3 and line 4 carry one SHA on purpose (S372 shipped a self-contradicting pair).
# **INCREMENTAL over `8b2e4053` -> `fc6df72e` (S376). SOURCE WINDOW = FIVE FILES, ONE OF THEM NEW.**
# Ancestry CHECKED FIRST (invariant 48); the outbound MAP-STAMP check passes.
# scan mode: INCREMENTAL, TARGETED at the surface this window's diff could have falsified, with
# every LIVE finding REPRODUCED BY COMPILING or by grepping source at this watermark — not relayed.

## Summary — S376 pass (this pass)

**SIX new findings (N32-N37). FIVE were CORRECTED IN PLACE this pass; ONE is LIVE and operator-owned.
TWO carried findings CLOSED (N26, C8).** Docs scanned: the 13 curated maps, the four untracked
`*.generated.md`, and the `docs/` surface this window's diff could have falsified.

⚑ **THE HEADLINE IS NOT A STALE DOC — IT IS THAT THE MAP SET WAS DISAGREEING WITH ITSELF, IN FOUR
PLACES, INSIDE SINGLE FILES.** Every one of the four was detectable by grepping one artifact against
itself, with no source read and no compile. That is the cheapest class of defect this report has ever
carried and it had survived multiple passes, because each pass updated ONE occurrence of a figure it
believed it had re-derived. **An internal contradiction is the strongest available tell that a
claimed "re-read" was a carry.** Invariant 71.

⚑ **AND ONE CITATION WAS A WRONG *FILE*, NOT A DRIFTED LINE — WHICH FAILS WORSE.** Invariant 72.

**METHOD NOTE, carried from S372 and honoured again:** every LIVE finding below was REPRODUCED at
this watermark — by compiling, or by grepping the SYMBOL rather than adjusting a line number
arithmetically. Per the S347 memory *"Relayed premises fail ~1 in 3"*, nothing here is relayed.

---

**N32 — CORRECTED THIS PASS, AND IT IS THE MOST IMPORTANT ONE: TWO MAPS NAMED THE WRONG *FILE*, NOT A
DRIFTED LINE.** `structure.map.md` (Entry Points) and `auth.map.md` (request-pipeline table, row 2)
both stated that `compiler/src/codegen/emit-server.ts` *"splits the pipeline remainder into a
standalone `_scrml_dispatch(req, server)` and wraps it in `_scrml_onion_dispatch(req, server)
(`emit-server.ts:521`)"*, and auth.map.md gave the range `emit-server.ts:~454-521`.
**VERIFIED at this watermark by grepping the SYMBOL:** `grep -rn '_scrml_onion_dispatch'
compiler/src/codegen/` returns **NOTHING**; `grep -rn '_scrml_dispatch' compiler/src/codegen/`
returns nothing either. Both symbols are emitted by the HOST — `compiler/src/commands/build.js:514`
(`async function _scrml_dispatch(req, server)`) and `:521` (`function _scrml_onion_dispatch(req,
server)`, which calls `_scrml_mw_pipeline_0(downstream)(req)`). `emit-server.ts:521` reads
`if (Array.isArray(node)) {` and `:~454-460` is §20.5/§52 `@currentUser`-query-gate code —
**unrelated to the onion in every particular.** What `emit-server.ts` DOES own: `_scrml_hasMW`
(`:2934`), `_scrml_mw_wrap` (`:3093`), and the exports `_scrml_mw_pipeline` (`:3230`) /
`_scrml_mw_declared_in` (`:3247`).
**Reason:** wrong-file citation (the LINE NUMBER was correct — for a different file).
**Provenance:** wrong since **#654 (`b74f7363`)**, which is when `build.js` gained the split. Carried
through every window since.
**Why it survived, and this is the transferable part:** the auth surface has measured `--name-only`
EMPTY for four consecutive windows, so `auth.map.md` was STAMP-ADVANCED each time rather than read.
**A stamp-advance on a measured zero-diff proves the SOURCE did not move. It proves nothing about
whether the map was ever right.** And a wrong file with a right number is the hardest form to catch:
it resolves to real code, it reads as precise, and an arithmetic drift-check would "confirm" it.
**Disposition:** CORRECTED in both maps — split into a codegen row (what the onion IS) and a host row
(how dispatch is split and wrapped), each with symbols grepped at this watermark. Recorded as
**invariant 72**.

**N33 — CORRECTED THIS PASS: FOUR FIGURES CONTRADICTED ANOTHER FIGURE IN THEIR OWN FILE.** All four
were labelled current; none needed an external oracle to detect.

| file | figure | said | its own sibling said | truth at `fc6df72e` |
|---|---|---|---|---|
| `error.map.md` | census buckets, under a heading reading **"at this HEAD"** | PINNED 338 · IMPL-SITES 320 · FALSE-CLAIM 95 | 343 · 302 · 112, **35 lines above** | 343 · **303** · 112 |
| `test.map.md` | "Test Categories" heading total | 1,387 | 1,394 (this file's header) | **1,398** |
| `test.map.md` | per-category table | unit 901 · browser 94 | unit 908 · browser 95 (prose **4 lines above the table**) | **909** · **98** |
| `primary.map.md` | §34 total, in a paragraph reading *"Re-read at this HEAD, not carried"* | 810 | 812 (this file's header) | **813** |

**Reason:** carried-figure drift, self-contradicting.
**Disposition:** ALL FOUR CORRECTED, each with the contradiction named in place so the next pass sees
why the number moved. **Structural remedy adopted:** a bucket/count table now prints the SHA it was
executed at in its own heading — "at this HEAD" decays silently and nothing fails when it does.
Recorded as **invariant 71**.

**N34 — CORRECTED THIS PASS: FIVE `api.js` CITATIONS IN `structure.map.md`, AND FOUR WERE ALREADY
WRONG BEFORE THIS WINDOW'S DIFF.** Re-derived by grep, not by arithmetic:

| claim | said | truth at `fc6df72e` | stale at the PRIOR watermark too? |
|---|---|---|---|
| `_runCG = selfHostModules?.runCG ?? runCG` | `api.js:2409` | **`:2518`** | yes — 52 lines |
| `splitBlocks` self-host seam | `api.js:1082` | **`:1134`** | yes — 52 lines (below the insertion point) |
| `buildAST` self-host seam | `api.js:1208-1210` | **`:1316`** | yes |
| `selfHostModules` `@param` block | `api.js:665-677` | **`:703-716`** | yes — `:665` is the GITI-018 stdlib import-specifier rewriter, a different function |

The `_runCG` citation also appears in `primary.map.md`'s Task-Shape Routing and was corrected there.
**Reason:** stale line refs; four of the four predate this window, so the +57 lines `api.js` gained at
Stage 2.5c only widened an existing gap.
**Disposition:** all corrected in both maps.

**N35 — CORRECTED THIS PASS: `primary.map.md`'s PREFIX-GREP FIGURES WERE WRONG AT THEIR OWN
WATERMARK.** The map published `grep -cE '^\| E-' compiler/SPEC.md` = **912** and `W-` = **178** "at
this HEAD". **MEASURED by checking out that watermark's SPEC** (`git show 8b2e4053:compiler/SPEC.md`)
and re-grepping: **915** and **179**. At `fc6df72e`: **916** / **179** / `I-` 10 / `H-` 2.
**Reason:** carried figure, never re-derived.
**Why it is worth a finding rather than a silent patch:** SPEC moved by exactly ONE line this window,
so a figure that appeared to move +4 is definitionally a stale baseline. **A delta larger than the
diff can support is a self-evident tell, and this map set publishes several such series.**
**Disposition:** corrected, with the corrected series (`915 -> 916`) stated so the next pass has a
real baseline.

**N36 — CORRECTED THIS PASS: ONE FILE CITED ONE EMIT SITE AS TWO DIFFERENT WRONG LINES.**
`error.map.md` gave `E-EACH-BODY-DECL-UNSUPPORTED`'s fire site as **`emit-each.ts:1387`** in one
paragraph and **`:1416`** in a delta-ledger row. `domain.map.md` also carried `:1416`.
**VERIFIED:** `grep -n E-EACH-BODY-DECL-UNSUPPORTED compiler/src/codegen/emit-each.ts` returns
**`:1361`**. `emit-each.ts` is unchanged below line 2028 this window, so both were already wrong at
the prior watermark.
**Reason:** citation rot — the exact class §34 stripped its own `:line` references to stop.
**Disposition:** corrected in both maps to `:1361`, with the double-citation named in place.

**N37 — LIVE, OPERATOR-OWNED, AND IT IS NOT A NEW FINDING: `compiler/SPEC.md:11686` STILL ASSERTS A
BEHAVIOUR THE COMPILER DOES NOT HAVE.** Re-read at this watermark, byte-for-byte unchanged from S372:
§17.1.2.3's position table still says a markup `if=` on a NON-ROOT element inside an `<each>` row
template *"emits nothing — fails **CLOSED** (never renders)"*. It emits a real create-time append
gate plus `W-IF-IN-EACH` — renders-then-goes-stale. **This is N25, carried forward unresolved for a
second window.** **Suggested disposition: unchanged — update `SPEC.md:11686` to the measured
behaviour. Operator-owned; a mapper does not edit SPEC.**

---

## CLOSURES CONFIRMED THIS PASS

**N26 (S372) — CLOSED, AND THE SUGGESTED REMEDY WAS TAKEN IN FULL.** The report suggested correcting
`g-else-if-dotted-cell-ref-emits-unregistered-flat-key`'s stale `locus=` **and** "consider whether a
`locus=` should carry a SYMBOL rather than a line number". **Verified at this watermark:**
`docs/known-gaps.md:2687` now reads
`locus=compiler/src/codegen/emit-event-wiring.ts::computeChainBranchCondition::condition.name-arm`
with an inline note that the old `:647` was 142 lines adrift and that a locus should name a symbol.
**A symbol-form locus cannot rot under an insertion above it.** Worth recording because the report's
structural suggestions usually do not get taken.

**C8 (the four `*.generated.md`) — CLOSED THIS PASS BY REGENERATION.** They had been `@generated`
**2026-06-25** and were ~2 months stale, wrong against HEAD by ~37 source files and ~340 test files.
Re-run at this watermark from `flogence/`:
`bun scripts/mapgen.ts --kind {structure,errors,deps,tests} --root <repo> --write`. New figures:
structure **192 files / 1,478 exports**, deps **192 files / 672 edges**, errors **450 E-codes with
emit sites**, tests **1,384 across 11 dirs**.
⚠ **THE CLOSURE COMES WITH TWO POPULATION WARNINGS, because two of those numbers WILL be misread:**
`error.generated.md`'s **450** counts codes with a live EMIT SITE found by a source walk, while
`error.map.md`'s **813** counts §34 CATALOG rows — **different questions, neither wrong, do not
reconcile.** And `test.generated.md`'s **1,384** is a category-directory walk that skips
`fixtures`/`helpers`, so it misses the 14 root-level `compiler/tests/*.test.js` that make FACTS.md's
**1,398**. ⚠ **They remain gitignored (`.gitignore:3`, `.claude/`) and commit nothing**, so a future
pass gets no currency signal from `git status` on them and must re-run mapgen deliberately.

---

## CARRIED FINDINGS — RE-VERIFIED BY EXECUTION AT `fc6df72e`

| finding | status at this watermark | evidence |
|---|---|---|
| **N25 / N37** — `SPEC.md:11686` fails-CLOSED claim | **LIVE, unchanged** | line re-read; still *"emits nothing — fails CLOSED"* |
| **S331-N5** — `route-inference.ts:3438` cites SPEC **§6.6.20** | **LIVE, unchanged** | `:3438` still reads `§6.6.20`; `grep -c '§6.6.20' compiler/SPEC.md` returns **0** |
| **N6** — two consecutive `/** … */` blocks, the first contradicting the second, immediately above `skipDerivedWalkKey` | **LIVE, unchanged, SAME LINES** | blocks at `:3643-3657` and `:3658-3676`; `skipDerivedWalkKey` at `:3677` checks only `span` + `_`-prefix, while the FIRST block enumerates `span`/`loc`/`spans`/`parent`/`_scope`/`_record` |
| **C6** — `docs/tutorial.md` hardcodes an old version | **LIVE** | 4 occurrences of `v0.7.0`; `package.json` is `0.7.1` |

---

## NEW-DOC SCAN — this window's additions

Four new `docs/changes/<change-id>/` directories landed (`boot-trim-tier1-2026-08-25`,
`db-state-block-locus-2026-08-25`, `db-locus-blockcomment-fp-2026-08-26`,
`ruling2-bare-call-landing-2026-08-26`). **All are dispatch artifacts under the established
`docs/changes/` convention (BRIEF.md / progress.md / repro) and are NOT flagged** — that directory is
the archive location for dispatch provenance, not a current-truth surface.

⚠ **ONE NOTE, NOT A VIOLATION: `docs/changes/ruling2-bare-call-landing-2026-08-26/DE-RISK.md`
publishes point-in-time facts about an UNLANDED branch, and one has already moved.** It states
`origin/wip/s368-bare-call-build @ 7d5fe573` is *"42 commits behind `origin/main` as of 2026-08-26"*.
**Verified here: the branch and SHA are exactly as stated; the count is now 44** (`git rev-list
--count origin/wip/s368-bare-call-build..origin/main`), because #718 and the S376 wrap landed after
it was written. The doc is honest — it dates itself and says "Nothing built here" — and
`compiler/src/default-logic-exemption.ts` is correctly described as not on main (verified: the path
does not exist). **The note exists only so the next reader re-derives the behind-count rather than
quoting it.**

---

## Summary — S372 pass (PRIOR pass — carried for provenance)

**SEVEN findings (N25-N31). ALL SEVEN ARE LIVE.** Docs scanned: the maps themselves plus the
`docs/` surface this window's diff could have falsified. **The headline is that THREE separate
derived artifacts each outlived the code they described, and one of them is `compiler/SPEC.md`.**

⚑ **METHOD NOTE, AND IT IS THE POINT OF THE PASS: every finding below was REPRODUCED, not relayed.**
Two of the three source-contradiction findings were caught only because a claim was COMPILED rather
than read. See the S347 memory *"Relayed premises fail ~1 in 3"* — this pass measured 3 of 3 on the
claims it chose to execute.

---

**N25 — LIVE, AND IT IS THE SPEC ITSELF: `compiler/SPEC.md:11686` ASSERTS A BEHAVIOUR THE COMPILER
NO LONGER HAS.** §17.1.2.3's position table says a markup `if=` on a NON-ROOT element inside an
`<each>` row template *"emits nothing — fails **CLOSED** (never renders)"*. **PA-REPRODUCED at this
watermark by compiling** `<each in=@rows><li><span if=@.ok>YES</span><b>${@.name}</b></li></each>`:
the emitted client JS contains `if (_scrml_each_item.ok) _scrml_frag_3.appendChild(_scrml_el_4);` —
a real **create-time append gate** — and the compile emits `W-IF-IN-EACH`. So it RENDERS correctly at
row build and then goes STALE on a same-key reconcile; it does not "emit nothing" and does not "never
render". The row is marked *measured S302* and was overtaken by **#416 / GH adopter #409**, which
landed both the gate and the warning, and was never updated.
**Reason:** grep-mismatch / stale-measurement.
**Why it matters more than a prose slip:** the SPEC table is the natural scoping artifact for anyone
fixing `g-structural-if-inside-each-row-template-fails-open`, and it would send them to build a gate
that already exists while mischaracterising the failure mode of the position next to it.
**Suggested disposition:** update `compiler/SPEC.md:11686` to the measured behaviour (create-time
gate + `W-IF-IN-EACH`, renders-then-stale) — **operator-owned, this is a SPEC edit.** The corrected
table with the executed evidence is in domain.map.md §17.1.2; error.map.md's new "A PREDICATE WITH NO
DIAGNOSTIC" section and primary.map.md Task-Shape Routing row 3 both warn against scoping from it.

**N26 — LIVE, IN THE GAP LEDGER: `docs/known-gaps.md:2561` POINTS AT A LINE 142 AWAY FROM THE CODE.**
`g-else-if-dotted-cell-ref-emits-unregistered-flat-key` (MED, open, #692) carries
`locus=compiler/src/codegen/emit-event-wiring.ts:647(computeChainBranchCondition's condition.name
branch …)`. **Verified at this watermark:** `computeChainBranchCondition` is at **`:750`** and its
`condition.name` arm at **`:789-791`**; `:647` lands inside `computeDisplayToggleCondition`'s
always-truthy-gate block, a different function. **Mechanism: #704 inserted 192 lines ABOVE it**, and
the locus was recorded before that landed. **This is the same failure that cost three sessions at
S369-S371** (`g-usage-analyzer-…`, N19) — a `locus=` that reads authoritative and is not.
**Reason:** stale-locus after an unrelated insertion.
**Suggested disposition:** correct the `locus=` to `:789`; **and consider whether a `locus=` should
carry a SYMBOL rather than a line number**, since a line number is invalidated by any edit above it
while `computeChainBranchCondition`'s `condition.name` arm is stable. Recorded in the maps as
dependencies.map.md's §55 SYNTH-KEY RULE table + primary.map.md routing row 1, both of which name the
symbol and flag the stale figure.

**N27 — CORRECTED THIS PASS (MAP -> SOURCE DRIFT, INHERITED): FIVE LINE REFS IN
dependencies.map.md's `ifRaw`/`ifCond` TABLE WERE WRONG.** Verified against source at this watermark
and corrected in place: `captureStructuralIfAttr` `:2705` -> **`:2731`**; `structuralHeaderAnchor`
`:2797` -> **`:2823`**; `emitGatedStructural` `:1498` -> **`:1516`**; `emitIfMountGate` `:1421` ->
**`:1439`**; `isGateableIfValue` `:1472` -> **`:1490`**; the `E-IF-IN-DISPATCHED-ARM` guard `:1508` ->
**`:1526`**; `stripSourceTextFromValue` `:1681` -> **`:1611`**. And `visitStructuralIfAttr` was cited
at `:12688`, which is **neither** its definition (`type-system.ts:13190`) nor either call site
(`:12721`, `:12811`). `creditFromAttrValue` `:2559` was the only one still correct.
**Reason:** map-to-source drift across windows that did not re-walk this section.
**Suggested disposition:** DONE — corrected in dependencies.map.md this pass. ⚑ **The transferable
observation: a table of line numbers is a maintenance liability that no test covers.** Seven of eight
refs in one table had rotted. Prefer `symbol` + `file`, and treat a bare `:NNNN` as a hint.

**N28 — CORRECTED THIS PASS (MAP CONTRADICTED ITSELF, WHILE CLAIMING TO HAVE BEEN VERIFIED):
primary.map.md PUBLISHED THREE FIGURES THAT ITS OWN OTHER SECTIONS CONTRADICTED.**
  · The "Derived-figure authority" section said *"Re-read at this HEAD, not carried:"* and then gave
    `244,112` lines / `1,386` test files — where `docs/FACTS.md` at `b9e97f1b` read **`244,175` /
    `1,387`**, which is exactly what its own Fingerprint block twelve lines above said.
  · The diagnostic-lookup routing row said the census *"re-executed at this HEAD … returns **810
    rows** (+1: `E-MW-007`)"* — while error.map.md AND this file's own Map Index row both said **812**.
  · A Key Fact repeated `809 -> 810, E-MW-007`.
**Reason:** a carried S368 figure surviving a pass that had already corrected it elsewhere in the
same file. **Suggested disposition:** DONE — all three corrected by EXECUTION at this watermark
(`244,774` / `1,394`; census re-run: **812 rows**, STRUCK 34 · PINNED 343 · IMPL-SITES 302 ·
DECLARED-AHEAD 18 · RUNTIME-SURFACED 3 · FALSE-CLAIM 112). ⚑ **An internal contradiction inside ONE
map is the cheapest available tell that a "re-read" was a carry — diff a map against itself.**

**N29 — CORRECTED THIS PASS: test.map.md's "338 PINNED at this HEAD" IS WRONG, AND SO IS THE
IMPLICATION THAT `--full` DISAGREES WITH THE PLAIN CENSUS.** `bun scripts/s34-census.ts` and
`bun scripts/s34-census.ts --full` were BOTH executed at this watermark and BOTH return **PINNED
343**. The map's phrasing invited a reader to believe the two modes compute different pinned sets.
**Reason:** stale figure + a misleading framing. **Suggested disposition:** DONE — corrected in
test.map.md, with the equality between the two modes stated explicitly. Its category sum was also
re-counted recursively (`908+213+133+95+14+14+11+4+2 = 1,394`, agreeing exactly with FACTS.md).

**N30 — LIVE, AND IT IS THE MAP SET'S OWN OMISSION: TWO ROUTING HOLES WERE REPORTED INDEPENDENTLY BY
TWO SEPARATE DISPATCHES ON THE SAME DAY.** (a) No Task-Shape Routing row for `if=`/`show=` lowering
and none naming `codegen/emit-event-wiring.ts` for that concern — the file appeared in exactly ONE
row, about module-init ownership — **while four defects landed on it in this one window** (#704 plus
the three-defect §55 arc it closed). (b) No row for `eachBlockFromMarkupNode` or the lift-vs-structural
`<each>` split, which appeared **nowhere in the map set at all** while producing multiple dead-page
defects this session. **Two independent reports of the same absence is measurement, not opinion.**
**Reason:** structural — a routing table built by walking what CHANGED grows no row for a DISTINCTION,
because nothing "changes" at a fork; and it grows no row for a surface whose defects are silent.
**Suggested disposition:** DONE — Task-Shape Routing rows 1-3 added, invariants 69 + 70 added, with
supporting sections in dependencies.map.md (§55 SYNTH-KEY RULE), domain.map.md (§55 collapse matrix),
structure.map.md (six file entries) and error.map.md (the no-diagnostic class). ⚑ **Carried forward as
a standing check: after each window, ask which FORKS the window's defects turned on, not just which
FILES changed.**

**N31 — LIVE, IN SOURCE, UNCHANGED FROM LAST WINDOW AND RE-VERIFIED: `route-inference.ts:4959-4962`
STILL CITES `:5201` AND `:6233` WHERE THE CONSUMERS ARE `:5210` AND `:6242`.** Both still **9 lines
short** at this watermark (`markupReferencedNames.has(_fnNameForMarkup)` is at `:5210`;
`markupReferencedNames.has(nm) || exportedFnNames.has(nm)` inside the `clientRootIds` build is at
`:6242`, with `const clientRootIds` at `:6240`). This was filed last pass as N20 and **nothing has
moved on it** — `route-inference.ts` is `--name-only` EMPTY this window, so no touch has come along
to carry the fix. **Reason:** in-source comment drift.
**Suggested disposition:** correct on the next touch of the file; the comment's CLAIM is right and
load-bearing (invariant 68) — do not delete it. Recorded again so nothing re-publishes the figures.

---

## Summary — S371 pass (PRIOR pass — carried for provenance)

**SIX findings (N19-N24). FIVE ARE LIVE. The headline is not a doc: it is that a
DIAGNOSTIC'S LOCUS WAS WRONG IN THE LEDGER FOR THREE SESSIONS AND THE MAP SET HAD NOTHING TO
CONTRADICT IT.** The map set's own omission is the enabling condition, so it is filed as a finding
against these maps, not as a ledger typo.

**N19 — THE MAP SET CARRIED NO ROW FOR `W-DEAD-FUNCTION`, REACHABILITY, OR `usage-analyzer.ts`, AND
A WRONG LOCUS SURVIVED S369 -> S371 BECAUSE OF IT.** `docs/known-gaps.md` named
`locus=compiler/src/codegen/usage-analyzer.ts` for
`g-usage-analyzer-blind-to-each-in-collection-fn-ref`; a dispatch brief repeated it; the dev agent
working that surface had to re-derive the locus from source and said so explicitly. **Verified at
this watermark:** `usage-analyzer.ts` contains ONE occurrence of `W-DEAD` — a prose mention in a
comment at `:692` — exports only a boolean `FeatureUsage` bitmap, and its own header (`:16-17`)
states *"zero new diagnostics, zero AST mutation, zero emission."* The sole emit site is
`route-inference.ts:5615-5616`. **Disposition: CORRECTED THIS PASS in the maps** — a Task-Shape
Routing row (primary row 2), a dedicated `W-DEAD-FUNCTION` section in error.map.md, a positive row on
`route-inference.ts` and a NEGATIVE row on `usage-analyzer.ts` in structure.map.md, plus invariant 68.
The ledger's `locus=` was corrected by the operator this session. ⚑ **The transferable shape: a map
that omits a surface is not neutral — it is the absence of the thing that would have contradicted the
false claim.**

**N20 — LIVE, IN SOURCE, LANDED THIS WINDOW: `route-inference.ts:4959-4962` CITES `:5201` AND
`:6233`; THE ACTUAL CONSUMERS ARE `:5210` AND `:6242`.** Both citations are **9 lines short**. The
comment is the S371 correction block added by #688 itself, and its point is important and correct —
that `markupReferencedNames` feeds PLACEMENT decisions, not just the advisory warning — but the two
line numbers a reader would jump to are wrong. Mechanism: the numbers were computed before the
53-line insertion settled. **Disposition: correct the two numbers on the next touch of the file. Do
not delete the comment — its claim is right and load-bearing (invariant 68).**

**N21 — LIVE (CODE + TEST-INSTRUMENT): A SHIPPED CONFORMANCE CASE PASSES ITS OWN SUITE WHILE ITS PAGE
IS DEAD UNDER THE RUNTIME THAT ACTUALLY SHIPS.** PA-REPRODUCED at this watermark by compiling
`conformance/cases/each/ternary-markup-giti033` standalone: exit 0, and the emitted `page.client.js`
makes BARE calls to `_scrml_each_clear` (`:31`, `:101`, `:159`) and `_scrml_resolve_item` (`:46`,
`:54`, `:66`, …) — both defined in the **`reconciliation`** chunk, which is **absent from the emitted
`scrml-runtime.<hash>.js`**. First each render -> `ReferenceError` -> dead page. **The case passes
because the conformance (b) half executes the FULL `SCRML_RUNTIME` monolith**
(`conformance/adapters/impl1-ts.ts:467` and `:924`), not the pruned artifact. **Root cause
localized:** `detectRuntimeChunks` (`codegen/emit-client.ts:828`) walks AST *nodes* and has no
`markup-value` case, so an `<each>` inside a ternary-markup consequent — a `MarkupValueExpr`
(`types/ast.ts:2070`) nested in an EXPRESSION tree — is never visited. **Third instance of one class;
the other two are already fixed in that same file** (`case "engine-decl"` `:1707`, `case
"match-block"` `:1750`), each with the identical failure sentence in its own comment. ⚑ **Precision:
two further symbols are also unresolved (`_scrml_register_rehydrator` `:213`, `_scrml_chunk_loading`
`:220`, both `utilities`) and BOTH are `typeof`-guarded, so they are harmless — a symbol diff without
reading the call site reports 4 defects where there is 1.** **Disposition: NOT a doc fix — this is an
open defect plus a test-tier gap. Route to the PA for a gap-ledger entry and a fix decision. Recorded
in the maps as invariant 67 + Task-Shape Routing row 3 + a new test.map.md section.**

**N22 — LIVE, USER-FACING TEXT CONTRADICTS BEHAVIOUR: THE `W-DEAD-FUNCTION` MESSAGE PROMISES A
TREE-SHAKE THAT NEVER HAPPENS.** PA-EXECUTED at this watermark:
`<program>${ fn reallyDead() { return 41 } }<p>hello</p></program>` emits the warning *"It will be
tree-shaken from the output"* and `dist/page.client.js` **still contains `reallyDead`.** Already
ledgered this session as `g-wdead-function-tree-shaken-claim-is-false`. **Disposition: PA-owned;
recorded here so no map or brief repeats the message's own claim as a fact.**

**N23 — CORRECTED THIS PASS (MAP -> SOURCE DRIFT, INHERITED): structure.map.md cited
`detectRuntimeChunks` at `:273` and `POST_EMIT_HELPER_CHUNK_GATES` at `:2167`.** Actual at this
watermark: **`:828`** and **`:2869`**. Both were ALSO wrong at `728bdc92` (verified by reading
`git show 728bdc92:compiler/src/codegen/emit-client.ts`), so this is inherited rot, not a
this-window regression — which is worse, not better: it means a currency-verify pass re-published
them. **Disposition: corrected in structure.map.md this pass.**

**N24 — CORRECTED THIS PASS (MAP PROSE): a gap ID renamed in the ledger was stale in THREE maps.**
primary, domain and structure all cited `g-each-inline-value-form-match-interp-dropped`; the ledger
entry is now `g-each-inline-value-form-match-or-markup-branch-interp-dropped` (widened to cover the
markup-valued `if` branch). Related: #678's comment-only change to `codegen/emit-each.ts:1420`
retracted TWO false claims in that file's own comment — that the dropped case is *"captured in
`_droppedCFStmt`"* (**that identifier exists nowhere in the tree**, grep-verified at this watermark)
and that the skip *"WARNS instead of dropping silently"* (**it emits a JS comment into the artifact;
compile is exit 0 with nothing in `result.warnings`**). **Disposition: map prose corrected; the
source comment is already fixed on `main`.**

⚑ **WHAT THIS PASS DID NOT SCAN.** With a two-file source window, a full docs re-scan would have
re-derived the S368 population unchanged. The doc-population sections below (aspirational content,
uncertain docs, C-series) are **CARRIED VERBATIM from `728bdc92` and were NOT re-scanned**, except
the two `route-inference.ts` findings (N6, S331-N5) which WERE re-read at this HEAD because that file
changed. Treat every carried entry as `verify-before-acting`.

---

## Carried Summary — S368 pass (verbatim below this line)

**FIVE new findings (N14-N18). FOUR OF THE FIVE ARE THE MAP SET DESCRIBING BEHAVIOUR THE CODE NO
LONGER HAS — i.e. this pass's largest non-compliance population was the PRIOR GENERATION OF THESE
MAPS, not the repo's docs.** That is the honest headline and it is not comfortable: a 21-commit
window falsified four separate published claims, three of which a reader had no way to detect from
inside the map. All are corrected in this generation. Carried findings were re-verified at this HEAD
and the previous pass's N12/N13 are folded into the carried set below.

**N14 — FOUR MAPS PUBLISHED A "NOT ON MAIN, NOT MAPPED" EXCLUSION FOR CONTENT THAT HAD SINCE
LANDED.** primary, schema, structure and build all carried an explicit block saying the
`asIs`/`unknown` split (`InferenceResult`, `InferenceGap`, required `UnknownType.reason`),
`scripts/types-gate.ts` and `compiler/tests/TYPES-BASELINE.json` lived only on the unlanded branch
`feat/s365-asis-split-rung0`, and that *"at this watermark `UnknownType` is `{ kind: \"unknown\" }`
and NOTHING ELSE."* **All of it landed at `43eea9aa` (#665).** `git merge-base --is-ancestor
43eea9aa origin/main` exits 0; `type-system.ts:387-389` carries the required `reason`; both files
are in `git ls-tree HEAD` and on disk. ⚑ **The shape is the finding, not the instance: a
DELIBERATE, well-reasoned exclusion is exactly the kind of claim that rots silently, because it
reads as verified rather than as time-bound.** An exclusion for unlanded work should name the
condition that retires it, not just the state it observed. **Disposition: corrected in all four maps
this pass; schema.map.md was RE-WALKED specifically because a currency-verify would have
re-published the false claim.**

**N15 — test.map.md PUBLISHED AN ARITHMETIC VERIFICATION THAT WAS FALSE.** Its header read *"The
category sum re-checks: 885+196+132+92+11+8+4+2 = 1330, +14 top-level = **1378**."* **That sum is
1,344.** A 34-file shortfall was stated as a check that had been performed. Recounted RECURSIVELY at
this watermark, the real breakdown sums by execution: 901+213+133+94+14+14+11+4+2 = **1,386**
(`docs/FACTS.md` agrees). **The likely mechanism is method, not typo — several categories hold
`*.test.js` in SUBDIRECTORIES, and a non-recursive count undercounts.** ⚑ **A stated "the sum
re-checks" is a claim like any other; this one was never executed.** Disposition: corrected, and the
prior per-category figures are marked SUPERSEDED so nobody diffs against them.

**N16 — primary.map.md's Task-Shape Routing sent agents to a fix that had landed, labelled OPEN.**
The row for **`reset(@cell)` giving you a Promise instead of a value** read *"OPEN, HIGH, not
built."* #662 (`5639cd0a`) landed `_scrml_reset_apply` (`runtime-template.js:1179`) and both
re-invocation paths route through it. Disposition: corrected. **Class note: a routing row that
carries a STATUS is a currency liability in a way that a row carrying only a LOCATION is not.**

**⚑ N17 — A §34 CATALOG ROW ASSERTS A COUNTERFACTUAL THAT IS ACTUALLY THE CURRENT BEHAVIOUR, AND
THE DIAGNOSTIC IT DESCRIBES IS GATED ON THE COMPLEMENT OF THE LOCUS IT CLAIMS. VERIFIED BY
EXECUTION, NOT BY READING.** `E-CONTROL-FLOW-IN-MARKUP`'s row (and the §17.4 prose at
`SPEC.md:11765`) states that the §40.8 default-logic auto-lift *"fires only at
`<program>`/`<page>`/`<channel>` direct-child roots"* and that without it such a construct *"would
ship as raw `for(){}` text into the DOM."* **It ships.** Compiled at this watermark:

    <program>            ->  <body>if (1) { }<p>ok</p>…      exit 0, zero diagnostics
    if (1) { }
    <p>ok</>
    </program>

Two siblings of the same class reproduce identically (`log("M1");`, and a `//` comment flushing the
run around it). The mechanism is structural: the emit site (`ast-builder.js:1857-1860`) is gated
`parentType === "markup"`, the **COMPLEMENT** of the §40.8 default-logic locus, so the diagnostic
**cannot** fire there. **This is a doc describing behaviour the code does not have — pa.md Rule 4,
and it is in the NORMATIVE document.** ⚠ **Compounding it, `W-PROGRAM-REDUNDANT-LOGIC` actively
routes authors INTO the broken mode: it tells you to remove the `${…}` wrapper, and the wrapped form
is the one that works.** **Suggested disposition: this is NOT a map fix.** The bare-call limb is an
OPEN OPERATOR RULING (§40.8 is silent on a bare call — `g-default-logic-bare-call-is-unspecified-and-ships-as-page-text`),
the comment limb has a complete-but-unlanded fix
(`g-default-logic-comment-flushes-a-run-severing-a-statement-from-its-declaration`), and the bare-`if`
limb is covered by NEITHER and is the one that contradicts the SPEC row. **Either the row's claim is
corrected, or the gate is widened to the §40.8 locus — but the row cannot stay as written.**

**⚑ N18 — A NAVIGATION GAP IN THIS MAP SET, REPORTED INDEPENDENTLY BY TWO DISPATCHES BEFORE ANYONE
FILED IT: THE §40.8 / auto-lift SURFACE HAD NO ROUTING ROW AT ALL.** Three HIGH defects of one class
landed on `liftBareDeclarations` (`ast-builder.js:1161`) in a single session, and `§40.8` appeared in
primary.map.md only under `keep-alive` (invariant 29) and the one-onion rule — **neither of which
mentions lifting.** `liftBareDeclarations` appeared nowhere in any map. **The absence was not a
judgement that the surface did not matter; it was that nothing had ever routed through it, so no
generation had a reason to add a row.** ⚑ **The general shape: a routing table built by walking what
CHANGED will never grow a row for a surface whose defects are all SILENT — nothing changed there,
because nothing was fixed there.** **Disposition: CLOSED this pass** — the lift surface is now
Task-Shape Routing **row 1** (with all nine gates, their line numbers, the three reproductions, the
ruling-vs-fix split, the wider-than-§40.8 members and the cherry-pick-not-file-delta landing hazard),
invariant **64**, a Key Fact, and rows in structure/domain/error.

**N19 (minor, recorded not actioned) — NEITHER NEW DIAGNOSTIC CODE HAS AN LSP HOVER, AND ONE HAS NO
SPEC-INDEX ENTRY.** `lsp/handlers.js:ERROR_DESCRIPTIONS` carries 42 `W-*` entries and **zero
`W-TYPE-*`**, and has no entry for `E-STDLIB-CLIENT-CHUNK-MISSING` either — while `E-MW-007` got one
in the window it landed. `W-TYPE-031-UNPROVEN` has no `SPEC-INDEX.md` entry (`E-TYPE-031` has none
either, so that half is a family-level omission rather than a regression).
`E-STDLIB-CLIENT-CHUNK-MISSING` DOES have one (`SPEC-INDEX.md:214`). **Verified, not assumed:** the
#669 sweep that corrected two stale `(api.js)` attributions for the new code is clean — zero
remaining hits across `compiler/`, `docs/`.

**CARRIED FINDINGS — SPOT RE-VERIFIED BY EXECUTION AT `728bdc92`, all still live:** **C6**
`docs/tutorial.md` hardcodes `v0.7.0` at **4** sites while `package.json` is `0.7.1` · **C3** SPEC's
`data-scrml-each-mount` description (1 hit) still lacks the top-level/nested split the code makes ·
**N9** `docs/known-gaps.md` still calls `planBlockArmLift` "the single §18.5 classifier" (1 hit) and
`primary.map.md`'s routing row still says the opposite — **still needs a human to adjudicate BY
EXECUTION, not by reading** · **N6** `route-inference.ts:3643` still carries the two back-to-back
`/** Keys the derived-cell walk … */` blocks · **C4** the nine `W-LINT-*` codes with no §34 row are
unchanged · **C8** the four `*.generated.md` files are confirmed UNTRACKED (`git ls-files .claude/`
returns 16 paths, none of them a `.generated.md`), so the disposition remains a per-clone `rm` and
never a commit — their staleness has now reached ~2 months and 344 test files.



**TWO new findings (N12, N13), and BOTH were produced by re-deriving a number rather than carrying
it. Every carried finding was re-verified by EXECUTION at this HEAD; all still hold, and one
(C4) needed its derivation method corrected even though its FIGURE was right.**

**N12 — a SPEC-diff grep for new diagnostic codes returns THREE and TWO ARE FALSE. This mapper made
the error first and caught it before publishing, which is why it is filed as a method finding.**
`git diff <base>..<head> -- compiler/SPEC.md | grep '^+' | grep -oE 'E-[A-Z0-9]+-[0-9]+'` returns
`E-MW-007`, `E-PROGRAM-002`, `E-IMPORT-005`. Only `E-MW-007` is new. `E-PROGRAM-002` was already in
SPEC at `c93a692c` (mentions 1 -> 2) and `E-IMPORT-005` likewise (6 -> 7); the diff caught a new
PROSE MENTION of an existing code. **A code is new only when
`git show <base>:compiler/SPEC.md | grep -c '<CODE>'` is 0.** The two are not even the same kind of
neighbour: `E-PROGRAM-002` has **no emit site at all** (SPEC `:22811` says "TBD"), while
`E-IMPORT-005` is **fully live** and always was (`compiler/src/module-resolver.js:206`). Corrected in
error.map.md and domain.map.md before publication; recorded here because the flawed method is the
obvious one and will be reached for again.

**N13 — the §34 census's FALSE-CLAIM bucket moved 95 -> 112 and IMPL-SITES 320 -> 300 while the
catalog moved +1. That is a RECLASSIFICATION by a changed instrument, and nothing labels it as
one.** `scripts/s34-census.ts` gained +143 lines this window (#646) and now emits a disposition
table (`BUILD-ARC 71 · HOME-NO-SHALL 27 · ORPHAN-INDEX 4 · NOMINAL-HOME 10`) it did not previously
have. **The census prints the new buckets with no marker that the classifier changed**, so any
reader diffing this run against the S346 run reads a -20 / +17 swing as twenty regressions and
seventeen new broken diagnostics. It is neither. **Suggested disposition: the census should print
its own classifier version, or the map is the only thing standing between a reader and a wrong
conclusion.** Guarded in error.map.md this pass with an explicit "do not diff these across the
instrument change" note.

**RE-VERIFIED BY EXECUTION AT THIS HEAD — all carried findings still hold:**

| finding | re-verification run | verdict |
|---|---|---|
| **N6** route-inference.ts stale/contradicting doc comment | read `:3643-3660` — **TWO consecutive `/** Keys the derived-cell walk … */` blocks** still sit back to back, the second contradicting the first on the same function | **STILL LIVE** |
| **N7** census `source files` is environment-dependent | printed **1940** here vs **1864** (S346, fresh worktree) vs **1858** (S341) — **same commit class, three different numbers** | **STILL LIVE, and this is the strongest evidence yet** |
| **N8** `source-text-regex-census.ts` prints a baked `file:line` | `:170` still prints `type-system.ts:26048` | **STILL LIVE** |
| **N9** `planBlockArmLift` called "the single §18.5 classifier" | phrase live at `docs/known-gaps.md:8508` and `:8515` **and now also at `emit-control-flow.ts:2078`** — the divergence gap it contradicts is marked RESOLVED, so the phrase and the ledger now disagree in the OPPOSITE direction from the original finding | **STILL LIVE, DIRECTION CHANGED — see below** |
| **S331-N5** `route-inference.ts:3438` cites §6.6.20 | still `§6.6.20`; the section is §6.6.19 | **STILL LIVE** |
| **C3** SPEC §52.15.5 describes `<div data-scrml-each-mount>` | still at SPEC `:32624`; code shows the div is retired for NESTED each (`runtime-template.js:2217`) but **still emitted for TOP-LEVEL each** (`emit-ssr-render.ts:411`) | **STILL LIVE, and NARROWER than recorded — see below** |
| **C4** nine live `W-LINT-*` codes with no §34 row | re-derived: `W-LINT-016 017 018 019 020 021 022 023 024` — **NINE, confirmed** | **STILL LIVE, figure confirmed, METHOD corrected — see below** |
| **C6** `docs/tutorial.md` hardcodes `v0.7.0` | **4 sites**; `package.json` is `0.7.1` | **STILL LIVE** |
| **S322-N1** `g-auto-await-family-…-150-…` bakes 150 into an id measuring 142 | id unchanged at `docs/known-gaps.md:427` | **STILL LIVE** |

### C4 — the FIGURE was right and the obvious METHOD is wrong in BOTH directions

Nine is confirmed, but a naive `comm` of "codes appearing in `compiler/src/`" against "codes
appearing anywhere in `compiler/SPEC.md`" returns **TEN**, and it is wrong twice over:

- **It ADDS `W-LINT-009`, which is not a fire site.** The only occurrence is a COMMENT —
  `lint-ghost-patterns.js:929`, *"(No separate entry for W-LINT-009 — W-LINT-004 subsumes it.)"*
- **It DROPS `W-LINT-018`, which IS one.** The code appears in SPEC PROSE but has no §34 table row,
  so "mentioned in SPEC" wrongly clears it.

**The correct derivation bounds BOTH sides:** table rows only (`^\| W-LINT-[0-9]+ \|`) on the SPEC
side, and an actual `code:` assignment on the source side. **A code's presence in a comment is not a
fire, and its presence in prose is not a row.**

### N9 — the finding INVERTED this window and the inversion is the interesting part

The original finding was that `docs/known-gaps.md` calls `planBlockArmLift` "the single §18.5
classifier" while a second, ad-hoc classifier demonstrably existed. **What changed: the gap that
recorded the divergence (`g-match-block-iife-tail-classifier-diverges-from-shared-plan`) is now
marked `RESOLVED S330-peter`, and the phrase has PROPAGATED INTO THE SOURCE** —
`emit-control-flow.ts:2078` now also says "the single §18.5 classifier". Meanwhile
`primary.map.md`'s own routing row still says the opposite: *"Grep `_blockTailIsValueExpr`
(`emit-logic.ts:4653`), NOT `planBlockArmLift` — the latter finds only the two RAW-STRING routes."*
**Three artifacts, two incompatible claims, and the source now carries one of them.**
**Suggested disposition: needs a human to adjudicate by EXECUTION** — determine whether
`planBlockArmLift` is genuinely the sole tail classifier at this HEAD, then make the gap ledger, the
source comment and the primary routing row agree. Do not resolve it by reading.

### C3 — narrower than recorded, and the record should say so

`<div data-scrml-each-mount>` is **not** uniformly retired. `runtime-template.js:2217` describes the
replacement as foster-safe "unlike the old `<div data-scrml-each-mount>`" (nested each), but
`emit-ssr-render.ts:411` states *"Only a TOP-LEVEL each mounts to a static `data-scrml-each-mount`
div"* and `runtime-template.js:3121` still does a `[data-scrml-each-mount]` querySelector.
**Suggested disposition: amend the finding from "SPEC describes a retired attribute" to "SPEC
describes it without the top-level/nested split the code makes."** The SPEC text at `:32624` is not
false — it is under-specified.


## S346-pass findings (N10-N11) — RE-VERIFIED at this HEAD, both still live

**N10** (`docs/PA-SCRML-PRIMER.md` §13.5 under audit) — the audit charter is still the governing
artifact and the S346 ruling stands: **corpus-zero is blast-radius evidence ONLY, never demand
evidence.** This window ADDED an enforcement surface for it (`scripts/corpus-zero-debt.ts`, #552),
which makes the distinction more load-bearing, not less — a probe that measures zero uses must not
be read as a probe that measures zero need. Still FLAG, DO NOT DELETE.

**N11** ("the bunfig default 10s per-test timeout") — still live in the test comments; the real
budget is still bun's default 5000 ms and `bunfig.toml [test] timeout` is still deleted. Invariant
56 carries.

### N10. `docs/PA-SCRML-PRIMER.md` §13.5 — the sliver table + the "doc-only surface" dispatch principle are UNDER AUDIT (S346 ruling)

**Location:** `docs/PA-SCRML-PRIMER.md:1154` (section heading "§13.5 Spec real-estate vs adoption —
known slivers + doc-only surfaces (S64 audit)") through the general principle at `:1168` ("PA should
not dispatch implementation work against a doc-only surface, and should not assume a sliver…").

**Reason:** content-heuristic + a live operator ruling. The table's verdicts derive corpus-use counts
(S64 vintage) into prioritisation guidance. **bryan ratified at S346 that corpus-emptiness is not
evidence about whether to build** — the sliding-doors audit
(`scrml-support/docs/audits/sliding-doors-corpus-zero-2026-08-16/CHARTER.md`, verified present, with
`candidate-sites-raw.txt` beside it) is re-examining exactly this class of zero-use surface.

**Suggested disposition: FLAG, DO NOT DELETE, DO NOT UPDATE YET.** The table's FACTUAL half (which
surfaces have zero source-level uses) may still be true; its NORMATIVE half (what the PA should do
about that) is contested pending the audit. Annotating the section as under-audit is the PA's edit to
make, not this mapper's. Until then: do not cite §13.5 as a dispatch-blocking rule.

### N11. Three test files cite "the bunfig default 10s per-test timeout" — a number that was never in force

**Locations (verified at this HEAD):**
- `compiler/tests/conformance/corpus-bridge.test.js:12` — "each well under the 10s per-test timeout"
- `compiler/tests/integration/self-compilation.test.js:494` — "The bunfig default 10s per-test timeout is exceeded ONLY under that…"
- `compiler/tests/integration/trucking-dispatch-smoke-integration.test.js:144` and `:528-531` — "…intermittently breaches the bunfig default 10s per-test timeout…"

**Reason:** grep-mismatch against the config file the comments cite. `bunfig.toml` carried
`[test] timeout = 10000` until #537 — **and bun never read the key** (bun 1.3.14, verified; the
effective budget is the default 5000 ms). The comments were false when written and are now doubly so:
the key they reference no longer exists, and `bunfig.toml`'s own comment block states the truth.
Any reasoning in those files premised on "we have 10 s" (e.g. self-compilation's exceeded-only-under
analysis) should be re-derived against 5000 ms.

**Suggested disposition: update the comments to match (5000 ms default; a slow test declares its own
site budget).** Test-file edits are outside this mapper's scope — routed to the PA. Low urgency:
comments only, no assertion depends on the number; the hazard is the next timeout triage inheriting
the phantom 10 s.

## S341-pass findings (N6-N9) — RE-VERIFIED at this HEAD, all still live

### N6. **RE-VERIFIED AT `b9e97f1b` (S371) — STILL LIVE, UNCHANGED BY #688.** Two consecutive `/** … */` blocks remain at `:3643-3657` and `:3658-3676` immediately above the same function. A STALE, ORPHANED DOC COMMENT IS LIVE ON `main` — `route-inference.ts:3643-3657` contradicts the block directly below it, on the same function

**This is a source-code finding, not a docs one, and it sits inside a confidentiality check.**

`compiler/src/route-inference.ts` carries **TWO consecutive `/** … */` blocks** immediately above
`skipDerivedWalkKey` (`:3677`). The FIRST (`:3643-3657`) describes a **SIX-entry deny-list**:

> *"either non-AST baggage (`span`, `loc`), a non-plain container the walk cannot read anyway (`spans`
> is a `Map`), a back-reference that would make the walk revisit the tree (`parent`), or scope/symbol
> side-tables … (`_scope`, `_record`)"*

The SECOND — the current one — **explicitly records that the S337 review DELETED `parent`, `loc` and
`spans`**, because none exists as a node field at RI time and each was "pure FAIL-OPEN SURFACE".

**The shipped predicate is the two-clause one:** `key === "span" || key.startsWith("_")`.

**Why this is worth a finding rather than a nit.** The stale block is the FIRST thing a reader hits,
it is confident and specific, and **it argues for keeping exactly the entries the review removed.**
A future maintainer restoring `parent` to that list would silently re-open the fail-open surface the
S337 review closed — and would believe they were following the file's own guidance. The two blocks
are not merely redundant; **they disagree about a security-relevant decision.**

**Disposition: delete the first block (`:3643-3657`).** Compiler-source edit — **NOT performed by
this dispatch** (scope-barred from `compiler/src/`). Routed to the PA.

### N7. `s34-census.ts`'s published `source files` figure is ENVIRONMENT-DEPENDENT — the prior map set's `1887` does not reproduce at any commit

`filesScanned` (`scripts/s34-census.ts:184`) increments over a **FILESYSTEM walk** of ten roots
(`compiler/src`, `native-parser`, `runtime`, `compiler/scripts`, `self-host`, `self-host-v2`, `lsp`,
`scripts`, `stdlib`, `compiler/tests`). It therefore counts whatever **gitignored build output** the
checkout happens to hold. In a fresh worktree, tracked and on-disk agree exactly (**1,858 = 1,858**);
in a built checkout they do not, which is where `1887` came from.

**Three map files published it as a repo fact** (primary, structure, error) and one of them used it
in a delta comparison. **All three were corrected at the S341 pass**, and each now carries the tracked figure
(1,850 → 1,858, +8 = 3 new `scripts/` probes + 5 new test files) with the caveat.

**The generalisable rule, now written into primary.map.md: a count that walks the filesystem is not a
repo fact. Publish the index-derived number, or state which environment produced it.** Note this is
NOT a defect in `s34-census.ts` — the figure is a scan-scope diagnostic for the tool's own operator
and is fine in that role. **The defect is quoting it as a repo measurement.**

**Sibling instance found while verifying the same class, and it runs the other way:** `docs/FACTS.md`
counts `test files` as **`*.test.js` only**, excluding the 15 `*.test.ts` files under the same tree.
So `git ls-files` on `*.test.*` returns **1,361** where FACTS says **1,339**. **Neither is wrong;
they count different populations.** test.map.md now says so explicitly, because a future pass that
"corrects" one to the other would be introducing an error.

**Disposition: no code change owed. The map corrections are landed. Optionally, `facts.ts` could
label the census figure or drop it — the PA's call.**

### N8. `scripts/source-text-regex-census.ts` PRINTS a baked `file:line` — the exact rot class this repo stripped from §34 at S305

The script's runtime output includes:

```
see `postRe.test(t)` — the site of the confirmed defect at type-system.ts:26048.
```

(`scripts/source-text-regex-census.ts:167` at this HEAD — #524's `toRel`/`--selftest` additions shifted it from `:136` — and the same citation in its header at `:38`. Re-verified live this pass.)

**It is CORRECT at this HEAD — verified: `type-system.ts:26048` is
`const postRe = new RegExp(...)`.** That is precisely what makes it a hazard rather than a bug today.
**A baked `:line` in a maintained artifact rots silently and nothing fails** — this repo already
ruled on that class (S305 stripped 103 `file:line` citations from §34 down to 5, keeping file paths
and dropping line numbers) and structure.map.md carries two line-number corrections from the same
cause. **A number printed to an operator by a running tool is worse than one in a doc, because it
carries the authority of having just been computed.**

**Disposition: replace with `type-system.ts` + the symbol (`postRe`), matching the S305 ruling.**
`scripts/` edit — **NOT performed by this dispatch** (scope-barred). Routed to the PA.

**Note the honest half, which is not a finding and should not be read as one:** the same script
declares its own blind spot in its header — it keys on argument identifier NAMES, so it cannot see
`postRe.test(t)`, and its author records that a probe built to detect pattern-matching-instead-of-
resolving-structure inherited exactly that blind spot, and names the structural successor. **That is
a model self-report and this pass has no criticism of it.**

### N9. `docs/known-gaps.md` still calls `planBlockArmLift` "the single §18.5 classifier" — the S331 finding is UNRESOLVED and the phrase is still propagating

Re-verified at this HEAD: `docs/known-gaps.md:7925` ("the single §18.5 classifier") and `:7932`
("the single §18.5 tail classifier"). **This was filed as S331-N1, the maps were corrected, and the
SOURCE of the phrase was not.** The maps now contradict the ledger on a point that has already cost
one session (an agent sent to two wrong loci).

⚠ **This dispatch is SCOPE-BARRED from `docs/known-gaps.md`** (S340-peter may be live on it), so it
is reported, not fixed. **Nothing has changed about the finding except that it is now a window
older** — and `emit-logic.*`/`emit-control-flow.*` are zero-diff this window, so the correction
"segmenter for TWO of FOUR routes; the leaf predicate is `_blockTailIsValueExpr`" is verified still
accurate.
## RESOLVED (S341 pass) — closures re-verified still closed at this HEAD

### S326-N-series / S328 / S331 — THE OFF-MAIN MAP STAMP: **CLOSED, at the source**

Reported three times across four passes and recurring every time. Closed by (a) the MAP-STAMP RULE
block at the top of primary.map.md, which specifies the OUTBOUND check and the three-command
procedure, (b) the amendment to invariant 48 separating inbound from outbound, and (c) restamping all
thirteen files, including the two whose orphaned stamps predated the prior pass entirely
(`fe14c9b2`, S302; `97576f35`, S326). **Verified by exit-0 on
`git merge-base --is-ancestor <stamp> origin/main` for every map, and by `bun scripts/state.ts` now
printing a real behind-count where it previously printed `behind-count unavailable`.**

**The convention that CAUSED the recurrence is also retired, and naming it matters:** prior passes
deliberately froze line 3 at the last walk's SHA to signal "this map was not re-walked". The
INTENTION was right — an honest older stamp beats a false "verified at HEAD". **The mechanism was
wrong: line 3 is a CURRENCY ANCHOR consumed by a tool, not a provenance note read by a human.**
Provenance now lives on a separate "content as of X" line, and every map's own header still carries
the zero-diff command justifying not re-walking it.

### S320-N1 — **CLOSED.** `scripts/s34-census.ts` is no longer broken on any platform

Carried for **four consecutive passes** as "the one-line code fix is still owed". #473 (`0beddacc`,
S332-peter) landed it: `fileURLToPath(import.meta.url)` replaces
`new URL(import.meta.url).pathname`, mirroring `scripts/facts.ts` one file over. Re-executed at this
HEAD: `807 rows (§34 19113..19991, derived) · 1887 source files · 880 conformance cases`.

**The map set's own guidance was the collateral damage and it is now retired, not softened.**
primary.map.md, error.map.md and structure.map.md each carried a "broken / broken-on-Windows, fall
back to the manual table-column methodology" caveat. All three now say **run the oracle first, on
any platform**, and the manual `awk -F'|'` methodology is re-labelled an **independent cross-check**
rather than a fallback. (It agreed this pass: 808 EWIH rows = 807 `[EWI]` + 1 `H-LIFECYCLE-001`.)

⚠ **The gap ledger has NOT caught up** — see N3.

### S326-N3 — **PARTIALLY CLOSED**, and the closure is structural rather than editorial

The heading-vs-marker drift itself is not fixed (13 instances stand, N4). **What IS fixed is the
blindness**: #485 shipped `headingMarkerDrift()` in `scripts/state.ts`, so the disagreement is now
reported on every `--check` run instead of being rediscovered by each map pass with a different
hand count (10, then 19, now a reproducible 13). **A finding that moves from "estimated by hand each
pass" to "printed by a probe" has changed category**, even with the same instances outstanding.

---

## Carried findings — RE-VERIFIED at this HEAD

**Every finding below was RE-RUN at `4f034e13`, not carried forward on faith. Each states the command
that re-verified it.**

### S331-N2 (carried, UNCHANGED). `SPEC.md` §12.6 contradicts §12.2 — it names the WRONG server-only module set for placement

Re-verified: `SPEC.md:7444` still reads *"Trigger 1, a server-only resource / server-only stdlib
import per the `SERVER_ONLY_SCRML_MODULES` set; or Trigger 3, a `?{}` SQL context"*.

**Two defects in one clause, and the second is the serious one.** (a) It numbers the §12.2 triggers
differently from §12.2 itself — §12.2's Trigger 3 IS the server-only import; §12.6 calls that Trigger
1 and gives Trigger 3 to `?{}` SQL. (b) **It names `SERVER_ONLY_SCRML_MODULES` for a PLACEMENT
decision.** That set feeds ASYNC classification, where over-inclusion is safe;
`ESCALATION_SERVER_ONLY_MODULES` is the placement set, where neither direction is safe. **Conflating
them is the exact defect the S299 amendment exists to prevent, and here it sits inside a normative
clause** — two sections after `SPEC.md:7312` where §12.2 states the correct scope rule. **A reader
who reaches §12.6 first gets the wrong module set from a SHALL.**

**Still open. SPEC edit — scope-barred from this dispatch.** Routed to the PA.

### S331-N5 **RE-VERIFIED AT `b9e97f1b` (S371) — STILL LIVE.** `:3438` still reads `§6.6.20`; `grep -n '§6.6.20' compiler/SPEC.md` returns ZERO hits while `#### 6.6.19` sits at `SPEC.md:3694`. (carried, UNCHANGED). `route-inference.ts:3438` cites SPEC **§6.6.20**; the section is **§6.6.19**

Re-verified verbatim at this HEAD: `* the derived-cell-RHS one (\`collectDerivedRhsServerOnlyRefs\`, §6.6.20).`

A one-character miscitation in the doc comment of the very function the section governs. **Note this
survived a window in which the surrounding function was substantially rewritten (#500, +125 lines) —
the rewrite touched the code and not the citation**, which is the ordinary way a citation rots.
Compiler-source edit — scope-barred. Routed to the PA.

### S331-N3 / S331-N4 (carried, NOT RE-MEASURED — deliberately). `docs/known-gaps.md` status drift

The prior pass found THREE entries reading `status=open` whose fixes had landed, and a
machine-measured **13** entries whose `### ` heading status disagrees with their `@gap` marker.

⚠ **THIS PASS DID NOT RE-MEASURE EITHER, AND THAT IS A DELIBERATE SCOPE DECISION RATHER THAN AN
OMISSION.** The dispatch brief bars this worktree from `docs/known-gaps.md` because S340-peter may be
live on that file, and **re-measuring a contended ledger from a stale worktree would produce a number
that is wrong the moment it is written.** `bun scripts/state.ts --check` prints the drift count
(#485) and is the live authority. **Do not carry 3 or 13 forward from this report as current.**

The standing rule the findings produced is unchanged and does not need a re-measure to hold:
**`state.ts` parses the MARKER, so the rollup and its CI gate are correct and blind to the
disagreement — and the heading is the line a grep returns.**

### C3. SPEC §52.15.5 still describes the retired `<div data-scrml-each-mount>`
**Still open.** `grep -c "data-scrml-each-mount" compiler/SPEC.md` = **1**. Unchanged this window.

### C4. NINE live `W-LINT-*` codes have no §34 row — **re-derived at this HEAD, and NINE is confirmed**
**Still open, count CONFIRMED at nine.** `W-LINT-016` … `W-LINT-024`, each with a real
`code: "W-LINT-0NN"` push site in `compiler/src/lint-ghost-patterns.js` and **0** rows in §34.

⚠ **A METHODOLOGY NOTE, because this pass's FIRST cut of this measurement was WRONG in the exact way
the map set warns about.** A naive `comm`-diff of "all `W-LINT-*` tokens in `compiler/src/`" against
"all `W-LINT-*` §34 rows" returns **ELEVEN**, not nine. The two extras are not codes:
`W-LINT-NNN` is a JSDoc PLACEHOLDER (`lint-ghost-patterns.js:62`, `:696`), and `W-LINT-009` appears
only inside a COMMENT — `// (No separate entry for W-LINT-009 — W-LINT-004 subsumes it.)`
(`:868`). **A grep hit is not a fire site.** Nine is the figure that survives reading each hit, and
it is the same nine the prior pass recorded — so this is a confirmation, not a widening.

### C5. `compiler/SPEC-INDEX.md` — the generated half is current, the AUTHORED half is not
**Still open.** The generated totals + section row-ranges regenerated this window (**33 row-range
lines rewritten, net zero lines** — CI-gated by `scripts/regen-spec-index.ts --check`; the two new
§34 rows shifted every range below them). **Only the totals and ranges are gated.** The authored
per-section prose is ungated, was not touched, and continues to rot.

### C6. `docs/tutorial.md` hardcodes `v0.7.0` at four sites while `package.json` is `0.7.1`
**Still open, count unchanged at 4.** Re-verified: `grep -c "v0\.7\.0" docs/tutorial.md` = 4;
`package.json` `"version": "0.7.1"`.

### C7. `compiler/native-parser/` — zero diff, none owed
**Still true.** `git diff --name-only 8863d457..4f034e13 -- compiler/native-parser/` is **EMPTY**.
The standing `.scrml`-mirror feature-staleness gap is unchanged and nothing this window widened it.

⚠ **But note WHY nothing is owed, because the reason is thinner than it looks.** Every codegen change
this window landed in `compiler/src/codegen/`, and the native parser mirrors the PARSER, not the
emitters. **`name-resolver.ts` DID move (`<timeout>` added to `SCRML_NON_ELEMENT_TAGS_EXTRA`) and it
is a resolution-stage file** — verified no `native-parser/` counterpart exists for that list, so no
mirror obligation attaches. A future lifecycle-tag addition that touches the tokenizer or the block
splitter WOULD attach one.

### C8. The four `*.generated.md` indexes — **CLOSED AT S376 BY REGENERATION. The S372 reclassification text is retained below for provenance; its "absent from this worktree" observation was true of the S372 worktree and is NOT true of the main checkout, where all four exist.**

> **S376 CLOSURE.** Re-run from `flogence/` with `bun scripts/mapgen.ts --kind {structure,errors,deps,tests} --root <repo> --write`. Figures moved `2026-06-25` -> `fc6df72e`: structure **155 -> 192 files / 1,128 -> 1,478 exports** · deps **155 -> 192 files / 488 -> 672 edges** · errors **353 -> 450 E-codes** · tests **1,042 -> 1,384**. ⚠ **Two of those numbers are a DIFFERENT POPULATION from the curated maps' and must not be reconciled:** `error.generated.md`'s 450 counts codes with a live EMIT SITE (source walk) while `error.map.md`'s 813 counts §34 CATALOG rows; `test.generated.md`'s 1,384 is a category-directory walk that skips `fixtures`/`helpers` and therefore misses the 14 root-level `compiler/tests/*.test.js` that make FACTS.md's 1,398. **The gitignored status is unchanged, so this closure buys no standing currency — the next pass must re-run mapgen deliberately or these go stale again silently.**


**They are NOT tracked files, and they never have been.** `git ls-files .claude/` returns exactly 16
paths — the 13 maps, `agents/project-mapper.md`, `settings.json`, `statusline.mjs` — and
`git log --all --diff-filter=AD -- '.claude/maps/*.generated.md'` is **EMPTY**. `.claude/` is
gitignored with `.claude/maps/` force-tracked, so those four files exist only as **untracked,
per-clone local artifacts** in whichever checkout generated them. They are absent from this worktree
entirely.

**Why the reclassification matters more than the original finding.** For five windows this report
listed them under repo non-compliance with the disposition "delete them", implying a commit. **There
is nothing to commit.** The correct disposition is a per-clone `rm` — and, one level up, the real
finding is that **a stale generator's output living beside the hand-walked maps, invisible to git, is
a class no repo-level gate can ever see.** A future pass that greps the repo for them will find
nothing and may conclude the finding was resolved.

**This pass could not re-measure their contents** (they are not in this worktree), so the carried
"`test.generated.md` claims 1042" figure is **unverified at this HEAD and should not be requoted.**
What IS verifiable: the true count is **1,339**.

**Suggested disposition: `rm` them in each clone that has them, and — the part that actually closes
the class — either retire the generator or have it write inside a tracked path so a gate can reach
its output.** Routed to the PA; nothing here is a repo edit.

### S313-N5. `scripts/git-hooks/pre-push` — comment still stale
**Still open.** Unchanged this window (`scripts/git-hooks/` has zero diff).

### S322-N1. `g-auto-await-family-not-closed-…` bakes **150** into an ID whose measurement is **142**
**Still open.** Unchanged this window. The ID is load-bearing for grep, so the disposition remains
"leave the ID, correct the body" rather than a rename.

---

## Map corrections applied this pass — what was WRONG and is now right

Recorded here rather than fixed silently, because the corrections ARE findings.

### S376 corrections (this pass)

| map | claim as carried | truth at `fc6df72e` | how verified | already wrong at the PRIOR stamp? |
|---|---|---|---|---|
| structure · auth | `emit-server.ts` emits `_scrml_dispatch` / `_scrml_onion_dispatch` at `:521` / `:~454-521` | **`commands/build.js:514` / `:521`**; neither symbol exists under `compiler/src/codegen/` | grepped the SYMBOL, not the line | **yes — since #654** |
| structure · primary | `api.js:2409` = `_runCG` seam | **`:2518`** | grep | yes (52 lines) |
| structure | `api.js:1082` = `splitBlocks` seam | **`:1134`** | grep | yes (52 lines) |
| structure | `api.js:1208-1210` = `buildAST` seam | **`:1316`** | grep | yes |
| structure | `api.js:665-677` = the `selfHostModules` `@param` block | **`:703-716`** (`:665` is the GITI-018 import rewriter) | read both ranges | yes |
| structure | `compiler/src` = 189 tracked files | **194** (145 `.ts` + 47 `.js` + 1 `.md` + 1 `.json`) | `git ls-files` | yes |
| structure | "~20 top-level analysis modules" with no lint count | **nine top-level `lint-*.js`** + two under `validators/` | `ls` | n/a (new detail) |
| error · domain | `E-EACH-BODY-DECL-UNSUPPORTED` at `emit-each.ts:1387` **and** `:1416` (two values, one file) | **`:1361`** | grep | yes — file unchanged below :2028 this window |
| error | census buckets "at this HEAD" = 338 / 320 / 14 / 95 | **343 / 303 / 18 / 112** | `bun scripts/s34-census.ts` re-executed | yes (S346 figures) |
| error | catalog = 812 | **813** | census | n/a (this window's +1) |
| test | heading total 1,387 (vs its own header's 1,394) | **1,398** | `find` | yes |
| test | table unit 901 / browser 94 (vs its own prose's 908 / 95) | **909 / 98** | `find` per dir | yes |
| primary | §34 total 810 (vs its own header's 812) | **813** | census | yes |
| primary | `grep -cE '^\| E-'` = 912, `W-` = 178 | **916 / 179** here; **915 / 179** at the PRIOR stamp | re-grepped `git show 8b2e4053:compiler/SPEC.md` | **yes — wrong at its own stamp** |
| primary | FACTS 244,774 / 191 files / 1,394 tests / SPEC 37,539 | **245,517 / 192 / 1,398 / 37,540** | `cat docs/FACTS.md` | n/a (this window) |
| primary | `test files` cross-check = 1,378 | **1,398** | `find` | yes |
| primary · domain | `eachBlockFromMarkupNode` at `emit-each.ts:3266` | **`:3309`** | grep | no — #710 inserted 43 lines above it |
| primary | "SPEC-INDEX.md did NOT regenerate this window — byte-identical" | **it moved 110 lines** (1 generated total + 54 authored-prose rows, #709's boot-trim rotation) | `git diff --numstat` | n/a (this window) |
| primary | the four `*.generated.md` "were NOT touched this pass and cannot be" | **regenerated this pass**; new figures recorded, with population warnings | ran `mapgen.ts` | n/a |

**⚑ Nine of the nineteen rows above were already wrong at the PRIOR watermark.** This window's diff
did not cause them; it only made two of them worse. **A refresh that only walks what CHANGED will
never find them** — which is the standing argument for grepping a sample of carried citations by
SYMBOL every pass, and for diffing any figure that appears twice in one file against itself.

### Prior passes' correction ledger

> **The table below is the PRIOR passes' correction ledger, retained because each rule it produced is
> still the rule.** **This pass's (S372) corrections are the rows appended at the very bottom.**

| Map claim (prior generation) | Truth at `4f034e13` |
|---|---|
| §18.5: `planBlockArmLift` reads as the single classifier every path routes through | **FOUR emission routes; `planBlockArmLift` has TWO call sites and is the segmenter+plan for the raw-string pair. `_blockTailIsValueExpr` is the single leaf predicate.** Four-route table added to domain.map.md; invariant 49 added; dependencies.map.md's §18.5 row rewritten in place |
| §12.2 Trigger 3 described without a scope statement | **Escalation is per-FUNCTION and reaches no other position (`SPEC.md:7312`, normative this window). Two non-function positions still LEAK with no diagnostic.** Scope table added to domain.map.md; invariant 50 added; auth.map.md gains the coverage table |
| `_blockTailIsValueExpr` at `emit-logic.ts:4535` | **`:4653`** |
| `inverseCallerMap` at `route-inference.ts:4466`; `indirectInverseCallerMap` at `:4707`; `W-AUTH-MIDDLEWARE-AUTO-INJECTED` at `:5648` | **`:4727` · `:4968` · `:6001`** |
| `SERVER_ONLY_SCRML_MODULES` at `route-inference.ts:578`; `ESCALATION_…` at `:655` | **`:579` · `:656`** |
| §34 catalog **806**, "unchanged" | **807** — first movement in five windows (`E-DERIVED-SERVER-ONLY-REACH`) |
| `s34-census.ts` "broken on Windows, use the manual fallback" | **FIXED (#473). Runs everywhere. The manual method is a cross-check, not a fallback** |
| counts across four maps: 238,974 lines / 1,328 tests / 37,074 SPEC / 865 conformance | **240,107 / 1,334 / 37,150 / 880**, each independently re-derived and cross-checked three ways |
| `test.generated.md`: 1042 `.test.js` | **1,339** (under-reports by **297**) |
| **THIS PASS —** map stamps `616688ea` / `fe14c9b2` / `97576f35` presented as currency anchors | **all three are ORPHANED BRANCH TIPS.** Restamped to `4f034e13`; provenance moved to a "content as of X" line. **`fe14c9b2` had been orphaned since S302 and no prior pass caught it, because every prior audit checked `primary.map.md` only.** |
| **THIS PASS —** `1887 source files` published in three maps as a repo measurement | **environment-dependent; does not reproduce at any commit.** Tracked figure 1,850 → 1,858. See N7. |
| **THIS PASS —** §6.6.19 described as closing the derived-cell position (S331 framing) | **TRUE-BUT-INCOMPLETE, and the incompleteness was a live leak.** The refusal shipped at #486; its collector reached two hardcoded fields, and **SIX positions still leaked a real `Bun.password.hash` into the browser bundle at exit 0** until #500. auth.map.md's position table and domain.map.md's §6.6.19 section are corrected. |
| **THIS PASS —** `<timer>`/`<poll>` first-tick asymmetry written in the present tense since S314 | **that was the SPEC amendment; the CODE landed at #510, this window.** Until then `_scrml_timer_start` had four parameters and no immediate-tick path, and the described behaviour was produced *accidentally* by the `collect.ts` descent defect. **A map section describing ratified intent in the present tense is indistinguishable from one describing shipped behaviour** — domain.map.md now splits the two explicitly. |
| known-gaps heading/marker drift "10" then "19" | **13**, machine-measured and reproducible |
| **THIS PASS (S346) —** config.map.md printed `bunfig [test] timeout = 10000ms` as live configuration; test.map.md echoed it as the runner config | **bun never read the key — the effective per-test budget was ALWAYS the default 5000 ms.** Wrong at every stamp that carried it, not merely stale. Both maps corrected; the key itself deleted on main at #537 with an explanatory comment. See N11 for the surviving test-file comments |
| **THIS PASS (S346) —** structure.map.md's Directory Ownership carried **ELEVEN verbatim-duplicated lines** across six row groups (`name-resolver.ts`, `emit-tool.ts`, `collect.ts`, `emit-ssr-render.ts`, `emit-lift.js`, the `_eachRequestIds`/`E-EACH-BODY` sub-rows, the `immediateArg`/`_scrml_timer_start` sub-rows, `collectDerivedCellDecls`) | all deduplicated (exact-line dedupe, one survivor each, verified). A duplicated row is a fork waiting to disagree — the next edit lands in one copy. The duplication pattern suggests a prior incremental pass APPENDED updated rows without removing the originals |
| **THIS PASS (S346) —** structure.map.md's emit-tool row named `identReferencedInSrc` as the prune predicate | **that function is DELETED on main (#515)**; the predicate is the shared `localServerImportNameUsed`, exported from emit-server.ts. Stale-at-write is not the charge here — it was current at S341 — but the row now names the replacement AND the reason the duplicate died |
| **THIS PASS (S346) —** domain/error maps carried "`~`/`var` in an `<each>` body already fails loud via `E-CODEGEN-INVALID-LOGIC`" | **held only at FIRST position** — at any other body position `var nm = 1` was the silent list-killing miscompile (#516 closed it; bryan delta-log [1437]). A coverage claim proven on one position is not a coverage claim |
| **THIS PASS (S368-wrap) —** primary · schema · structure · build all carried *"NOT ON MAIN, NOT MAPPED — the `asIs`/`unknown` split … lives on the unlanded branch `feat/s365-asis-split-rung0`"*, plus the same exclusion for `scripts/types-gate.ts` and `compiler/tests/TYPES-BASELINE.json` | **ALL OF IT LANDED at `43eea9aa` (#665).** `merge-base --is-ancestor 43eea9aa origin/main` exits 0; `UnknownType` carries the REQUIRED `reason` at `type-system.ts:387-389`; both files are in `git ls-tree HEAD`. **Rule produced: an exclusion for unlanded work must name the CONDITION that retires it, not just the state it observed — otherwise it reads as verified rather than time-bound.** (N14) |
| **THIS PASS (S368-wrap) —** test.map.md published *"The category sum re-checks: 885+196+132+92+11+8+4+2 = 1330, +14 top-level = **1378**"* | **That sum is 1,344.** A 34-file shortfall stated as a completed check. Recursive recount: 901+213+133+94+14+14+11+4+2 = **1,386**. **Rule produced: "the sum re-checks" is a claim like any other — execute it.** (N15) |
| **THIS PASS (S368-wrap) —** primary.map.md's routing row for `reset(@cell)` returning a Promise read *"OPEN, HIGH, not built"* | **FIXED at #662 (`5639cd0a`)** — `_scrml_reset_apply` (`runtime-template.js:1179`), both re-invocation paths. **Rule produced: a routing row carrying a STATUS is a currency liability in a way a row carrying only a LOCATION is not.** (N16) |
| **THIS PASS (S368-wrap) —** the map set had NO routing row, and no mention anywhere, for `liftBareDeclarations` / the §40.8 auto-lift surface | **THREE HIGH defects of one class landed there in one session** and `§40.8` appeared in primary.map.md only under `keep-alive` and the one-onion rule. **Rule produced: a routing table built by walking what CHANGED will never grow a row for a surface whose defects are all SILENT — nothing changed there, because nothing was fixed there.** Now Task-Shape Routing row 1 + invariant 64. (N18) |
| **THIS PASS (S368-wrap) —** counts across the map set: 242,954 lines / 190 files / 1,378 tests / 37,298 SPEC / 810 §34 codes | **244,112 / 191 / 1,386 / 37,539 / 812**, each re-derived (FACTS.md + a recursive `find` + a re-executed `s34-census.ts`). Conformance FLAT at **883** for the fourth window. |
| **THIS PASS (S372) —** `compiler/SPEC.md:11686` (§17.1.2.3) states a markup `if=` on a NON-ROOT element inside an `<each>` row template *"emits nothing — fails CLOSED (never renders)"* | **FALSE at this watermark. PA-REPRODUCED by compiling:** it emits a create-time append gate (`if (_scrml_each_item.ok) frag.appendChild(el)`) and fires `W-IF-IN-EACH` — it renders, then goes STALE. Measured-S302, overtaken by #416/GH #409, never updated. **Rule produced: a SPEC table marked "measured" carries a DATE, and the code can move under it — a measurement is a snapshot, not a normative claim.** (N25) |
| **THIS PASS (S372) —** `docs/known-gaps.md:2561` locus `emit-event-wiring.ts:647` for `g-else-if-dotted-cell-ref-emits-unregistered-flat-key` | **142 lines off** — `computeChainBranchCondition` is at `:750`, its `condition.name` arm at `:789`; `:647` is inside a DIFFERENT function. #704 inserted 192 lines above it. **Rule produced: a `locus=` should name a SYMBOL, not a line — a line number is invalidated by any edit above it.** (N26) |
| **THIS PASS (S372) —** dependencies.map.md's `ifRaw`/`ifCond` table: `captureStructuralIfAttr :2705` · `structuralHeaderAnchor :2797` · `visitStructuralIfAttr :12688` · `emitGatedStructural :1498` · `emitIfMountGate :1421` · `isGateableIfValue :1472` · dispatched-arm guard `:1508` · `stripSourceTextFromValue :1681` | **SEVEN OF EIGHT WRONG.** Truth: `:2731` · `:2823` · def `:13190` (calls `:12721`/`:12811`) · `:1516` · `:1439` · `:1490` · `:1526` · `:1611`. Only `creditFromAttrValue :2559` survived. **Rule produced: a table of bare line numbers is a maintenance liability no test covers.** (N27) |
| **THIS PASS (S372) —** primary.map.md's "Derived-figure authority" said *"Re-read at this HEAD, not carried"* and gave `244,112` / `1,386`; its routing row said the census returns `810 rows` | **Its OWN Fingerprint block said `244,175` / `1,387`, and its OWN Map Index row said `812`.** An internal contradiction inside one file. Corrected by execution: **`244,774` / `1,394` / `812`**. **Rule produced: diff a map against ITSELF — a self-contradiction is the cheapest tell that a "re-read" was a carry.** (N28) |
| **THIS PASS (S372) —** test.map.md's "338 PINNED at this HEAD", phrased as what `--full` computes | **343**, and `--full` and the plain census return the SAME number — the two modes have never disagreed. Category sum also re-counted recursively to `908+213+133+95+14+14+11+4+2 = 1,394`, agreeing exactly with FACTS.md. (N29) |
| **THIS PASS (S372) —** the map set had NO routing row for `if=`/`show=` LOWERING (and named `emit-event-wiring.ts` only for module-init), and NONE for `eachBlockFromMarkupNode` / the lift-vs-structural `<each>` split | **Both holes reported INDEPENDENTLY by two dispatches on the same day.** Four defects landed on `emit-event-wiring.ts` in this one window; the each split produced multiple dead pages. **Rule produced: a routing table built by walking what CHANGED grows no row for a DISTINCTION — nothing "changes" at a fork. After each window, ask which FORKS the defects turned on, not just which FILES moved.** (N30) |

---

## Aspirational / archival content — NO new mislocation this window

**RE-DERIVED AT THIS WATERMARK:** `git diff --name-status b9e97f1b..8b2e4053 -- '*.md' | grep '^A'`
returns exactly **five** new markdown files and **every one of them is under `docs/changes/`**, which
is the archived-dispatch-artifact convention (S133/S135 — every `isolation:worktree` dispatch archives
its prompt verbatim as `BRIEF.md`), i.e. out of scope by design:

    docs/changes/if-attr-per-field-synth-crash-2026-08-24/{BRIEF.md, progress.md}
    docs/changes/render-snippet-slot-trace-2026-08-24/{BRIEF.md, TRACE.md, progress.md}

**Filtering out `archive/`, `handOffs/` and `docs/changes/` leaves ZERO added `.md` files.** No
deep-dive, ADR, debate, gauntlet report, spec draft, proposal or planning doc was added to this repo
this window. `docs/deep-dives/`, `docs/adrs/`, `docs/debates/`, `docs/gauntlets/` and `docs/research/`
do not exist here — that content lives in `scrml-support`, and the separation held.

⚠ **THE ONE THING WORTH SAYING ABOUT THE `docs/changes/` ARTIFACTS: they are DISPATCH-TIME snapshots
and several of them are ALREADY superseded by the commits they produced.** `if-attr-per-field-synth-
crash-2026-08-24/progress.md` (+484 lines) records a premise — *per-field `.errors` collapse is safe
because the base is a dead page there* — that #704's own final commit message **retracts**, because it
was measured on one field-declaration form. **A `docs/changes/*` artifact is EVIDENCE OF A PROCESS,
never a statement of current behaviour.** Do not scope from one; scope from source at a watermark.
**Suggested disposition: none — leave them in place. They are correctly located and correctly
historical.** This note exists so a future reader does not mistake one for a spec.

## Uncertain — needs human review (both carried; existence RE-VERIFIED at this watermark, content unchanged)

⚠ **All seven filenames in the first entry and `docs/website/` were confirmed to still EXIST at
`8b2e4053`** — an "uncertain" entry that silently outlives its subject is worse than no entry, so the
check is cheap and is now run each pass. **Neither entry was touched by this window's diff.**

### `docs/language-inspiration-audit-2026-06-06.md`, `docs/lin.md`, `docs/external-js.md`, root `gaunt.md` / `DESIGN.md` / `NERDME.md` / `scrmlFormula.md`
**Reason uncertain:** each mixes durable design rationale with dated status claims, and the mix is
not separable by heuristic. Filename dates predate the current SPEC by two months, but the content
is not obviously superseded.
**What to check:** for each, decide whether it is (a) a current reference an adopter or agent should
read, (b) rationale that belongs in `scrml-support/docs/`, or (c) archival. **Unchanged this
window** — none was touched by the diff.

### `docs/website/`
**Reason uncertain:** a published surface with its own currency contract, not re-walked here.
**What to check:** whether the website's feature claims track the §34 catalog (**FLAT at 812 at this
watermark, re-censused not carried; this line read `807 → 809` and was two windows stale**) and the
two still-open server-only-leak positions. **A public page asserting that the
compiler prevents server-only code from reaching the browser would be over-claiming** — the guarantee
holds for functions and for derived cells (**and, only since #500 this window, for derived cells at
any depth**), and does NOT hold for a mutable-cell initialiser or a markup interpolation.

⚠ **RAISED IN URGENCY THIS PASS, on evidence rather than repetition.** Until #500 the derived-cell
guarantee itself did not hold in six measured positions, at exit 0, shipping a real
`Bun.password.hash` to the browser. **Any public claim written between #486 and #500 was not merely
imprecise — it was false for those positions**, and nobody checked, because the website is outside
every gate this repo runs. The question is no longer "does the marketing overstate the guarantee" but
"**what is the review path for a public confidentiality claim, and why is there none?**"

---

## Map currency at this stamp

**EVERY stamp is `fc6df72e` — the `merge-base HEAD origin/main` at WRITE time, NOT the tip.**
Verified at write time: `git diff --name-only fc6df72e..HEAD -- compiler/ scripts/ conformance/
stdlib/ lsp/ .github/ package.json` is **EMPTY** (HEAD `60803548` is one docs-only wrap commit above
it) and `git merge-base --is-ancestor fc6df72e origin/main` exits **0**. At this watermark the
merge-base IS `origin/main`, so there is no drift between the two.

⚑ **LINE 3 AND LINE 4 CARRY THE SAME SHA IN ALL 13 ARTIFACTS, DELIBERATELY.** At S372 a refresh
bumped line 3 while line 4 still named an older `generated-at:` — a self-contradicting watermark the
PA correctly refused to ship. **Two SHAs on two lines is a standing invitation to update one and not
the other.** When the source diff between the working tip and the merge-base is EMPTY there is no
second SHA to record, so one is recorded; the tip is named in prose where it cannot be mistaken for a
watermark. Audited across all 13 files at write time: **13 of 13 agree, and no file carries a
`commit:` token anywhere except line 3** (`scripts/state.ts:615-616` parses line 3 and no other).

`bun scripts/state.ts --check` re-run AFTER this pass's write prints
`maps: 1 commits behind HEAD (watermark fc6df72e, HEAD 60803548)  [WARN-only — not gated;
project-mapper seam]` — the 1 being this session's docs-only wrap commit, exactly what a merge-base
stamp should report. **Executed, and its exit status read: it still exits 0.** Nothing in the
toolchain fails on stale maps.

| Map | Stamp | Re-walked this pass? | Evidence |
|---|---|---|---|
| primary · structure · dependencies · domain · test · error · non-compliance | `fc6df72e` | **yes — targeted** | five `compiler/src` files moved, one of them a NEW module; `compiler/SPEC.md` +1 line (a §34 row); +4 test files |
| schema | `fc6df72e` | **no — stamp-advanced on measured zero-diff** | `compiler/src/types/` `--name-only` EMPTY for the FOURTEENTH consecutive window; `grep -E 'export (interface\|type) '` over the window's `+` lines is EMPTY |
| build · infra · config · migrations | `fc6df72e` | **no — stamp-advanced on measured zero-diff** | `.github/` / `package.json` / `bun.lock` / `Makefile` / `Dockerfile` / `scripts/` all EMPTY; env-var grep over the whole window diff returns 0; `'*migrat*'` returns only the map files themselves |
| auth | `fc6df72e` | **no — stamp-advanced on measured zero-diff, BUT a row was CORRECTED anyway (N32)** | the auth surface is EMPTY for the FOURTH consecutive window — **and that is precisely why the wrong-file onion citation survived four windows.** A stamp-advance proves the source did not move, not that the map was right |


### Carried currency table (S368 pass)

**EVERY stamp was `728bdc92`, which IS `origin/main` — trivially an ancestor.** There is no separate
working tip this pass: the `generated-at:` line records the same SHA, with the reason. **Only ONE
line per file carries `commit: <SHA>`** — `scripts/state.ts:mapsStaleness()` parses line 3 by regex
and a second match would be read as the watermark.

| Map | Stamp | Re-walked? | Evidence |
|---|---|---|---|
| primary · structure · dependencies · **schema** · domain · test · error · build · infra · non-compliance | `728bdc92` | **yes** | 28 source/test files moved across the window; every one traced to a landing and read at HEAD |
| config | `728bdc92` | no — **currency verified** | `grep -cE '^[+-].*(process\.env\|Bun\.env)'` over the whole 2,328-line source diff returns **0**; `.env*` / `bunfig.toml` / `tsconfig*` are `--name-only` EMPTY |
| auth | `728bdc92` | no — **currency verified** | `emit-server.ts`, `select-request-onion.js`, `protect-analyzer.ts`, `auth-graph.ts`, `stdlib/auth\|oauth\|crypto`, `lsp/` all `--name-only` EMPTY; re-walked LAST window, content is one window old |
| migrations | `728bdc92` | no — **currency verified** | `schema-differ.js` / `db-migrate.js` / `db-authoritative.ts` / `sql-table-refs.js` all zero-diff — twelfth window |

⚠ **schema.map.md WAS RE-WALKED THIS PASS AFTER A STREAK OF CURRENCY-ONLY PASSES, AND THE STREAK WAS
THE REASON.** Its header carried an explicit "NOT ON MAIN, NOT MAPPED" exclusion for the
`asIs`/`unknown` split — content that landed at #665. **A currency-verify would have re-published a
false claim**, because the surface it checks (`compiler/src/types`, and "no exported type added")
is genuinely zero-diff: the three new types are module-private to `type-system.ts`. **A zero-diff
proof of the surface you habitually check does not cover a claim you made about a DIFFERENT surface.**

**The watermark advanced `c96e7012` → `728bdc92`** — **21 commits, PRs #657-#676** — and the
arithmetic is clean at both ends: the prior stamp WAS an ancestor
(`merge-base --is-ancestor c96e7012 728bdc92` passes) and the new one IS `origin/main`. The outbound
check per the MAP-STAMP RULE returned an EMPTY source diff.

⚑ **THE BRANCH VANISHED UNDER THIS PASS — A STRONGER FORM OF THE DEFECT THE PRIOR PASS MEASURED, AND
THE CHECK CAUGHT IT AGAIN.** This generation began on `wrap/s368` at `6bb57c66`, under a dispatching
brief that said in as many words *"stay on it, do not switch branches."* Partway through, the
operator squash-merged that branch as **#676** and the checkout moved to `main` at `728bdc92`. **So
the SHA the pass started with is not merely a non-ancestor — it is on no branch at all**, and the
branch the brief named no longer exists. Re-running the three-command procedure at WRITE time
returned `BASE = 728bdc92` with an EMPTY source diff (#676 is docs-only), so the stamp is correct.
**Corollary now recorded in the MAP-STAMP RULE block: "which branch am I on" is ALSO a write-time
question. A pass that recorded its branch once at orientation would have committed to a merged
branch.**

**The carried residual stands:** `state.ts` checks ancestry against `HEAD`, not `origin/main`; the
written rule is stricter. ⚠ Also carried and MEASURED AGAIN: `bun scripts/state.ts --check` reports
maps staleness as **WARN-only, not gated** — mid-pass it printed
`maps: 22 commits behind HEAD (watermark c96e7012, HEAD 7b945a99)` and **exited 0**. **Nine
consecutive passes have recommended a deterministic map-currency gate; nothing has moved on it.**


## Tags
#non-compliance #project-mapper #cleanup #scrml #spec-stale-table #stale-locus #symbol-not-line #self-contradicting-map #routing-hole #reproduce-dont-relay #docs-changes-are-evidence-not-spec #line-ref-drift #merge-base-not-tip #fail-open-predicate #w-dead-function-wrong-locus #usage-analyzer-is-not-the-locus #routing-omission #chunk-pruning-blind-spot #ternary-markup-giti033 #off-by-nine-line-citation #tree-shaken-claim-false #not-on-main-exclusion-rot #routing-gap #section-40-8 #e-control-flow-in-markup #spec-vs-code-drift #sum-never-executed #branch-vanished-mid-pass #§18.5-four-routes #single-classifier-overstatement #map-stamp-rule #outbound-stamp-check #inbound-vs-outbound #squash-merge-orphans-a-branch-tip #three-of-five-stamps-orphaned #fe14c9b2-orphaned-ten-sessions #silent-instrument #behind-count-unavailable #mandatory-step-unanswerable #stale-orphaned-doc-comment #route-inference-3643 #fail-open-surface-restored-by-a-doc #filesscanned-is-environment-dependent #a-filesystem-walk-is-not-a-repo-fact #baked-line-number-in-tool-output #s305-citation-ruling #generated-md-never-tracked #untracked-artifact-no-gate-can-see #grep-hit-is-not-a-fire-site #w-lint-nnn-placeholder #w-lint-009-is-a-comment #spec-ahead-vs-shipped #ratified-is-not-implemented #six-leaking-positions #scope-barred-from-known-gaps #n12-spec-diff-grep-false-positives #code-is-new-only-if-absent-at-base #n13-census-reclassification #instrument-changed-not-catalog #c4-method-corrected #comment-is-not-a-fire #prose-is-not-a-row #n9-inverted #phrase-propagated-into-source #c3-narrower-than-recorded #watermark-moved-mid-run #run-outbound-check-at-write-time #maps-staleness-is-warn-only #112-commits-behind-no-failure #corpus-zero-debt-enforcement #wrong-file-not-drifted-line #internally-contradictory-figure #one-sha-on-two-lines #zero-diff-is-not-correctness #generated-maps-regenerated #symbol-locus-not-line-locus #invariant-71 #invariant-72
#plan-block-arm-lift-two-callsites #leaf-predicate-not-segmenter #§12.2-per-function-scope
#§12.6-wrong-module-set #spec-internal-contradiction #escalation-vs-async-set #gap-ledger-stale-open
#three-gaps-open-but-landed #s248-no-op-dispatch-class #cross-operator-ledger-blindness
#heading-marker-drift-13 #bidirectional-drift #state-ts-detector-shipped #§6.6.20-does-not-exist
#s34-census-fixed-everywhere #s320-n1-closed #w-lint-nine-not-eight #generated-md-under-reports-292
#delete-the-generated-indexes #tutorial-v0.7.0 #spec-index-authored-half #website-over-claim-risk
#810-codes #883-conformance #1378-tests #watermark-advanced #bunfig-timeout-never-in-force #timeout-wears-fail-marker #pa-scrml-primer-13-5-under-audit #corpus-emptiness-not-evidence #sliding-doors-audit #inputfiles-order-open #528-title-overclaim

## Links
- [primary.map.md](./primary.map.md)
- [domain.map.md](./domain.map.md)
- [error.map.md](./error.map.md)
- [auth.map.md](./auth.map.md)
- [build.map.md](./build.map.md)
- [test.map.md](./test.map.md)
- [structure.map.md](./structure.map.md)
- [dependencies.map.md](./dependencies.map.md)
- [known-gaps.md](../../docs/known-gaps.md)
- [changelog.md](../../docs/changelog.md)
- [FACTS.md](../../docs/FACTS.md)
- [master-list.md](../../master-list.md)
- [pa.md](../../pa.md)
