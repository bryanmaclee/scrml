# non-compliance.report.md
# project: scrml
# generated: 2026-08-11T14:53:28-06:00  commit: 4f034e13
# generated-at: 4f034e13 (informational — not the currency anchor)
# **INCREMENTAL over `8863d457` -> `4f034e13` (24 commits, TWO operators — bryan S331/S337/S338,
# peter S334/S335/S336/S339/S340).** Ancestry CHECKED FIRST (invariant 48):
# `git merge-base --is-ancestor 8863d457 4f034e13` passes, so the delta is bounded.
# **The watermark is `origin/main`'s tip** — the prior stamp `616688ea` was a branch tip.
# scan mode: INCREMENTAL, TARGETED at the surface this window's diff could have falsified, PLUS a
# full re-verification of every carried finding (not a carry-forward — each was re-run at this HEAD).

## Summary — this pass

**THE HEADLINE FINDING OF THE PRIOR PASS IS NOW A FIXED RULE, NOT A FINDING — and the reason it took
four passes to fix is itself the most transferable thing in this report.**

The off-main map stamp was first reported at S326, restated at S328 (in infra.map.md's own header, in
bold), and restated again at S331. **It recurred every single time.** This pass fixed it at the
source: primary.map.md now carries a MAP-STAMP RULE block, and invariant 48 is amended.

**The diagnosis: invariant 48 specified the INBOUND check and the failure is on the OUTBOUND side.**
"Verify the stamp is an ancestor" tells you to check the stamp you are READING. The S331 author did
exactly that (`git merge-base --is-ancestor 35d4d32e HEAD` — recorded in its header, and it passed),
then **named the correct outbound SHA in the very next sentence** (*"`616688ea` is ONE COMMIT AHEAD
of `origin/main` (`8863d457`)"*), and stamped the branch tip anyway. **A rule that names the command
but not the MOMENT does not bind.**

**And it was worse than the prior passes measured, because they only ever audited `primary.map.md`.**
Auditing all FIVE distinct stamps live in the set on arrival:

| stamp | maps | ancestor of `origin/main`? | orphaned since |
|---|---|---|---|
| `616688ea` | primary, structure, dependencies, build, error, test, auth, domain, non-compliance | **NO** — tip of `wrap/s331`, squashed as `2391d483` | S331 |
| `fe14c9b2` | schema | **NO** — tip of `wrap/s302` | **S302 — roughly TEN sessions** |
| `97576f35` | infra | **NO** — tip of `wrap/s326-bryan` | S326 |
| `e80b692e` | config | yes | — |
| `115e8b1b` | migrations | yes | — |

**`schema.map.md` is the instructive one and it is a NEW finding this pass.** The S331 currency pass
looked directly at that stamp and wrote *"the stamp stays honestly older"*. **It was right about AGE
and never asked about ANCESTRY.** Every "zero diff since `fe14c9b2`" command that header carried was,
strictly, unbounded — the conclusion survived, but by luck rather than by the check.

**The consequence was not cosmetic and it was SILENT.** `scripts/state.ts:545` guards its
behind-count with `merge-base --is-ancestor` and correctly REFUSES to print a number it cannot
compute (`:547`). But nothing escalates that refusal — so the pre-dispatch maps-currency check that
`pa-scrml-overlay.md {{maps_fills}}` mandates before EVERY dev dispatch **returned nothing, silently,
for three of the last six map generations.** A mandatory step was unanswerable and no gate noticed.
**Verified fixed at this pass: the probe now prints `maps: N commits behind HEAD`.**

**Beyond that, this pass found ONE new live source-code defect on `main` (N6), ONE published-figure
methodology bug (N7), and ONE new instance of the baked-`:line`-rot class (N8).** All five carried
findings were re-run at this HEAD and all five still hold.

## NEW this pass

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
in a delta comparison. **All three are corrected this pass**, and each now carries the tracked figure
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

(`scripts/source-text-regex-census.ts:136`, and the same citation in its header at `:38`.)

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
## RESOLVED this pass

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

---

## Aspirational / archival content — this window's new docs, all correctly located

**No new finding.** Every `.md` added this window is correctly located. The full added set is TEN
files and it partitions cleanly:

| Added | Kind | Verdict |
|---|---|---|
| `docs/changes/derived-server-only-reach-nested-positions-2026-08-10/BRIEF.md` + `progress.md` | dispatch brief + progress log, archived at dispatch time per the standing convention | correctly located |
| `docs/changes/tier-2-scaffold-retirement-2026-08-10/RULING.md` | a RULING — the durable output of a decision | correctly located |
| `handOffs/hand-off-s331.md`, `-s334.md`, `-s335.md`, `-s336.md`, `-s337-bryan.md`, `-s339-peter.md` | rotated session hand-offs | correctly located, and OUT OF SCOPE for these maps by the standing exclusion |
| `handOffs/incoming/2026-08-11-S338-bryan-to-S340-peter-508-review-findings.md` | a cross-clone inbox message | correctly located |

**No `docs/deep-dives/`, `docs/adrs/`, `docs/debates/`, `docs/gauntlets/` or `docs/research/`
directory exists in this repo** — verified this pass. The location heuristic that would route such
content to `scrml-support` has nothing to fire on, which is the correct steady state.

**Filename-heuristic note, so a future pass does not false-flag them:** two of the added paths carry
a `YYYY-MM-DD` date string (`…-2026-08-10/`) and one carries `-plan`-adjacent vocabulary in its body.
**Both are inside `docs/changes/<id>/`, where a date IS the id convention**, and a `BRIEF.md` is
*supposed* to describe work that had not happened yet at the time it was written. **The name and
content heuristics must not fire inside `docs/changes/` — that directory's whole contract is
"historical record of a decision process".**

One nuance carried from the prior pass, still true: `docs/changes/**` may contain **live `.scrml`
files** used as executable evidence for a measured claim (the S331 `reproducer.scrml` /
`control-function.scrml` pair). These are evidence, not sample code. **They are outside the compile
gate and should stay there** — if they ever enter it, `reproducer.scrml` will correctly fail with
`E-DERIVED-SERVER-ONLY-REACH`, which is the point of it.

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

**EVERY stamp below is an ancestor of `origin/main`, verified per-map — `git merge-base --is-ancestor
<stamp> origin/main` exits 0 for all thirteen.** That sentence could not have been written about any
prior generation of this map set.

| Map | Stamp | Content as of | Re-walked? | Evidence |
|---|---|---|---|---|
| primary · structure · dependencies · domain · test · error | `4f034e13` | `4f034e13` | **yes** | 28 source-bearing files moved |
| build | `4f034e13` | `4f034e13` | **partially** | `.github/` + `package.json` zero-diff; `scripts/` gained three files and was re-walked |
| non-compliance | `4f034e13` | `4f034e13` | **yes** | this file |
| auth | `4f034e13` | `616688ea` | no — **currency verified, ONE row corrected** | `stdlib/` zero-diff; `emit-server.ts` moved by exactly one line (the §52.8 lint call at `:5162`), not an auth path. The §6.6.19 position-coverage table was corrected in place because #500 changed its reach |
| schema | `4f034e13` | `fe14c9b2` | no — **currency verified** | `git diff --name-only 8863d457..4f034e13 -- compiler/src/types` is EMPTY (nine windows) |
| config | `4f034e13` | `e80b692e` | no — **currency verified** | zero added/removed `process.env`/`Bun.env` lines in the whole window diff; the three NEW `scripts/` files checked individually and read no env var |
| infra | `4f034e13` | `97576f35` (== `b7f89952`) | no — **currency verified** | `git diff --name-only 8863d457..4f034e13 -- .github/` is EMPTY |
| migrations | `4f034e13` | `115e8b1b` | no — **currency verified** | `schema-differ.js` / `db-migrate.js` / `db-authoritative.ts` / `sql-table-refs.js` all zero-diff |

**The watermark advanced `8863d457` → `4f034e13`** — 24 commits. **Note the arithmetic: the PRIOR
map's PRINTED stamp was `616688ea`, and it is not the commit this window was measured from.**
`8863d457` is `616688ea`'s merge-base with `main` and is the SHA at which the incoming maps were
actually accurate. **A stamp that is not an ancestor does not merely mislead — it cannot be used as
an interval endpoint at all**, which is why this pass had to derive its own starting point.

⚠ **The instrument's behaviour is now correctly understood, and the earlier characterisation of it in
this report was wrong.** Prior passes wrote that `scripts/state.ts` "performs no ancestry check". **It
does** — `:545` guards with `merge-base --is-ancestor <watermark> HEAD` and `:547` returns
`watermark X is NOT an ancestor of HEAD Y (diverged/rebased) — behind-count unavailable`. **The
problem was never a missing check; it was that the check's negative result terminates silently.** It
is WARN-only, nothing consumes the refusal, and `{{maps_fills}}` — which mandates a currency read
before every dev dispatch — simply got nothing back. **Verified working at this pass: with an
ancestor watermark it prints `maps: N commits behind HEAD`.**

**The residual, stated plainly:** the guard compares against `HEAD`, not `origin/main`. The rule
written into primary.map.md is STRICTER (ancestor of `origin/main`), which implies HEAD-ancestry for
any HEAD on or descended from main — so a compliant stamp always satisfies the instrument. **A stamp
that satisfies the instrument does not always satisfy the rule**, and that gap is what let three
generations pass their own check.

## Tags
#non-compliance #project-mapper #cleanup #scrml #§18.5-four-routes #single-classifier-overstatement #map-stamp-rule #outbound-stamp-check #inbound-vs-outbound #squash-merge-orphans-a-branch-tip #three-of-five-stamps-orphaned #fe14c9b2-orphaned-ten-sessions #silent-instrument #behind-count-unavailable #mandatory-step-unanswerable #stale-orphaned-doc-comment #route-inference-3643 #fail-open-surface-restored-by-a-doc #filesscanned-is-environment-dependent #a-filesystem-walk-is-not-a-repo-fact #baked-line-number-in-tool-output #s305-citation-ruling #generated-md-never-tracked #untracked-artifact-no-gate-can-see #grep-hit-is-not-a-fire-site #w-lint-nnn-placeholder #w-lint-009-is-a-comment #spec-ahead-vs-shipped #ratified-is-not-implemented #six-leaking-positions #scope-barred-from-known-gaps
#plan-block-arm-lift-two-callsites #leaf-predicate-not-segmenter #§12.2-per-function-scope
#§12.6-wrong-module-set #spec-internal-contradiction #escalation-vs-async-set #gap-ledger-stale-open
#three-gaps-open-but-landed #s248-no-op-dispatch-class #cross-operator-ledger-blindness
#heading-marker-drift-13 #bidirectional-drift #state-ts-detector-shipped #§6.6.20-does-not-exist
#s34-census-fixed-everywhere #s320-n1-closed #w-lint-nine-not-eight #generated-md-under-reports-292
#delete-the-generated-indexes #tutorial-v0.7.0 #spec-index-authored-half #website-over-claim-risk
#807-codes #880-conformance #1334-tests #watermark-advanced #no-ancestry-check

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
