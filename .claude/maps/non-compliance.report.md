# non-compliance.report.md
# project: scrml
# generated: 2026-08-24T09:45:00-06:00  commit: b9e97f1b
# generated-at: b9e97f1b (the watermark IS `origin/main` and IS the working tip).
# **INCREMENTAL over `728bdc92` -> `b9e97f1b` (S371-bryan). SOURCE WINDOW = TWO FILES, one of them
# COMMENT-ONLY.** Ancestry CHECKED FIRST (invariant 48); the outbound MAP-STAMP check passes.
# scan mode: INCREMENTAL, TARGETED at the surface this window's diff could have falsified, PLUS
# the two carried route-inference findings re-verified BY READING THE FILE AT THIS HEAD.
## Summary — S371 pass (this pass)

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

### C8. The four `*.generated.md` indexes — **RECLASSIFIED THIS PASS. The finding was real and its CATEGORY was wrong for five windows.**

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

> **The table below is the PRIOR pass's correction ledger, retained because each rule it produced is
> still the rule.** This pass's own corrections are the four rows appended at the bottom.

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

---

## Aspirational / archival content — NO new mislocation this window

**RE-DERIVED AT THIS HEAD: `git diff --name-status c93a692c..c96e7012 -- '*.md' | grep '^A'` outside `archive/`, `handOffs/` and `docs/changes/` returns NOTHING.** Across 111 commits this window added **zero** new `.md` files to `docs/` or the repo root — every added doc is a rotated hand-off, a `docs/changes/<id>/` dispatch record, or an archive entry. `docs/audits/` still holds **20** files, all dated 2026-05 to 2026-07, all carried from prior passes; **the location finding on that directory is UNCHANGED, not re-litigated** — deep-dives, debates, ADRs and gauntlet reports belong in `scrml-support`, and `docs/audits/` is the standing exception the PA has chosen not to move. No new doc crossed the line this window.

**No new mislocation finding.** The window's added `.md` files partition cleanly:

| Added | Kind | Verdict |
|---|---|---|
| `docs/changes/{census-crossos-separator-fix, compilescrml-input-order-canonical, derived-transitive-r4, derived-transitive-r5, derived-transitive-r6, dev-compile-throw-fail-closed, flagship-hos-hermetic, gate-boot-listener-fix, gate-each-multiroot-image-debug, issue-debt-probe, maps-refresh-s341, pgnotify-listen-case-split, tool-import-prune-2026-08-11}/` (BRIEF/progress/FINDINGS/WORK-ORDER) | dispatch briefs + logs, archived at dispatch time per the standing convention | correctly located |
| `handOffs/hand-off-s343-bryan.md`, `handOffs/incoming/…` (3 files, one a pure rename) | rotated hand-offs + cross-clone inbox | correctly located; OUT OF SCOPE by the standing exclusion |

⚠ **Two of those `docs/changes/` ids describe work NOT LANDED at this watermark, and that is
CORRECT for a BRIEF but worth stating so nobody maps it as shipped:**
`dev-compile-throw-fail-closed/` is PR #539 (in flight — dev.js throw-path fail-close, dir watches,
debounce, `ctimeMs`), and `compilescrml-input-order-canonical/` is the OPEN
`g-compilescrml-input-order-dependent-emission` fix (HIGH). The name/content heuristics must not
fire inside `docs/changes/` — that directory's contract is "record of a decision process" — but a
READER must also not cite a BRIEF as evidence of a landing. The landed/not-landed authority is git.

**No `docs/deep-dives/`, `docs/adrs/`, `docs/debates/`, `docs/gauntlets/` or `docs/research/`
directory exists in this repo** — re-verified this pass; the location heuristic has nothing to fire
on, which is the correct steady state.

Carried nuance, still true: `docs/changes/**` may contain live `.scrml`/`.ts` evidence files
(this window adds `flagship-hos-hermetic/repro/compile-hos.ts` and
`pgnotify-listen-case-split/repro/ordersFeed.scrml`). They are evidence, not samples, and stay
outside the compile gate.

---

## Uncertain — needs human review (both carried, both unchanged)

### `docs/language-inspiration-audit-2026-06-06.md`, `docs/lin.md`, `docs/external-js.md`, root `gaunt.md` / `DESIGN.md` / `NERDME.md` / `scrmlFormula.md`
**Reason uncertain:** each mixes durable design rationale with dated status claims, and the mix is
not separable by heuristic. Filename dates predate the current SPEC by two months, but the content
is not obviously superseded.
**What to check:** for each, decide whether it is (a) a current reference an adopter or agent should
read, (b) rationale that belongs in `scrml-support/docs/`, or (c) archival. **Unchanged this
window** — none was touched by the diff.

### `docs/website/`
**Reason uncertain:** a published surface with its own currency contract, not re-walked here.
**What to check:** whether the website's feature claims track the §34 catalog's movement (**now
807 → 809**) and the two still-open server-only-leak positions. **A public page asserting that the
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

**EVERY stamp is `b9e97f1b`, which IS `origin/main` — trivially an ancestor.** Verified at WRITE
time: `git merge-base HEAD origin/main` -> `b9e97f1b`; the source diff against it is EMPTY;
`git merge-base --is-ancestor b9e97f1b origin/main` exits 0; and `bun scripts/state.ts --check`
prints **`maps: current`** (it printed `maps: 112 commits behind` at the start of the S368 pass).

| Map | Stamp | Re-walked this pass? | Evidence |
|---|---|---|---|
| primary · structure · error · test · non-compliance | `b9e97f1b` | **yes — targeted** | the routing gap (N19) + the chunk-pruning finding (N21); source claims re-verified BY EXECUTION, not by reading |
| dependencies | `b9e97f1b` | no — **zero-diff measured** | `package.json` / `bun.lock` `--name-only` EMPTY; `grep -cE '^[+-]import '` over the `route-inference.ts` diff returns 0 |
| schema | `b9e97f1b` | no — **zero-diff measured** | `compiler/src/types/`, `*.d.ts`, `schema*`, `*.proto`, `*.graphql`, `compiler/SPEC.md` all `--name-only` EMPTY |
| domain | `b9e97f1b` | no — **zero-diff measured** + one in-place gap-ID correction (N24) | `compiler/SPEC.md` `--name-only` EMPTY |
| build · infra | `b9e97f1b` | no — **zero-diff measured** | `.github/`, `package.json`, `Makefile`, `Dockerfile`, `scripts/` all `--name-only` EMPTY |
| config | `b9e97f1b` | no — **zero-diff measured** | `process.env`/`Bun.env` grep over the whole window's diff returns 0 |
| auth | `b9e97f1b` | no — **zero-diff measured**, second consecutive window | whole auth surface `--name-only` EMPTY |
| migrations | `b9e97f1b` | no — **zero-diff measured**, thirteenth consecutive window | no migration/schema/DB path in the window |

⚠ **THE S368 WARNING STILL APPLIES AND IS WHY THE TABLE ABOVE NAMES A SURFACE PER ROW:** a zero-diff
proof of the surface you habitually check does not cover a claim you made about a DIFFERENT surface.
S368 caught schema.map.md re-publishing a false "NOT ON MAIN" exclusion that way. **This pass's N23
is the same species one level down** — structure.map.md's `:273` / `:2167` citations were stale at
`728bdc92` too, and every currency-verify pass since re-published them.

---

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
#non-compliance #project-mapper #cleanup #scrml #w-dead-function-wrong-locus #usage-analyzer-is-not-the-locus #routing-omission #chunk-pruning-blind-spot #ternary-markup-giti033 #off-by-nine-line-citation #tree-shaken-claim-false #not-on-main-exclusion-rot #routing-gap #section-40-8 #e-control-flow-in-markup #spec-vs-code-drift #sum-never-executed #branch-vanished-mid-pass #§18.5-four-routes #single-classifier-overstatement #map-stamp-rule #outbound-stamp-check #inbound-vs-outbound #squash-merge-orphans-a-branch-tip #three-of-five-stamps-orphaned #fe14c9b2-orphaned-ten-sessions #silent-instrument #behind-count-unavailable #mandatory-step-unanswerable #stale-orphaned-doc-comment #route-inference-3643 #fail-open-surface-restored-by-a-doc #filesscanned-is-environment-dependent #a-filesystem-walk-is-not-a-repo-fact #baked-line-number-in-tool-output #s305-citation-ruling #generated-md-never-tracked #untracked-artifact-no-gate-can-see #grep-hit-is-not-a-fire-site #w-lint-nnn-placeholder #w-lint-009-is-a-comment #spec-ahead-vs-shipped #ratified-is-not-implemented #six-leaking-positions #scope-barred-from-known-gaps #n12-spec-diff-grep-false-positives #code-is-new-only-if-absent-at-base #n13-census-reclassification #instrument-changed-not-catalog #c4-method-corrected #comment-is-not-a-fire #prose-is-not-a-row #n9-inverted #phrase-propagated-into-source #c3-narrower-than-recorded #watermark-moved-mid-run #run-outbound-check-at-write-time #maps-staleness-is-warn-only #112-commits-behind-no-failure #corpus-zero-debt-enforcement
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
