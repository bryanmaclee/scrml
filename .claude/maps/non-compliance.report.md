# non-compliance.report.md
# project: scrml
# generated: 2026-08-23T08:54:48-06:00  commit: c96e7012
# generated-at: 565696e5 (informational — not the currency anchor; the working tip is a DOCS-ONLY
# wrap commit on `wrap/s365`).
# **INCREMENTAL over `c93a692c` -> `c96e7012` (111 commits, PRs #539-#654, TWO operators — peter
# S347-S366, bryan S347-S365).** Ancestry CHECKED FIRST (invariant 48); the outbound MAP-STAMP check
# passes (source diff `merge-base..HEAD` EMPTY, `c96e7012` an ancestor of `origin/main`).
# scan mode: INCREMENTAL, TARGETED at the surface this window's diff could have falsified, PLUS
# re-verification of the carried findings at this HEAD — **spot-EXECUTED, not carried on faith.**

## Summary — this pass

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

### N6. A STALE, ORPHANED DOC COMMENT IS LIVE ON `main` — `route-inference.ts:3643-3657` contradicts the block directly below it, on the same function

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

### S331-N5 (carried, UNCHANGED). `route-inference.ts:3438` cites SPEC **§6.6.20**; the section is **§6.6.19**

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

**EVERY stamp is `c96e7012`, the tip of `origin/main` at generation — trivially an ancestor.** The
working tip `c813d6bf` is a DOCS-ONLY wrap commit on `wrap/s365` (`docs/changelog.md`, `hand-off.md`,
`handOffs/delta-log.md`), recorded on the `generated-at:` line. The two-column convention carries:
line 3 is the currency anchor; "content as of X" is walk provenance. **Only ONE line per file carries
`commit: <SHA>`** — `scripts/state.ts:mapsStaleness()` parses line 3 by regex and a second match
would be read as the watermark.

| Map | Stamp | Content as of | Re-walked? | Evidence |
|---|---|---|---|---|
| primary · structure · dependencies · domain · test · error · build · infra · auth · non-compliance | `c96e7012` | `c96e7012` | **yes** | 127 files moved in the mapped roots; `emit-server.ts` +413, `dev.js` +953, three NEW `compiler/src/` modules |
| schema | `c96e7012` | `c96e7012` | no — **currency verified** | `compiler/src/types` zero-diff; AND `git diff c93a692c..c96e7012 -- compiler/src/ \| grep '^+' \| grep -E 'export (interface\|type) '` returns NOTHING |
| config | `c96e7012` | `c96e7012` | no — **currency verified** | `grep -cE 'process\.env\|Bun\.env'` over the window diff returns **0**; five new files checked individually, none reads an env var |
| migrations | `c96e7012` | `c96e7012` | no — **currency verified** | `schema-differ.js` / `db-migrate.js` / `db-authoritative.ts` / `sql-table-refs.js` all zero-diff over the full 111 commits |

⚠ **auth.map.md WAS RE-WALKED THIS PASS AFTER TEN CURRENCY-ONLY WINDOWS.** Its ten-window "zero-diff
auth surface" streak ended: `emit-server.ts` moved +413 lines and the REQUEST PIPELINE was re-ordered
(CORS preflight to stage 1) and re-scoped (`ratelimit=` back to per-route), with `handle()` moved
from per-route to top-level dispatch. **Two of those three were fail-OPEN.** A currency-verify would
have missed all of it — the streak was the reason to re-walk, not a reason to skip.

**The watermark advanced `c93a692c` → `c96e7012`** — **111 commits**, the largest interval in this
map set's history, and the arithmetic is clean at both ends: the prior stamp WAS an ancestor
(`merge-base --is-ancestor c93a692c c96e7012` passes) and the new one is
(`merge-base --is-ancestor c96e7012 origin/main` passes). The outbound check per the MAP-STAMP RULE
returned an EMPTY source diff.

⚠ **THE WATERMARK MOVED UNDER THIS PASS, MID-RUN, AND THE CHECK CAUGHT IT.** At the start of this
run `HEAD` was `c96e7012`; partway through, the operator committed `c813d6bf` on `wrap/s365`.
Re-running `git merge-base HEAD origin/main` produced `c96e7012` and the outbound source diff was
EMPTY (the new commit is docs-only), so the watermark is correct. **A pass that had read HEAD once at
the start and stamped it would have written a NON-ANCESTOR branch tip — exactly the defect the
MAP-STAMP RULE exists to prevent, arriving by a route the rule's own three-command procedure does
cover but only if the procedure is run at WRITE time, not at read time.** Run the outbound check
immediately before writing line 3, not at orientation.

**The carried residual stands:** `state.ts` checks ancestry against `HEAD`, not `origin/main`; the
written rule is stricter. A compliant stamp satisfies both; a branch-tip stamp can satisfy the
instrument and violate the rule. ⚠ Also carried and now MEASURED: `bun scripts/state.ts --check`
reports maps staleness as **WARN-only, not gated** — at the start of this run it printed
`maps: 112 commits behind HEAD`, and nothing failed. **The maps-currency check that
`pa-scrml-overlay.md {{maps_fills}}` requires before every dev dispatch is advisory, and a
112-commit drift produced no failure anywhere in the toolchain.**


## Tags
#non-compliance #project-mapper #cleanup #scrml #§18.5-four-routes #single-classifier-overstatement #map-stamp-rule #outbound-stamp-check #inbound-vs-outbound #squash-merge-orphans-a-branch-tip #three-of-five-stamps-orphaned #fe14c9b2-orphaned-ten-sessions #silent-instrument #behind-count-unavailable #mandatory-step-unanswerable #stale-orphaned-doc-comment #route-inference-3643 #fail-open-surface-restored-by-a-doc #filesscanned-is-environment-dependent #a-filesystem-walk-is-not-a-repo-fact #baked-line-number-in-tool-output #s305-citation-ruling #generated-md-never-tracked #untracked-artifact-no-gate-can-see #grep-hit-is-not-a-fire-site #w-lint-nnn-placeholder #w-lint-009-is-a-comment #spec-ahead-vs-shipped #ratified-is-not-implemented #six-leaking-positions #scope-barred-from-known-gaps #n12-spec-diff-grep-false-positives #code-is-new-only-if-absent-at-base #n13-census-reclassification #instrument-changed-not-catalog #c4-method-corrected #comment-is-not-a-fire #prose-is-not-a-row #n9-inverted #phrase-propagated-into-source #c3-narrower-than-recorded #watermark-moved-mid-run #run-outbound-check-at-write-time #maps-staleness-is-warn-only #112-commits-behind-no-failure #corpus-zero-debt-enforcement
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
